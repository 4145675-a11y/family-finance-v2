import { describe, expect, test } from 'vitest';

import { calculateFoodWeek, type FoodWeekInput } from './food-week';

function food(overrides: Partial<FoodWeekInput> = {}): FoodWeekInput {
  return {
    // Wednesday, 12 August 2026. The week runs Sunday 9th to Saturday 15th.
    asOf: '2026-08-12',
    monthlyPlannedMinor: 400_000,
    approvedThisMonthMinor: 0,
    pendingThisMonthMinor: 0,
    spentThisWeekMinor: 0,
    largePurchaseThisWeekMinor: 0,
    carryForwardEnabled: false,
    dataAgeDays: 1,
    ...overrides,
  };
}

describe('week boundaries', () => {
  test('the week starts on the preceding Sunday', () => {
    expect(calculateFoodWeek(food()).weekStartsOn).toBe('2026-08-09');
  });

  test('and ends on the following Saturday', () => {
    expect(calculateFoodWeek(food()).weekEndsOn).toBe('2026-08-15');
  });

  test('a Sunday is its own week start', () => {
    const guidance = calculateFoodWeek(food({ asOf: '2026-08-09' }));
    expect(guidance.weekStartsOn).toBe('2026-08-09');
    expect(guidance.daysLeftInWeek).toBe(7);
  });

  test('the week is cut at the end of the month, never spilling into the next', () => {
    const guidance = calculateFoodWeek(food({ asOf: '2026-08-30' }));
    expect(guidance.weekEndsOn).toBe('2026-08-31');
    expect(guidance.daysLeftInWeek).toBe(2);
  });

  test('on the last day of the month there is one day left in both', () => {
    const guidance = calculateFoodWeek(food({ asOf: '2026-08-31' }));
    expect(guidance.daysLeftInMonth).toBe(1);
    expect(guidance.daysLeftInWeek).toBe(1);
  });

  test('February is measured as February', () => {
    expect(calculateFoodWeek(food({ asOf: '2026-02-10' })).daysLeftInMonth).toBe(19);
  });
});

describe('the weekly figure is not the monthly one divided by four', () => {
  test('it is pro-rated over the days actually left', () => {
    // 20 days left in the month, 4 of them left in this week, 4,000.00 untouched.
    const guidance = calculateFoodWeek(food());
    expect(guidance.daysLeftInMonth).toBe(20);
    expect(guidance.daysLeftInWeek).toBe(4);
    expect(guidance.weekRemainingMinor).toBe(80_000);
    expect(guidance.weekRemainingMinor).not.toBe(100_000);
  });

  test('a heavier month so far leaves less for this week', () => {
    const guidance = calculateFoodWeek(food({ approvedThisMonthMinor: 300_000 }));
    expect(guidance.monthRemainingMinor).toBe(100_000);
    expect(guidance.weekRemainingMinor).toBe(20_000);
  });

  test('pending spending counts against the week just like approved spending', () => {
    const approved = calculateFoodWeek(food({ approvedThisMonthMinor: 200_000 }));
    const pending = calculateFoodWeek(food({ pendingThisMonthMinor: 200_000 }));
    expect(pending.weekRemainingMinor).toBe(approved.weekRemainingMinor);
  });
});

describe('the weekly figure can never exceed what the month has left', () => {
  test('when the month is spent, the week is zero', () => {
    const guidance = calculateFoodWeek(food({ approvedThisMonthMinor: 400_000 }));
    expect(guidance.monthRemainingMinor).toBe(0);
    expect(guidance.weekRemainingMinor).toBe(0);
  });

  test('overspending the month does not produce a negative week', () => {
    const guidance = calculateFoodWeek(food({ approvedThisMonthMinor: 500_000 }));
    expect(guidance.weekRemainingMinor).toBe(0);
    expect(guidance.status).toBe('over_month');
  });

  test('carry-forward cannot push the week past the month remainder', () => {
    const guidance = calculateFoodWeek(
      food({ asOf: '2026-08-30', carryForwardEnabled: true, approvedThisMonthMinor: 380_000 }),
    );
    expect(guidance.weekRemainingMinor).toBeLessThanOrEqual(guidance.monthRemainingMinor);
    expect(guidance.weekRemainingMinor).toBe(20_000);
  });
});

describe('carry-forward from a quieter week', () => {
  test('an under-spent month so far raises this week', () => {
    const without = calculateFoodWeek(food({ approvedThisMonthMinor: 50_000 }));
    const withCarry = calculateFoodWeek(
      food({ approvedThisMonthMinor: 50_000, carryForwardEnabled: true }),
    );
    expect(withCarry.carryForwardMinor).toBeGreaterThan(0);
    expect(withCarry.weekRemainingMinor).toBeGreaterThan(without.weekRemainingMinor);
  });

  test('there is nothing to carry when spending is already ahead', () => {
    const guidance = calculateFoodWeek(
      food({ approvedThisMonthMinor: 300_000, carryForwardEnabled: true }),
    );
    expect(guidance.carryForwardMinor).toBe(0);
  });
});

describe('a large stock-up shop', () => {
  test('is still spent in full against the month', () => {
    const guidance = calculateFoodWeek(
      food({
        approvedThisMonthMinor: 150_000,
        spentThisWeekMinor: 150_000,
        largePurchaseThisWeekMinor: 120_000,
      }),
    );
    expect(guidance.monthSpentMinor).toBe(150_000);
    expect(guidance.monthRemainingMinor).toBe(250_000);
  });

  test('but does not make the week look like a habit', () => {
    const asHabit = calculateFoodWeek(
      food({ approvedThisMonthMinor: 150_000, spentThisWeekMinor: 150_000 }),
    );
    const asStockUp = calculateFoodWeek(
      food({
        approvedThisMonthMinor: 150_000,
        spentThisWeekMinor: 150_000,
        largePurchaseThisWeekMinor: 120_000,
      }),
    );
    expect(asStockUp.weekOverPaceMinor).toBeLessThan(asHabit.weekOverPaceMinor);
    expect(asStockUp.projectedMonthMinor).toBeLessThan(asHabit.projectedMonthMinor);
  });

  test('and is reported so the screen can explain itself', () => {
    const guidance = calculateFoodWeek(food({ largePurchaseThisWeekMinor: 90_000 }));
    const warning = guidance.warnings.find((w) => w.code === 'food.large_purchase');
    expect(warning?.params?.amountMinor).toBe(90_000);
  });

  test('never declares a permanent failure from one shop', () => {
    const guidance = calculateFoodWeek(
      food({
        approvedThisMonthMinor: 180_000,
        spentThisWeekMinor: 180_000,
        largePurchaseThisWeekMinor: 160_000,
      }),
    );
    expect(guidance.status).not.toBe('over_month');
  });
});

describe('recovery guidance', () => {
  test('a week above pace reports by how much', () => {
    const guidance = calculateFoodWeek(
      food({ approvedThisMonthMinor: 200_000, spentThisWeekMinor: 200_000 }),
    );
    expect(guidance.weekOverPaceMinor).toBeGreaterThan(0);
    expect(guidance.warnings.map((w) => w.code)).toContain('food.week_over_pace');
  });

  test('next week gets a figure that keeps the month inside its plan', () => {
    const guidance = calculateFoodWeek(food({ approvedThisMonthMinor: 200_000 }));
    expect(guidance.nextWeekAllowanceMinor).toBeGreaterThan(0);
    expect(guidance.nextWeekAllowanceMinor).toBeLessThanOrEqual(guidance.monthRemainingMinor);
  });

  test('there is no next week when the month ends with this one', () => {
    expect(calculateFoodWeek(food({ asOf: '2026-08-31' })).nextWeekAllowanceMinor).toBe(0);
  });
});

describe('status and confidence', () => {
  test('an untouched budget early in the month is on track', () => {
    expect(calculateFoodWeek(food()).status).toBe('on_track');
  });

  test('spending faster than the plan is ahead of pace, not yet over', () => {
    const guidance = calculateFoodWeek(food({ approvedThisMonthMinor: 250_000 }));
    expect(guidance.status).toBe('ahead_of_pace');
    expect(guidance.projectedMonthMinor).toBeGreaterThan(400_000);
  });

  test('no monthly budget means no guidance, and says so', () => {
    const guidance = calculateFoodWeek(food({ monthlyPlannedMinor: 0 }));
    expect(guidance.status).toBe('insufficient_data');
    expect(guidance.confidence).toBe('low');
  });

  test('never-verified data means no confident guidance', () => {
    const guidance = calculateFoodWeek(food({ dataAgeDays: null }));
    expect(guidance.status).toBe('insufficient_data');
    expect(guidance.confidence).toBe('low');
  });

  test('stale data still gives guidance, with a warning and lower confidence', () => {
    const guidance = calculateFoodWeek(food({ dataAgeDays: 12 }));
    expect(guidance.status).not.toBe('insufficient_data');
    expect(guidance.confidence).toBe('medium');
    expect(guidance.warnings.map((w) => w.code)).toContain('food.stale');
  });

  test('the guidance carries its calculation version', () => {
    expect(calculateFoodWeek(food()).calculationVersion).toBe('1.0.0');
  });

  test('every figure is an integer number of minor units', () => {
    const guidance = calculateFoodWeek(
      food({ approvedThisMonthMinor: 123_457, carryForwardEnabled: true }),
    );
    for (const value of [
      guidance.weekRemainingMinor,
      guidance.monthRemainingMinor,
      guidance.projectedMonthMinor,
      guidance.nextWeekAllowanceMinor,
      guidance.carryForwardMinor,
      guidance.weekOverPaceMinor,
    ]) {
      expect(Number.isInteger(value)).toBe(true);
    }
  });
});
