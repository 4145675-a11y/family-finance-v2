import { writeZip, type ZipFile } from './zip-write';

/**
 * Producing an `.xlsx` a spreadsheet application will open.
 *
 * Used for two things: exporting a report the family can hand to somebody, and
 * building the workbooks the import tests read. Both want the same guarantee —
 * that what comes out is a real Office Open XML file and not a CSV wearing an
 * extension — so there is one writer.
 *
 * The written file carries no formulas, no macros, no external links and no
 * defined names. It is a grid of literal values, which is all a financial export
 * should ever be: a recipient opening it sees the numbers that were exported, not
 * a computation that might evaluate differently on their machine.
 */

export type WriteCellValue =
  | { readonly kind: 'text'; readonly value: string }
  /** Exact minor units, written as a decimal with two places. */
  | { readonly kind: 'money'; readonly amountMinor: number }
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'date'; readonly iso: string }
  | { readonly kind: 'blank' };

export interface WriteSheet {
  readonly name: string;
  readonly rows: readonly (readonly WriteCellValue[])[];
}

/** Escapes text for XML content. */
function escapeXml(text: string): string {
  return (
    text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
      // Control characters are not legal in XML 1.0 at all.
      // eslint-disable-next-line no-control-regex -- stripping them is the point
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
  );
}

/** Zero-based column index to a spreadsheet column name: 0 → A, 26 → AA. */
export function columnName(index: number): string {
  let name = '';
  let remaining = index;
  for (;;) {
    name = String.fromCharCode(65 + (remaining % 26)) + name;
    remaining = Math.floor(remaining / 26) - 1;
    if (remaining < 0) break;
  }
  return name;
}

/**
 * Minor units as the decimal text a spreadsheet stores.
 *
 * Built by string surgery rather than division, so `-1` agora is `-0.01` and not
 * `-0.009999999999999998`.
 */
export function minorToDecimalText(amountMinor: number): string {
  const negative = amountMinor < 0;
  const digits = String(Math.abs(Math.trunc(amountMinor))).padStart(3, '0');
  const whole = digits.slice(0, -2);
  const fraction = digits.slice(-2);
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/** A calendar date as the serial number a workbook stores. */
function isoToSerial(isoDate: string): number {
  const parsed = Date.parse(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(parsed)) return 0;
  return Math.round(parsed / 86_400_000) + 25_569;
}

const SHEET_STYLES = {
  /** Index into `cellXfs`. 0 general, 1 date, 2 money, 3 bold header. */
  general: 0,
  date: 1,
  money: 2,
  header: 3,
} as const;

function cellXml(reference: string, cell: WriteCellValue): string {
  switch (cell.kind) {
    case 'blank':
      return '';
    case 'text':
      return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell.value)}</t></is></c>`;
    case 'money':
      return `<c r="${reference}" s="${SHEET_STYLES.money}"><v>${minorToDecimalText(cell.amountMinor)}</v></c>`;
    case 'number':
      return `<c r="${reference}"><v>${Number.isFinite(cell.value) ? cell.value : 0}</v></c>`;
    case 'date':
      return `<c r="${reference}" s="${SHEET_STYLES.date}"><v>${isoToSerial(cell.iso)}</v></c>`;
  }
}

function sheetXml(sheet: WriteSheet): string {
  const rows = sheet.rows
    .map((row, rowIndex) => {
      const cells = row
        .map((cell, columnIndex) => cellXml(`${columnName(columnIndex)}${rowIndex + 1}`, cell))
        .join('');
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView rightToLeft="1" workbookViewId="0"/></sheetViews><sheetData>${rows}</sheetData></worksheet>`;
}

/** A safe sheet name: the characters Excel forbids, and the 31-character limit. */
export function safeSheetName(name: string, fallback: string): string {
  const cleaned = name
    .replace(/[\\/?*[\]:]/g, ' ')
    .trim()
    .slice(0, 31);
  return cleaned.length > 0 ? cleaned : fallback;
}

export function writeWorkbook(sheets: readonly WriteSheet[]): Uint8Array {
  if (sheets.length === 0) {
    throw new Error('a workbook needs at least one sheet');
  }

  const named = sheets.map((sheet, index) => ({
    ...sheet,
    name: safeSheetName(sheet.name, `גיליון ${index + 1}`),
  }));

  const sheetEntries: ZipFile[] = named.map((sheet, index) => ({
    name: `xl/worksheets/sheet${index + 1}.xml`,
    content: sheetXml(sheet),
  }));

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${named
    .map(
      (_sheet, index) =>
        `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join('')}</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${named
    .map(
      (sheet, index) =>
        `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
    )
    .join('')}</sheets></workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${named
    .map(
      (_sheet, index) =>
        `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
    )
    .join(
      '',
    )}<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

  // numFmtId 14 is the built-in short date; 164 is a custom two-place money format
  // with thousands separators, which is what a reader expects of a shekel column.
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`;

  return writeZip([
    { name: '[Content_Types].xml', content: contentTypes },
    { name: '_rels/.rels', content: rootRels },
    { name: 'xl/workbook.xml', content: workbook },
    { name: 'xl/_rels/workbook.xml.rels', content: workbookRels },
    { name: 'xl/styles.xml', content: styles },
    ...sheetEntries,
  ]);
}

export const cell = {
  text: (value: string): WriteCellValue => ({ kind: 'text', value }),
  money: (amountMinor: number): WriteCellValue => ({ kind: 'money', amountMinor }),
  number: (value: number): WriteCellValue => ({ kind: 'number', value }),
  date: (iso: string): WriteCellValue => ({ kind: 'date', iso }),
  blank: (): WriteCellValue => ({ kind: 'blank' }),
};
