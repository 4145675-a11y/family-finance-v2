import { buildXlsx } from '@family-finance/document-import';

/**
 * The spreadsheets the import journeys upload.
 *
 * Built in memory by the product's own writer, at the moment a test needs one.
 * Nothing is committed: a fixture file in the repository is a financial document
 * sitting in version control forever, and even an invented one trains the habit.
 *
 * Every lender here is prefixed `E2E`, like the rest of the synthetic household,
 * so an imported row can never be mistaken for a real one.
 *
 * The header is the deliberately unhelpful shape a real gemach list has —
 * `מזהה | שדה1 | שדה2 | שדה3` — because that is the case ADR-0035 had to solve:
 * the columns are recognised by what is in them, not by what they are called.
 */

export interface Workbook {
  readonly name: string;
  readonly bytes: Buffer;
}

function xlsx(name: string, rows: readonly (readonly (string | number)[])[]): Workbook {
  return {
    name,
    bytes: Buffer.from(buildXlsx([{ name: 'חובות', rows: rows.map((row) => [...row]) }])),
  };
}

/**
 * A debt list whose lenders are all new, plus one row the reader must refuse.
 *
 * Row 3 carries a hedged date — "בערך" — which ADR-0035 says is not a date. It is
 * in the fixture on purpose: an import where everything reads cleanly would never
 * exercise the refusal, and the refusal is the safety property.
 */
export function debtWorkbook(): Workbook {
  return xlsx('E2E חובות.xlsx', [
    ['מזהה', 'שדה1', 'שדה2', 'שדה3'],
    ['1', 'E2E גמח מהקובץ', 45_000, 'ז׳ טבת תשפ״ז'],
    ['2', 'E2E קופת חסד מהקובץ', 12_000, '15/01/2027'],
    ['3', 'E2E מלווה עם תאריך מסופק', 8_000, 'בערך ג׳ טבת תשפ״ז'],
    ['4', 'סה״כ', 65_000, ''],
  ]);
}

/**
 * The same list again, byte for byte.
 *
 * Uploading it a second time is how a family actually creates a duplicate: they
 * download the file again and forget they already did it.
 */
export function debtWorkbookAgain(): Workbook {
  return debtWorkbook();
}
