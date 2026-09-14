import { Deadline, LIMITS, LimitExceededError, MalformedDocumentError } from './limits';
import { decodeXmlPart, localName, scanXml } from './xml';
import {
  InflationBudget,
  findEntry,
  readZipDirectory,
  readZipEntry,
  type ZipEntry,
} from './zip';

/**
 * Reading a workbook without running it.
 *
 * The single most important property of this module is what it does *not* do. An
 * `.xlsx` can carry macros, external links, DDE commands and formulas that read
 * other files. None of that is executed, resolved, or followed here. A formula is
 * noted as a fact about the cell — "this number was computed" — and the value the
 * spreadsheet application last cached is the value read.
 *
 * That is a real trade-off and it is stated in the review screen: a workbook saved
 * by a tool that did not cache results will show empty cells rather than numbers
 * the importer invented. An empty cell a person can fix is safer than a computed
 * one they cannot check.
 */

export type SheetCellValue =
  | { readonly kind: 'empty' }
  | { readonly kind: 'text'; readonly text: string }
  /** `raw` is the exact decimal text the file stored, kept for exact money parsing. */
  | { readonly kind: 'number'; readonly raw: string }
  | { readonly kind: 'date'; readonly iso: string; readonly raw: string }
  | { readonly kind: 'boolean'; readonly value: boolean }
  | { readonly kind: 'error'; readonly code: string };

export interface SheetCell {
  /** Zero-based column index, from the cell reference. */
  readonly column: number;
  readonly value: SheetCellValue;
  /** True when the cell held a formula. The cached result is what was read. */
  readonly fromFormula: boolean;
}

export interface SheetRow {
  /** 1-based row number as the file records it, so provenance survives gaps. */
  readonly number: number;
  readonly cells: readonly SheetCell[];
}

export interface Sheet {
  readonly name: string;
  readonly rows: readonly SheetRow[];
  /** True when reading stopped at a limit rather than at the end of the sheet. */
  readonly truncated: boolean;
}

export interface Workbook {
  readonly sheets: readonly Sheet[];
  /** Sheet names found in the workbook, including any not read. */
  readonly sheetNames: readonly string[];
  readonly usedFormulas: boolean;
}

/** Built-in number formats that mean "this is a date or a time". */
const BUILT_IN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

/** A custom format code is a date when it names date or time components. */
function formatCodeIsDate(code: string): boolean {
  // Strip quoted literals and colour/condition blocks first: `"yyyy"` is a label.
  const withoutLiterals = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '');
  return /[ymdhs]/i.test(withoutLiterals) && !/^[^ymdhs]*$/i.test(withoutLiterals);
}

interface StyleTable {
  /** Index into `cellXfs` to "is a date format". */
  readonly dateStyles: ReadonlySet<number>;
}

function parseStyles(xml: string): StyleTable {
  const customDateFormats = new Set<number>();
  const dateStyles = new Set<number>();

  let inCellXfs = false;
  let xfIndex = 0;

  scanXml(xml, (token) => {
    if (token.kind === 'text') return;
    const name = localName(token.name);

    if (name === 'numFmt' && (token.kind === 'open' || token.kind === 'self-closing')) {
      const id = Number.parseInt(token.attributes.get('numFmtId') ?? '', 10);
      const code = token.attributes.get('formatCode') ?? '';
      if (Number.isFinite(id) && formatCodeIsDate(code)) customDateFormats.add(id);
      return;
    }

    if (name === 'cellXfs') {
      if (token.kind === 'open') inCellXfs = true;
      if (token.kind === 'close') inCellXfs = false;
      return;
    }

    if (
      inCellXfs &&
      name === 'xf' &&
      (token.kind === 'open' || token.kind === 'self-closing')
    ) {
      const id = Number.parseInt(token.attributes.get('numFmtId') ?? '0', 10);
      if (BUILT_IN_DATE_FORMATS.has(id) || customDateFormats.has(id)) dateStyles.add(xfIndex);
      xfIndex += 1;
    }
  });

  return { dateStyles };
}

function parseSharedStrings(xml: string): readonly string[] {
  const strings: string[] = [];
  let depth = 0;
  let collecting = false;
  let buffer = '';
  /** `rPh` holds phonetic hints for Japanese; its text is not the string. */
  let inPhonetic = 0;

  scanXml(xml, (token) => {
    if (token.kind === 'text') {
      if (collecting && inPhonetic === 0) buffer += token.value;
      return;
    }
    const name = localName(token.name);

    if (name === 'si') {
      if (token.kind === 'open') {
        depth += 1;
        collecting = true;
        buffer = '';
      } else if (token.kind === 'close') {
        depth -= 1;
        collecting = false;
        strings.push(buffer.slice(0, LIMITS.maxCellChars));
        buffer = '';
      } else {
        strings.push('');
      }
      return;
    }

    if (name === 'rPh') {
      if (token.kind === 'open') inPhonetic += 1;
      if (token.kind === 'close') inPhonetic -= 1;
    }
  });

  if (depth !== 0) {
    throw new MalformedDocumentError(
      'malformed_document',
      'the shared string table is corrupt',
    );
  }
  return strings;
}

/** `BC12` → column 54 (zero-based). Ignores the row part. */
export function columnIndexFromReference(reference: string): number {
  let index = 0;
  for (const character of reference) {
    const code = character.charCodeAt(0);
    if (code < 65 || code > 90) break;
    index = index * 26 + (code - 64);
  }
  return index - 1;
}

/**
 * An Excel date serial as a calendar date.
 *
 * Two quirks are handled explicitly rather than absorbed. Serial 60 is the
 * 29th of February 1900, a day that did not exist — a bug preserved from Lotus
 * 1-2-3 — so it is reported as unreadable rather than silently shifted. And a
 * workbook may count from 1904 instead, which shifts every date by four years if
 * ignored.
 */
export function serialToIsoDate(serial: number, epoch1904: boolean): string | null {
  if (!Number.isFinite(serial) || serial < 0 || serial > 2_958_465) return null;

  const wholeDays = Math.floor(serial);

  if (epoch1904) {
    const base = Date.UTC(1904, 0, 1);
    return isoOf(base + wholeDays * 86_400_000);
  }

  if (wholeDays === 60) return null;
  // Before the phantom leap day the epoch is 31 December 1899; after it, the
  // spreadsheet's own off-by-one makes 30 December the correct base.
  const base = wholeDays < 60 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30);
  return isoOf(base + wholeDays * 86_400_000);
}

function isoOf(milliseconds: number): string | null {
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function parseSheet(
  xml: string,
  name: string,
  sharedStrings: readonly string[],
  styles: StyleTable,
  epoch1904: boolean,
  deadline: Deadline,
): { sheet: Sheet; usedFormulas: boolean } {
  const rows: SheetRow[] = [];
  let truncated = false;
  let usedFormulas = false;

  let currentRowNumber = 0;
  let currentCells: SheetCell[] = [];
  let inRow = false;

  let cellColumn = 0;
  let cellType = '';
  let cellStyle = 0;
  let inCell = false;
  let inValue = false;
  let inInlineText = false;
  let cellHasFormula = false;
  let valueBuffer = '';
  let inlineBuffer = '';

  scanXml(xml, (token) => {
    if (token.kind === 'text') {
      if (inValue) valueBuffer += token.value;
      else if (inInlineText) inlineBuffer += token.value;
      return true;
    }

    const name_ = localName(token.name);

    if (name_ === 'row') {
      if (token.kind === 'open') {
        deadline.check();
        if (rows.length >= LIMITS.maxRowsPerSheet) {
          truncated = true;
          return false;
        }
        inRow = true;
        currentCells = [];
        currentRowNumber =
          Number.parseInt(token.attributes.get('r') ?? '', 10) || rows.length + 1;
      } else if (token.kind === 'close' && inRow) {
        inRow = false;
        if (currentCells.length > 0) {
          rows.push({ number: currentRowNumber, cells: currentCells });
        }
      }
      return true;
    }

    if (name_ === 'c' && (token.kind === 'open' || token.kind === 'self-closing')) {
      const reference = token.attributes.get('r') ?? '';
      cellColumn = reference === '' ? currentCells.length : columnIndexFromReference(reference);
      cellType = token.attributes.get('t') ?? 'n';
      cellStyle = Number.parseInt(token.attributes.get('s') ?? '0', 10) || 0;
      cellHasFormula = false;
      valueBuffer = '';
      inlineBuffer = '';
      inCell = token.kind === 'open';
      if (token.kind === 'self-closing') inCell = false;
      return true;
    }

    if (name_ === 'c' && token.kind === 'close') {
      if (!inCell) return true;
      inCell = false;
      if (cellColumn >= LIMITS.maxColumnsPerRow) {
        truncated = true;
        return true;
      }
      const value = decodeCell(
        cellType,
        cellStyle,
        valueBuffer,
        inlineBuffer,
        sharedStrings,
        styles,
        epoch1904,
      );
      if (value.kind !== 'empty') {
        currentCells.push({ column: cellColumn, value, fromFormula: cellHasFormula });
      }
      return true;
    }

    if (name_ === 'f' && inCell) {
      // A formula is recorded, never evaluated and never followed.
      cellHasFormula = true;
      usedFormulas = true;
      return true;
    }

    if (name_ === 'v') {
      if (token.kind === 'open') inValue = true;
      if (token.kind === 'close') inValue = false;
      return true;
    }

    if (name_ === 't' && inCell) {
      if (token.kind === 'open') inInlineText = true;
      if (token.kind === 'close') inInlineText = false;
    }
    return true;
  });

  return { sheet: { name, rows, truncated }, usedFormulas };
}

function decodeCell(
  type: string,
  style: number,
  value: string,
  inline: string,
  sharedStrings: readonly string[],
  styles: StyleTable,
  epoch1904: boolean,
): SheetCellValue {
  const trimmed = value.trim();

  if (type === 's') {
    const index = Number.parseInt(trimmed, 10);
    const text = Number.isFinite(index) ? (sharedStrings[index] ?? '') : '';
    return text.length === 0 ? { kind: 'empty' } : { kind: 'text', text };
  }

  if (type === 'inlineStr') {
    const text = inline.slice(0, LIMITS.maxCellChars);
    return text.trim().length === 0 ? { kind: 'empty' } : { kind: 'text', text };
  }

  if (type === 'str') {
    // A formula whose cached result is text.
    const text = trimmed.slice(0, LIMITS.maxCellChars);
    return text.length === 0 ? { kind: 'empty' } : { kind: 'text', text };
  }

  if (type === 'b') {
    if (trimmed === '') return { kind: 'empty' };
    return { kind: 'boolean', value: trimmed === '1' };
  }

  if (type === 'e') {
    return { kind: 'error', code: trimmed || '#N/A' };
  }

  if (trimmed === '') return { kind: 'empty' };

  if (styles.dateStyles.has(style)) {
    const iso = serialToIsoDate(Number.parseFloat(trimmed), epoch1904);
    if (iso !== null) return { kind: 'date', iso, raw: trimmed };
  }

  return { kind: 'number', raw: trimmed };
}

/** Content types that mean the workbook carries executable content. */
const MACRO_CONTENT_TYPES = [
  'application/vnd.ms-excel.sheet.macroEnabled.main+xml',
  'application/vnd.ms-office.vbaProject',
  'application/vnd.ms-excel.macrosheet+xml',
];

function assertNoMacros(contentTypesXml: string, entries: readonly ZipEntry[]): void {
  for (const type of MACRO_CONTENT_TYPES) {
    if (contentTypesXml.includes(type)) {
      throw new MalformedDocumentError(
        'macro_enabled_file',
        'the workbook contains macros, which this importer will not open',
      );
    }
  }
  if (entries.some((entry) => entry.name.toLowerCase().includes('vbaproject'))) {
    throw new MalformedDocumentError(
      'macro_enabled_file',
      'the workbook contains a macro project',
    );
  }
}

/** Maps relationship ids to sheet part names. */
function parseWorkbookRelations(xml: string): ReadonlyMap<string, string> {
  const relations = new Map<string, string>();
  scanXml(xml, (token) => {
    if (token.kind === 'text') return;
    if (localName(token.name) !== 'Relationship') return;
    const id = token.attributes.get('Id');
    const target = token.attributes.get('Target');
    if (id !== undefined && target !== undefined) relations.set(id, target);
  });
  return relations;
}

interface SheetReference {
  readonly name: string;
  readonly relationId: string | null;
}

function parseWorkbook(xml: string): { sheets: SheetReference[]; epoch1904: boolean } {
  const sheets: SheetReference[] = [];
  let epoch1904 = false;

  scanXml(xml, (token) => {
    if (token.kind === 'text') return;
    const name = localName(token.name);

    if (name === 'workbookPr' && (token.kind === 'open' || token.kind === 'self-closing')) {
      const flag = token.attributes.get('date1904');
      epoch1904 = flag === '1' || flag === 'true';
      return;
    }

    if (name === 'sheet' && (token.kind === 'open' || token.kind === 'self-closing')) {
      const sheetName = token.attributes.get('name') ?? `גיליון ${sheets.length + 1}`;
      const relationId = token.attributes.get('r:id') ?? token.attributes.get('id') ?? null;
      sheets.push({ name: sheetName, relationId });
    }
  });

  return { sheets, epoch1904 };
}

/** Resolves a relationship target against the `xl/` part directory. */
function sheetPartName(target: string): string {
  const cleaned = target.replace(/^\/+/, '').replace(/^xl\//, '');
  // A target may not escape the package; `..` in a part name is malformed.
  if (cleaned.includes('..')) {
    throw new MalformedDocumentError('malformed_archive', 'a part name tries to escape');
  }
  return `xl/${cleaned}`;
}

/**
 * Reads a workbook from the bytes of an `.xlsx` file.
 *
 * Every part is decompressed under one shared budget, and the deadline is checked
 * per sheet and per row, so a workbook engineered to be slow costs a bounded
 * amount of time rather than the request.
 */
export function readWorkbook(bytes: Uint8Array, deadline = new Deadline()): Workbook {
  const entries = readZipDirectory(bytes);
  const budget = new InflationBudget();

  const contentTypes = findEntry(entries, '[Content_Types].xml');
  if (contentTypes === undefined) {
    throw new MalformedDocumentError(
      'malformed_archive',
      'the archive is not an Office document',
    );
  }
  assertNoMacros(decodeXmlPart(readZipEntry(bytes, contentTypes, budget, deadline)), entries);

  const workbookEntry = findEntry(entries, 'xl/workbook.xml');
  if (workbookEntry === undefined) {
    throw new MalformedDocumentError('malformed_archive', 'the archive holds no workbook');
  }

  const { sheets: references, epoch1904 } = parseWorkbook(
    decodeXmlPart(readZipEntry(bytes, workbookEntry, budget, deadline)),
  );

  if (references.length > LIMITS.maxSheets) {
    throw new LimitExceededError('maxSheets', `${references.length} sheets`);
  }

  const relationsEntry = findEntry(entries, 'xl/_rels/workbook.xml.rels');
  const relations =
    relationsEntry === undefined
      ? new Map<string, string>()
      : parseWorkbookRelations(
          decodeXmlPart(readZipEntry(bytes, relationsEntry, budget, deadline)),
        );

  const sharedEntry = findEntry(entries, 'xl/sharedStrings.xml');
  const sharedStrings =
    sharedEntry === undefined
      ? []
      : parseSharedStrings(decodeXmlPart(readZipEntry(bytes, sharedEntry, budget, deadline)));

  const stylesEntry = findEntry(entries, 'xl/styles.xml');
  const styles =
    stylesEntry === undefined
      ? { dateStyles: new Set<number>() }
      : parseStyles(decodeXmlPart(readZipEntry(bytes, stylesEntry, budget, deadline)));

  const sheets: Sheet[] = [];
  let usedFormulas = false;

  references.forEach((reference, index) => {
    deadline.check();
    const target = reference.relationId === null ? null : relations.get(reference.relationId);
    const partName =
      target === undefined || target === null
        ? `xl/worksheets/sheet${index + 1}.xml`
        : sheetPartName(target);

    const entry = findEntry(entries, partName);
    if (entry === undefined) return;

    const parsed = parseSheet(
      decodeXmlPart(readZipEntry(bytes, entry, budget, deadline)),
      reference.name,
      sharedStrings,
      styles,
      epoch1904,
      deadline,
    );
    sheets.push(parsed.sheet);
    usedFormulas = usedFormulas || parsed.usedFormulas;
  });

  if (sheets.length === 0) {
    throw new MalformedDocumentError('malformed_document', 'no readable sheet was found');
  }

  return { sheets, sheetNames: references.map((reference) => reference.name), usedFormulas };
}
