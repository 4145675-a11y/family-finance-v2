import { OUTSTANDING_CHECK_STATUSES, type PostDatedCheck } from '@family-finance/contracts';

import type { StoreDocument } from './document';

/**
 * Finding the check behind a bank debit.
 *
 * A statement row says "צ׳ק 1043 — 1,500.00" on a Tuesday. Somewhere in the
 * household's records is a check for 1,500 dated the previous Sunday that the
 * gemach has been holding for four months. Joining those two is the difference
 * between a repayment recorded once and a household that appears to have paid
 * twice — once when the check cleared, once when the statement was imported.
 *
 * Three rules run through everything here:
 *
 *  1. **Nothing is decided.** This proposes; a person approves. A confident match
 *     and a poor one differ only in what the screen says about them, never in
 *     whether they are applied.
 *  2. **An ambiguous match stays ambiguous.** Two checks for the same amount on
 *     the same day are genuinely indistinguishable from a statement row, and
 *     picking one would be inventing a fact. Both are offered; the family knows
 *     which check they wrote.
 *  3. **A returned check is not a repayment.** A bank debit that reverses a
 *     bounced check looks arithmetically like a payment and is the opposite of
 *     one, so a check that has already been returned is never offered as a match
 *     for a new debit.
 *
 * Confidence is in basis points and is built from named reasons rather than a
 * tuned score, so a reviewer can be told *why* something matched instead of being
 * shown a number they have no way to argue with.
 */

export type CheckMatchReason =
  | 'same_account'
  | 'exact_amount'
  | 'check_number_in_reference'
  | 'due_date_exact'
  | 'due_date_within_window'
  | 'presented_outside_expected_window'
  | 'payee_in_reference'
  | 'only_candidate';

export interface CheckMatch {
  readonly checkId: string;
  readonly check: PostDatedCheck;
  readonly confidenceBp: number;
  readonly reasons: readonly CheckMatchReason[];
}

/**
 * How far after its printed date a check may still be presented.
 *
 * Generous on purpose. A gemach deposits when it gets to the bank, not on the
 * date printed, and a check presented three weeks late is entirely ordinary. The
 * window is asymmetric because a check presented *before* its date is unusual and
 * worth more suspicion than one presented after it.
 */
export const MATCH_WINDOW_AFTER_DAYS = 45;
export const MATCH_WINDOW_BEFORE_DAYS = 10;

/** A tight window around the printed date, where a match is worth more. */
const EXACT_WINDOW_DAYS = 3;

function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
  );
}

/**
 * Digits found in a statement description, as candidate check numbers.
 *
 * A bank writes the check number in a dozen different ways — "צ'ק 1043",
 * "CHQ 001043", "משיכת שיק מס 1043". Rather than guess at a format, every run of
 * digits is treated as a candidate and compared with the recorded number, which
 * either matches or does not.
 */
export function digitRunsIn(text: string): string[] {
  return text.match(/[0-9]{2,12}/g) ?? [];
}

function referenceMentionsNumber(reference: string, checkNumber: string | null): boolean {
  if (checkNumber === null) return false;
  const trimmed = checkNumber.replace(/^0+/, '');
  return digitRunsIn(reference).some(
    (run) => run === checkNumber || run.replace(/^0+/, '') === trimmed,
  );
}

function referenceMentionsPayee(reference: string, payeeName: string): boolean {
  const needle = payeeName.trim();
  if (needle.length < 3) return false;
  return reference.includes(needle);
}

export interface DebitCandidate {
  /** The account the money left. */
  readonly accountId: string;
  readonly amountMinor: number;
  readonly transactionDate: string;
  /** The description, reference or memo from the statement. */
  readonly reference: string;
}

/**
 * Every check that could be the one behind a debit, best first.
 *
 * The amount must be exact. A check clears for its face value; a debit that is
 * off by an agora is a different transaction, and treating it as a match would
 * quietly change the amount of a repayment.
 */
export function matchesForDebit(document: StoreDocument, debit: DebitCandidate): CheckMatch[] {
  const candidates = document.checks.filter(
    (check) =>
      OUTSTANDING_CHECK_STATUSES.includes(check.status) &&
      check.accountId === debit.accountId &&
      check.amountMinor === debit.amountMinor,
  );

  const matches: CheckMatch[] = [];

  for (const check of candidates) {
    const offset = daysBetween(check.dueDate, debit.transactionDate);
    const outsideWindow =
      offset > MATCH_WINDOW_AFTER_DAYS || offset < -MATCH_WINDOW_BEFORE_DAYS;
    const numberMatches = referenceMentionsNumber(debit.reference, check.checkNumber);

    /*
     * The date window filters; the check number overrules it.
     *
     * A gemach that banks a post-dated check early, or months late, produces a
     * debit outside any sensible window — and when the statement carries the
     * check number, the bank has already told us which check it was. Discarding
     * that on a date heuristic would leave the family to match it by hand while
     * the software held the answer. Without a number, the window stands.
     */
    if (outsideWindow && !numberMatches) continue;

    const reasons: CheckMatchReason[] = ['same_account', 'exact_amount'];
    // Amount and account together are the floor: they are necessary, and on
    // their own they are not much — a household writing twelve identical checks
    // has twelve equally good candidates.
    let confidenceBp = 4_000;

    if (numberMatches) {
      reasons.push('check_number_in_reference');
      // The strongest single signal there is: the bank printed the number.
      confidenceBp += 4_500;
    }

    if (outsideWindow) {
      // Worth saying out loud on the review screen: this cleared a long way from
      // the date on the paper, which is the sort of thing a person should look at.
      reasons.push('presented_outside_expected_window');
    } else if (Math.abs(offset) <= EXACT_WINDOW_DAYS) {
      reasons.push('due_date_exact');
      confidenceBp += 1_500;
    } else {
      reasons.push('due_date_within_window');
      confidenceBp += 500;
    }

    if (referenceMentionsPayee(debit.reference, check.payeeName)) {
      reasons.push('payee_in_reference');
      confidenceBp += 1_000;
    }

    matches.push({
      checkId: check.id,
      check,
      confidenceBp: Math.min(confidenceBp, 10_000),
      reasons,
    });
  }

  if (matches.length === 1) {
    const only = matches[0];
    if (only !== undefined) {
      matches[0] = {
        ...only,
        reasons: [...only.reasons, 'only_candidate'],
        confidenceBp: Math.min(only.confidenceBp + 1_000, 10_000),
      };
    }
  }

  return matches.sort(
    (a, b) => b.confidenceBp - a.confidenceBp || a.check.dueDate.localeCompare(b.check.dueDate),
  );
}

export interface CheckMatchProposal {
  /** The single best match, when there is an unambiguous one. */
  readonly best: CheckMatch | null;
  /** Everything worth showing, best first. */
  readonly candidates: readonly CheckMatch[];
  /** True when two or more candidates cannot be told apart from the statement. */
  readonly ambiguous: boolean;
}

/** How much better the leader must be before it is offered as *the* match. */
const DECISIVE_MARGIN_BP = 1_000;

/**
 * The proposal a review screen shows.
 *
 * `best` is filled only when one candidate is clearly ahead. When two checks are
 * equally plausible the field stays null and both are listed — the reviewer picks,
 * because they are the only one who can. Choosing for them would look like
 * competence and would be a guess about which month's repayment this was.
 */
export function proposeCheckMatch(
  document: StoreDocument,
  debit: DebitCandidate,
): CheckMatchProposal {
  const candidates = matchesForDebit(document, debit);

  const leader = candidates[0];
  const runnerUp = candidates[1];

  if (leader === undefined) {
    return { best: null, candidates: [], ambiguous: false };
  }

  const ambiguous =
    runnerUp !== undefined && leader.confidenceBp - runnerUp.confidenceBp < DECISIVE_MARGIN_BP;

  return {
    best: ambiguous ? null : leader,
    candidates,
    ambiguous,
  };
}

/**
 * True when a statement row looks like a check clearing rather than a purchase.
 *
 * Used only to decide whether to *look* for a match. A false positive costs a
 * reviewer one glance; a false negative costs them nothing, because the row still
 * imports as an ordinary expense.
 */
export function looksLikeCheckDebit(reference: string): boolean {
  return /צ.?ק|שיק|המחאה|\bCHQ\b|\bCHEQUE\b|\bCHECK\b/i.test(reference);
}
