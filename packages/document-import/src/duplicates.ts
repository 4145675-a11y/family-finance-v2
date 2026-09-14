import type { Direction, DuplicateVerdict } from '@family-finance/contracts';

/**
 * Deciding whether a proposed row is something already recorded.
 *
 * 02-FINANCIAL-RULES.md § אינווריאנטים says an import must not double a record.
 * The tempting reading is "detect duplicates and drop them", and that reading is
 * wrong in a way that costs a family real money: two identical coffee purchases on
 * the same day at the same shop are not a duplicate, and silently dropping the
 * second understates spending forever.
 *
 * So this module never deletes and never merges. It produces one of three
 * verdicts and hands them to a person. The only thing it treats as certain is a
 * row from the *same file at the same place in that file* — reimporting the exact
 * same statement — which is the case the invariant is really about.
 */

export interface ExistingRecord {
  readonly id: string;
  readonly accountId: string | null;
  readonly date: string;
  readonly amountMinor: number;
  readonly direction: Direction;
  readonly description: string;
  readonly reference: string | null;
  /**
   * Which file, and where in it, this record came from. Set for anything
   * previously imported; null for a record typed by hand.
   */
  readonly sourceFingerprint: string | null;
}

export interface CandidateRecord {
  readonly accountId: string | null;
  readonly date: string;
  readonly amountMinor: number;
  readonly direction: Direction;
  readonly description: string;
  readonly reference: string | null;
  readonly sourceFingerprint: string | null;
}

export interface DuplicateAssessment {
  readonly verdict: DuplicateVerdict;
  readonly matchedId: string | null;
  /** Why, as a short machine-readable reason for the review screen. */
  readonly reason:
    | 'same_file_same_row'
    | 'same_reference'
    | 'same_account_date_amount'
    | 'near_date_same_amount'
    | 'none';
}

/**
 * A stable identifier for "this row, of this file".
 *
 * Built from the file's content hash and the exact location inside it, so the same
 * statement uploaded twice produces the same fingerprints and the second upload is
 * recognised with certainty rather than by resemblance.
 */
export function sourceFingerprint(
  fileSha256: string,
  location: { sheetName: string | null; page: number | null; row: number | null },
): string {
  return [
    fileSha256,
    location.sheetName ?? '',
    location.page === null ? '' : String(location.page),
    location.row === null ? '' : String(location.row),
  ].join(':');
}

/** Days between two business dates, ignoring time entirely. */
function daysApart(a: string, b: string): number {
  const left = Date.parse(`${a}T00:00:00Z`);
  const right = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(left) || Number.isNaN(right)) return Number.POSITIVE_INFINITY;
  return Math.abs(Math.round((left - right) / 86_400_000));
}

/** Normalises a description so spacing and punctuation do not defeat a match. */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * How alike two descriptions are, 0 to 1.
 *
 * Token overlap rather than edit distance: a bank writes the same merchant with
 * different amounts of padding and a trailing reference, and shared words survive
 * that where character positions do not.
 */
export function descriptionSimilarity(a: string, b: string): number {
  const left = new Set(
    normalise(a)
      .split(' ')
      .filter((word) => word.length > 1),
  );
  const right = new Set(
    normalise(b)
      .split(' ')
      .filter((word) => word.length > 1),
  );
  if (left.size === 0 || right.size === 0) return a.trim() === b.trim() ? 1 : 0;

  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / Math.max(left.size, right.size);
}

export function assessDuplicate(
  candidate: CandidateRecord,
  existing: readonly ExistingRecord[],
): DuplicateAssessment {
  // The exact same row of the exact same file. This is the only certainty.
  if (candidate.sourceFingerprint !== null) {
    const same = existing.find(
      (record) => record.sourceFingerprint === candidate.sourceFingerprint,
    );
    if (same !== undefined) {
      return { verdict: 'likely_duplicate', matchedId: same.id, reason: 'same_file_same_row' };
    }
  }

  // A bank's own reference number identifies a movement uniquely, when present.
  if (candidate.reference !== null && candidate.reference.trim().length >= 4) {
    const byReference = existing.find(
      (record) =>
        record.reference !== null &&
        record.reference.trim() === candidate.reference?.trim() &&
        record.amountMinor === candidate.amountMinor,
    );
    if (byReference !== undefined) {
      return {
        verdict: 'likely_duplicate',
        matchedId: byReference.id,
        reason: 'same_reference',
      };
    }
  }

  const sameAmount = existing.filter(
    (record) =>
      record.amountMinor === candidate.amountMinor && record.direction === candidate.direction,
  );

  for (const record of sameAmount) {
    const sameAccount =
      candidate.accountId === null ||
      record.accountId === null ||
      record.accountId === candidate.accountId;
    if (!sameAccount) continue;

    if (record.date === candidate.date) {
      const similarity = descriptionSimilarity(record.description, candidate.description);
      if (similarity >= 0.6) {
        return {
          verdict: 'likely_duplicate',
          matchedId: record.id,
          reason: 'same_account_date_amount',
        };
      }
      // Same day, same amount, different words: two real purchases, or the same
      // one described differently. A person decides.
      return {
        verdict: 'possible_duplicate',
        matchedId: record.id,
        reason: 'same_account_date_amount',
      };
    }

    // A card posts a day or two after the purchase, so a near-date match on the
    // same amount is worth raising without claiming it.
    if (daysApart(record.date, candidate.date) <= 3) {
      const similarity = descriptionSimilarity(record.description, candidate.description);
      if (similarity >= 0.5) {
        return {
          verdict: 'possible_duplicate',
          matchedId: record.id,
          reason: 'near_date_same_amount',
        };
      }
    }
  }

  return { verdict: 'new', matchedId: null, reason: 'none' };
}
