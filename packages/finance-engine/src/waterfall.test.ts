import { describe, expect, test } from 'vitest';

import { WATERFALL_STEPS, allocateWaterfall, noClaims } from './waterfall';

const claims = {
  ...noClaims(),
  essential_needs: 600_000,
  mortgage_and_material: 800_000,
  taxes_and_held_funds: 300_000,
  debt_minimums: 200_000,
  operating_reserve: 400_000,
  legal_or_urgent_debt: 100_000,
  expensive_debt: 900_000,
};

describe('the ten steps', () => {
  test('are exactly the ten from FIN-WATERFALL-001, in order', () => {
    expect(WATERFALL_STEPS.map((step) => step.step)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  test('essentials come first and long-term goals last', () => {
    expect(WATERFALL_STEPS[0]?.key).toBe('essential_needs');
    expect(WATERFALL_STEPS.at(-1)?.key).toBe('long_term_goals');
  });

  test('the minimal reserve precedes accelerated repayment', () => {
    const reserve = WATERFALL_STEPS.find((step) => step.key === 'operating_reserve')?.step ?? 0;
    const expensive = WATERFALL_STEPS.find((step) => step.key === 'expensive_debt')?.step ?? 0;
    expect(reserve).toBeLessThan(expensive);
  });
});

describe('allocateWaterfall', () => {
  test('funds every step when there is enough money', () => {
    const result = allocateWaterfall(5_000_000, claims);
    expect(result.allocations.every((allocation) => allocation.unfundedMinor === 0)).toBe(true);
    expect(result.firstUnfundedStep).toBeNull();
  });

  test('never allocates more than is available', () => {
    const result = allocateWaterfall(1_000_000, claims);
    const allocated = result.allocations.reduce(
      (total, allocation) => total + allocation.allocatedMinor,
      0,
    );
    expect(allocated).toBe(1_000_000);
    expect(result.remainingMinor).toBe(0);
  });

  test('fills earlier steps completely before later ones get anything', () => {
    // 600,000 covers essentials exactly and leaves nothing for the mortgage.
    const result = allocateWaterfall(600_000, claims);
    expect(result.allocations[0]?.allocatedMinor).toBe(600_000);
    expect(result.allocations[1]?.allocatedMinor).toBe(0);
    expect(result.firstUnfundedStep).toBe(2);
  });

  test('a partially funded step reports what it is short', () => {
    const result = allocateWaterfall(900_000, claims);
    expect(result.allocations[1]?.allocatedMinor).toBe(300_000);
    expect(result.allocations[1]?.unfundedMinor).toBe(500_000);
  });

  test('accelerated repayment is blocked while any of steps 1-5 is short', () => {
    const result = allocateWaterfall(1_500_000, claims);
    expect(result.acceleratedRepaymentAllowed).toBe(false);
  });

  test('accelerated repayment opens once steps 1-5 are fully funded', () => {
    // 600,000 + 800,000 + 300,000 + 200,000 + 400,000 = 2,300,000
    const result = allocateWaterfall(2_300_000, claims);
    expect(result.acceleratedRepaymentAllowed).toBe(true);
  });

  test('money left after every claim is reported rather than absorbed', () => {
    const result = allocateWaterfall(10_000_000, claims);
    expect(result.remainingMinor).toBe(10_000_000 - 3_300_000);
  });

  test('with nothing available, every step is unfunded and the first is named', () => {
    const result = allocateWaterfall(0, claims);
    expect(result.firstUnfundedStep).toBe(1);
    expect(result.allocations.every((allocation) => allocation.allocatedMinor === 0)).toBe(
      true,
    );
  });

  test('a step with no claim never blocks the steps behind it', () => {
    const result = allocateWaterfall(500_000, { ...noClaims(), debt_minimums: 200_000 });
    expect(result.firstUnfundedStep).toBeNull();
    expect(result.remainingMinor).toBe(300_000);
  });

  test('rejects a negative amount of available money', () => {
    expect(() => allocateWaterfall(-1, claims)).toThrow();
  });
});
