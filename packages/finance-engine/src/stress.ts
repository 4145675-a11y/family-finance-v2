import type { BusinessDate } from '@family-finance/contracts';

import { addDays, endOfMonth } from './dates';
import { projectDailyBalance } from './forecast';
import { applyBasisPoints, clampAtZero } from './money';
import type { EngineInput, PlannedItem } from './types';

/**
 * The stress tests 02-FINANCIAL-RULES.md § Stress tests requires to run.
 *
 * Their purpose is narrow and important: a large expense, a business transfer or
 * an extra debt payment is not `safe` if a *reasonable* adverse scenario breaks an
 * essential need, a minimum payment or the reserve. Each scenario below is one of
 * those reasonable adversities, applied to the same input and re-projected.
 *
 * Every scenario reports the same four things — low point, failure day, gap and
 * the obligations put at risk — so they can be compared side by side rather than
 * each telling its own story.
 */

export interface StressContext {
  /** Balance of the single largest private debt: what a sudden demand would cost. */
  readonly largestPrivateDebtMinor: number;
  /** Largest credit-card balance: the size of a plausible unclassified charge. */
  readonly largestCardBalanceMinor: number;
  readonly reserveFloorMinor: number;
}

export interface StressScenarioResult {
  readonly key: string;
  readonly label: string;
  readonly lowPointMinor: number;
  readonly lowPointDate: BusinessDate;
  readonly firstFailureDate: BusinessDate | null;
  readonly fundingGapMinor: number;
  readonly passed: boolean;
  readonly atRiskObligations: readonly string[];
}

function shockItem(
  id: string,
  label: string,
  amountMinor: number,
  date: BusinessDate,
): PlannedItem {
  return {
    id,
    label,
    scope: 'household',
    direction: 'outflow',
    amountMinor,
    certainty: 'certain',
    expectedDate: date,
    dueDate: date,
    essential: true,
  };
}

function evaluate(
  key: string,
  label: string,
  input: EngineInput,
  today: BusinessDate,
): StressScenarioResult {
  const forecast = projectDailyBalance(input, today, 'conservative');

  // An obligation is at risk when the balance is already below zero on the day it
  // falls due — the projection says the money will not be there.
  const atRiskObligations = input.plannedItems
    .filter((item) => item.scope === 'household' && item.direction === 'outflow')
    .filter((item) => {
      const due = item.dueDate ?? item.expectedDate;
      const day = forecast.days.find((candidate) => candidate.date === due);
      return day !== undefined && day.closingMinor < 0;
    })
    .map((item) => item.label);

  return {
    key,
    label,
    lowPointMinor: forecast.lowPointMinor,
    lowPointDate: forecast.lowPointDate,
    firstFailureDate: forecast.firstFailureDate,
    fundingGapMinor: clampAtZero(-forecast.lowPointMinor).resultMinor,
    passed: forecast.firstFailureDate === null,
    atRiskObligations,
  };
}

/** Runs the six required scenarios and returns one result per scenario. */
export function runStressTests(
  input: EngineInput,
  today: BusinessDate,
  context: StressContext,
): StressScenarioResult[] {
  const periodEnd = endOfMonth(today);
  const householdInflows = input.plannedItems.filter(
    (item) => item.scope === 'household' && item.direction === 'inflow',
  );

  // 1. No further business income arrives this month. Modelled by removing the
  //    approved transfer and every business-sourced household inflow.
  const withoutBusinessIncome: EngineInput = {
    ...input,
    approvedSafeTransferMinor: 0,
    business:
      input.business === null ? null : { ...input.business, cumulativeRealizedProfitMinor: 0 },
  };

  // 2. Business receipts fall 30%. Applied to the approved transfer, which is the
  //    only business money the household forecast counts.
  const reducedReceipts: EngineInput = {
    ...input,
    approvedSafeTransferMinor:
      input.approvedSafeTransferMinor -
      applyBasisPoints(input.approvedSafeTransferMinor, 3_000),
  };

  // 3. A certain receipt is 14 days late. Only the earliest one is delayed: that
  //    is the realistic failure, and delaying everything would model a different
  //    event entirely.
  const earliestCertain = householdInflows
    .filter((item) => item.certainty === 'certain')
    .sort((a, b) => (a.expectedDate < b.expectedDate ? -1 : 1))[0];

  const delayedReceipt: EngineInput = {
    ...input,
    plannedItems: input.plannedItems.map((item) =>
      earliestCertain !== undefined && item.id === earliestCertain.id
        ? { ...item, expectedDate: addDays(item.expectedDate, 14), dueDate: null }
        : item,
    ),
  };

  // 4. A private lender asks for the money back, in full, in seven days.
  const suddenDemand: EngineInput = {
    ...input,
    plannedItems: [
      ...input.plannedItems,
      shockItem(
        'stress-private-demand',
        'דרישת חוב פרטית פתאומית',
        context.largestPrivateDebtMinor,
        addDays(today, 7),
      ),
    ],
  };

  // 5. An unexpected essential expense the size of the reserve floor.
  const unexpectedEssential: EngineInput = {
    ...input,
    plannedItems: [
      ...input.plannedItems,
      shockItem(
        'stress-essential-shock',
        'הוצאה חיונית בלתי צפויה',
        context.reserveFloorMinor,
        addDays(today, 3),
      ),
    ],
  };

  // 6. A large card charge that has not been classified yet lands before month end.
  const unclassifiedCharge: EngineInput = {
    ...input,
    plannedItems: [
      ...input.plannedItems,
      shockItem(
        'stress-unclassified-charge',
        'חיוב כרטיס גדול שטרם סווג',
        context.largestCardBalanceMinor,
        periodEnd,
      ),
    ],
  };

  return [
    evaluate(
      'no_business_income',
      'אפס הכנסה עסקית נוספת עד סוף החודש',
      withoutBusinessIncome,
      today,
    ),
    evaluate('receipts_down_30', 'ירידה של 30% בתקבולים העסקיים', reducedReceipts, today),
    evaluate('receipt_delayed_14d', 'תקבול ודאי מתעכב ב־14 יום', delayedReceipt, today),
    evaluate('private_debt_demand', 'דרישת חוב פרטית פתאומית', suddenDemand, today),
    evaluate('essential_shock', 'הוצאה חיונית בגובה רצפת הרזרבה', unexpectedEssential, today),
    evaluate(
      'unclassified_card_charge',
      'חיוב כרטיס גדול שטרם סווג',
      unclassifiedCharge,
      today,
    ),
  ];
}

/** All six scenarios end the period without a failure day. */
export function stressTestsPassed(results: readonly StressScenarioResult[]): boolean {
  return results.length > 0 && results.every((result) => result.passed);
}
