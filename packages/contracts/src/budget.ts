import { z } from 'zod';

import { timestampSchema, uuidSchema, versionSchema } from './identity';
import { amountMinorSchema, currencySchema } from './money';

/**
 * Budget contracts.
 *
 * 01-PRODUCT-SPEC.md § Must asks for a suggested categorical budget that is never
 * activated without approval, and 03-UX-SPEC.md § מסכים lists what a budget screen
 * has to show: planned, actual, pending, committed, remaining, projected.
 *
 * Two product rules are built into these shapes:
 *
 *  1. A budget is a plan, not money. Nothing here changes a balance, and no field
 *     can be mistaken for one.
 *  2. Moving money between categories is a *proposal* until a person approves it.
 *     Silently enlarging a category to absorb overspending would hide the very
 *     thing the family needs to see.
 */

/** `YYYY-MM` in the household's time zone. */
export const budgetPeriodSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'a budget period is YYYY-MM');
export type BudgetPeriod = z.infer<typeof budgetPeriodSchema>;

/**
 * The category set a real family recognises.
 *
 * Fixed rather than free text so the copy layer can name each one in plain Hebrew
 * and so guidance rules (the weekly food budget) can attach to a stable key.
 * 01-PRODUCT-SPEC.md § מחוץ לתכולה forbids recommending cuts to religious or
 * educational spending, so those exist as ordinary categories and never as
 * candidates for elimination.
 */
export const budgetCategoryKeySchema = z.enum([
  'food',
  'housing_and_bills',
  'transport_and_fuel',
  'health',
  'education',
  'clothing',
  'celebrations_and_gifts',
  'cash_and_small',
  'holidays',
  'other',
]);
export type BudgetCategoryKey = z.infer<typeof budgetCategoryKeySchema>;

export const BUDGET_CATEGORY_KEYS = budgetCategoryKeySchema.options;

/** The one category that also gets weekly guidance on the home screen. */
export const WEEKLY_GUIDED_CATEGORY: BudgetCategoryKey = 'food';

export const budgetStatusSchema = z.enum(['draft', 'active', 'archived']);
export type BudgetStatus = z.infer<typeof budgetStatusSchema>;

export const budgetSchema = z.object({
  id: uuidSchema,
  householdId: uuidSchema,
  period: budgetPeriodSchema,
  status: budgetStatusSchema,
  currency: currencySchema,
  /**
   * A first-month budget is a low-confidence draft (03-UX-SPEC.md § מסכים), and
   * the flag travels with the row so no screen has to guess.
   */
  isFirstMonthDraft: z.boolean(),
  createdBy: uuidSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  version: versionSchema,
});
export type Budget = z.infer<typeof budgetSchema>;

export const budgetLineSchema = z.object({
  id: uuidSchema,
  householdId: uuidSchema,
  budgetId: uuidSchema,
  categoryId: uuidSchema,
  categoryKey: budgetCategoryKeySchema,
  plannedMinor: amountMinorSchema,
  /** Set when this line should also produce weekly guidance. */
  weeklyGuidance: z.boolean(),
  note: z.string().trim().max(280).nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  version: versionSchema,
});
export type BudgetLine = z.infer<typeof budgetLineSchema>;

export const budgetChangeStatusSchema = z.enum(['proposed', 'approved', 'rejected']);
export type BudgetChangeStatus = z.infer<typeof budgetChangeStatusSchema>;

/**
 * A proposed move of planned money from one category to another.
 *
 * Deliberately a transfer and never an increase: a budget that can grow on its own
 * stops being a budget. If the family wants more for food, something else gives —
 * and the screen has to say which.
 */
export const budgetChangeSchema = z
  .object({
    id: uuidSchema,
    householdId: uuidSchema,
    budgetId: uuidSchema,
    fromCategoryId: uuidSchema,
    toCategoryId: uuidSchema,
    amountMinor: amountMinorSchema,
    reason: z.string().trim().max(280).nullable(),
    status: budgetChangeStatusSchema,
    proposedBy: uuidSchema,
    approvedBy: uuidSchema.nullable(),
    approvedAt: timestampSchema.nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    version: versionSchema,
  })
  .refine((change) => change.fromCategoryId !== change.toCategoryId, {
    message: 'a budget transfer needs two different categories',
    path: ['toCategoryId'],
  })
  .refine((change) => change.amountMinor > 0, {
    message: 'a budget transfer moves a positive amount',
    path: ['amountMinor'],
  })
  .refine((change) => (change.status === 'approved') === (change.approvedAt !== null), {
    message: 'an approved change records who approved it and when',
    path: ['approvedAt'],
  });
export type BudgetChange = z.infer<typeof budgetChangeSchema>;

export const createBudgetInputSchema = z.object({
  householdId: uuidSchema,
  period: budgetPeriodSchema,
  currency: currencySchema,
  isFirstMonthDraft: z.boolean(),
  lines: z
    .array(
      z.object({
        categoryId: uuidSchema,
        categoryKey: budgetCategoryKeySchema,
        plannedMinor: amountMinorSchema,
        weeklyGuidance: z.boolean(),
        note: z.string().trim().max(280).nullable(),
      }),
    )
    .min(1),
});
export type CreateBudgetInput = z.infer<typeof createBudgetInputSchema>;

export const proposeBudgetChangeInputSchema = z
  .object({
    budgetId: uuidSchema,
    fromCategoryId: uuidSchema,
    toCategoryId: uuidSchema,
    amountMinor: amountMinorSchema.refine((value) => value > 0, {
      message: 'a budget transfer moves a positive amount',
    }),
    reason: z.string().trim().max(280).nullable(),
  })
  .refine((input) => input.fromCategoryId !== input.toCategoryId, {
    message: 'a budget transfer needs two different categories',
    path: ['toCategoryId'],
  });
export type ProposeBudgetChangeInput = z.infer<typeof proposeBudgetChangeInputSchema>;

/** Approval is idempotent: the caller states the version it read. */
export const approveBudgetChangeInputSchema = z.object({
  changeId: uuidSchema,
  expectedVersion: versionSchema,
});
export type ApproveBudgetChangeInput = z.infer<typeof approveBudgetChangeInputSchema>;
