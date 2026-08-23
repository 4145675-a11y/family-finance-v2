import fc from 'fast-check';
import { beforeAll, describe, expect, test } from 'vitest';

import { calculateBudget, proposeBudgetTransfer } from './budget';
import type { BudgetLineInput, CategorySpendInput } from './budget';
import { calculateFoodWeek } from './food-week';

/**
 * Budget invariants, over every input fast-check can find.
 *
 * The two that matter most are the ones a family would never catch by reading a
 * screen: a "transfer" that quietly enlarges the budget, and a weekly food figure
 * that allows more than the month can afford. Both are easy to get right for the
 * example in front of you and easy to get wrong two hundred shekels away.
 */

const SEED = 20260823;
const RUNS = 300;

beforeAll(() => {
  fc.configureGlobal({ seed: SEED, numRuns: RUNS });
});

const money = fc.integer({ min: 0, max: 5_000_000 });

const categoryKeys = [
  'food',
  'housing_and_bills',
  'transport_and_fuel',
  'health',
  'education',
] as const;

const linesArb: fc.Arbitrary<BudgetLineInput[]> = fc
  .array(money, { minLength: 2, maxLength: 5 })
  .map((amounts) =>
    amounts.map((plannedMinor, index) => ({
      categoryId: `c-${index}`,
      categoryKey: categoryKeys[index % categoryKeys.length] ?? 'other',
      plannedMinor,
      weeklyGuidance: index === 0,
    })),
  );

const dayOfMonth = fc.integer({ min: 1, max: 28 });

describe('a budget transfer moves money, it does not create it', () => {
  test('the total planned amount is identical before and after', () => {
    fc.assert(
      fc.property(linesArb, money, fc.nat(), fc.nat(), (lines, amount, a, b) => {
        const from = a % lines.length;
        const to = b % lines.length;
        fc.pre(from !== to);
        fc.pre(amount > 0);

        const proposal = proposeBudgetTransfer(lines, [], `c-${from}`, `c-${to}`, amount);
        expect(proposal.totalPlannedAfterMinor).toBe(proposal.totalPlannedBeforeMinor);
      }),
    );
  });

  test('no category is ever left with a negative plan', () => {
    fc.assert(
      fc.property(linesArb, money, fc.nat(), fc.nat(), (lines, amount, a, b) => {
        const from = a % lines.length;
        const to = b % lines.length;
        fc.pre(from !== to);
        fc.pre(amount > 0);

        const proposal = proposeBudgetTransfer(lines, [], `c-${from}`, `c-${to}`, amount);
        for (const line of proposal.lines) {
          expect(line.plannedMinor).toBeGreaterThanOrEqual(0);
          expect(Number.isInteger(line.plannedMinor)).toBe(true);
        }
      }),
    );
  });

  test('both sides move by the same amount', () => {
    fc.assert(
      fc.property(linesArb, money, fc.nat(), fc.nat(), (lines, amount, a, b) => {
        const from = a % lines.length;
        const to = b % lines.length;
        fc.pre(from !== to);
        fc.pre(amount > 0);

        const proposal = proposeBudgetTransfer(lines, [], `c-${from}`, `c-${to}`, amount);
        const before = lines[from]?.plannedMinor ?? 0;
        const afterFrom =
          proposal.lines.find((line) => line.categoryId === `c-${from}`)?.plannedMinor ?? 0;
        const beforeTo = lines[to]?.plannedMinor ?? 0;
        const afterTo =
          proposal.lines.find((line) => line.categoryId === `c-${to}`)?.plannedMinor ?? 0;

        expect(before - afterFrom).toBe(proposal.movedMinor);
        expect(afterTo - beforeTo).toBe(proposal.movedMinor);
      }),
    );
  });
});

describe('a plan is not money', () => {
  test('re-labelling spending between categories never changes the totals', () => {
    fc.assert(
      fc.property(linesArb, money, fc.nat(), fc.nat(), (lines, amount, a, b) => {
        const from = a % lines.length;
        const to = b % lines.length;
        fc.pre(from !== to);

        const asFrom: CategorySpendInput[] = [
          {
            categoryId: `c-${from}`,
            approvedMinor: amount,
            pendingMinor: 0,
            committedMinor: 0,
          },
        ];
        const asTo: CategorySpendInput[] = [
          { categoryId: `c-${to}`, approvedMinor: amount, pendingMinor: 0, committedMinor: 0 },
        ];

        const one = calculateBudget({
          period: '2026-08',
          asOf: '2026-08-16',
          currency: 'ILS',
          lines,
          spend: asFrom,
          dataAgeDays: 1,
          isFirstMonthDraft: false,
        });
        const other = calculateBudget({
          period: '2026-08',
          asOf: '2026-08-16',
          currency: 'ILS',
          lines,
          spend: asTo,
          dataAgeDays: 1,
          isFirstMonthDraft: false,
        });

        expect(other.totals.approvedMinor).toBe(one.totals.approvedMinor);
        expect(other.totals.plannedMinor).toBe(one.totals.plannedMinor);
      }),
    );
  });

  test('pending money is never folded into approved money', () => {
    fc.assert(
      fc.property(linesArb, money, money, (lines, approved, pending) => {
        const result = calculateBudget({
          period: '2026-08',
          asOf: '2026-08-16',
          currency: 'ILS',
          lines,
          spend: [
            {
              categoryId: 'c-0',
              approvedMinor: approved,
              pendingMinor: pending,
              committedMinor: 0,
            },
          ],
          dataAgeDays: 1,
          isFirstMonthDraft: false,
        });
        expect(result.totals.approvedMinor).toBe(approved);
        expect(result.totals.pendingMinor).toBe(pending);
      }),
    );
  });

  test('remaining and over never both exist on the same line', () => {
    fc.assert(
      fc.property(linesArb, money, money, money, (lines, approved, pending, committed) => {
        const result = calculateBudget({
          period: '2026-08',
          asOf: '2026-08-16',
          currency: 'ILS',
          lines,
          spend: [
            {
              categoryId: 'c-0',
              approvedMinor: approved,
              pendingMinor: pending,
              committedMinor: committed,
            },
          ],
          dataAgeDays: 1,
          isFirstMonthDraft: false,
        });
        for (const line of result.lines) {
          expect(line.remainingMinor).toBeGreaterThanOrEqual(0);
          expect(line.overMinor).toBeGreaterThanOrEqual(0);
          expect(line.remainingMinor === 0 || line.overMinor === 0).toBe(true);
          expect(Number.isInteger(line.remainingMinor)).toBe(true);
          expect(Number.isInteger(line.projectedMinor)).toBe(true);
        }
      }),
    );
  });

  test('a projection never falls below what is already committed and spent', () => {
    fc.assert(
      fc.property(linesArb, money, money, dayOfMonth, (lines, approved, committed, day) => {
        const result = calculateBudget({
          period: '2026-08',
          asOf: `2026-08-${String(day).padStart(2, '0')}`,
          currency: 'ILS',
          lines,
          spend: [
            {
              categoryId: 'c-0',
              approvedMinor: approved,
              pendingMinor: 0,
              committedMinor: committed,
            },
          ],
          dataAgeDays: 1,
          isFirstMonthDraft: false,
        });
        const line = result.lines.find((entry) => entry.categoryId === 'c-0');
        expect(line?.projectedMinor ?? 0).toBeGreaterThanOrEqual(approved + committed);
      }),
    );
  });
});

describe('weekly food guidance stays inside the month', () => {
  test('it never allows more than the month has left', () => {
    fc.assert(
      fc.property(
        money,
        money,
        money,
        dayOfMonth,
        fc.boolean(),
        (planned, approved, pending, day, carry) => {
          const guidance = calculateFoodWeek({
            asOf: `2026-08-${String(day).padStart(2, '0')}`,
            monthlyPlannedMinor: planned,
            approvedThisMonthMinor: approved,
            pendingThisMonthMinor: pending,
            spentThisWeekMinor: 0,
            largePurchaseThisWeekMinor: 0,
            carryForwardEnabled: carry,
            dataAgeDays: 1,
          });
          expect(guidance.weekRemainingMinor).toBeLessThanOrEqual(guidance.monthRemainingMinor);
        },
      ),
    );
  });

  test('every figure it returns is a non-negative whole number of minor units', () => {
    fc.assert(
      fc.property(money, money, money, dayOfMonth, (planned, approved, spentThisWeek, day) => {
        const guidance = calculateFoodWeek({
          asOf: `2026-08-${String(day).padStart(2, '0')}`,
          monthlyPlannedMinor: planned,
          approvedThisMonthMinor: approved,
          pendingThisMonthMinor: 0,
          spentThisWeekMinor: spentThisWeek,
          largePurchaseThisWeekMinor: 0,
          carryForwardEnabled: true,
          dataAgeDays: 1,
        });
        for (const value of [
          guidance.weekRemainingMinor,
          guidance.monthRemainingMinor,
          guidance.nextWeekAllowanceMinor,
          guidance.carryForwardMinor,
          guidance.weekOverPaceMinor,
          guidance.projectedMonthMinor,
        ]) {
          expect(Number.isInteger(value)).toBe(true);
          expect(value).toBeGreaterThanOrEqual(0);
        }
      }),
    );
  });

  test('spending more never raises the weekly figure', () => {
    fc.assert(
      fc.property(money, money, money, dayOfMonth, (planned, a, b, day) => {
        const [less, more] = a <= b ? [a, b] : [b, a];
        const build = (approved: number) =>
          calculateFoodWeek({
            asOf: `2026-08-${String(day).padStart(2, '0')}`,
            monthlyPlannedMinor: planned,
            approvedThisMonthMinor: approved,
            pendingThisMonthMinor: 0,
            spentThisWeekMinor: 0,
            largePurchaseThisWeekMinor: 0,
            carryForwardEnabled: false,
            dataAgeDays: 1,
          });
        expect(build(more).weekRemainingMinor).toBeLessThanOrEqual(
          build(less).weekRemainingMinor,
        );
      }),
    );
  });

  test('next week is never promised more than the month has left', () => {
    fc.assert(
      fc.property(money, money, dayOfMonth, (planned, approved, day) => {
        const guidance = calculateFoodWeek({
          asOf: `2026-08-${String(day).padStart(2, '0')}`,
          monthlyPlannedMinor: planned,
          approvedThisMonthMinor: approved,
          pendingThisMonthMinor: 0,
          spentThisWeekMinor: 0,
          largePurchaseThisWeekMinor: 0,
          carryForwardEnabled: true,
          dataAgeDays: 1,
        });
        expect(guidance.nextWeekAllowanceMinor).toBeLessThanOrEqual(
          guidance.monthRemainingMinor,
        );
      }),
    );
  });
});
