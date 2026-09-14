import { describe, expect, test } from 'vitest';

import { account, baseInput, planned } from './fixtures/scenario';
import {
  liquidCashMinor,
  nextCertainIncomeDate,
  reserveFloor,
  safeHouseholdSpend,
} from './household';

const today = '2026-08-10';

describe('liquidCashMinor', () => {
  test('bank accounts and cash wallets count', () => {
    const accounts = [
      account({ id: 'bank', balance: { amountMinor: 500_000, direction: 'inflow' } }),
      account({
        id: 'wallet',
        kind: 'cash_wallet',
        balance: { amountMinor: 30_000, direction: 'inflow' },
      }),
    ];
    expect(liquidCashMinor(accounts, 'household')).toBe(530_000);
  });

  test('a credit card balance is never liquidity', () => {
    const accounts = [
      account({ id: 'bank', balance: { amountMinor: 500_000, direction: 'inflow' } }),
      account({
        id: 'card',
        kind: 'credit_card',
        balance: { amountMinor: 800_000, direction: 'outflow' },
      }),
    ];
    expect(liquidCashMinor(accounts, 'household')).toBe(500_000);
  });

  test('an overdrawn bank account reduces the total, because the minus is real', () => {
    const accounts = [
      account({ id: 'bank', balance: { amountMinor: 500_000, direction: 'inflow' } }),
      account({
        id: 'overdraft',
        balance: { amountMinor: 200_000, direction: 'outflow' },
      }),
    ];
    expect(liquidCashMinor(accounts, 'household')).toBe(300_000);
  });

  test('business accounts are not household cash', () => {
    const accounts = [
      account({ id: 'home', balance: { amountMinor: 500_000, direction: 'inflow' } }),
      account({
        id: 'biz',
        scope: 'business',
        balance: { amountMinor: 900_000, direction: 'inflow' },
      }),
    ];
    expect(liquidCashMinor(accounts, 'household')).toBe(500_000);
    expect(liquidCashMinor(accounts, 'business')).toBe(900_000);
  });
});

describe('nextCertainIncomeDate', () => {
  test('finds the earliest certain inflow after the date given', () => {
    const items = [
      planned({
        id: 'a',
        direction: 'inflow',
        certainty: 'certain',
        expectedDate: '2026-08-28',
      }),
      planned({
        id: 'b',
        direction: 'inflow',
        certainty: 'certain',
        expectedDate: '2026-08-20',
      }),
    ];
    expect(nextCertainIncomeDate(items, today)).toBe('2026-08-20');
  });

  test('ignores probable income, which is not something to rely on', () => {
    const items = [
      planned({
        id: 'a',
        direction: 'inflow',
        certainty: 'probable',
        expectedDate: '2026-08-12',
      }),
      planned({
        id: 'b',
        direction: 'inflow',
        certainty: 'certain',
        expectedDate: '2026-08-28',
      }),
    ];
    expect(nextCertainIncomeDate(items, today)).toBe('2026-08-28');
  });

  test('returns null when nothing certain is coming', () => {
    expect(nextCertainIncomeDate([], today)).toBeNull();
  });
});

describe('reserveFloor', () => {
  test('takes the highest component, not the first', () => {
    const floor = reserveFloor(
      {
        manualFloorMinor: 200_000,
        incidentBufferMinor: 350_000,
        revolvingAvoidanceMinor: 100_000,
        protectedReservesMinor: 0,
      },
      300_000,
    );
    expect(floor.floorMinor).toBe(350_000);
    expect(floor.chosenComponent).toBe('incident_buffer');
  });

  test('reports which component set the floor, because the user is owed the reason', () => {
    const floor = reserveFloor(
      {
        manualFloorMinor: null,
        incidentBufferMinor: null,
        revolvingAvoidanceMinor: null,
        protectedReservesMinor: 0,
      },
      420_000,
    );
    expect(floor.chosenComponent).toBe('essentials_until_next_income');
    expect(floor.floorMinor).toBe(420_000);
  });

  test('lists every component even when it contributed nothing', () => {
    const floor = reserveFloor(
      {
        manualFloorMinor: 100_000,
        incidentBufferMinor: null,
        revolvingAvoidanceMinor: null,
        protectedReservesMinor: 0,
      },
      0,
    );
    expect(floor.components).toHaveLength(4);
  });
});

describe('safeHouseholdSpend', () => {
  test('computes the formula from 02-FINANCIAL-RULES.md § נוסחאות', () => {
    // 500,000 cash + 1,200,000 certain salary
    //   − 600,000 rent − 120,000 debt minimum − 600,000 reserve floor
    const result = safeHouseholdSpend(baseInput(), today);
    expect(result.resultMinor).toBe(380_000);
    expect(result.fundingGapMinor).toBe(0);
  });

  test('the breakdown reproduces the result exactly', () => {
    const result = safeHouseholdSpend(baseInput(), today);
    const recomputed = result.breakdown.reduce(
      (total, line) =>
        line.effect === 'adds'
          ? total + line.amountMinor
          : line.effect === 'subtracts'
            ? total - line.amountMinor
            : total,
      0,
    );
    expect(recomputed).toBe(result.resultMinor);
  });

  test('a shortfall becomes a funding gap and never a negative safe figure', () => {
    const result = safeHouseholdSpend(
      baseInput({
        accounts: [account({ balance: { amountMinor: 10_000, direction: 'inflow' } })],
      }),
      today,
    );
    expect(result.resultMinor).toBe(0);
    expect(result.fundingGapMinor).toBe(110_000);
  });

  test('probable income is conditional and stays out of the safe figure', () => {
    const withProbable = baseInput({
      plannedItems: [
        ...baseInput().plannedItems,
        planned({
          id: 'maybe',
          label: 'תקבול אפשרי',
          direction: 'inflow',
          amountMinor: 900_000,
          certainty: 'probable',
          expectedDate: '2026-08-25',
        }),
      ],
    });
    const result = safeHouseholdSpend(withProbable, today);
    expect(result.resultMinor).toBe(380_000);
    expect(result.conditionalMinor).toBe(900_000);
  });

  test('certain income expected after the period end does not count', () => {
    const result = safeHouseholdSpend(
      baseInput({
        plannedItems: baseInput().plannedItems.map((item) =>
          item.id === 'salary' ? { ...item, expectedDate: '2026-09-02' } : item,
        ),
      }),
      today,
    );
    expect(result.resultMinor).toBe(0);
    expect(result.fundingGapMinor).toBeGreaterThan(0);
  });

  test('an unresolved reconciliation gap reduces what is considered safe', () => {
    const input = baseInput();
    const result = safeHouseholdSpend(
      {
        ...input,
        dataQuality: { ...input.dataQuality, unresolvedReconciliationGapMinor: 80_000 },
      },
      today,
    );
    expect(result.resultMinor).toBe(300_000);
  });

  test('protected reserves are subtracted and reported as unavailable', () => {
    const input = baseInput();
    const result = safeHouseholdSpend(
      { ...input, reserve: { ...input.reserve, protectedReservesMinor: 50_000 } },
      today,
    );
    expect(result.resultMinor).toBe(330_000);
    expect(result.unavailableMinor).toBeGreaterThanOrEqual(50_000);
  });

  test('assumptions are stated, never implied', () => {
    expect(safeHouseholdSpend(baseInput(), today).assumptions.length).toBeGreaterThan(0);
  });
});

describe('committedOutflowMinor', () => {
  test('is what has to leave: essentials, settled charges and debt minimums', () => {
    // 600,000 rent + 0 other certain charges + 120,000 debt minimum.
    expect(safeHouseholdSpend(baseInput(), today).committedOutflowMinor).toBe(720_000);
  });

  test('excludes money that is only set aside', () => {
    const input = baseInput();
    const result = safeHouseholdSpend(
      { ...input, reserve: { ...input.reserve, protectedReservesMinor: 50_000 } },
      today,
    );
    // The reserve raises what is unavailable, but nothing extra has to be paid.
    expect(result.committedOutflowMinor).toBe(720_000);
    expect(result.unavailableMinor).toBeGreaterThan(result.committedOutflowMinor);
  });

  test('never exceeds the sum of the subtracting breakdown lines', () => {
    const result = safeHouseholdSpend(baseInput(), today);
    const subtracted = result.breakdown
      .filter((line) => line.effect === 'subtracts')
      .reduce((total, line) => total + line.amountMinor, 0);
    expect(result.committedOutflowMinor).toBeLessThanOrEqual(subtracted);
  });
});
