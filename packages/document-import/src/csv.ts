import { Deadline, LIMITS, LimitExceededError, MalformedDocumentError } from './limits';

/**
 * Reading a delimited text file that came from an Israeli bank.
 *
 * Three things make this harder than "split on commas", and all three are common
 * in the files this product is actually given:
 *
 *  1. The separator is often a semicolon, because a comma is the thousands
 *     separator in the same file.
 *  2. The encoding is often windows-1255 rather than UTF-8, because the file was
 *     produced by an older system. Decoded as UTF-8 the Hebrew becomes mojibake,
 *     and a header row nobody can read means every column has to be mapped by
 *     hand.
 *  3. There is frequently a title block above the header — a bank name, an account
 *     number, a date range — so the first line is not the header.
 *
 * The first two are settled here. The third belongs to `table.ts`, which finds the
 * header row rather than assuming it.
 */

export interface CsvDocument {
  readonly rows: readonly (readonly string[])[];
  /**
   * The 1-based line each row came from in the file.
   *
   * Blank lines are dropped from `rows` but their positions are not forgotten: a
   * reviewer asked to check "row 14" has to find row 14 in the file they uploaded,
   * not the fourteenth row that happened to survive parsing.
   */
  readonly rowNumbers: readonly number[];
  readonly delimiter: string;
  readonly encoding: 'utf-8' | 'windows-1255';
  readonly truncated: boolean;
}

const CANDIDATE_DELIMITERS = [',', ';', '\t', '|'] as const;

/**
 * Decides the text encoding from the bytes.
 *
 * A strict UTF-8 decode either succeeds or throws. Succeeding is close to proof:
 * multi-byte UTF-8 sequences are structured enough that arbitrary 8-bit text
 * almost never forms valid ones. Failing is proof of the opposite, and for a
 * Hebrew financial export the overwhelmingly likely alternative is windows-1255.
 */
export function decodeText(bytes: Uint8Array): {
  text: string;
  encoding: 'utf-8' | 'windows-1255';
} {
  const withoutBom =
    bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
      ? bytes.subarray(3)
      : bytes;

  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(withoutBom);
    return { text, encoding: 'utf-8' };
  } catch {
    return { text: decodeWindows1255(withoutBom), encoding: 'windows-1255' };
  }
}

/**
 * The Hebrew code page, mapped by hand.
 *
 * `TextDecoder` supports it only when the runtime was built with the full ICU
 * data, which is not something a financial import should depend on being true.
 * The table is small and the alternative — Hebrew that silently turns to
 * question marks — is the kind of failure that makes a person re-type a
 * statement by hand.
 */
const WINDOWS_1255_HIGH: readonly string[] = [
  '€',
  '�',
  '‚',
  'ƒ',
  '„',
  '…',
  '†',
  '‡',
  'ˆ',
  '‰',
  '�',
  '‹',
  '�',
  '�',
  '�',
  '�',
  '�',
  '‘',
  '’',
  '“',
  '”',
  '•',
  '–',
  '—',
  '˜',
  '™',
  '�',
  '›',
  '�',
  '�',
  '�',
  '�',
  '\u00a0',
  '¡',
  '¢',
  '£',
  '₪',
  '¥',
  '¦',
  '§',
  '¨',
  '©',
  '×',
  '«',
  '¬',
  '\u00ad',
  '®',
  '¯',
  '°',
  '±',
  '²',
  '³',
  '´',
  'µ',
  '¶',
  '·',
  '¸',
  '¹',
  '÷',
  '»',
  '¼',
  '½',
  '¾',
  '¿',
  'ְ',
  'ֱ',
  'ֲ',
  'ֳ',
  'ִ',
  'ֵ',
  'ֶ',
  'ַ',
  'ָ',
  'ֹ',
  '�',
  'ֻ',
  'ּ',
  'ֽ',
  '־',
  'ֿ',
  '׀',
  'ׁ',
  'ׂ',
  '׃',
  'װ',
  'ױ',
  'ײ',
  '׳',
  '״',
  '�',
  '�',
  '�',
  '�',
  '�',
  '�',
  '�',
  'א',
  'ב',
  'ג',
  'ד',
  'ה',
  'ו',
  'ז',
  'ח',
  'ט',
  'י',
  'ך',
  'כ',
  'ל',
  'ם',
  'מ',
  'ן',
  'נ',
  'ס',
  'ע',
  'ף',
  'פ',
  'ץ',
  'צ',
  'ק',
  'ר',
  'ש',
  'ת',
  '�',
  '�',
  '\u200e',
  '\u200f',
  '�',
];

export function decodeWindows1255(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) {
    if (byte < 0x80) {
      text += String.fromCharCode(byte);
    } else {
      text += WINDOWS_1255_HIGH[byte - 0x80] ?? '�';
    }
  }
  return text;
}

/**
 * Picks the separator by counting how consistently each candidate splits lines.
 *
 * Frequency alone is not enough: a Hebrew description full of commas beats a
 * semicolon on count while producing ragged rows. Consistency of field count
 * across the sample is what actually identifies a delimiter, so that is what is
 * scored, with frequency only breaking ties.
 */
export function detectDelimiter(text: string): string {
  const lines = text
    .split(/\r\n|\n|\r/)
    .filter((line) => line.trim().length > 0)
    .slice(0, 30);

  if (lines.length === 0) return ',';

  let best = ',';
  let bestScore = -1;

  for (const candidate of CANDIDATE_DELIMITERS) {
    const counts = lines.map((line) => splitRespectingQuotes(line, candidate).length);
    const maximum = Math.max(...counts);
    if (maximum < 2) continue;

    const mode = counts.reduce<Map<number, number>>((accumulator, count) => {
      accumulator.set(count, (accumulator.get(count) ?? 0) + 1);
      return accumulator;
    }, new Map());

    let modalCount = 0;
    let modalFields = 0;
    for (const [fields, occurrences] of mode) {
      if (fields > 1 && occurrences > modalCount) {
        modalCount = occurrences;
        modalFields = fields;
      }
    }

    // Consistency dominates; field count is the tiebreak.
    const score = modalCount * 100 + modalFields;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best;
}

/** A single-line split that respects quoting; used only for delimiter scoring. */
function splitRespectingQuotes(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && character === delimiter) {
      fields.push(field);
      field = '';
      continue;
    }
    field += character ?? '';
  }
  fields.push(field);
  return fields;
}

/**
 * Reads the whole document.
 *
 * Quoting follows RFC 4180: a field may be quoted, a doubled quote inside a
 * quoted field is one quote, and a newline inside quotes belongs to the field
 * rather than ending the row.
 */
export function readCsv(bytes: Uint8Array, deadline = new Deadline()): CsvDocument {
  if (bytes.byteLength > LIMITS.maxCsvBytes) {
    throw new LimitExceededError('maxCsvBytes', `${bytes.byteLength} bytes`);
  }

  const { text, encoding } = decodeText(bytes);
  if (text.trim().length === 0) {
    throw new MalformedDocumentError('malformed_document', 'the file holds no text');
  }

  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  const rowNumbers: number[] = [];

  let row: string[] = [];
  let field = '';
  let quoted = false;
  let truncated = false;
  let lineNumber = 1;

  const pushField = () => {
    row.push(field.slice(0, LIMITS.maxCellChars).trim());
    field = '';
  };

  const pushRow = () => {
    if (row.length > LIMITS.maxColumnsPerRow) {
      row = row.slice(0, LIMITS.maxColumnsPerRow);
      truncated = true;
    }
    if (row.some((value) => value.length > 0)) {
      rows.push(row);
      rowNumbers.push(lineNumber);
    }
    row = [];
    lineNumber += 1;
  };

  for (let index = 0; index < text.length; index += 1) {
    if ((index & 0xffff) === 0) deadline.check();

    if (rows.length >= LIMITS.maxRowsPerSheet) {
      truncated = true;
      break;
    }

    const character = text[index];

    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character ?? '';
      }
      continue;
    }

    if (character === '"' && field.length === 0) {
      quoted = true;
      continue;
    }

    if (character === delimiter) {
      pushField();
      continue;
    }

    if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      pushField();
      pushRow();
      continue;
    }

    field += character ?? '';
  }

  if (field.length > 0 || row.length > 0) {
    pushField();
    pushRow();
  }

  if (rows.length === 0) {
    throw new MalformedDocumentError('malformed_document', 'no rows were found in the file');
  }

  return { rows, rowNumbers, delimiter, encoding, truncated };
}
