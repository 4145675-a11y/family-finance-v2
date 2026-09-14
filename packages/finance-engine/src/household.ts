import { LIQUID_ACCOUNT_KINDS } from '@family-finance/contracts';
import type { BusinessDate } from '@family-finance/contracts';

import { endOfMonth, isOnOrBefore } from './dates';
import { clampAtZero, maxSigned, sumSigned, toSigned } from './money';
import { notice, type EngineNotice } from './notice';
import type {
  AccountPosition,
  BreakdownLine,
  EngineInput,
  PlannedItem,
  ReserveInputs,
} from './types';

/**
 * Household liquidity: what is genuinely available to spend.
 *
 * 02-FINANCIAL-RULES.md § נזילות מול ודאות draws the line this file is built on.
 * Certainty is not liquidity. Money that is certain to arrive but has not arrived
 * is not cash, and a `safe` figure that includes it is wrong in the one direction
 * that hurts — it tells a family they can spend money they do not have.
 */

/**
 * Cash actually held in household accounts.
 *
 * Only bank accounts and cash wallets qualify. A credit card is money owed, not
 * money held, so its balance never enters this sum; an overdrawn bank account
 * reduces it, because the negative balance is real.
 */
export function liquidCashMinor(
  accounts: readonly AccountPosition[],
  scope: 'household' | 'business',
): number {
  return sumSigned(
    accounts
      .filter(
        (account) => account.scope === scope && LIQUID_ACCOUNT_KINDS.includes(account.kind),
      )
      .map((account) => toSigned(account.balance)),
  );
}

function isDueBy(item: PlannedItem, date: BusinessDate): boolean {
  return isOnOrBefore(item.dueDate ?? item.expectedDate, date);
}

/** The first date a certain household inflow is expected, if there is one. */
export function nextCertainIncomeDate(
  items: readonly PlannedItem[],
  after: BusinessDate,
): BusinessDate | null {
  const dates = items
    .filter(
      (item) =>
        item.scope === 'household' &&
        item.direction === 'inflow' &&
        item.certainty === 'certain' &&
        !isOnOrBefore(item.expectedDate, after),
    )
    .map((item) => item.expectedDate)
    .sort();
  return dates[0] ?? null;
}

export interface ReserveFloor {
  readonly floorMinor: number;
  /** Which component set the floor. The user is shown this, never just a number. */
  readonly chosenComponent: string;
  readonly components: readonly BreakdownLine[];
}

/**
 * The minimum reserve floor.
 *
 * § רזרבה מינימלית: not "three to six months". The floor is the highest of the
 * four listed components, and the system must be able to say which one won —
 * changing it is a material decision, not a slider.
 */
export function reserveFloor(
  reserve: ReserveInputs,
  essentialsUntilNextIncomeMinor: number,
): ReserveFloor {
  const components: BreakdownLine[] = [
    {
      key: 'manual_floor',
      amountMinor: reserve.manualFloorMinor ?? 0,
      effect: 'informational',
    },
    {
      key: 'essentials_until_next_income',
      amountMinor: essentialsUntilNextIncomeMinor,
      effect: 'informational',
    },
    {
      key: 'incident_buffer',
      amountMinor: reserve.incidentBufferMinor ?? 0,
      effect: 'informational',
    },
    {
      key: 'revolving_avoidance',
      amountMinor: reserve.revolvingAvoidanceMinor ?? 0,
      effect: 'informational',
    },
  ];

  const floorMinor = maxSigned(components.map((component) => component.amountMinor));
  const winner = components.find((component) => component.amountMinor === floorMinor);

  return {
    floorMinor,
    chosenComponent: winner?.key ?? 'manual_floor',
    components,
  };
}

export interface SafeSpend {
  readonly resultMinor: number;
  readonly fundingGapMinor: number;
  readonly conditionalMinor: number;
  readonly unavailableMinor: number;
  /**
   * What must actually leave the household before the period ends: essential
   * needs, other settled charges and debt minimums.
   *
   * Distinct from `unavailableMinor`, which also holds money that is merely set
   * aside. A screen asking "how much has to go out" is asking about this one, and
   * summing breakdown lines on the screen to get it would put an arithmetic
   * decision in a component.
   */
  readonly committedOutflowMinor: number;
  readonly breakdown: readonly BreakdownLine[];
  readonly reserve: ReserveFloor;
  readonly assumptions: readonly EngineNotice[];
}

/**
 * `safe_household_spend`, exactly as written in § נוסחאות.
 *
 * Every term is a named breakdown line, in the order the formula states it, so
 * the number on the dashboard can always be reconstructed from what is shown
 * beneath it (UX-TRUST-001).
 *
 * The negative case is not swallowed. When the terms come out below zero the
 * result is zero and the shortfall becomes `fundingGapMinor`, which is presented
 * as its own fact with its own date — a family with a gap needs to see the gap,
 * not a reassuring zero.
 */
export function safeHouseholdSpend(input: EngineInput, today: BusinessDate): SafeSpend {
  const periodEnd = endOfMonth(today);

  const verifiedLiquidCashMinor = liquidCashMinor(input.accounts, 'household');

  const certainIncomeMinor = input.plannedItems
    .filter(
      (item) =>
        item.scope === 'household' &&
        item.direction === 'inflow' &&
        item.certainty === 'certain' &&
        isOnOrBefore(item.expectedDate, periodEnd),
    )
    .reduce((total, item) => total + item.amountMinor, 0);

  const essentialNeedsMinor = input.plannedItems
    .filter(
      (item) =>
        item.scope === 'household' &&
        item.direction === 'outflow' &&
        item.essential &&
        isDueBy(item, periodEnd),
    )
    .reduce((total, item) => total + item.amountMinor, 0);

  // Certain obligations that are not essential needs. Filtering on `!essential`
  // is what stops the same shekel being subtracted twice.
  const certainDueItemsMinor = input.plannedItems
    .filter(
      (item) =>
        item.scope === 'household' &&
        item.direction === 'outflow' &&
        !item.essential &&
        item.certainty === 'certain' &&
        isDueBy(item, periodEnd),
    )
    .reduce((total, item) => total + item.amountMinor, 0);

  const debtMinimumsMinor = input.debts
    .filter((debt) => debt.status === 'active')
    .reduce((total, debt) => total + (debt.minimumPaymentMinor ?? 0), 0);

  const nextIncome = nextCertainIncomeDate(input.plannedItems, today);
  const essentialsUntilNextIncomeMinor =
    nextIncome === null
      ? essentialNeedsMinor
      : input.plannedItems
          .filter(
            (item) =>
              item.scope === 'household' &&
              item.direction === 'outflow' &&
              item.essential &&
              isDueBy(item, nextIncome),
          )
          .reduce((total, item) => total + item.amountMinor, 0);

  const reserve = reserveFloor(input.reserve, essentialsUntilNextIncomeMinor);

  const breakdown: BreakdownLine[] = [
    {
      key: 'verified_liquid_cash',
      amountMinor: verifiedLiquidCashMinor,
      effect: 'adds',
    },
    {
      key: 'certain_income',
      amountMinor: certainIncomeMinor,
      effect: 'adds',
    },
    {
      key: 'approved_business_transfer',
      amountMinor: input.approvedSafeTransferMinor,
      effect: 'adds',
    },
    {
      key: 'essential_needs',
      amountMinor: essentialNeedsMinor,
      effect: 'subtracts',
    },
    {
      key: 'certain_due_items',
      amountMinor: certainDueItemsMinor,
      effect: 'subtracts',
    },
    {
      key: 'debt_minimums',
      amountMinor: debtMinimumsMinor,
      effect: 'subtracts',
    },
    {
      key: 'protected_reserves',
      amountMinor: input.reserve.protectedReservesMinor,
      effect: 'subtracts',
    },
    {
      key: 'safety_floor',
      amountMinor: reserve.floorMinor,
      effect: 'subtracts',
    },
    {
      key: 'reconciliation_gap',
      amountMinor: input.dataQuality.unresolvedReconciliationGapMinor,
      effect: 'subtracts',
    },
  ];

  const raw = breakdown.reduce(
    (total, line) =>
      line.effect === 'adds'
        ? total + line.amountMinor
        : line.effect === 'subtracts'
          ? total - line.amountMinor
          : total,
    0,
  );

  const { resultMinor, shortfallMinor } = clampAtZero(raw);

  // Conditional money is shown beside the safe figure and never mixed into it.
  const conditionalMinor = input.plannedItems
    .filter(
      (item) =>
        item.scope === 'household' &&
        item.direction === 'inflow' &&
        item.certainty !== 'certain' &&
        isOnOrBefore(item.expectedDate, periodEnd),
    )
    .reduce((total, item) => total + item.amountMinor, 0);

  const assumptions: EngineNotice[] = [
    notice('assumption.verified_balances_only'),
    notice('assumption.certain_income_within_period'),
    notice('assumption.debt_minimums_full_month'),
  ];

  return {
    resultMinor,
    fundingGapMinor: shortfallMinor,
    conditionalMinor,
    committedOutflowMinor: essentialNeedsMinor + certainDueItemsMinor + debtMinimumsMinor,
    unavailableMinor:
      input.reserve.protectedReservesMinor + reserve.floorMinor + debtMinimumsMinor,
    breakdown,
    reserve,
    assumptions,
  };
}
