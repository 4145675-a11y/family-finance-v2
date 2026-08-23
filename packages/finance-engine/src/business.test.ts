import { describe, expect, test } from 'vitest';

import { businessProfit, householdNeedUntilMonthEnd, safeBusinessTransfer } from './business';
import { account, baseInput } from './fixtures/scenario';
import type { BusinessInputs, EngineInput } from './types';

const business: BusinessInputs = {
  id: 'business-1',
  name: 'העסק',
  receivedIncomeMinor: 4_000_000,
  approvedExpensesMinor: 1_500_000,
  paidExpensesMinor: 1_200_000,
  accruedTaxReserveMinor: 800_000,
  certainObligationsMinor: 300_000,
  operatingReserveMinor: 200_000,
  overduePayablesMinor: 0,
  cumulativeRealizedProfitMinor: 1_000_000,
};

function withBusiness(overrides: Partial<BusinessInputs> = {}): EngineInput {
  return baseInput({
    business: { ...business, ...overrides },
    accounts: [
      account(),
      account({
        id: 'business-account',
        scope: 'business',
        balance: { amountMinor: 2_500_000, direction: 'inflow' },
      }),
    ],
  });
}

describe('businessProfit', () => {
  test('operating profit is received income less approved expenses', () => {
    const profit = businessProfit(withBusiness());
    expect(profit?.operatingProfitMinor).toBe(2_500_000);
  });

  test('realized cash profit also removes tax reserve and certain obligations', () => {
    // 4,000,000 − 1,200,000 paid − 800,000 tax − 300,000 obligations
    expect(businessProfit(withBusiness())?.realizedCashProfitMinor).toBe(1_700_000);
  });

  test('accounting profit and realized cash profit are different numbers', () => {
    const profit = businessProfit(withBusiness());
    expect(profit?.operatingProfitMinor).not.toBe(profit?.realizedCashProfitMinor);
  });

  test('available cash removes the operating reserve and overdue payables', () => {
    // 2,500,000 liquid − 800,000 tax − 300,000 obligations − 200,000 reserve
    expect(businessProfit(withBusiness())?.availableCashMinor).toBe(1_200_000);
  });

  test('a loss is reported as a loss rather than clamped to zero', () => {
    const profit = businessProfit(
      withBusiness({ receivedIncomeMinor: 100_000, approvedExpensesMinor: 900_000 }),
    );
    expect(profit?.operatingProfitMinor).toBe(-800_000);
  });

  test('no business means no profit figure at all', () => {
    expect(businessProfit(baseInput())).toBeNull();
  });
});

describe('safeBusinessTransfer', () => {
  test('is the lowest of realized profit, available cash and household need', () => {
    const input = withBusiness();
    const profit = businessProfit(input);
    const transfer = safeBusinessTransfer(input, profit, 400_000);
    expect(transfer.resultMinor).toBe(400_000);
    expect(transfer.bindingConstraint).toBe('household_need');
  });

  test('realized profit can be the binding limit', () => {
    const input = withBusiness({ cumulativeRealizedProfitMinor: 150_000 });
    const transfer = safeBusinessTransfer(input, businessProfit(input), 900_000);
    expect(transfer.resultMinor).toBe(150_000);
    expect(transfer.bindingConstraint).toBe('realized_profit');
  });

  test('available cash can be the binding limit', () => {
    const input = withBusiness({ overduePayablesMinor: 1_100_000 });
    const transfer = safeBusinessTransfer(input, businessProfit(input), 900_000);
    expect(transfer.resultMinor).toBe(100_000);
    expect(transfer.bindingConstraint).toBe('available_cash');
  });

  test('a negative limit produces no transfer, not a negative one', () => {
    const input = withBusiness({ overduePayablesMinor: 5_000_000 });
    const transfer = safeBusinessTransfer(input, businessProfit(input), 900_000);
    expect(transfer.resultMinor).toBe(0);
  });

  test('warns when a transfer would be a draw against the business', () => {
    const input = withBusiness({ cumulativeRealizedProfitMinor: 0 });
    const transfer = safeBusinessTransfer(input, businessProfit(input), 900_000);
    expect(transfer.warnings.map((w) => w.code)).toContain('business.no_realized_profit');
  });

  test('warns about overdue payables, which are deducted before anything moves', () => {
    const input = withBusiness({ overduePayablesMinor: 50_000 });
    const transfer = safeBusinessTransfer(input, businessProfit(input), 900_000);
    expect(transfer.warnings.map((w) => w.code)).toContain('business.overdue_payables');
  });

  test('without a business the answer is zero with an explanation', () => {
    const transfer = safeBusinessTransfer(baseInput(), null, 900_000);
    expect(transfer.resultMinor).toBe(0);
    expect(transfer.bindingConstraint).toBe('none');
    expect(transfer.warnings).toHaveLength(1);
  });
});

describe('householdNeedUntilMonthEnd', () => {
  test('is the shortfall between commitments and what is already available', () => {
    expect(householdNeedUntilMonthEnd(900_000, 400_000)).toBe(500_000);
  });

  test('is zero when the household already covers its commitments', () => {
    expect(householdNeedUntilMonthEnd(400_000, 900_000)).toBe(0);
  });
});
