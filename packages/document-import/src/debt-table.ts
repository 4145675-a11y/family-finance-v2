import { parseDueDateText, type DateParseResult } from '@family-finance/hebrew-calendar';

import { parseAmount } from './normalize';
import { isBlankRow, isRepeatedHeader, isTotalsRow, normaliseHeader } from './table';

/**
 * Reading a debt list whose headers say nothing.
 *
 * Real files arrive with columns called `מזהה | שדה1 | שדה2 | שדה3`. The header
 * row carries no meaning, so the header-vocabulary detector in `table.ts`
 * correctly reports `unknown` for every column and the file yields no rows. The
 * answer is not to make that vocabulary looser — that would misread documents it
 * currently reads correctly — but to ask a different question of the same table:
 * **what do the values look like?**
 *
 * A debt list has a distinctive shape: one column of names, which are text and
 * not numbers, and one column of amounts, which are numbers and not text.
 * That pairing is what this module looks for, and it looks only when the
 * header-based path has already come back empty-handed. Every existing document
 * type keeps the route it had.
 *
 * What it does not do: decide anything. A detection opens the review screen with
 * a proposed mapping and a row-by-row account of what would be imported and what
 * would not. The family approves it, as they approve every other import.
 */

/** Which column holds what, once the values have been read. */
export interface DebtColumnMapping {
  /** The file's own row identifier, when it has one. Carried for the audit trail. */
  readonly sourceRowIdIndex: number | null;
  readonly lenderNameIndex: number;
  readonly balanceIndex: number;
  /** A due date, a note, or both. Often blank. */
  readonly dueDateOrNoteIndex: number | null;
}

export interface DebtTableDetection {
  readonly detected: boolean;
  /** 0–10000, on the same scale as `detectDocumentType`. */
  readonly confidenceBp: number;
  readonly mapping: DebtColumnMapping | null;
  readonly evidence: readonly string[];
}

/** Why a row in a recognised debt table was not proposed as a debt. */
export type DebtRowExclusion =
  | 'blank_row'
  | 'repeated_header'
  | 'totals_row'
  | 'missing_lender_name'
  | 'unparsed_amount'
  | 'zero_balance'
  | 'negative_balance';

export interface DebtRowProposal {
  readonly outcome: 'debt';
  readonly rowIndex: number;
  readonly sourceRowId: string | null;
  readonly lenderName: string;
  readonly balanceMinor: number;
  /** The due-date cell, read into both calendars or flagged for review. */
  readonly due: DateParseResult | null;
  /** Text from the due-date cell that was not part of the date. */
  readonly note: string | null;
}

export interface DebtRowExcluded {
  readonly outcome: 'excluded';
  readonly rowIndex: number;
  readonly reason: DebtRowExclusion;
  /** Whatever could still be read, so the review screen can show the row. */
  readonly lenderName: string | null;
  readonly rawAmount: string | null;
}

export type DebtRowReading = DebtRowProposal | DebtRowExcluded;

/**
 * Headers that carry no meaning.
 *
 * Their presence is evidence that the values are the only thing to go on. Their
 * absence is not evidence against: a file may simply have no header row.
 */
const PLACEHOLDER_HEADERS = /^(?:שדה|עמודה|column|col|field|f)\s*\d*$/u;

/** A cell that reads as a monetary figure. */
function isAmountCell(value: string): boolean {
  return value.trim().length > 0 && parseAmount(value) !== null;
}

/**
 * A cell that reads as a name.
 *
 * It must contain a letter: a bare number, a date or a punctuation run is not a
 * lender. A cell that also parses as an amount is not a name either, which is
 * what keeps an identifier column from being mistaken for one.
 */
function isNameCell(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  if (parseAmount(trimmed) !== null) return false;
  return /\p{L}/u.test(trimmed);
}

/** The share of non-empty cells in a column that satisfy a predicate. */
function columnShare(
  rows: readonly (readonly string[])[],
  index: number,
  predicate: (value: string) => boolean,
): { share: number; populated: number } {
  let populated = 0;
  let hits = 0;
  for (const row of rows) {
    const value = (row[index] ?? '').trim();
    if (value.length === 0) continue;
    populated += 1;
    if (predicate(value)) hits += 1;
  }
  return { share: populated === 0 ? 0 : hits / populated, populated };
}

/** "Most" of the non-empty values. Deliberately a clear majority, not half. */
const MAJORITY = 0.6;

/** Fewer rows than this and the shape of a column is not evidence of anything. */
const MIN_DATA_ROWS = 2;

/**
 * Looks for a names column followed by an amounts column.
 *
 * @param dataRows rows below the header, with the header itself excluded
 * @param header   the header row, used only as supporting evidence
 */
export function detectDebtTable(
  dataRows: readonly (readonly string[])[],
  header: readonly string[] = [],
): DebtTableDetection {
  const usable = dataRows.filter((row) => !isBlankRow(row) && !isTotalsRow(row));
  if (usable.length < MIN_DATA_ROWS) {
    return { detected: false, confidenceBp: 0, mapping: null, evidence: [] };
  }

  const width = usable.reduce((widest, row) => Math.max(widest, row.length), 0);
  const evidence: string[] = [];

  const placeholderHeaders = header.filter((cell) =>
    PLACEHOLDER_HEADERS.test(normaliseHeader(cell)),
  ).length;
  if (placeholderHeaders >= 2) {
    evidence.push(`placeholder-headers:${placeholderHeaders}`);
  }

  let best: { mapping: DebtColumnMapping; score: number } | null = null;

  for (let nameIndex = 0; nameIndex < width; nameIndex += 1) {
    const names = columnShare(usable, nameIndex, isNameCell);
    if (names.share < MAJORITY || names.populated < MIN_DATA_ROWS) continue;

    // The balance is the first amounts column to the right of the names.
    for (let amountIndex = nameIndex + 1; amountIndex < width; amountIndex += 1) {
      const amounts = columnShare(usable, amountIndex, isAmountCell);
      if (amounts.share < MAJORITY || amounts.populated < MIN_DATA_ROWS) continue;

      const score = names.share + amounts.share;
      if (best !== null && score <= best.score) continue;

      best = {
        score,
        mapping: {
          // A column left of the names that is not itself a name is the file's
          // own row id. It is carried, never interpreted.
          sourceRowIdIndex: nameIndex > 0 ? nameIndex - 1 : null,
          lenderNameIndex: nameIndex,
          balanceIndex: amountIndex,
          dueDateOrNoteIndex: amountIndex + 1 < width ? amountIndex + 1 : null,
        },
      };
      break;
    }
  }

  if (best === null) {
    return { detected: false, confidenceBp: 0, mapping: null, evidence };
  }

  const names = columnShare(usable, best.mapping.lenderNameIndex, isNameCell);
  const amounts = columnShare(usable, best.mapping.balanceIndex, isAmountCell);
  evidence.push(
    `names-column:${best.mapping.lenderNameIndex}:${Math.round(names.share * 100)}%`,
    `amounts-column:${best.mapping.balanceIndex}:${Math.round(amounts.share * 100)}%`,
  );

  // Two strong columns alone reach 8000; placeholder headers add the rest.
  const base = Math.round(((names.share + amounts.share) / 2) * 8_000);
  const bonus = placeholderHeaders >= 2 ? 1_000 : 0;

  return {
    detected: true,
    confidenceBp: Math.min(9_000, base + bonus),
    mapping: best.mapping,
    evidence,
  };
}

/**
 * Reads one row into a proposed debt, or into the reason it is not one.
 *
 * A zero balance is excluded rather than imported: a settled debt is not an
 * active one, and creating it with an opening balance of nothing would put a
 * lender card on the screen that owes no money and never did.
 */
export function readDebtRow(
  row: readonly string[],
  rowIndex: number,
  mapping: DebtColumnMapping,
  header: readonly string[] = [],
): DebtRowReading {
  const cell = (index: number | null): string =>
    index === null ? '' : (row[index] ?? '').trim();

  const lenderRaw = cell(mapping.lenderNameIndex);
  const amountRaw = cell(mapping.balanceIndex);
  const excluded = (reason: DebtRowExclusion): DebtRowExcluded => ({
    outcome: 'excluded',
    rowIndex,
    reason,
    lenderName: lenderRaw.length > 0 ? lenderRaw : null,
    rawAmount: amountRaw.length > 0 ? amountRaw : null,
  });

  if (isBlankRow(row)) return excluded('blank_row');
  if (header.length > 0 && isRepeatedHeader(row, header)) return excluded('repeated_header');
  if (isTotalsRow(row)) return excluded('totals_row');
  if (!isNameCell(lenderRaw)) return excluded('missing_lender_name');

  const parsed = parseAmount(amountRaw);
  if (parsed === null) return excluded('unparsed_amount');
  if (parsed.negative) return excluded('negative_balance');
  if (parsed.amountMinor === 0) return excluded('zero_balance');

  const dueCell = cell(mapping.dueDateOrNoteIndex);
  const due = dueCell.length > 0 ? parseDueDateText(dueCell) : null;

  const sourceRowId = cell(mapping.sourceRowIdIndex);

  return {
    outcome: 'debt',
    rowIndex,
    sourceRowId: sourceRowId.length > 0 ? sourceRowId : null,
    lenderName: lenderRaw,
    balanceMinor: parsed.amountMinor,
    due,
    note: due === null ? null : due.note,
  };
}

/** Reads a whole table. Order is preserved so the review screen matches the file. */
export function readDebtTable(
  dataRows: readonly (readonly string[])[],
  mapping: DebtColumnMapping,
  header: readonly string[] = [],
): readonly DebtRowReading[] {
  return dataRows.map((row, index) => readDebtRow(row, index, mapping, header));
}
