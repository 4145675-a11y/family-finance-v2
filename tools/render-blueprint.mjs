/**
 * A reader for `render.yaml` — deliberately a small one.
 *
 * The blueprint is the contract between this repository and the machine that
 * runs it (ADR-0033), and `render-blueprint.test.mjs` holds it to that
 * contract. A test needs to read the file, and the repository has no YAML
 * dependency — nor does it want a full YAML implementation for a file that
 * must stay simple enough for the owner to read.
 *
 * So this parser accepts exactly the subset the blueprint uses — maps, lists,
 * plain and quoted scalars, comments, two-space indentation — and refuses
 * everything else: tabs, anchors, aliases, flow syntax, block scalars, multiple
 * documents, duplicate keys. A refusal is a finding, not a limitation: a
 * blueprint that needs more than this has become something to review.
 *
 * Zero dependencies: Node built-ins only, like the rest of tools/.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const BLUEPRINT_PATH = fileURLToPath(new URL('../render.yaml', import.meta.url));

/** A line the parser refuses, with the line number so the finding can be located. */
export class BlueprintSyntaxError extends Error {
  /**
   * @param {number} line
   * @param {string} reason
   */
  constructor(line, reason) {
    super(`render.yaml line ${line}: ${reason}`);
    this.name = 'BlueprintSyntaxError';
    this.line = line;
  }
}

/**
 * Removes a trailing comment. `#` starts one at the beginning of the content or
 * after whitespace, and never inside quotes.
 * @param {string} text
 */
function stripComment(text) {
  let quote = null;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quote !== null) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === '#' && (index === 0 || /\s/.test(text[index - 1] ?? ''))) {
      return text.slice(0, index);
    }
  }
  return text;
}

/** Characters a plain scalar may not begin with: each starts a YAML feature this file does not use. */
const REFUSED_LEADING = new Set([
  '&',
  '*',
  '!',
  '|',
  '>',
  '[',
  ']',
  '{',
  '}',
  '%',
  '@',
  '`',
  ',',
]);

/**
 * @param {string} raw
 * @param {number} line
 * @returns {string | number | boolean | null}
 */
function scalar(raw, line) {
  const text = raw.trim();
  if (text.startsWith("'")) {
    if (!text.endsWith("'") || text.length < 2)
      throw new BlueprintSyntaxError(line, 'unterminated quote');
    const inner = text.slice(1, -1);
    if (inner.includes("'"))
      throw new BlueprintSyntaxError(line, 'quote inside a single-quoted value');
    return inner;
  }
  if (text.startsWith('"')) {
    if (!text.endsWith('"') || text.length < 2)
      throw new BlueprintSyntaxError(line, 'unterminated quote');
    const inner = text.slice(1, -1);
    if (inner.includes('\\') || inner.includes('"')) {
      throw new BlueprintSyntaxError(line, 'escape sequence in a double-quoted value');
    }
    return inner;
  }
  if (REFUSED_LEADING.has(text[0] ?? '')) {
    throw new BlueprintSyntaxError(
      line,
      `value begins with "${text[0]}", which is not plain YAML`,
    );
  }
  if (text.includes(': ') || text.endsWith(':')) {
    throw new BlueprintSyntaxError(line, 'a plain value may not contain ": "');
  }
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'null' || text === '~') return null;
  // Mirrors YAML: an unquoted number is a number. The blueprint test insists
  // that env values are strings, which is why `'1'` is quoted in render.yaml.
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  return text;
}

const KEY = /^([A-Za-z_][A-Za-z0-9_]*):(?:\s+(.*))?$/;

/**
 * Parses the accepted subset.
 * @param {string} source
 * @returns {unknown}
 */
export function parseBlueprint(source) {
  if (source.includes('\t')) {
    const line = source.slice(0, source.indexOf('\t')).split('\n').length;
    throw new BlueprintSyntaxError(line, 'tab character');
  }

  const lines = source
    .split(/\r?\n/)
    .map((raw, index) => ({ line: index + 1, text: stripComment(raw).trimEnd() }))
    .filter((entry) => entry.text.trim() !== '');

  for (const entry of lines) {
    if (entry.text === '---' || entry.text === '...') {
      throw new BlueprintSyntaxError(entry.line, 'document marker; one document only');
    }
  }

  let position = 0;
  /** @param {{text: string}} entry */
  const indentOf = (entry) => entry.text.length - entry.text.trimStart().length;

  /** @param {number} indent */
  function parseNode(indent) {
    const entry = lines[position];
    if (entry === undefined) throw new BlueprintSyntaxError(0, 'unexpected end of file');
    return entry.text.trimStart().startsWith('- ') ? parseList(indent) : parseMap(indent);
  }

  /** @param {number} indent */
  function parseMap(indent) {
    /** @type {Record<string, unknown>} */
    const map = {};
    while (position < lines.length) {
      const entry = lines[position];
      if (entry === undefined) break;
      const level = indentOf(entry);
      if (level < indent) break;
      if (level > indent) throw new BlueprintSyntaxError(entry.line, 'unexpected indentation');
      const body = entry.text.trim();
      if (body.startsWith('- '))
        throw new BlueprintSyntaxError(entry.line, 'list item where a key was expected');
      const match = KEY.exec(body);
      if (match === null) throw new BlueprintSyntaxError(entry.line, 'expected "key: value"');
      const key = match[1] ?? '';
      const rest = match[2];
      if (Object.hasOwn(map, key))
        throw new BlueprintSyntaxError(entry.line, `duplicate key "${key}"`);
      position += 1;
      if (rest === undefined || rest.trim() === '') {
        const next = lines[position];
        if (next === undefined || indentOf(next) <= indent) {
          throw new BlueprintSyntaxError(entry.line, `"${key}" has no value`);
        }
        map[key] = parseNode(indentOf(next));
      } else {
        map[key] = scalar(rest, entry.line);
      }
    }
    return map;
  }

  /** @param {number} indent */
  function parseList(indent) {
    /** @type {unknown[]} */
    const list = [];
    while (position < lines.length) {
      const entry = lines[position];
      if (entry === undefined) break;
      const level = indentOf(entry);
      if (level < indent) break;
      if (level > indent) throw new BlueprintSyntaxError(entry.line, 'unexpected indentation');
      const body = entry.text.trim();
      if (!body.startsWith('- '))
        throw new BlueprintSyntaxError(entry.line, 'expected a list item');
      const item = body.slice(2).trim();
      if (KEY.test(item)) {
        // `- key: value` opens a map whose keys sit two columns in.
        lines[position] = { line: entry.line, text: `${' '.repeat(indent + 2)}${item}` };
        list.push(parseMap(indent + 2));
      } else {
        list.push(scalar(item, entry.line));
        position += 1;
      }
    }
    return list;
  }

  if (lines.length === 0) throw new BlueprintSyntaxError(1, 'empty document');
  const first = lines[0];
  if (first !== undefined && indentOf(first) !== 0) {
    throw new BlueprintSyntaxError(first.line, 'document must start at column 0');
  }
  const document = parseNode(0);
  const leftover = lines[position];
  if (leftover !== undefined)
    throw new BlueprintSyntaxError(leftover.line, 'unexpected indentation');
  return document;
}

/** The repository's blueprint, parsed. */
export function readBlueprint() {
  return parseBlueprint(readFileSync(BLUEPRINT_PATH, 'utf8'));
}
