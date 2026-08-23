import { describe, expect, test } from 'vitest';

import { account, baseInput, planned } from './fixtures/scenario';
import { fundingGapWithinDays, overdueEssentialsMinor, projectDailyBalance } from './forecast';
import { runStressTests, stressTestsPassed } from './stress';

const today = '2026-08-10';

describe('projectDailyBalance', () => {
  test('walks every day from today to the end of the month', () => {
    const forecast = projectDailyBalance(baseInput(), today, 'conservative');
    expect(forecast.days).toHaveLength(22);
    expect(forecast.days[0]?.date).toBe('2026-08-10');
    expect(forecast.days.at(-1)?.date).toBe('2026-08-31');
  });

  test('opens at the household liquid balance', () => {
    expect(projectDailyBalance(baseInput(), today, 'conservative').openingMinor).toBe(500_000);
  });

  test('applies an outflow on the day it is due', () => {
    const forecast = projectDailyBalance(baseInput(), today, 'conservative');
    const rentDay = forecast.days.find((day) => day.date === '2026-08-15');
    expect(rentDay?.outflowMinor).toBe(600_000);
    expect(rentDay?.closingMinor).toBe(-100_000);
  });

  test('finds the low point and the day it happens', () => {
    const forecast = projectDailyBalance(baseInput(), today, 'conservative');
    expect(forecast.lowPointMinor).toBe(-100_000);
    expect(forecast.lowPointDate).toBe('2026-08-15');
  });

  test('names the first day the balance goes below zero', () => {
    expect(projectDailyBalance(baseInput(), today, 'conservative').firstFailureDate).toBe(
      '2026-08-15',
    );
  });

  test('reports no failure day when the balance never goes negative', () => {
    const forecast = projectDailyBalance(
      baseInput({
        accounts: [account({ balance: { amountMinor: 1_000_000, direction: 'inflow' } })],
      }),
      today,
      'conservative',
    );
    expect(forecast.firstFailureDate).toBeNull();
    expect(forecast.lowPointMinor).toBe(400_000);
  });

  test('the conservative scenario ignores probable income', () => {
    const withProbable = baseInput({
      plannedItems: [
        ...baseInput().plannedItems,
        planned({
          id: 'maybe',
          direction: 'inflow',
          amountMinor: 900_000,
          certainty: 'probable',
          expectedDate: '2026-08-12',
        }),
      ],
    });
    expect(projectDailyBalance(withProbable, today, 'conservative').endOfPeriodMinor).toBe(
      1_100_000,
    );
  });

  test('the expected scenario counts it, and is shown beside rather than instead', () => {
    const withProbable = baseInput({
      plannedItems: [
        ...baseInput().plannedItems,
        planned({
          id: 'maybe',
          direction: 'inflow',
          amountMinor: 900_000,
          certainty: 'probable',
          expectedDate: '2026-08-12',
        }),
      ],
    });
    expect(projectDailyBalance(withProbable, today, 'expected').endOfPeriodMinor).toBe(
      2_000_000,
    );
  });

  test('an outflow is counted in full whatever its certainty', () => {
    const withPossibleCost = baseInput({
      plannedItems: [
        ...baseInput().plannedItems,
        planned({
          id: 'maybe-cost',
          direction: 'outflow',
          amountMinor: 200_000,
          certainty: 'possible',
          expectedDate: '2026-08-12',
        }),
      ],
    });
    const forecast = projectDailyBalance(withPossibleCost, today, 'conservative');
    expect(forecast.days.find((day) => day.date === '2026-08-12')?.outflowMinor).toBe(200_000);
  });

  test('a due date overrides the expected date, because that is when it must be paid', () => {
    const input = baseInput({
      plannedItems: [
        planned({
          id: 'bill',
          direction: 'outflow',
          amountMinor: 100_000,
          expectedDate: '2026-08-25',
          dueDate: '2026-08-12',
        }),
      ],
    });
    const forecast = projectDailyBalance(input, today, 'conservative');
    expect(forecast.days.find((day) => day.date === '2026-08-12')?.outflowMinor).toBe(100_000);
  });

  test('business items do not move the household forecast', () => {
    const input = baseInput({
      plannedItems: [
        ...baseInput().plannedItems,
        planned({
          id: 'biz',
          scope: 'business',
          direction: 'outflow',
          amountMinor: 900_000,
          expectedDate: '2026-08-12',
        }),
      ],
    });
    expect(projectDailyBalance(input, today, 'conservative').endOfPeriodMinor).toBe(1_100_000);
  });
});

describe('fundingGapWithinDays', () => {
  test('reports the shortfall inside the horizon', () => {
    expect(fundingGapWithinDays(baseInput(), today, 14)).toBe(100_000);
  });

  test('is zero when nothing inside the horizon breaks', () => {
    const input = baseInput({
      accounts: [account({ balance: { amountMinor: 1_000_000, direction: 'inflow' } })],
    });
    expect(fundingGapWithinDays(input, today, 14)).toBe(0);
  });

  test('a shorter horizon can be clean while a longer one is not', () => {
    expect(fundingGapWithinDays(baseInput(), today, 3)).toBe(0);
    expect(fundingGapWithinDays(baseInput(), today, 14)).toBeGreaterThan(0);
  });
});

describe('overdueEssentialsMinor', () => {
  test('counts an essential obligation whose due date has passed', () => {
    const input = baseInput({
      plannedItems: [
        planned({
          id: 'late',
          direction: 'outflow',
          amountMinor: 70_000,
          essential: true,
          expectedDate: '2026-08-01',
          dueDate: '2026-08-01',
        }),
      ],
    });
    expect(overdueEssentialsMinor(input, today)).toBe(70_000);
  });

  test('a future obligation is not overdue', () => {
    expect(overdueEssentialsMinor(baseInput(), today)).toBe(0);
  });
});

describe('runStressTests', () => {
  const context = {
    largestPrivateDebtMinor: 300_000,
    largestCardBalanceMinor: 400_000,
    reserveFloorMinor: 200_000,
  };

  test('runs all six scenarios required by 02-FINANCIAL-RULES.md', () => {
    const results = runStressTests(baseInput(), today, context);
    expect(results.map((result) => result.key)).toEqual([
      'no_business_income',
      'receipts_down_30',
      'receipt_delayed_14d',
      'private_debt_demand',
      'essential_shock',
      'unclassified_card_charge',
    ]);
  });

  test('each scenario reports a low point, a gap and whether it passed', () => {
    for (const result of runStressTests(baseInput(), today, context)) {
      expect(typeof result.lowPointMinor).toBe('number');
      expect(result.fundingGapMinor).toBeGreaterThanOrEqual(0);
      expect(typeof result.passed).toBe('boolean');
    }
  });

  test('a household that already fails fails every scenario', () => {
    const results = runStressTests(baseInput(), today, context);
    expect(stressTestsPassed(results)).toBe(false);
  });

  test('a comfortable household passes all six', () => {
    const input = baseInput({
      accounts: [account({ balance: { amountMinor: 3_000_000, direction: 'inflow' } })],
    });
    const results = runStressTests(input, today, context);
    expect(stressTestsPassed(results)).toBe(true);
  });

  test('a sudden private demand can break a household that otherwise holds', () => {
    const input = baseInput({
      accounts: [account({ balance: { amountMinor: 700_000, direction: 'inflow' } })],
    });
    const results = runStressTests(input, today, {
      ...context,
      largestPrivateDebtMinor: 5_000_000,
    });
    const demand = results.find((result) => result.key === 'private_debt_demand');
    expect(demand?.passed).toBe(false);
  });

  test('a delayed receipt is modelled by moving one payment, not all of them', () => {
    const input = baseInput({
      accounts: [account({ balance: { amountMinor: 700_000, direction: 'inflow' } })],
    });
    const delayed = runStressTests(input, today, context).find(
      (result) => result.key === 'receipt_delayed_14d',
    );
    // The salary lands on the 28th; delayed by 14 days it falls outside the month
    // entirely, so the period ends without it.
    expect(delayed?.passed).toBe(true);
    expect(delayed?.lowPointMinor).toBe(100_000);
  });

  test('scenarios name the obligations they put at risk', () => {
    const results = runStressTests(baseInput(), today, context);
    const atRisk = results.flatMap((result) => result.atRiskObligations);
    expect(atRisk.length).toBeGreaterThan(0);
  });

  test('an empty result set is not treated as passing', () => {
    expect(stressTestsPassed([])).toBe(false);
  });
});
