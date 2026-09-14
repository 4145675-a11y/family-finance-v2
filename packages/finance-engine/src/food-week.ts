import type { BusinessDate, Confidence } from '@family-finance/contracts';

import { addDays, daysBetween, endOfMonth, startOfMonth } from './dates';
import { assertStoredAmount, clampAtZero, roundHalfUp } from './money';
import { notice, type EngineNotice } from './notice';

/**
 * Weekly guidance for the food budget.
 *
 * Food is the budget a family actually steers week by week, which is why it is
 * the one category that reaches the home screen. The guidance is deliberately not
 * "the monthly amount divided by four":
 *
 *  - months are 28 to 31 days, and four weeks never fit;
 *  - a week is cut short by the end of the month;
 *  - a single stock-up shop covers more than the week it happened in;
 *  - a quiet week should be able to help a heavy one;
 *  - and above all, a weekly figure must never let the family spend more than the
 *    month has left. That is the one hard rule here, and the property suite holds
 *    it for every generated input.
 */

export const FOOD_WEEK_CALCULATION_VERSION = '1.0.0';

/** Sunday. The Israeli week starts here, so weeks line up with how a family shops. */
const WEEK_START_DAY = 0;

/** Beyond this age, guidance is offered with a warning rather than confidence. */
const STALE_AFTER_DAYS = 7;

export interface FoodWeekInput {
  readonly asOf: BusinessDate;
  readonly monthlyPlannedMinor: number;
  /** Confirmed food spending this month. */
  readonly approvedThisMonthMinor: number;
  /** Food drafts awaiting approval this month. Counted as spent. */
  readonly pendingThisMonthMinor: number;
  /** Food spending inside the current week, approved and pending together. */
  readonly spentThisWeekMinor: number;
  /**
   * The part of this week's spending that was a single large stock-up. It is
   * still spent in full; it is only excluded from the *pace* judgement, because a
   * month's worth of rice bought on Tuesday is not a Tuesday habit.
   */
  readonly largePurchaseThisWeekMinor: number;
  /** Let an under-spent earlier week raise this week's figure. */
  readonly carryForwardEnabled: boolean;
  /** Age of the freshest confirmed balance. `null` means nothing was ever verified. */
  readonly dataAgeDays: number | null;
}

export type FoodWeekStatus = 'on_track' | 'ahead_of_pace' | 'over_month' | 'insufficient_data';

export interface FoodWeekGuidance {
  readonly weekStartsOn: BusinessDate;
  /** Clipped to the end of the month, so guidance never crosses into next month. */
  readonly weekEndsOn: BusinessDate;
  readonly daysLeftInWeek: number;
  readonly daysLeftInMonth: number;
  readonly monthPlannedMinor: number;
  readonly monthSpentMinor: number;
  readonly monthRemainingMinor: number;
  /** What may still be spent on food before the week ends. */
  readonly weekRemainingMinor: number;
  readonly weekSpentMinor: number;
  /** How much this week has run past an even pace, if it has. */
  readonly weekOverPaceMinor: number;
  /** What next week can hold if the month is to stay inside its plan. */
  readonly nextWeekAllowanceMinor: number;
  readonly projectedMonthMinor: number;
  readonly carryForwardMinor: number;
  readonly status: FoodWeekStatus;
  readonly warnings: readonly EngineNotice[];
  readonly assumptions: readonly EngineNotice[];
  readonly confidence: Confidence;
  readonly dataAgeDays: number | null;
  readonly calculationVersion: string;
}

/** Days since the most recent week start, given a Sunday-start week. */
function daysSinceWeekStart(date: BusinessDate): number {
  const [year, month, day] = date.split('-').map(Number);
  const weekday = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1)).getUTCDay();
  return (weekday - WEEK_START_DAY + 7) % 7;
}

export function calculateFoodWeek(input: FoodWeekInput): FoodWeekGuidance {
  assertStoredAmount(input.monthlyPlannedMinor, 'monthly food budget');
  assertStoredAmount(input.approvedThisMonthMinor, 'approved food spending');
  assertStoredAmount(input.pendingThisMonthMinor, 'pending food spending');
  assertStoredAmount(input.spentThisWeekMinor, 'food spending this week');
  assertStoredAmount(input.largePurchaseThisWeekMinor, 'large food purchase');

  const monthStart = startOfMonth(input.asOf);
  const monthEnd = endOfMonth(input.asOf);
  const daysInMonth = daysBetween(monthStart, monthEnd) + 1;
  const daysElapsed = daysBetween(monthStart, input.asOf) + 1;
  const daysLeftInMonth = daysBetween(input.asOf, monthEnd) + 1;

  const weekStartsOn = addDays(input.asOf, -daysSinceWeekStart(input.asOf));
  const rawWeekEnd = addDays(weekStartsOn, 6);
  // A week that runs past the end of the month is cut there: next month has its
  // own budget, and guidance that spans the boundary would spend it early.
  const weekEndsOn = rawWeekEnd > monthEnd ? monthEnd : rawWeekEnd;
  const daysLeftInWeek = Math.max(0, daysBetween(input.asOf, weekEndsOn) + 1);

  const monthSpentMinor = input.approvedThisMonthMinor + input.pendingThisMonthMinor;
  const monthRemainingMinor = clampAtZero(
    input.monthlyPlannedMinor - monthSpentMinor,
  ).resultMinor;

  const warnings: EngineNotice[] = [];

  // An even pace over the days already gone. Used only to describe the week, and
  // never to cap it — the month remainder does that.
  const expectedByNowMinor =
    daysInMonth === 0
      ? 0
      : roundHalfUp(
          (input.monthlyPlannedMinor * Math.min(daysElapsed, daysInMonth)) / daysInMonth,
        );

  const carryForwardMinor = input.carryForwardEnabled
    ? clampAtZero(expectedByNowMinor - monthSpentMinor).resultMinor
    : 0;

  const proRataMinor =
    daysLeftInMonth <= 0
      ? 0
      : roundHalfUp((monthRemainingMinor * daysLeftInWeek) / daysLeftInMonth);

  // The hard rule: whatever the pro-rata and the carry-forward suggest, a week can
  // never be allowed more than the month itself has left.
  const weekRemainingMinor = Math.min(monthRemainingMinor, proRataMinor + carryForwardMinor);

  // Pace judgement ignores the stock-up shop, which is spent but not repeatable.
  const paceRelevantWeekSpendMinor = clampAtZero(
    input.spentThisWeekMinor - input.largePurchaseThisWeekMinor,
  ).resultMinor;
  const evenWeekShareMinor =
    daysInMonth === 0 ? 0 : roundHalfUp((input.monthlyPlannedMinor * 7) / daysInMonth);
  const weekOverPaceMinor = clampAtZero(
    paceRelevantWeekSpendMinor - evenWeekShareMinor,
  ).resultMinor;

  const daysAfterThisWeek = Math.max(0, daysLeftInMonth - daysLeftInWeek);
  const nextWeekAllowanceMinor =
    daysAfterThisWeek === 0
      ? 0
      : Math.min(
          monthRemainingMinor,
          roundHalfUp(
            (clampAtZero(monthRemainingMinor - weekRemainingMinor).resultMinor *
              Math.min(7, daysAfterThisWeek)) /
              daysAfterThisWeek,
          ),
        );

  // Projection uses spending excluding the stock-up, then adds it back once, so a
  // single big shop does not get multiplied across the rest of the month.
  const repeatableSoFarMinor = clampAtZero(
    monthSpentMinor - input.largePurchaseThisWeekMinor,
  ).resultMinor;
  const projectedMonthMinor =
    daysElapsed <= 0
      ? input.monthlyPlannedMinor
      : Math.max(
          monthSpentMinor,
          roundHalfUp((repeatableSoFarMinor / daysElapsed) * daysInMonth) +
            input.largePurchaseThisWeekMinor,
        );

  if (input.largePurchaseThisWeekMinor > 0) {
    warnings.push(
      notice('food.large_purchase', { amountMinor: input.largePurchaseThisWeekMinor }),
    );
  }
  if (weekOverPaceMinor > 0) {
    warnings.push(notice('food.week_over_pace', { amountMinor: weekOverPaceMinor }));
  }
  if (input.dataAgeDays !== null && input.dataAgeDays > STALE_AFTER_DAYS) {
    warnings.push(notice('food.stale', { days: input.dataAgeDays }));
  }

  const hasUsableData = input.monthlyPlannedMinor > 0 && input.dataAgeDays !== null;

  const status: FoodWeekStatus = !hasUsableData
    ? 'insufficient_data'
    : monthSpentMinor > input.monthlyPlannedMinor
      ? 'over_month'
      : projectedMonthMinor > input.monthlyPlannedMinor
        ? 'ahead_of_pace'
        : 'on_track';

  const confidence: Confidence = !hasUsableData
    ? 'low'
    : input.dataAgeDays !== null && input.dataAgeDays > STALE_AFTER_DAYS
      ? 'medium'
      : 'high';

  return {
    weekStartsOn,
    weekEndsOn,
    daysLeftInWeek,
    daysLeftInMonth,
    monthPlannedMinor: input.monthlyPlannedMinor,
    monthSpentMinor,
    monthRemainingMinor,
    weekRemainingMinor,
    weekSpentMinor: input.spentThisWeekMinor,
    weekOverPaceMinor,
    nextWeekAllowanceMinor,
    projectedMonthMinor,
    carryForwardMinor,
    status,
    warnings,
    assumptions: [
      notice('food.assumption.week_starts_sunday'),
      notice('food.assumption.week_capped_by_month'),
      notice('food.assumption.large_purchase_excluded_from_pace'),
    ],
    confidence,
    dataAgeDays: input.dataAgeDays,
    calculationVersion: FOOD_WEEK_CALCULATION_VERSION,
  };
}
