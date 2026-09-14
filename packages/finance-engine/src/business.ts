import { liquidCashMinor } from './household';
import { notice, type EngineNotice } from './notice';
import { clampAtZero, minSigned } from './money';
import type { BreakdownLine, EngineInput } from './types';

/**
 * Business profitability and the safe transfer to the household.
 *
 * 01-PRODUCT-SPEC.md describes the situation this exists for: a business turning
 * over 35–60 thousand a month whose real profit is unknown, mixed with household
 * money across several accounts. The danger is not fraud, it is drawing money
 * that was never profit — money that belonged to the tax authority or to a
 * supplier who has not invoiced yet.
 *
 * Hence two different profit figures. Accounting profit answers "did the business
 * do well". Realized cash profit answers "is there money that is actually ours",
 * and only the second one may fund a transfer.
 */

export interface BusinessProfit {
  readonly operatingProfitMinor: number;
  readonly realizedCashProfitMinor: number;
  readonly availableCashMinor: number;
  readonly breakdown: readonly BreakdownLine[];
}

/**
 * `business_operating_profit` and `realized_business_cash_profit`, per § נוסחאות.
 *
 * Both may come out negative, and both are reported as they are. A loss is a
 * fact; clamping it at zero would hide the very thing the household needs to see.
 */
export function businessProfit(input: EngineInput): BusinessProfit | null {
  const business = input.business;
  if (business === null) return null;

  const operatingProfitMinor = business.receivedIncomeMinor - business.approvedExpensesMinor;

  const realizedCashProfitMinor =
    business.receivedIncomeMinor -
    business.paidExpensesMinor -
    business.accruedTaxReserveMinor -
    business.certainObligationsMinor;

  const liquidBusinessCashMinor = liquidCashMinor(input.accounts, 'business');

  const availableCashMinor =
    liquidBusinessCashMinor -
    business.accruedTaxReserveMinor -
    business.certainObligationsMinor -
    business.operatingReserveMinor -
    business.overduePayablesMinor;

  const breakdown: BreakdownLine[] = [
    {
      key: 'received_income',
      amountMinor: business.receivedIncomeMinor,
      effect: 'adds',
    },
    {
      key: 'paid_expenses',
      amountMinor: business.paidExpensesMinor,
      effect: 'subtracts',
    },
    {
      key: 'tax_reserve',
      amountMinor: business.accruedTaxReserveMinor,
      effect: 'subtracts',
    },
    {
      key: 'certain_obligations',
      amountMinor: business.certainObligationsMinor,
      effect: 'subtracts',
    },
    {
      key: 'operating_reserve',
      amountMinor: business.operatingReserveMinor,
      effect: 'subtracts',
    },
    {
      key: 'overdue_payables',
      amountMinor: business.overduePayablesMinor,
      effect: 'subtracts',
    },
    {
      key: 'liquid_business_cash',
      amountMinor: liquidBusinessCashMinor,
      effect: 'informational',
    },
    {
      key: 'approved_expenses',
      amountMinor: business.approvedExpensesMinor,
      effect: 'informational',
    },
  ];

  return { operatingProfitMinor, realizedCashProfitMinor, availableCashMinor, breakdown };
}

export interface SafeTransfer {
  readonly resultMinor: number;
  readonly bindingConstraint: 'realized_profit' | 'available_cash' | 'household_need' | 'none';
  readonly householdNeedMinor: number;
  readonly breakdown: readonly BreakdownLine[];
  readonly warnings: readonly EngineNotice[];
}

/**
 * `safe_business_transfer = max(0, min(cumulative_realized_profit,
 *                                      business_available_cash,
 *                                      household_need_until_month_end))`
 *
 * The household need term is what keeps this from becoming a drawdown habit: the
 * business does not hand over everything it can, only what the household actually
 * needs before the month ends. The engine reports which of the three limits bound
 * the result, because "why is it only this much" is the first question asked.
 */
export function safeBusinessTransfer(
  input: EngineInput,
  profit: BusinessProfit | null,
  householdNeedMinor: number,
): SafeTransfer {
  const business = input.business;
  if (business === null || profit === null) {
    return {
      resultMinor: 0,
      bindingConstraint: 'none',
      householdNeedMinor,
      breakdown: [],
      warnings: [notice('business.none_defined')],
    };
  }

  const candidates = [
    {
      key: 'realized_profit' as const,
      amountMinor: business.cumulativeRealizedProfitMinor,
    },
    {
      key: 'available_cash' as const,
      amountMinor: profit.availableCashMinor,
    },
    {
      key: 'household_need' as const,
      amountMinor: householdNeedMinor,
    },
  ];

  const lowest = minSigned(candidates.map((candidate) => candidate.amountMinor));
  const { resultMinor } = clampAtZero(lowest);
  const binding = candidates.find((candidate) => candidate.amountMinor === lowest);

  const warnings: EngineNotice[] = [];
  if (profit.availableCashMinor < 0) {
    warnings.push(notice('business.available_cash_negative'));
  }
  if (business.cumulativeRealizedProfitMinor <= 0) {
    warnings.push(notice('business.no_realized_profit'));
  }
  if (business.overduePayablesMinor > 0) {
    warnings.push(
      notice('business.overdue_payables', { amountMinor: business.overduePayablesMinor }),
    );
  }

  return {
    resultMinor,
    bindingConstraint: binding?.key ?? 'none',
    householdNeedMinor,
    breakdown: candidates.map((candidate) => ({
      key: candidate.key,
      amountMinor: candidate.amountMinor,
      effect: 'informational' as const,
    })),
    warnings,
  };
}

/**
 * How much the household is short before the month ends.
 *
 * This is the third limit on a transfer, and it is intentionally computed from
 * commitments rather than from wants: essentials, certain charges and debt
 * minimums, less the cash and certain income already in hand.
 */
export function householdNeedUntilMonthEnd(
  commitmentsMinor: number,
  availableMinor: number,
): number {
  return clampAtZero(commitmentsMinor - availableMinor).resultMinor;
}
