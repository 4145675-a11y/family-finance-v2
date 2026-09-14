import {
  AT_LARGE_CHECK_STATUSES,
  OUTSTANDING_CHECK_STATUSES,
  type BusinessDate,
  type CheckStatus,
} from '@family-finance/contracts';

import { addMonths, compareDates, daysBetween } from './dates';

/**
 * What a stack of post-dated checks means for a household, today.
 *
 * The arithmetic is trivial; the classification is not, and the classification is
 * where a family gets hurt. Three numbers that must never be added together:
 *
 *   - money that has already left the account (cleared checks) — history;
 *   - money that may leave at any moment (checks the gemach is holding) —
 *     exposure;
 *   - money that will leave later (checks not yet handed over) — a plan.
 *
 * Presenting the second as the first tells a family they are poorer than they
 * are. Presenting it as the third tells them they are safer than they are, and
 * that is the one that bounces a check.
 *
 * Nothing here decides anything. It classifies, counts and totals, and the
 * screens say what it means.
 */

/** What the engine is told about one check. Deliberately less than is stored. */
export interface CheckRecord {
  readonly id: string;
  readonly debtId: string;
  readonly accountId: string;
  readonly amountMinor: number;
  readonly dueDate: BusinessDate;
  readonly status: CheckStatus;
  readonly installmentNumber: number | null;
  readonly payeeName: string;
  readonly deliveredOn: BusinessDate | null;
  readonly clearedOn: BusinessDate | null;
}

/**
 * Status as a person needs to read it, which is status plus today's date.
 *
 * `due` and `overdue` are not stored anywhere — they are what the calendar makes
 * of a check nobody has cashed. Deriving them here means the answer is right
 * every morning without anything having to run overnight.
 */
export type DerivedCheckState =
  | 'prepared'
  | 'delivered'
  | 'due'
  | 'overdue'
  | 'deposited'
  | 'cleared'
  | 'returned'
  | 'cancelled'
  | 'replaced';

/** How soon a check counts as "coming up". Two weeks is a household's horizon. */
export const DUE_SOON_DAYS = 14;

export function derivedCheckState(check: CheckRecord, today: BusinessDate): DerivedCheckState {
  if (check.status === 'cleared') return 'cleared';
  if (check.status === 'returned') return 'returned';
  if (check.status === 'cancelled') return 'cancelled';
  if (check.status === 'replaced') return 'replaced';
  if (check.status === 'deposited') return 'deposited';

  // A prepared check is still in the chequebook: its date has no urgency,
  // because nobody else can present it.
  if (check.status === 'prepared') return 'prepared';

  if (compareDates(check.dueDate, today) < 0) return 'overdue';
  if (check.dueDate === today) return 'due';
  return 'delivered';
}

export const isOutstanding = (check: CheckRecord): boolean =>
  OUTSTANDING_CHECK_STATUSES.includes(check.status);

/** Held by the gemach: it can be presented without anyone asking us first. */
export const isAtLarge = (check: CheckRecord): boolean =>
  AT_LARGE_CHECK_STATUSES.includes(check.status);

const totalOf = (checks: readonly CheckRecord[]): number =>
  checks.reduce((sum, check) => sum + check.amountMinor, 0);

const byDueDate = (a: CheckRecord, b: CheckRecord): number =>
  compareDates(a.dueDate, b.dueDate) || a.amountMinor - b.amountMinor;

export interface CheckExposure {
  /** Every check still capable of taking money out. */
  readonly outstandingCount: number;
  readonly outstandingTotalMinor: number;
  /** Of those, the ones the gemach is holding right now. */
  readonly atLargeCount: number;
  readonly atLargeTotalMinor: number;
  /** Handed over, dated today or earlier, and still not honoured. */
  readonly overdueCount: number;
  readonly overdueTotalMinor: number;
  /** Falling due within the next two weeks, including today. */
  readonly dueSoonCount: number;
  readonly dueSoonTotalMinor: number;
  /** The next one that may come out, if any. */
  readonly nextCheck: CheckRecord | null;
  readonly clearedCount: number;
  readonly clearedTotalMinor: number;
  /** Bounced and needing a decision. Never counted as exposure. */
  readonly returnedCount: number;
  readonly returnedTotalMinor: number;
  readonly cancelledCount: number;
  readonly replacedCount: number;
}

export function summariseChecks(
  checks: readonly CheckRecord[],
  today: BusinessDate,
): CheckExposure {
  const outstanding = checks.filter(isOutstanding);
  const atLarge = checks.filter(isAtLarge);

  // Strictly past its date and still not honoured. Today's check is not late;
  // it is due, and the two read very differently to somebody deciding whether to
  // spend this morning.
  const overdue = atLarge.filter((check) => compareDates(check.dueDate, today) < 0);

  const dueSoon = outstanding.filter((check) => {
    const days = daysBetween(today, check.dueDate);
    return days >= 0 && days <= DUE_SOON_DAYS;
  });

  const cleared = checks.filter((check) => check.status === 'cleared');
  const returned = checks.filter((check) => check.status === 'returned');

  // The next one is the earliest still capable of moving money, not the earliest
  // by date: a cleared check dated tomorrow is not something to warn about.
  const nextCheck = [...outstanding].sort(byDueDate)[0] ?? null;

  return {
    outstandingCount: outstanding.length,
    outstandingTotalMinor: totalOf(outstanding),
    atLargeCount: atLarge.length,
    atLargeTotalMinor: totalOf(atLarge),
    overdueCount: overdue.length,
    overdueTotalMinor: totalOf(overdue),
    dueSoonCount: dueSoon.length,
    dueSoonTotalMinor: totalOf(dueSoon),
    nextCheck,
    clearedCount: cleared.length,
    clearedTotalMinor: totalOf(cleared),
    returnedCount: returned.length,
    returnedTotalMinor: totalOf(returned),
    cancelledCount: checks.filter((check) => check.status === 'cancelled').length,
    replacedCount: checks.filter((check) => check.status === 'replaced').length,
  };
}

/**
 * Do the outstanding checks actually cover what is still owed?
 *
 * The question a family asks after a year of a gemach loan, and the one that has
 * no answer if the plan is defined as the sum of the checks. `shortfallMinor` is
 * debt not covered by paper; `excessMinor` is paper beyond the debt, which
 * usually means a check was cleared without being recorded, and is worth saying
 * rather than clamping to zero.
 */
export interface CheckCoverage {
  readonly outstandingDebtMinor: number;
  readonly checksOutstandingMinor: number;
  readonly shortfallMinor: number;
  readonly excessMinor: number;
  readonly fullyCovered: boolean;
}

export function coverageOf(
  outstandingDebtMinor: number,
  exposure: CheckExposure,
): CheckCoverage {
  const difference = outstandingDebtMinor - exposure.outstandingTotalMinor;
  return {
    outstandingDebtMinor,
    checksOutstandingMinor: exposure.outstandingTotalMinor,
    shortfallMinor: Math.max(0, difference),
    excessMinor: Math.max(0, -difference),
    fullyCovered: difference <= 0,
  };
}

// ---------------------------------------------------------------------------
// Planning a series
// ---------------------------------------------------------------------------

export interface PlannedCheck {
  readonly installmentNumber: number;
  readonly amountMinor: number;
  readonly dueDate: BusinessDate;
  readonly checkNumber: string | null;
}

export type SeriesWarning =
  | 'total_does_not_match'
  | 'final_check_larger_than_others'
  | 'no_intended_total'
  | 'due_date_clamped';

export interface CheckSeriesPlan {
  readonly checks: readonly PlannedCheck[];
  readonly totalMinor: number;
  readonly intendedTotalMinor: number | null;
  readonly differenceMinor: number;
  readonly warnings: readonly SeriesWarning[];
}

export interface SeriesRequest {
  readonly count: number;
  readonly amountPerCheckMinor: number;
  readonly finalCheckAmountMinor: number | null;
  readonly firstDueDate: BusinessDate;
  readonly firstCheckNumber: string | null;
  readonly intendedTotalMinor: number | null;
}

/**
 * Works out what a series would be, without creating anything.
 *
 * A preview rather than a creation, because a stack of twelve checks entered by
 * hand is twelve chances to mistype and the family should see the last date and
 * the total before any of it is written down.
 *
 * The total is checked against what the family said they were repaying. When the
 * two differ the series is still produced — the arithmetic is theirs to decide —
 * but the difference is reported and the screen shows it before the button.
 */
export function planCheckSeries(request: SeriesRequest): CheckSeriesPlan {
  const warnings: SeriesWarning[] = [];
  const checks: PlannedCheck[] = [];

  const firstNumber =
    request.firstCheckNumber === null ? null : Number.parseInt(request.firstCheckNumber, 10);
  const numberWidth = request.firstCheckNumber?.length ?? 0;

  for (let index = 0; index < request.count; index += 1) {
    const isFinal = index === request.count - 1;
    const amountMinor =
      isFinal && request.finalCheckAmountMinor !== null
        ? request.finalCheckAmountMinor
        : request.amountPerCheckMinor;

    const dueDate = addMonths(request.firstDueDate, index);

    // The day moved because the target month is shorter. Worth saying: the
    // family wrote "the 31st of every month" and three of them are not the 31st.
    if (dueDate.slice(8, 10) !== request.firstDueDate.slice(8, 10)) {
      if (!warnings.includes('due_date_clamped')) warnings.push('due_date_clamped');
    }

    checks.push({
      installmentNumber: index + 1,
      amountMinor,
      dueDate,
      checkNumber:
        firstNumber === null ? null : String(firstNumber + index).padStart(numberWidth, '0'),
    });
  }

  const totalMinor = checks.reduce((sum, check) => sum + check.amountMinor, 0);

  if (request.intendedTotalMinor === null) {
    warnings.push('no_intended_total');
  } else if (request.intendedTotalMinor !== totalMinor) {
    warnings.push('total_does_not_match');
  }

  if (
    request.finalCheckAmountMinor !== null &&
    request.finalCheckAmountMinor > request.amountPerCheckMinor
  ) {
    warnings.push('final_check_larger_than_others');
  }

  return {
    checks,
    totalMinor,
    intendedTotalMinor: request.intendedTotalMinor,
    differenceMinor:
      request.intendedTotalMinor === null ? 0 : totalMinor - request.intendedTotalMinor,
    warnings,
  };
}

/**
 * A series that adds up to a given total, with the remainder on the last check.
 *
 * Offered because the alternative is a family doing the division themselves and
 * discovering in month twelve that they are eighty agorot short. The remainder
 * goes on the last check rather than being spread, because that is what a gemach
 * and a borrower actually agree.
 */
export function evenSeriesFor(
  totalMinor: number,
  count: number,
): { readonly perCheckMinor: number; readonly finalCheckMinor: number | null } {
  if (count <= 0) throw new Error('a series needs at least one check');

  const perCheckMinor = Math.floor(totalMinor / count);
  const remainder = totalMinor - perCheckMinor * count;

  if (remainder === 0) return { perCheckMinor, finalCheckMinor: null };
  return { perCheckMinor, finalCheckMinor: perCheckMinor + remainder };
}
