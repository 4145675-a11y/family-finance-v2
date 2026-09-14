import type {
  BudgetCategoryKey,
  BusinessDate,
  Confidence,
  Currency,
} from '@family-finance/contracts';

import { daysBetween, endOfMonth, startOfMonth } from './dates';
import { assertStoredAmount, clampAtZero, roundHalfUp } from './money';
import { notice, type EngineNotice } from './notice';

/**
 * The monthly budget, computed deterministically.
 *
 * 03-UX-SPEC.md § מסכים fixes the six figures a budget line has to carry: planned,
 * actual, pending, committed, remaining and projected. They are separate on
 * purpose — a family that cannot tell "already spent" from "waiting to be
 * approved" from "will certainly be charged" cannot make a decision with them.
 *
 * Nothing here touches a balance. A budget is a plan; 02-FINANCIAL-RULES.md
 * § אינווריאנטים is explicit that classifying money does not move it, and the
 * property suite holds this module to that.
 */

export const BUDGET_CALCULATION_VERSION = '1.0.0';

export interface BudgetLineInput {
  readonly categoryId: string;
  readonly categoryKey: BudgetCategoryKey;
  readonly plannedMinor: number;
  /** Whether this category also produces weekly guidance. */
  readonly weeklyGuidance: boolean;
}

/** What has actually happened against a category this period. */
export interface CategorySpendInput {
  readonly categoryId: string;
  /** Confirmed or reconciled transactions. This is the only "real" figure. */
  readonly approvedMinor: number;
  /** Drafts awaiting approval. Money that has very likely left. */
  readonly pendingMinor: number;
  /** Recurring charges already committed for this period but not yet made. */
  readonly committedMinor: number;
}

export interface BudgetInput {
  /** `YYYY-MM`. */
  readonly period: string;
  readonly asOf: BusinessDate;
  readonly currency: Currency;
  readonly lines: readonly BudgetLineInput[];
  readonly spend: readonly CategorySpendInput[];
  /** Age of the freshest confirmed balance; drives confidence, never the maths. */
  readonly dataAgeDays: number | null;
  /** A first-month budget is a low-confidence draft by product rule. */
  readonly isFirstMonthDraft: boolean;
}

export type BudgetLineStatus = 'on_track' | 'watch' | 'over';

export interface BudgetLineResult {
  readonly categoryId: string;
  readonly categoryKey: BudgetCategoryKey;
  readonly plannedMinor: number;
  readonly approvedMinor: number;
  readonly pendingMinor: number;
  readonly committedMinor: number;
  /** Planned less everything already spent, pending or committed. Never negative. */
  readonly remainingMinor: number;
  /** By how much the category has already passed its plan, if it has. */
  readonly overMinor: number;
  /** Where this category lands by month end at the current pace. */
  readonly projectedMinor: number;
  readonly status: BudgetLineStatus;
  readonly weeklyGuidance: boolean;
}

export interface BudgetTotals {
  readonly plannedMinor: number;
  readonly approvedMinor: number;
  readonly pendingMinor: number;
  readonly committedMinor: number;
  readonly remainingMinor: number;
  readonly projectedMinor: number;
}

export interface BudgetResult {
  readonly period: string;
  readonly asOf: BusinessDate;
  readonly currency: Currency;
  readonly daysElapsed: number;
  readonly daysInMonth: number;
  readonly daysRemaining: number;
  readonly lines: readonly BudgetLineResult[];
  readonly totals: BudgetTotals;
  /** Projected month-end position: negative means the plan is exceeded. */
  readonly projectedResultMinor: number;
  readonly warnings: readonly EngineNotice[];
  readonly assumptions: readonly EngineNotice[];
  readonly missingData: readonly EngineNotice[];
  readonly confidence: Confidence;
  readonly dataAgeDays: number | null;
  readonly calculationVersion: string;
}

const EMPTY_SPEND: Omit<CategorySpendInput, 'categoryId'> = {
  approvedMinor: 0,
  pendingMinor: 0,
  committedMinor: 0,
};

/**
 * Projects where a category lands at month end.
 *
 * The pace comes from variable spending only — what has actually gone out plus
 * what is waiting to be approved — because committed recurring charges are
 * already known in full and extrapolating them would count them twice.
 *
 * With no elapsed days there is no pace to measure, so the projection is simply
 * what is already known. Inventing a rate from zero days is how a budget screen
 * ends up predicting a catastrophe on the first of the month.
 */
function projectCategory(
  variableSoFarMinor: number,
  committedMinor: number,
  daysElapsed: number,
  daysInMonth: number,
): number {
  if (daysElapsed <= 0) return variableSoFarMinor + committedMinor;
  const projectedVariable = roundHalfUp((variableSoFarMinor / daysElapsed) * daysInMonth);
  return Math.max(variableSoFarMinor, projectedVariable) + committedMinor;
}

export function calculateBudget(input: BudgetInput): BudgetResult {
  const monthStart = startOfMonth(input.asOf);
  const monthEnd = endOfMonth(input.asOf);
  const daysInMonth = daysBetween(monthStart, monthEnd) + 1;
  const daysElapsed = Math.min(
    daysInMonth,
    Math.max(0, daysBetween(monthStart, input.asOf) + 1),
  );
  const daysRemaining = Math.max(0, daysInMonth - daysElapsed);

  const spendByCategory = new Map(input.spend.map((entry) => [entry.categoryId, entry]));

  const warnings: EngineNotice[] = [];
  const missingData: EngineNotice[] = [];

  const lines: BudgetLineResult[] = input.lines.map((line) => {
    const spend = spendByCategory.get(line.categoryId) ?? {
      categoryId: line.categoryId,
      ...EMPTY_SPEND,
    };

    assertStoredAmount(line.plannedMinor, `planned for ${line.categoryKey}`);
    assertStoredAmount(spend.approvedMinor, `approved for ${line.categoryKey}`);
    assertStoredAmount(spend.pendingMinor, `pending for ${line.categoryKey}`);
    assertStoredAmount(spend.committedMinor, `committed for ${line.categoryKey}`);

    const usedMinor = spend.approvedMinor + spend.pendingMinor + spend.committedMinor;
    const { resultMinor: remainingMinor, shortfallMinor: overMinor } = clampAtZero(
      line.plannedMinor - usedMinor,
    );

    const projectedMinor = projectCategory(
      spend.approvedMinor + spend.pendingMinor,
      spend.committedMinor,
      daysElapsed,
      daysInMonth,
    );

    const status: BudgetLineStatus =
      overMinor > 0 ? 'over' : projectedMinor > line.plannedMinor ? 'watch' : 'on_track';

    if (status === 'over') {
      warnings.push(
        notice('budget.category_over', {
          categoryKey: line.categoryKey,
          amountMinor: overMinor,
        }),
      );
    }

    return {
      categoryId: line.categoryId,
      categoryKey: line.categoryKey,
      plannedMinor: line.plannedMinor,
      approvedMinor: spend.approvedMinor,
      pendingMinor: spend.pendingMinor,
      committedMinor: spend.committedMinor,
      remainingMinor,
      overMinor,
      projectedMinor,
      status,
      weeklyGuidance: line.weeklyGuidance,
    };
  });

  const totals: BudgetTotals = {
    plannedMinor: lines.reduce((sum, line) => sum + line.plannedMinor, 0),
    approvedMinor: lines.reduce((sum, line) => sum + line.approvedMinor, 0),
    pendingMinor: lines.reduce((sum, line) => sum + line.pendingMinor, 0),
    committedMinor: lines.reduce((sum, line) => sum + line.committedMinor, 0),
    remainingMinor: lines.reduce((sum, line) => sum + line.remainingMinor, 0),
    projectedMinor: lines.reduce((sum, line) => sum + line.projectedMinor, 0),
  };

  if (input.lines.length === 0) missingData.push(notice('budget.no_lines'));
  if (input.isFirstMonthDraft) warnings.push(notice('budget.first_month_draft'));
  if (input.dataAgeDays === null) missingData.push(notice('budget.no_verified_data'));
  else if (input.dataAgeDays > 7)
    warnings.push(notice('budget.stale', { days: input.dataAgeDays }));

  const spendOutsideBudget = input.spend.filter(
    (entry) => !input.lines.some((line) => line.categoryId === entry.categoryId),
  );
  if (spendOutsideBudget.length > 0) {
    missingData.push(notice('budget.spend_without_line', { count: spendOutsideBudget.length }));
  }

  const confidence: Confidence =
    input.lines.length === 0 || input.dataAgeDays === null
      ? 'low'
      : input.isFirstMonthDraft || input.dataAgeDays > 7
        ? 'medium'
        : 'high';

  return {
    period: input.period,
    asOf: input.asOf,
    currency: input.currency,
    daysElapsed,
    daysInMonth,
    daysRemaining,
    lines,
    totals,
    projectedResultMinor: totals.plannedMinor - totals.projectedMinor,
    warnings,
    assumptions: [
      notice('budget.assumption.pace_from_elapsed_days'),
      notice('budget.assumption.pending_counted_as_spent'),
    ],
    missingData,
    confidence,
    dataAgeDays: input.dataAgeDays,
    calculationVersion: BUDGET_CALCULATION_VERSION,
  };
}

export interface BudgetTransferProposal {
  readonly fromCategoryId: string;
  readonly toCategoryId: string;
  /** What was asked for. */
  readonly amountMinor: number;
  /**
   * What the proposal actually moves — capped at what the source category holds.
   * Both sides move by this same figure, which is what keeps the total planned
   * budget identical before and after.
   */
  readonly movedMinor: number;
  readonly lines: readonly BudgetLineInput[];
  readonly totalPlannedBeforeMinor: number;
  readonly totalPlannedAfterMinor: number;
  readonly warnings: readonly EngineNotice[];
  readonly acceptable: boolean;
}

export class BudgetError extends Error {}

/**
 * Proposes moving planned money from one category to another.
 *
 * Returns a proposal, never a change: 01-PRODUCT-SPEC.md keeps the budget
 * inactive until a person approves it. The total planned amount is identical
 * before and after — that is what makes this a transfer rather than a quiet
 * enlargement of the budget, and the property suite asserts it for every input.
 *
 * A move that would take a category below what it has already spent is returned
 * as `acceptable: false` with a warning rather than thrown: the family is allowed
 * to consider it, and the screen has to be able to explain why it is a bad idea.
 */
export function proposeBudgetTransfer(
  lines: readonly BudgetLineInput[],
  spend: readonly CategorySpendInput[],
  fromCategoryId: string,
  toCategoryId: string,
  amountMinor: number,
): BudgetTransferProposal {
  assertStoredAmount(amountMinor, 'transfer amount');
  if (amountMinor === 0) throw new BudgetError('a budget transfer moves a positive amount');
  if (fromCategoryId === toCategoryId) {
    throw new BudgetError('a budget transfer needs two different categories');
  }

  const from = lines.find((line) => line.categoryId === fromCategoryId);
  const to = lines.find((line) => line.categoryId === toCategoryId);
  if (from === undefined || to === undefined) {
    throw new BudgetError('both categories must exist in the budget');
  }

  const warnings: EngineNotice[] = [];
  let acceptable = true;

  if (from.plannedMinor < amountMinor) {
    warnings.push(
      notice('budget.transfer.exceeds_source', {
        categoryKey: from.categoryKey,
        availableMinor: from.plannedMinor,
      }),
    );
    acceptable = false;
  }

  const fromSpend = spend.find((entry) => entry.categoryId === fromCategoryId);
  const alreadyUsedMinor =
    (fromSpend?.approvedMinor ?? 0) +
    (fromSpend?.pendingMinor ?? 0) +
    (fromSpend?.committedMinor ?? 0);
  if (from.plannedMinor - amountMinor < alreadyUsedMinor) {
    warnings.push(
      notice('budget.transfer.below_spent', {
        categoryKey: from.categoryKey,
        spentMinor: alreadyUsedMinor,
      }),
    );
    acceptable = false;
  }

  // Both sides move by the same figure. Capping the source without capping the
  // destination would quietly create planned money out of nothing.
  const movedMinor = Math.min(amountMinor, from.plannedMinor);

  const after = lines.map((line) => {
    if (line.categoryId === fromCategoryId) {
      return { ...line, plannedMinor: line.plannedMinor - movedMinor };
    }
    if (line.categoryId === toCategoryId) {
      return { ...line, plannedMinor: line.plannedMinor + movedMinor };
    }
    return line;
  });

  const totalPlannedBeforeMinor = lines.reduce((sum, line) => sum + line.plannedMinor, 0);
  const totalPlannedAfterMinor = after.reduce((sum, line) => sum + line.plannedMinor, 0);

  return {
    fromCategoryId,
    toCategoryId,
    amountMinor,
    movedMinor,
    lines: after,
    totalPlannedBeforeMinor,
    totalPlannedAfterMinor,
    warnings,
    acceptable,
  };
}
