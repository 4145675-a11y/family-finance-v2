import type { BusinessDate, Certainty } from '@family-finance/contracts';

import { addDays, eachDay, endOfMonth, isOnOrBefore } from './dates';
import { liquidCashMinor } from './household';
import { clampAtZero, minSigned } from './money';
import type { EngineInput, PlannedItem } from './types';

/**
 * Daily cash projection to the end of the period, with its low point.
 *
 * 01-PRODUCT-SPEC.md § מסך הבית puts the forecast and the low point third on the
 * home screen, and 02-FINANCIAL-RULES.md ends its stress-test section with the
 * line that governs this whole module: "תחזית אינה הבטחה".
 *
 * Two scenarios are produced from the same data. The conservative one counts only
 * money that is certain to arrive, and it is the one every decision is judged
 * against. The expected one adds probable income and exists to be shown beside
 * it, never to replace it.
 */

export type ForecastScenario = 'expected' | 'conservative';

/** Which certainty levels each scenario is willing to count as incoming money. */
const INCLUDED_INFLOW_CERTAINTY: Readonly<Record<ForecastScenario, readonly Certainty[]>> = {
  conservative: ['certain'],
  expected: ['certain', 'probable'],
};

export interface ForecastDay {
  readonly date: BusinessDate;
  readonly openingMinor: number;
  readonly inflowMinor: number;
  readonly outflowMinor: number;
  readonly closingMinor: number;
}

export interface Forecast {
  readonly scenario: ForecastScenario;
  readonly from: BusinessDate;
  readonly to: BusinessDate;
  readonly openingMinor: number;
  readonly days: readonly ForecastDay[];
  readonly endOfPeriodMinor: number;
  readonly lowPointMinor: number;
  readonly lowPointDate: BusinessDate;
  /** First day the projected balance goes below zero, if any. */
  readonly firstFailureDate: BusinessDate | null;
}

/** The date an item actually moves money: what is due wins over what is expected. */
function effectiveDate(item: PlannedItem): BusinessDate {
  return item.dueDate ?? item.expectedDate;
}

/**
 * Projects the household balance one day at a time.
 *
 * Outflows are counted in full regardless of certainty. An expense we are only
 * fairly sure about still empties the account if it happens, and the asymmetry is
 * deliberate: optimism about income and pessimism about spending is exactly the
 * bias this product exists to correct.
 */
export function projectDailyBalance(
  input: EngineInput,
  today: BusinessDate,
  scenario: ForecastScenario,
  to: BusinessDate = endOfMonth(today),
): Forecast {
  const openingMinor = liquidCashMinor(input.accounts, 'household');
  const allowedCertainty = INCLUDED_INFLOW_CERTAINTY[scenario];

  const householdItems = input.plannedItems.filter((item) => item.scope === 'household');

  const days: ForecastDay[] = [];
  let running = openingMinor;
  let lowPointMinor = openingMinor;
  let lowPointDate = today;
  let firstFailureDate: BusinessDate | null = null;

  for (const date of eachDay(today, to)) {
    const dayItems = householdItems.filter((item) => effectiveDate(item) === date);

    const inflowMinor = dayItems
      .filter(
        (item) => item.direction === 'inflow' && allowedCertainty.includes(item.certainty),
      )
      .reduce((total, item) => total + item.amountMinor, 0);

    const outflowMinor = dayItems
      .filter((item) => item.direction === 'outflow')
      .reduce((total, item) => total + item.amountMinor, 0);

    const opening = running;
    running = opening + inflowMinor - outflowMinor;

    days.push({
      date,
      openingMinor: opening,
      inflowMinor,
      outflowMinor,
      closingMinor: running,
    });

    if (running < lowPointMinor) {
      lowPointMinor = running;
      lowPointDate = date;
    }
    if (running < 0 && firstFailureDate === null) firstFailureDate = date;
  }

  return {
    scenario,
    from: today,
    to,
    openingMinor,
    days,
    endOfPeriodMinor: running,
    lowPointMinor,
    lowPointDate,
    firstFailureDate,
  };
}

/**
 * Shortfall against obligations falling due in the next 14 days.
 *
 * This is the trigger 02-FINANCIAL-RULES.md names first for emergency mode. It is
 * measured on the conservative scenario, because an emergency that only
 * disappears if a probable payment arrives is still an emergency.
 */
export function fundingGapWithinDays(
  input: EngineInput,
  today: BusinessDate,
  days: number,
): number {
  const horizon = addDays(today, days);
  const forecast = projectDailyBalance(input, today, 'conservative', horizon);
  const lowest = minSigned([
    forecast.openingMinor,
    ...forecast.days.map((day) => day.closingMinor),
  ]);
  return clampAtZero(-lowest).resultMinor;
}

/** Obligations already past their due date and still unsettled. */
export function overdueEssentialsMinor(input: EngineInput, today: BusinessDate): number {
  return input.plannedItems
    .filter(
      (item) =>
        item.direction === 'outflow' &&
        item.essential &&
        item.dueDate !== null &&
        isOnOrBefore(item.dueDate, today),
    )
    .reduce((total, item) => total + item.amountMinor, 0);
}
