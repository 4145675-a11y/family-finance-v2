import { describe, expect, test } from 'vitest';

import { BudgetError, calculateBudget, proposeBudgetTransfer } from './budget';
import type { BudgetInput, BudgetLineInput, CategorySpendInput } from './budget';

const lines: BudgetLineInput[] = [
  { categoryId: 'c-food', categoryKey: 'food', plannedMinor: 400_000, weeklyGuidance: true },
  {
    categoryId: 'c-housing',
    categoryKey: 'housing_and_bills',
    plannedMinor: 900_000,
    weeklyGuidance: false,
  },
  {
    categoryId: 'c-transport',
    categoryKey: 'transport_and_fuel',
    plannedMinor: 150_000,
    weeklyGuidance: false,
  },
];

function budget(overrides: Partial<BudgetInput> = {}): BudgetInput {
  return {
    period: '2026-08',
    // Half way through a 31-day month.
    asOf: '2026-08-16',
    currency: 'ILS',
    lines,
    spend: [],
    dataAgeDays: 1,
    isFirstMonthDraft: false,
    ...overrides,
  };
}

function spend(
  overrides: Partial<CategorySpendInput> & { categoryId: string },
): CategorySpendInput {
  return { approvedMinor: 0, pendingMinor: 0, committedMinor: 0, ...overrides };
}

describe('calculateBudget — the six figures a line has to carry', () => {
  test('an untouched budget is entirely remaining', () => {
    const result = calculateBudget(budget());
    expect(result.totals.plannedMinor).toBe(1_450_000);
    expect(result.totals.remainingMinor).toBe(1_450_000);
    expect(result.totals.approvedMinor).toBe(0);
  });

  test('approved, pending and committed are reported apart, never merged', () => {
    const result = calculateBudget(
      budget({
        spend: [
          spend({
            categoryId: 'c-food',
            approvedMinor: 120_000,
            pendingMinor: 30_000,
            committedMinor: 50_000,
          }),
        ],
      }),
    );
    const food = result.lines.find((line) => line.categoryKey === 'food');
    expect(food?.approvedMinor).toBe(120_000);
    expect(food?.pendingMinor).toBe(30_000);
    expect(food?.committedMinor).toBe(50_000);
    expect(food?.remainingMinor).toBe(200_000);
  });

  test('remaining never goes negative; the excess is reported as its own figure', () => {
    const result = calculateBudget(
      budget({ spend: [spend({ categoryId: 'c-food', approvedMinor: 450_000 })] }),
    );
    const food = result.lines.find((line) => line.categoryKey === 'food');
    expect(food?.remainingMinor).toBe(0);
    expect(food?.overMinor).toBe(50_000);
    expect(food?.status).toBe('over');
  });

  test('a category over its plan produces a warning naming the category', () => {
    const result = calculateBudget(
      budget({ spend: [spend({ categoryId: 'c-food', approvedMinor: 450_000 })] }),
    );
    const warning = result.warnings.find((item) => item.code === 'budget.category_over');
    expect(warning?.params?.categoryKey).toBe('food');
    expect(warning?.params?.amountMinor).toBe(50_000);
  });

  test('spending at exactly the even pace is on track', () => {
    // 16 of 31 days elapsed; 400,000 * 16/31 ≈ 206,452.
    const result = calculateBudget(
      budget({ spend: [spend({ categoryId: 'c-food', approvedMinor: 200_000 })] }),
    );
    expect(result.lines.find((line) => line.categoryKey === 'food')?.status).toBe('on_track');
  });

  test('spending ahead of pace is flagged before the plan is actually passed', () => {
    const result = calculateBudget(
      budget({ spend: [spend({ categoryId: 'c-food', approvedMinor: 300_000 })] }),
    );
    const food = result.lines.find((line) => line.categoryKey === 'food');
    expect(food?.status).toBe('watch');
    expect(food?.overMinor).toBe(0);
    expect(food?.projectedMinor).toBeGreaterThan(400_000);
  });

  test('committed recurring money is not extrapolated, only added once', () => {
    const result = calculateBudget(
      budget({ spend: [spend({ categoryId: 'c-housing', committedMinor: 900_000 })] }),
    );
    const housing = result.lines.find((line) => line.categoryKey === 'housing_and_bills');
    expect(housing?.projectedMinor).toBe(900_000);
    expect(housing?.status).toBe('on_track');
  });

  test('on the first of the month nothing is extrapolated from zero days', () => {
    const result = calculateBudget(
      budget({
        asOf: '2026-08-01',
        spend: [spend({ categoryId: 'c-food', approvedMinor: 20_000 })],
      }),
    );
    const food = result.lines.find((line) => line.categoryKey === 'food');
    expect(result.daysElapsed).toBe(1);
    expect(food?.projectedMinor).toBeLessThanOrEqual(620_000);
  });

  test('the last day of the month leaves no days remaining', () => {
    const result = calculateBudget(budget({ asOf: '2026-08-31' }));
    expect(result.daysInMonth).toBe(31);
    expect(result.daysElapsed).toBe(31);
    expect(result.daysRemaining).toBe(0);
  });

  test('a shorter month is measured as a shorter month', () => {
    const result = calculateBudget(budget({ period: '2026-02', asOf: '2026-02-10' }));
    expect(result.daysInMonth).toBe(28);
  });
});

describe('calculateBudget — honesty about the data', () => {
  test('a first-month budget is flagged as a draft', () => {
    const result = calculateBudget(budget({ isFirstMonthDraft: true }));
    expect(result.warnings.map((w) => w.code)).toContain('budget.first_month_draft');
    expect(result.confidence).toBe('medium');
  });

  test('never-verified data gives low confidence rather than a confident number', () => {
    const result = calculateBudget(budget({ dataAgeDays: null }));
    expect(result.confidence).toBe('low');
    expect(result.missingData.map((m) => m.code)).toContain('budget.no_verified_data');
  });

  test('stale data warns with the age instead of failing silently', () => {
    const result = calculateBudget(budget({ dataAgeDays: 21 }));
    const stale = result.warnings.find((w) => w.code === 'budget.stale');
    expect(stale?.params?.days).toBe(21);
    expect(result.confidence).toBe('medium');
  });

  test('spending in a category with no budget line is reported, not dropped', () => {
    const result = calculateBudget(
      budget({ spend: [spend({ categoryId: 'c-unknown', approvedMinor: 5_000 })] }),
    );
    const missing = result.missingData.find((m) => m.code === 'budget.spend_without_line');
    expect(missing?.params?.count).toBe(1);
  });

  test('an empty budget says so rather than reporting a perfect zero', () => {
    const result = calculateBudget(budget({ lines: [] }));
    expect(result.missingData.map((m) => m.code)).toContain('budget.no_lines');
    expect(result.confidence).toBe('low');
  });

  test('assumptions are always stated', () => {
    expect(calculateBudget(budget()).assumptions.length).toBeGreaterThan(0);
  });

  test('the result carries its calculation version', () => {
    expect(calculateBudget(budget()).calculationVersion).toBe('1.0.0');
  });
});

describe('proposeBudgetTransfer', () => {
  test('moves planned money and leaves the total untouched', () => {
    const proposal = proposeBudgetTransfer(lines, [], 'c-transport', 'c-food', 50_000);
    expect(proposal.totalPlannedAfterMinor).toBe(proposal.totalPlannedBeforeMinor);
    expect(proposal.lines.find((line) => line.categoryKey === 'food')?.plannedMinor).toBe(
      450_000,
    );
    expect(
      proposal.lines.find((line) => line.categoryKey === 'transport_and_fuel')?.plannedMinor,
    ).toBe(100_000);
    expect(proposal.acceptable).toBe(true);
  });

  test('is a proposal: the original lines are not modified', () => {
    proposeBudgetTransfer(lines, [], 'c-transport', 'c-food', 50_000);
    expect(lines.find((line) => line.categoryKey === 'food')?.plannedMinor).toBe(400_000);
  });

  test('refuses to move more than the source holds, and says so', () => {
    const proposal = proposeBudgetTransfer(lines, [], 'c-transport', 'c-food', 900_000);
    expect(proposal.acceptable).toBe(false);
    expect(proposal.warnings.map((w) => w.code)).toContain('budget.transfer.exceeds_source');
    expect(proposal.totalPlannedAfterMinor).toBe(proposal.totalPlannedBeforeMinor);
  });

  test('warns when the source would fall below what it has already spent', () => {
    const proposal = proposeBudgetTransfer(
      lines,
      [spend({ categoryId: 'c-transport', approvedMinor: 120_000 })],
      'c-transport',
      'c-food',
      100_000,
    );
    expect(proposal.acceptable).toBe(false);
    expect(proposal.warnings.map((w) => w.code)).toContain('budget.transfer.below_spent');
  });

  test('rejects a transfer to the same category', () => {
    expect(() => proposeBudgetTransfer(lines, [], 'c-food', 'c-food', 1_000)).toThrow(
      BudgetError,
    );
  });

  test('rejects a zero transfer rather than pretending to do something', () => {
    expect(() => proposeBudgetTransfer(lines, [], 'c-food', 'c-housing', 0)).toThrow(
      BudgetError,
    );
  });

  test('rejects an unknown category', () => {
    expect(() => proposeBudgetTransfer(lines, [], 'c-food', 'c-nope', 1_000)).toThrow(
      BudgetError,
    );
  });
});
