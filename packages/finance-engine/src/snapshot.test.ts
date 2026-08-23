import { describe, expect, test } from 'vitest';

import { account, baseInput, debt, debtEvent } from './fixtures/scenario';
import { buildFinancialSnapshot } from './snapshot';

/**
 * End to end through the composition step.
 *
 * These assert the six answers 01-PRODUCT-SPEC.md § מסך הבית requires, in the
 * order it requires them, from one realistic input.
 */
describe('buildFinancialSnapshot', () => {
  const snapshot = buildFinancialSnapshot(baseInput());

  test('resolves the business date in the household time zone', () => {
    expect(snapshot.today).toBe('2026-08-10');
    expect(snapshot.periodStart).toBe('2026-08-01');
    expect(snapshot.periodEnd).toBe('2026-08-31');
  });

  test('1. freshness and confidence come first and are real values', () => {
    expect(snapshot.freshnessAgeDays).toBe(1);
    expect(snapshot.quality.confidence).toBe('high');
    expect(snapshot.quality.score).toBe(100);
  });

  test('2. safe spend is the engine figure, with a breakdown that reproduces it', () => {
    expect(snapshot.safeSpend.resultMinor).toBe(380_000);
    const recomputed = snapshot.safeSpend.breakdown.reduce(
      (total, line) =>
        line.effect === 'adds'
          ? total + line.amountMinor
          : line.effect === 'subtracts'
            ? total - line.amountMinor
            : total,
      0,
    );
    expect(recomputed).toBe(snapshot.safeSpend.resultMinor);
  });

  test('3. the forecast reports the low point and the failure day', () => {
    expect(snapshot.forecastConservative.lowPointMinor).toBe(-100_000);
    expect(snapshot.forecastConservative.lowPointDate).toBe('2026-08-15');
    expect(snapshot.forecastConservative.firstFailureDate).toBe('2026-08-15');
  });

  test('4. consumer debt and total debt are reported apart', () => {
    expect(snapshot.debtTotals.consumerDebtMinor).toBe(1_000_000);
    expect(snapshot.debtTotals.mortgageMinor).toBe(0);
    expect(snapshot.debtTotals.totalDebtMinor).toBe(1_000_000);
    expect(snapshot.debtTrend?.consumerDirection).toBe('flat');
  });

  test('5. household and business liquidity are separate figures', () => {
    expect(snapshot.householdLiquidMinor).toBe(500_000);
    expect(snapshot.businessLiquidMinor).toBe(0);
    expect(snapshot.businessProfit).toBeNull();
  });

  test('6. there is exactly one recommended action, with its reasoning', () => {
    expect(snapshot.nextAction.key).toBe('move_a_payment');
    expect(snapshot.nextAction.params?.date).toBe('2026-08-15');
  });

  test('the operating mode reflects a gap inside fourteen days', () => {
    expect(snapshot.mode.mode).toBe('emergency');
    expect(snapshot.mode.reasons.length).toBeGreaterThan(0);
  });

  test('the decision envelope is conditional while stress tests fail', () => {
    expect(snapshot.decision.status).toBe('conditional');
    expect(snapshot.decision.calculationSnapshotId.startsWith('snap_')).toBe(true);
  });

  test('the waterfall funds the first five steps before accelerating repayment', () => {
    expect(snapshot.waterfall.allocations[0]?.allocatedMinor).toBe(600_000);
    expect(snapshot.waterfall.acceleratedRepaymentAllowed).toBe(true);
    expect(snapshot.waterfall.firstUnfundedStep).toBe(7);
  });

  test('all six stress tests run', () => {
    expect(snapshot.stressTests).toHaveLength(6);
  });

  test('the same input always produces the same snapshot id', () => {
    expect(buildFinancialSnapshot(baseInput()).decision.inputHash).toBe(
      snapshot.decision.inputHash,
    );
  });
});

describe('a household that is not in trouble', () => {
  const healthy = buildFinancialSnapshot(
    baseInput({
      accounts: [account({ balance: { amountMinor: 3_000_000, direction: 'inflow' } })],
    }),
  );

  test('has no failure day and passes its stress tests', () => {
    expect(healthy.forecastConservative.firstFailureDate).toBeNull();
    expect(healthy.stressTests.every((result) => result.passed)).toBe(true);
  });

  test('reaches a milder operating mode', () => {
    expect(healthy.mode.mode).not.toBe('emergency');
  });

  test('reports a safe decision once nothing is missing', () => {
    expect(healthy.decision.status).toBe('safe');
  });

  test('recommends something other than closing a gap', () => {
    expect(healthy.nextAction.key).not.toBe('close_funding_gap');
  });
});

describe('a household that swapped one creditor for another', () => {
  const swapped = buildFinancialSnapshot(
    baseInput({
      debts: [
        debt({ id: 'moshe', kind: 'private_person', creditorName: 'משה' }),
        debt({ id: 'israel', kind: 'private_person', creditorName: 'ישראל' }),
      ],
      debtEvents: [
        debtEvent({ id: 'open-moshe', debtId: 'moshe', amountMinor: 500_000 }),
        debtEvent({
          id: 'repay-moshe',
          debtId: 'moshe',
          kind: 'principal_payment',
          amountMinor: 500_000,
          occurredOn: '2026-08-05',
        }),
        debtEvent({
          id: 'borrow-israel',
          debtId: 'israel',
          kind: 'new_principal',
          amountMinor: 500_000,
          occurredOn: '2026-08-05',
        }),
      ],
      rollovers: [
        {
          id: 'link',
          fromDebtId: 'moshe',
          toDebtId: 'israel',
          amountMinor: 500_000,
          occurredOn: '2026-08-05',
          status: 'confirmed',
        },
      ],
      debtBaseline: {
        asOf: '2026-08-01',
        consumerDebtMinor: 500_000,
        totalDebtMinor: 500_000,
      },
    }),
  );

  test('shows no net change, however large the repayment was', () => {
    expect(swapped.debtMetrics.grossPrincipalRepaidMinor).toBe(500_000);
    expect(swapped.debtTrend?.netConsumerChangeMinor).toBe(0);
    expect(swapped.debtTrend?.consumerDirection).toBe('flat');
  });

  test('attributes the whole repayment to the rollover, not to income', () => {
    expect(swapped.debtMetrics.rolloverFundedRepaymentMinor).toBe(500_000);
    expect(swapped.debtMetrics.incomeFundedPrincipalReductionMinor).toBe(0);
  });

  test('does not recommend celebrating: the action is never about the repayment', () => {
    expect(swapped.nextAction.key).not.toBe('accelerate_repayment');
  });
});
