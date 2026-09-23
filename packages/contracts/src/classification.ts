import { z } from 'zod';

import { budgetCategoryKeySchema } from './budget';
import { timestampSchema, uuidSchema, versionSchema } from './identity';

/**
 * What an imported bank row appears to be.
 *
 * A statement line is not self-describing. "ע. מסלול מורחב" is a bank charge,
 * "חיוב הלוואה" is a repayment, and both look like any other outflow to code that
 * only reads a number and a date. This file is the vocabulary for saying what a
 * line *is*, so that the review screen can offer an answer instead of a blank.
 *
 * Three rules shape everything here, and all three come from CLAUDE.md:
 *
 *   * **`AI לא מחשב`.** A classification never computes money. It proposes a type,
 *     a category and a counterparty; the amount, the direction and the date come
 *     from the file and are untouched by it.
 *   * **`uncertain לא safe`.** Confidence is part of the value, not a footnote.
 *     A suggestion that is not `high` cannot be acted on without a person, and a
 *     suggestion that would move a debt balance needs the debt named explicitly
 *     however confident it is.
 *   * **`draft לא truth`.** A suggestion changes nothing. It is written beside the
 *     raw row, and only an approval turns anything into a record.
 *
 * The classifier is deterministic — a rule table, not a model — so every
 * suggestion can state the rule that produced it and be reproduced from the same
 * input. That is what `explanation` and `ruleId` are for.
 */

/**
 * The kind of thing a statement line is.
 *
 * Deliberately its own vocabulary rather than the budget categories: a budget
 * category answers "which envelope does this spend come out of", and that is a
 * different question from "what is this line". A bank charge has no envelope in
 * `BUDGET_CATEGORY_KEYS`, and inventing one there would put a row on every budget
 * screen in the product to serve a classifier. Where a faithful mapping does
 * exist, `budgetCategoryKey` carries it; where it does not, it is null and the
 * reviewer decides.
 */
export const transactionClassSchema = z.enum([
  /** A charge the bank makes for keeping the account: מסלול, עמלת ניהול, דמי כרטיס. */
  'bank_fee',
  /** Interest the bank charged on an overdraft or a facility. */
  'bank_interest',
  /** A repayment of a loan or a debt: חיוב הלוואה, החזר הלוואה. */
  'loan_repayment',
  /** Money lent to the household arriving in the account. */
  'loan_received',
  /** Salary or other regular earned income. */
  'salary',
  /** A benefit or allowance: קצבה, ביטוח לאומי. */
  'benefit',
  /** The monthly credit-card settlement leaving the bank account. */
  'card_settlement',
  /** A standing order or direct debit that is not obviously anything else. */
  'standing_order',
  /** Cash taken out at a machine or a counter. */
  'cash_withdrawal',
  /** A utility or municipal bill: חשמל, מים, ארנונה, גז. */
  'utility_bill',
  /** An insurance premium. */
  'insurance',
  /** Tax paid to the state. */
  'tax',
  /** A transfer between the household's own accounts. */
  'internal_transfer',
  /** A cheque presented against the account. */
  'cheque',
  /** An ordinary purchase from a merchant. */
  'purchase',
  /** Money coming back: refund, reversal, credit. */
  'refund',
  /** Read, but not recognised as anything in particular. */
  'unclassified',
]);
export type TransactionClass = z.infer<typeof transactionClassSchema>;

/**
 * How much the classifier is prepared to stand behind a suggestion.
 *
 * The levels are a contract with the review screen, not a decoration:
 *
 *   * `high` — the row may be preselected as included. A person can still change
 *     it, and nothing is approved without them pressing approve.
 *   * `medium` — shown, never preselected. The row waits for a person to look.
 *   * `low` — shown as a question. The row cannot be included until someone
 *     decides what it is.
 */
export const confidenceLevelSchema = z.enum(['high', 'medium', 'low']);
export type ConfidenceLevel = z.infer<typeof confidenceLevelSchema>;

/** What the review screen must do about a suggestion. */
export const reviewRequirementSchema = z.enum([
  /** May arrive included; a person can edit it. */
  'may_preselect',
  /** Shown, not preselected: a person has to look at it. */
  'needs_review',
  /** Cannot be included until a person says what it is. */
  'needs_decision',
]);
export type ReviewRequirement = z.infer<typeof reviewRequirementSchema>;

/** The single table from confidence to what the screen may do. Written once. */
export const REVIEW_REQUIREMENT: Readonly<Record<ConfidenceLevel, ReviewRequirement>> = {
  high: 'may_preselect',
  medium: 'needs_review',
  low: 'needs_decision',
};

/** Which signal a rule read. Carried so an explanation can name it. */
export const classificationSignalSchema = z.enum([
  'household_rule',
  'description',
  'bank',
  'account_kind',
  'direction',
  'reference',
  'recurring',
  'amount',
]);
export type ClassificationSignal = z.infer<typeof classificationSignalSchema>;

export const classificationSuggestionSchema = z
  .object({
    class: transactionClassSchema,
    /** The budget envelope, when the class maps faithfully onto one. */
    budgetCategoryKey: budgetCategoryKeySchema.nullable(),
    /** Who the money went to or came from, when the line names them. */
    counterparty: z.string().trim().max(160).nullable(),
    /**
     * The debt this row repays, when the household has exactly one debt whose
     * lender the line names.
     *
     * Null is the normal answer and is not a failure: a statement line saying
     * "חיוב הלוואה" identifies no lender at all. `requiresDebtChoice` says whether
     * a person still has to name one before the row may be approved.
     */
    suggestedDebtId: uuidSchema.nullable(),
    /**
     * True when this row would move a debt balance and the debt is not settled.
     *
     * Independent of confidence. A row can be a certain loan repayment and still
     * need the lender named, and until it is named no balance may change.
     */
    requiresDebtChoice: z.boolean(),
    confidence: confidenceLevelSchema,
    /** One short Hebrew sentence naming the evidence. Never a number. */
    explanation: z.string().trim().min(1).max(300),
    /** The rule that produced this. A household rule carries its id. */
    ruleId: z.string().trim().min(1).max(80),
    /** True when the rule came from this household's own confirmations. */
    fromHouseholdRule: z.boolean(),
    signals: z.array(classificationSignalSchema).max(8),
  })
  .refine((s) => s.suggestedDebtId === null || s.class === 'loan_repayment', {
    message: 'only a repayment points at a debt',
    path: ['suggestedDebtId'],
  })
  .refine((s) => !s.requiresDebtChoice || s.class === 'loan_repayment', {
    message: 'only a repayment needs a debt chosen',
    path: ['requiresDebtChoice'],
  });
export type ClassificationSuggestion = z.infer<typeof classificationSuggestionSchema>;

/**
 * How a household rule decides which rows it applies to.
 *
 * `contains` on the normalised description is the whole matcher, on purpose. A
 * regular expression typed by a family is a way to match rows nobody intended,
 * and the normaliser has already folded the spelling variants that a looser
 * matcher would have been needed for.
 */
export const learnedRuleMatcherSchema = z.object({
  /** Normalised text that must appear in the normalised description. */
  descriptionContains: z.string().trim().min(2).max(120),
  /** Restrict to one direction, when the household said so. */
  direction: z.enum(['inflow', 'outflow']).nullable(),
  /** Restrict to one account, when the household said so. */
  accountId: uuidSchema.nullable(),
});
export type LearnedRuleMatcher = z.infer<typeof learnedRuleMatcherSchema>;

/**
 * What this household decided a kind of row means.
 *
 * Created only when a person corrects a suggestion and asks for it to be
 * remembered. It belongs to one household and is never shared: one family's
 * "העברה לאמא" is not another's.
 */
export const learnedRuleSchema = z.object({
  id: uuidSchema,
  householdId: uuidSchema,
  /** What the family called this rule, for the list they manage. */
  label: z.string().trim().min(1).max(120),
  matcher: learnedRuleMatcherSchema,
  /** The classification to apply. */
  class: transactionClassSchema,
  budgetCategoryKey: budgetCategoryKeySchema.nullable(),
  counterparty: z.string().trim().max(160).nullable(),
  /**
   * A debt this rule attaches the row to.
   *
   * Even a rule does not let a balance move without a person: the row still
   * arrives as a suggestion and still has to be approved. What the rule removes
   * is the retyping, not the confirmation.
   */
  debtId: uuidSchema.nullable(),
  /** A disabled rule is kept and ignored, so a family can try turning it off. */
  enabled: z.boolean(),
  /** How many rows this rule has been applied to. Shown in the list. */
  timesApplied: z.number().int().min(0),
  createdBy: uuidSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  version: versionSchema,
});
export type LearnedRule = z.infer<typeof learnedRuleSchema>;

export const createLearnedRuleInputSchema = z.object({
  label: z.string().trim().min(1).max(120),
  matcher: learnedRuleMatcherSchema,
  class: transactionClassSchema,
  budgetCategoryKey: budgetCategoryKeySchema.nullable(),
  counterparty: z.string().trim().max(160).nullable(),
  debtId: uuidSchema.nullable(),
});
export type CreateLearnedRuleInput = z.infer<typeof createLearnedRuleInputSchema>;

/**
 * The record of what was suggested and what a person did about it.
 *
 * Kept so that "why is this row a bank fee" is answerable months later: the
 * suggestion, its confidence, the rule behind it, and the decision, beside the
 * raw row that never changes.
 */
export const classificationDecisionSchema = z.enum([
  'accepted_as_suggested',
  'corrected_by_user',
  'decided_without_suggestion',
]);
export type ClassificationDecision = z.infer<typeof classificationDecisionSchema>;

export const classificationAuditSchema = z.object({
  suggestion: classificationSuggestionSchema,
  decision: classificationDecisionSchema,
  /** The class the row was approved as, which may differ from the suggestion. */
  finalClass: transactionClassSchema,
  decidedAt: timestampSchema,
  decidedBy: uuidSchema,
  /** The household rule saved from this decision, when one was. */
  savedRuleId: uuidSchema.nullable(),
});
export type ClassificationAudit = z.infer<typeof classificationAuditSchema>;
