import { LIMITS, MalformedDocumentError } from './limits';

/**
 * A deliberately small XML scanner.
 *
 * Spreadsheet parts are machine-generated XML with a shallow, predictable shape,
 * and what this importer needs from them is a stream of tags and text. A full
 * parser would bring capabilities that are pure liability here — entity
 * declarations, external entity resolution, DTD processing — which are the
 * mechanism behind XXE and the billion-laughs expansion.
 *
 * So this scanner does not implement them at all. It resolves the five predefined
 * entities and numeric character references, and treats a `<!DOCTYPE` or
 * `<!ENTITY` declaration as a malformed document rather than as an instruction.
 * There is nothing to disable, which is a stronger guarantee than a flag.
 */

export interface XmlTag {
  readonly kind: 'open' | 'close' | 'self-closing';
  readonly name: string;
  readonly attributes: ReadonlyMap<string, string>;
}

export interface XmlText {
  readonly kind: 'text';
  readonly value: string;
}

export type XmlToken = XmlTag | XmlText;

const NUMERIC_ENTITY = /&#(x?)([0-9a-fA-F]+);/g;
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/**
 * Resolves the entities XML defines and nothing else.
 *
 * An unknown entity is left as written rather than resolved or expanded. That is
 * the safe direction: worst case a reviewer sees `&custom;` in a description and
 * corrects it, which is far better than a parser that can be made to read a file
 * off the machine.
 */
export function decodeXmlText(raw: string): string {
  const withNumeric = raw.replace(NUMERIC_ENTITY, (match, hex: string, digits: string) => {
    const code = Number.parseInt(digits, hex === '' ? 10 : 16);
    if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
    // Surrogates and NUL are not legal XML characters; leaving them out keeps
    // downstream string handling honest.
    if (code === 0 || (code >= 0xd800 && code <= 0xdfff)) return '';
    return String.fromCodePoint(code);
  });

  return withNumeric.replace(/&([a-zA-Z]+);/g, (match, name: string) => {
    const resolved = NAMED_ENTITIES[name];
    return resolved ?? match;
  });
}

function parseAttributes(source: string): ReadonlyMap<string, string> {
  const attributes = new Map<string, string>();
  const pattern = /([:\w.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match = pattern.exec(source);
  while (match !== null) {
    const name = match[1];
    const value = match[3] ?? match[4] ?? '';
    if (name !== undefined) attributes.set(name, decodeXmlText(value));
    match = pattern.exec(source);
  }
  return attributes;
}

/**
 * Walks the document, handing each tag and text run to the visitor.
 *
 * Returning `false` from the visitor stops the walk — how the callers bound work
 * on a sheet with more rows than {@link LIMITS} allows without reading the rest.
 */
export function scanXml(source: string, visit: (token: XmlToken) => boolean | void): void {
  let cursor = 0;

  while (cursor < source.length) {
    const open = source.indexOf('<', cursor);

    if (open === -1) {
      const trailing = source.slice(cursor);
      if (trailing.trim().length > 0) visit({ kind: 'text', value: decodeXmlText(trailing) });
      return;
    }

    if (open > cursor) {
      const text = source.slice(cursor, open);
      if (text.length > 0 && visit({ kind: 'text', value: decodeXmlText(text) }) === false)
        return;
    }

    if (source.startsWith('<!--', open)) {
      const end = source.indexOf('-->', open + 4);
      if (end === -1)
        throw new MalformedDocumentError('malformed_document', 'unclosed comment');
      cursor = end + 3;
      continue;
    }

    if (source.startsWith('<![CDATA[', open)) {
      const end = source.indexOf(']]>', open + 9);
      if (end === -1) throw new MalformedDocumentError('malformed_document', 'unclosed CDATA');
      // CDATA content is literal: no entity resolution, by definition.
      if (visit({ kind: 'text', value: source.slice(open + 9, end) }) === false) return;
      cursor = end + 3;
      continue;
    }

    if (source.startsWith('<!DOCTYPE', open) || source.startsWith('<!ENTITY', open)) {
      throw new MalformedDocumentError(
        'malformed_document',
        'the document declares entities, which this importer refuses to process',
      );
    }

    if (source.startsWith('<?', open)) {
      const end = source.indexOf('?>', open + 2);
      if (end === -1) {
        throw new MalformedDocumentError(
          'malformed_document',
          'unclosed processing instruction',
        );
      }
      cursor = end + 2;
      continue;
    }

    const close = source.indexOf('>', open);
    if (close === -1) {
      throw new MalformedDocumentError('malformed_document', 'unclosed tag');
    }

    const inner = source.slice(open + 1, close);
    cursor = close + 1;

    if (inner.startsWith('/')) {
      if (
        visit({ kind: 'close', name: inner.slice(1).trim(), attributes: new Map() }) === false
      ) {
        return;
      }
      continue;
    }

    const selfClosing = inner.endsWith('/');
    const body = selfClosing ? inner.slice(0, -1) : inner;
    const nameEnd = body.search(/[\s/]/);
    const name = (nameEnd === -1 ? body : body.slice(0, nameEnd)).trim();
    const attributeSource = nameEnd === -1 ? '' : body.slice(nameEnd);

    if (
      visit({
        kind: selfClosing ? 'self-closing' : 'open',
        name,
        attributes: parseAttributes(attributeSource),
      }) === false
    ) {
      return;
    }
  }
}

/** Strips the namespace prefix: `a:t` becomes `t`. */
export function localName(name: string): string {
  const colon = name.indexOf(':');
  return colon === -1 ? name : name.slice(colon + 1);
}

/** Decodes an XML part, refusing anything that is not valid UTF-8 text. */
export function decodeXmlPart(bytes: Uint8Array): string {
  if (bytes.byteLength > LIMITS.maxInflatedBytes) {
    throw new MalformedDocumentError('malformed_document', 'an XML part is implausibly large');
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}
