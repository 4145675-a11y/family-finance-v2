import { LIMITS, type Deadline } from './limits';
import {
  PdfLexer,
  dictOf,
  latin1,
  nameOf,
  type PdfDict,
  type PdfDocument,
  type PdfObject,
} from './pdf-objects';

/**
 * Turning a page's drawing instructions back into text.
 *
 * A PDF does not contain sentences. It contains "put these glyph codes at this
 * position in this font", and the mapping from a glyph code back to a letter lives
 * in the font. For a Hebrew statement that mapping is essential: without the
 * font's `ToUnicode` table the same bytes are meaningless numbers.
 *
 * Positions are kept, not discarded, because they are what makes a table readable.
 * Text drawn at the same vertical position is one row; the horizontal positions
 * within it are the columns. That is a heuristic and it is labelled as one — a row
 * this module produces is a *candidate*, and every candidate goes to human review
 * with the source page recorded beside it.
 *
 * What is deliberately not attempted: interpreting graphics, following links,
 * running actions, or claiming that a visual layout was understood. If a page has
 * no text operators at all, the honest answer is that the page is an image, and
 * that is what gets reported.
 */

export interface TextRun {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  /** Approximate width, used to tell a column gap from a word space. */
  readonly width: number;
  readonly fontSize: number;
}

export interface PdfPageText {
  readonly pageNumber: number;
  readonly runs: readonly TextRun[];
  /** The page's text in reading order, one line per row of runs. */
  readonly lines: readonly string[];
  /** True when the page carried no text-drawing operators at all. */
  readonly imageOnly: boolean;
}

/** Maps a byte or two-byte code to the characters it stands for. */
interface FontMapping {
  readonly toUnicode: ReadonlyMap<number, string>;
  /** True when codes in this font are two bytes wide. */
  readonly twoByte: boolean;
  /** Simple-font encoding differences, code to glyph name. */
  readonly differences: ReadonlyMap<number, string>;
}

const EMPTY_FONT: FontMapping = {
  toUnicode: new Map(),
  twoByte: false,
  differences: new Map(),
};

/**
 * Glyph names that appear in `/Differences` and mean a Hebrew letter.
 *
 * Only the ones a Hebrew document actually uses. A name we do not know maps to
 * nothing, which shows the reviewer a gap rather than a wrong letter.
 */
const GLYPH_NAMES: Readonly<Record<string, string>> = {
  space: ' ',
  period: '.',
  comma: ',',
  hyphen: '-',
  slash: '/',
  colon: ':',
  percent: '%',
  parenleft: '(',
  parenright: ')',
  zero: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  afii57664: 'א',
  afii57665: 'ב',
  afii57666: 'ג',
  afii57667: 'ד',
  afii57668: 'ה',
  afii57669: 'ו',
  afii57670: 'ז',
  afii57671: 'ח',
  afii57672: 'ט',
  afii57673: 'י',
  afii57674: 'ך',
  afii57675: 'כ',
  afii57676: 'ל',
  afii57677: 'ם',
  afii57678: 'מ',
  afii57679: 'ן',
  afii57680: 'נ',
  afii57681: 'ס',
  afii57682: 'ע',
  afii57683: 'ף',
  afii57684: 'פ',
  afii57685: 'ץ',
  afii57686: 'צ',
  afii57687: 'ק',
  afii57688: 'ר',
  afii57689: 'ש',
  afii57690: 'ת',
};

function glyphNameToText(name: string): string {
  const known = GLYPH_NAMES[name];
  if (known !== undefined) return known;
  // `uni05D0` and `u05D0` are the conventional explicit forms.
  const explicit = name.match(/^uni([0-9A-Fa-f]{4})$/) ?? name.match(/^u([0-9A-Fa-f]{4,6})$/);
  if (explicit?.[1] !== undefined) {
    const code = Number.parseInt(explicit[1], 16);
    if (Number.isFinite(code) && code > 0 && code <= 0x10ffff)
      return String.fromCodePoint(code);
  }
  return '';
}

/**
 * Reads a `ToUnicode` CMap.
 *
 * The format is a small PostScript-like program, but only two constructs carry the
 * mapping: `beginbfchar` lists code-to-string pairs, and `beginbfrange` lists
 * spans. Nothing is executed; the two sections are read as data.
 */
function parseToUnicode(source: string): { map: Map<number, string>; twoByte: boolean } {
  const map = new Map<number, string>();
  let twoByte = false;

  const codespace = source.match(/begincodespacerange([\s\S]*?)endcodespacerange/);
  if (codespace?.[1] !== undefined) {
    const first = codespace[1].match(/<([0-9A-Fa-f]+)>/);
    if (first?.[1] !== undefined && first[1].length >= 4) twoByte = true;
  }

  const hexToText = (hex: string): string => {
    let text = '';
    for (let index = 0; index + 3 < hex.length + 1; index += 4) {
      const unit = Number.parseInt(hex.slice(index, index + 4), 16);
      if (!Number.isFinite(unit)) break;
      text += String.fromCharCode(unit);
    }
    return text;
  };

  for (const block of source.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    const body = block[1] ?? '';
    for (const pair of body.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g)) {
      const code = Number.parseInt(pair[1] ?? '', 16);
      if (!Number.isFinite(code)) continue;
      if ((pair[1] ?? '').length >= 4) twoByte = true;
      map.set(code, hexToText(pair[2] ?? ''));
    }
  }

  for (const block of source.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const body = block[1] ?? '';

    for (const span of body.matchAll(
      /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g,
    )) {
      const start = Number.parseInt(span[1] ?? '', 16);
      const end = Number.parseInt(span[2] ?? '', 16);
      const base = span[3] ?? '';
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
      if ((span[1] ?? '').length >= 4) twoByte = true;
      if (end - start > 65_535) continue;

      const baseValue = Number.parseInt(base.slice(-4), 16);
      const prefix = base.length > 4 ? hexToText(base.slice(0, base.length - 4)) : '';
      for (let code = start; code <= end; code += 1) {
        if (!Number.isFinite(baseValue)) break;
        map.set(code, prefix + String.fromCharCode(baseValue + (code - start)));
      }
    }

    for (const span of body.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[([\s\S]*?)\]/g)) {
      const start = Number.parseInt(span[1] ?? '', 16);
      if (!Number.isFinite(start)) continue;
      if ((span[1] ?? '').length >= 4) twoByte = true;
      let offset = 0;
      for (const item of (span[3] ?? '').matchAll(/<([0-9A-Fa-f]*)>/g)) {
        map.set(start + offset, hexToText(item[1] ?? ''));
        offset += 1;
      }
    }
  }

  return { map, twoByte };
}

function readFont(document: PdfDocument, fontObject: PdfObject | undefined): FontMapping {
  const font = dictOf(document.resolve(fontObject));
  if (font === null) return EMPTY_FONT;

  let toUnicode = new Map<number, string>();
  let twoByte = nameOf(document.resolve(font.entries.get('Subtype'))) === 'Type0';

  const toUnicodeStream = document.resolve(font.entries.get('ToUnicode'));
  if (toUnicodeStream?.kind === 'stream') {
    const decoded = document.decodeStream(toUnicodeStream);
    if (decoded.byteLength > 0) {
      const parsed = parseToUnicode(latin1(decoded));
      toUnicode = parsed.map;
      twoByte = twoByte || parsed.twoByte;
    }
  }

  const differences = new Map<number, string>();
  const encoding = document.resolve(font.entries.get('Encoding'));
  const encodingDict = dictOf(encoding);
  if (encodingDict !== null) {
    const list = document.resolve(encodingDict.entries.get('Differences'));
    if (list?.kind === 'array') {
      let code = 0;
      for (const item of list.items) {
        const resolved = document.resolve(item);
        if (resolved?.kind === 'number') {
          code = resolved.value;
          continue;
        }
        if (resolved?.kind === 'name') {
          differences.set(code, resolved.value);
          code += 1;
        }
      }
    }
  }

  return { toUnicode, twoByte, differences };
}

/** Decodes one PDF string with a font's mapping. */
function decodeWithFont(bytes: Uint8Array, font: FontMapping): string {
  let text = '';

  if (font.twoByte) {
    for (let index = 0; index + 1 < bytes.length; index += 2) {
      const code = ((bytes[index] ?? 0) << 8) | (bytes[index + 1] ?? 0);
      text += font.toUnicode.get(code) ?? '';
    }
    return text;
  }

  for (const byte of bytes) {
    const mapped = font.toUnicode.get(byte);
    if (mapped !== undefined) {
      text += mapped;
      continue;
    }
    const difference = font.differences.get(byte);
    if (difference !== undefined) {
      text += glyphNameToText(difference);
      continue;
    }
    // No mapping: fall back to the byte as Latin-1, which is right for the ASCII
    // range every statement uses for its digits and dates.
    text += byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : '';
  }

  return text;
}

type Matrix = readonly [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4],
    a[4] * b[1] + a[5] * b[3] + b[5],
  ];
}

/**
 * Walks one content stream, collecting positioned text.
 *
 * The text state machine implemented here is the subset that moves the pen:
 * `BT`/`ET`, `Tf`, `Td`, `TD`, `Tm`, `T*`, `TL`, `Tj`, `TJ`, `'` and `"`. Painting,
 * clipping, colour and image operators are read and discarded — they cannot
 * produce a character.
 */
function extractRuns(
  content: Uint8Array,
  fonts: ReadonlyMap<string, FontMapping>,
  deadline: Deadline,
): { runs: TextRun[]; sawTextOperator: boolean } {
  const runs: TextRun[] = [];
  const lexer = new PdfLexer(content, 0);
  const stack: PdfObject[] = [];

  let textMatrix: Matrix = IDENTITY;
  let lineMatrix: Matrix = IDENTITY;
  let font: FontMapping = EMPTY_FONT;
  let fontSize = 10;
  let leading = 0;
  let charSpacing = 0;
  let wordSpacing = 0;
  let horizontalScale = 1;
  let sawTextOperator = false;
  let characterBudget = LIMITS.maxPdfPageChars;

  const numberAt = (indexFromEnd: number): number => {
    const object = stack[stack.length - indexFromEnd];
    return object?.kind === 'number' ? object.value : 0;
  };

  const show = (bytes: Uint8Array) => {
    const text = decodeWithFont(bytes, font);
    if (text.length === 0) return;

    characterBudget -= text.length;
    if (characterBudget < 0) return;

    // The pen position in page space is the translation of the text matrix.
    const x = textMatrix[4];
    const y = textMatrix[5];
    const width = text.length * fontSize * 0.5 * horizontalScale;

    runs.push({ text, x, y, width, fontSize });

    // Advance the pen. An exact advance needs per-glyph widths from the font
    // program; half the point size is a standard approximation and is only used
    // to separate columns, never to place a number.
    const advance =
      width + text.length * charSpacing + (text.split(' ').length - 1) * wordSpacing;
    textMatrix = multiply([1, 0, 0, 1, advance, 0], textMatrix);
  };

  const nextLine = (tx: number, ty: number) => {
    lineMatrix = multiply([1, 0, 0, 1, tx, ty], lineMatrix);
    textMatrix = lineMatrix;
  };

  let operations = 0;

  while (!lexer.atEnd()) {
    operations += 1;
    if ((operations & 0x3ff) === 0) deadline.check();
    if (operations > 2_000_000) break;

    lexer.skipWhitespace();
    if (lexer.atEnd()) break;

    const keyword = lexer.peekKeyword();

    // Operands are objects; operators are bare keywords.
    if (keyword === '' || /^[+-.\d]/.test(keyword)) {
      const object = lexer.readObject();
      stack.push(object);
      if (stack.length > 64) stack.shift();
      continue;
    }

    const before = lexer.position;
    const object = lexer.readObject();
    if (object.kind !== 'null' || lexer.position === before) {
      if (lexer.position === before) {
        lexer.position += 1;
        continue;
      }
      stack.push(object);
      if (stack.length > 64) stack.shift();
      continue;
    }

    // `readObject` consumed a keyword and returned null: that keyword is the
    // operator, and it is what the text between `before` and now spells.
    const operator = latin1(content.subarray(before, lexer.position)).trim();

    switch (operator) {
      case 'BT':
        sawTextOperator = true;
        textMatrix = IDENTITY;
        lineMatrix = IDENTITY;
        break;
      case 'ET':
        break;
      case 'Tf': {
        const name = stack[stack.length - 2];
        fontSize = numberAt(1);
        if (name?.kind === 'name') font = fonts.get(name.value) ?? EMPTY_FONT;
        break;
      }
      case 'Td':
        nextLine(numberAt(2), numberAt(1));
        break;
      case 'TD':
        leading = -numberAt(1);
        nextLine(numberAt(2), numberAt(1));
        break;
      case 'Tm': {
        lineMatrix = [
          numberAt(6),
          numberAt(5),
          numberAt(4),
          numberAt(3),
          numberAt(2),
          numberAt(1),
        ];
        textMatrix = lineMatrix;
        break;
      }
      case 'T*':
        nextLine(0, -leading);
        break;
      case 'TL':
        leading = numberAt(1);
        break;
      case 'Tc':
        charSpacing = numberAt(1);
        break;
      case 'Tw':
        wordSpacing = numberAt(1);
        break;
      case 'Tz':
        horizontalScale = numberAt(1) / 100;
        break;
      case 'Tj': {
        sawTextOperator = true;
        const operand = stack[stack.length - 1];
        if (operand?.kind === 'string') show(operand.bytes);
        break;
      }
      case "'": {
        sawTextOperator = true;
        nextLine(0, -leading);
        const operand = stack[stack.length - 1];
        if (operand?.kind === 'string') show(operand.bytes);
        break;
      }
      case '"': {
        sawTextOperator = true;
        wordSpacing = numberAt(3);
        charSpacing = numberAt(2);
        nextLine(0, -leading);
        const operand = stack[stack.length - 1];
        if (operand?.kind === 'string') show(operand.bytes);
        break;
      }
      case 'TJ': {
        sawTextOperator = true;
        const operand = stack[stack.length - 1];
        if (operand?.kind === 'array') {
          for (const item of operand.items) {
            if (item.kind === 'string') {
              show(item.bytes);
            } else if (item.kind === 'number') {
              // A negative adjustment moves the pen forward; a large one is a gap
              // between columns rather than a space inside a word.
              const shift = (-item.value / 1000) * fontSize * horizontalScale;
              textMatrix = multiply([1, 0, 0, 1, shift, 0], textMatrix);
            }
          }
        }
        break;
      }
      default:
        break;
    }

    stack.length = 0;
  }

  return { runs, sawTextOperator };
}

/**
 * Groups runs into lines.
 *
 * Runs whose baselines are within a fraction of the font size are one line. Within
 * a line the runs are ordered by horizontal position, and a gap wider than roughly
 * one space becomes a separator — this is what turns a drawn table back into
 * something with columns.
 */
export function runsToLines(runs: readonly TextRun[]): string[] {
  if (runs.length === 0) return [];

  const sorted = [...runs].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: string[] = [];

  let currentY = sorted[0]?.y ?? 0;
  let current: TextRun[] = [];

  const flush = () => {
    if (current.length === 0) return;
    const ordered = [...current].sort((a, b) => a.x - b.x);
    let text = '';
    let previousEnd: number | null = null;

    for (const run of ordered) {
      if (previousEnd !== null) {
        const gap = run.x - previousEnd;
        // A wide gap is a column boundary; a narrow one is a word space.
        if (gap > run.fontSize * 0.9) text += '\t';
        else if (gap > run.fontSize * 0.15) text += ' ';
      }
      text += run.text;
      previousEnd = run.x + run.width;
    }

    const trimmed = text.trim();
    if (trimmed.length > 0) lines.push(trimmed);
    current = [];
  };

  for (const run of sorted) {
    const tolerance = Math.max(1.5, run.fontSize * 0.4);
    if (Math.abs(run.y - currentY) > tolerance) {
      flush();
      currentY = run.y;
    }
    current.push(run);
  }
  flush();

  return lines;
}

function collectFonts(
  document: PdfDocument,
  resources: PdfDict | null,
): ReadonlyMap<string, FontMapping> {
  const fonts = new Map<string, FontMapping>();
  if (resources === null) return fonts;

  const fontDict = dictOf(document.resolve(resources.entries.get('Font')));
  if (fontDict === null) return fonts;

  for (const [name, reference] of fontDict.entries) {
    fonts.set(name, readFont(document, reference));
    if (fonts.size > 256) break;
  }
  return fonts;
}

/** Walks the page tree in document order. */
function collectPages(document: PdfDocument): PdfDict[] {
  const pages: PdfDict[] = [];
  const seen = new Set<PdfObject>();

  const catalogue = [...document.entries().values()].find(
    (object) =>
      dictOf(object) !== null && nameOf(dictOf(object)?.entries.get('Type')) === 'Catalog',
  );

  const walk = (node: PdfObject | undefined, depth: number): void => {
    if (depth > 64 || pages.length >= LIMITS.maxPdfPages) return;
    const resolved = document.resolve(node);
    const dict = dictOf(resolved);
    if (dict === null || resolved === undefined || seen.has(resolved)) return;
    seen.add(resolved);

    const type = nameOf(document.resolve(dict.entries.get('Type')));
    if (type === 'Page') {
      pages.push(dict);
      return;
    }

    const kids = document.resolve(dict.entries.get('Kids'));
    if (kids?.kind === 'array') {
      for (const kid of kids.items) walk(kid, depth + 1);
    }
  };

  if (catalogue !== undefined) {
    const catalogueDict = dictOf(catalogue);
    walk(catalogueDict?.entries.get('Pages'), 0);
  }

  if (pages.length === 0) {
    // No usable catalogue: fall back to every object that calls itself a page, in
    // object-number order, which is document order for anything linearised.
    const numbered = [...document.entries().entries()]
      .filter(([, object]) => nameOf(dictOf(object)?.entries.get('Type')) === 'Page')
      .sort(([a], [b]) => a - b);
    for (const [, object] of numbered) {
      const dict = dictOf(object);
      if (dict !== null && pages.length < LIMITS.maxPdfPages) pages.push(dict);
    }
  }

  return pages;
}

/** Resources are inherited from an ancestor when a page does not declare them. */
function resourcesFor(document: PdfDocument, page: PdfDict): PdfDict | null {
  let node: PdfDict | null = page;
  for (let depth = 0; depth < 32 && node !== null; depth += 1) {
    const resources = dictOf(document.resolve(node.entries.get('Resources')));
    if (resources !== null) return resources;
    node = dictOf(document.resolve(node.entries.get('Parent')));
  }
  return null;
}

/** Extracts the text of every page. */
export function extractPages(document: PdfDocument, deadline: Deadline): PdfPageText[] {
  const pages = collectPages(document);
  const out: PdfPageText[] = [];

  pages.forEach((page, index) => {
    deadline.check();

    const fonts = collectFonts(document, resourcesFor(document, page));
    const contents = document.resolve(page.entries.get('Contents'));

    const streams: Uint8Array[] = [];
    if (contents?.kind === 'stream') streams.push(document.decodeStream(contents));
    if (contents?.kind === 'array') {
      for (const item of contents.items) {
        const resolved = document.resolve(item);
        if (resolved?.kind === 'stream') streams.push(document.decodeStream(resolved));
      }
    }

    const merged = concat(streams);
    const { runs, sawTextOperator } = extractRuns(merged, fonts, deadline);

    out.push({
      pageNumber: index + 1,
      runs,
      lines: runsToLines(runs),
      imageOnly: !sawTextOperator || runs.length === 0,
    });
  });

  return out;
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
