import { z } from 'zod';

import { dueDateSchema } from './calendar';
import { timestampSchema, uuidSchema, versionSchema } from './identity';
import { amountMinorSchema, businessDateSchema, currencySchema } from './money';

/**
 * Milestone 4 — the debt domain.
 *
 * Two rules from 02-FINANCIAL-RULES.md § גלגול חוב והחלפת נושה shape everything here:
 *
 *  1. Debt events are the truth. A balance is the sum of what happened to a debt,
 *     never a number typed over the previous one.
 *  2. Repaying one creditor with another creditor's money is three separate facts —
 *     the old debt was repaid, a new debt was created, and a link explains what
 *     funded the repayment. Merging creditors or rewriting history is forbidden.
 */

/**
 * Debt kinds.
 *
 * `mortgage` is separated because 01-PRODUCT-SPEC.md requires consumer debt and
 * total-debt-including-mortgage to be reported as two different numbers.
 * `private_person` carries the relationship fields that no institutional debt has.
 */
export const debtKindSchema = z.enum([
  'mortgage',
  'bank_loan',
  'revolving_credit',
  'overdraft',
  'private_person',
  /**
   * A gemach: a free-loan fund. Its own kind rather than an institution or a
   * private person, because neither describes it. It charges no interest, which
   * changes what "progress" means — every shekel repaid reduces the principal, so
   * a repayment schedule that looks alarming beside a bank loan is not — and it is
   * repaid through post-dated checks handed over in advance, which no other kind
   * of debt here does.
   */
  'gemach',
  'institution',
  'other',
]);
export type DebtKind = z.infer<typeof debtKindSchema>;

/** Every kind except `mortgage` counts toward consumer debt. */
export const CONSUMER_DEBT_KINDS: readonly DebtKind[] = [
  'bank_loan',
  'revolving_credit',
  'overdraft',
  'private_person',
  'gemach',
  'institution',
  'other',
];

export const debtStatusSchema = z.enum(['active', 'settled', 'written_off']);
export type DebtStatus = z.infer<typeof debtStatusSchema>;

/**
 * How pressing the creditor is.
 *
 * 02-FINANCIAL-RULES.md § קדימות חובות ranks legal risk and urgent demand above
 * interest cost, so urgency is recorded rather than inferred from the amount.
 */
export const debtUrgencySchema = z.enum(['none', 'watch', 'demanded', 'legal']);
export type DebtUrgency = z.infer<typeof debtUrgencySchema>;

/**
 * Relationship sensitivity for a debt owed to a person.
 *
 * Explicitly not translated into an interest rate: "יחס אישי אינו מתורגם אוטומטית
 * לריבית; הוא שיקול מוסבר ונפרד". It is carried so the advisor can explain a
 * recommendation, never so it can be silently priced.
 */
export const relationshipSensitivitySchema = z.enum(['low', 'medium', 'high']);
export type RelationshipSensitivity = z.infer<typeof relationshipSensitivitySchema>;

export const debtSchema = z
  .object({
    id: uuidSchema,
    householdId: uuidSchema,
    kind: debtKindSchema,
    creditorName: z.string().trim().min(1).max(160),
    currency: currencySchema,
    status: debtStatusSchema,
    /**
     * Effective annual cost in basis points (1250 = 12.5%). Null means unknown,
     * and unknown is not zero: § קדימות חובות forbids claiming a precise saving
     * when the rate is missing.
     */
    effectiveAnnualRateBp: z.number().int().min(0).max(1_000_000).nullable(),
    /** Contractual monthly minimum. Null when the creditor has set none. */
    minimumPaymentMinor: amountMinorSchema.nullable(),
    /** Day of month the minimum falls due, when the debt has a schedule. */
    paymentDueDay: z.number().int().min(1).max(31).nullable(),
    urgency: debtUrgencySchema,
    /** Private-debt fields. Null for every institutional debt. */
    promiseSummary: z.string().trim().max(500).nullable(),
    relationshipSensitivity: relationshipSensitivitySchema.nullable(),
    partialPaymentAllowed: z.boolean().nullable(),
    lastDemandAt: timestampSchema.nullable(),
    lastConversationAt: timestampSchema.nullable(),
    /** A date the lender may call the money in, when one was agreed. */
    expectedCallDate: businessDateSchema.nullable(),
    /**
     * When the payment is due, in whichever calendar the family wrote it.
     *
     * Optional so that every debt recorded before dual-calendar dates existed
     * stays valid: absent means nothing was ever said about a due date, which is
     * exactly what those records mean.
     */
    dueDate: dueDateSchema.optional(),
    notes: z.string().trim().max(1000).nullable(),
    openedOn: businessDateSchema,
    closedAt: timestampSchema.nullable(),
    createdBy: uuidSchema,
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    version: versionSchema,
  })
  .refine(
    (debt) =>
      debt.kind === 'private_person'
        ? debt.relationshipSensitivity !== null && debt.partialPaymentAllowed !== null
        : debt.relationshipSensitivity === null && debt.partialPaymentAllowed === null,
    {
      message: 'relationship fields belong to a private debt and only to a private debt',
      path: ['relationshipSensitivity'],
    },
  );
export type Debt = z.infer<typeof debtSchema>;

/**
 * What happened to a debt.
 *
 * `principal_payment` reduces the balance; `interest_charge` and `fee_charge` do
 * not reduce it, because paying interest is not progress on principal
 * (02-FINANCIAL-RULES.md § אינווריאנטים). `balance_correction` exists so a wrong
 * opening figure can be fixed without ever being mistaken for a repayment.
 */
export const debtEventKindSchema = z.enum([
  'opening_balance',
  'new_principal',
  'principal_payment',
  'interest_charge',
  'fee_charge',
  'interest_paid',
  'fee_paid',
  'balance_correction',
  'write_off',
  /**
   * Something worth remembering that moved no money: a conversation, a promise,
   * a change of terms. It belongs on the ledger because the ledger is the whole
   * history of a lender, and leaving it off would mean keeping it somewhere the
   * balance cannot be read beside it. Its effect is `none`.
   */
  'note',
]);
export type DebtEventKind = z.infer<typeof debtEventKindSchema>;

/** How an event moves the outstanding balance. */
export const balanceEffectSchema = z.enum(['increase', 'decrease', 'none']);
export type BalanceEffect = z.infer<typeof balanceEffectSchema>;

/**
 * The single table of how each event kind moves a balance.
 *
 * Written once, here, so the database, the engine and the UI cannot disagree.
 * `balance_correction` is deliberately absent: its direction is carried on the row,
 * because a correction can go either way and must stay visibly separate from a
 * repayment.
 */
export const DEBT_EVENT_BALANCE_EFFECT: Readonly<
  Record<Exclude<DebtEventKind, 'balance_correction'>, BalanceEffect>
> = {
  opening_balance: 'increase',
  new_principal: 'increase',
  principal_payment: 'decrease',
  interest_charge: 'increase',
  fee_charge: 'increase',
  interest_paid: 'none',
  fee_paid: 'none',
  write_off: 'decrease',
  note: 'none',
};

export const debtEventSchema = z
  .object({
    id: uuidSchema,
    householdId: uuidSchema,
    debtId: uuidSchema,
    kind: debtEventKindSchema,
    amountMinor: amountMinorSchema,
    currency: currencySchema,
    occurredOn: businessDateSchema,
    /**
     * Direction of a `balance_correction` only. Every other kind takes its effect
     * from DEBT_EVENT_BALANCE_EFFECT, so the two can never contradict each other.
     */
    correctionEffect: z.enum(['increase', 'decrease']).nullable(),
    /** The cash movement that paid this, when one exists. */
    transactionId: uuidSchema.nullable(),
    note: z.string().trim().max(500).nullable(),
    createdBy: uuidSchema,
    createdAt: timestampSchema,
  })
  .refine(
    (event) => (event.kind === 'balance_correction') === (event.correctionEffect !== null),
    {
      message: 'only a balance_correction carries an explicit direction, and it must carry one',
      path: ['correctionEffect'],
    },
  );
export type DebtEvent = z.infer<typeof debtEventSchema>;

/**
 * How a rollover link came to exist.
 *
 * A link inferred from amount and timing is a suggestion until a person confirms
 * it: "קישור rollover שמוסק לפי סכום/זמן הוא הצעה בלבד עד אישור משתמש".
 */
export const rolloverSourceSchema = z.enum(['user_confirmed', 'system_suggested']);
export type RolloverSource = z.infer<typeof rolloverSourceSchema>;

export const rolloverStatusSchema = z.enum(['proposed', 'confirmed', 'rejected']);
export type RolloverStatus = z.infer<typeof rolloverStatusSchema>;

/**
 * The link that explains what funded a repayment.
 *
 * It changes no balance of its own. The debt events are the truth; this row only
 * says that the money used to repay `fromDebtId` came from `toDebtId`, so the
 * aggregate debt meter can show a repayment that was not progress.
 */
export const debtRolloverSchema = z
  .object({
    id: uuidSchema,
    householdId: uuidSchema,
    /** The debt that was repaid. */
    fromDebtId: uuidSchema,
    /** The debt that was created to fund it. */
    toDebtId: uuidSchema,
    /** The `principal_payment` on the old debt. */
    repaymentEventId: uuidSchema,
    /** The `new_principal` on the new debt. */
    originationEventId: uuidSchema,
    amountMinor: amountMinorSchema,
    occurredOn: businessDateSchema,
    source: rolloverSourceSchema,
    status: rolloverStatusSchema,
    /** Confidence of an inferred link, in basis points. Null when user-confirmed. */
    confidenceBp: z.number().int().min(0).max(10_000).nullable(),
    notes: z.string().trim().max(500).nullable(),
    confirmedBy: uuidSchema.nullable(),
    confirmedAt: timestampSchema.nullable(),
    createdBy: uuidSchema,
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    version: versionSchema,
  })
  .refine((link) => link.fromDebtId !== link.toDebtId, {
    message: 'a debt cannot roll over into itself',
    path: ['toDebtId'],
  })
  .refine((link) => (link.status === 'confirmed') === (link.confirmedAt !== null), {
    message: 'a confirmed rollover records who confirmed it and when',
    path: ['confirmedAt'],
  })
  .refine((link) => (link.source === 'system_suggested' ? link.confidenceBp !== null : true), {
    message: 'an inferred link must state its confidence',
    path: ['confidenceBp'],
  });
export type DebtRollover = z.infer<typeof debtRolloverSchema>;

export const createDebtInputSchema = z.object({
  householdId: uuidSchema,
  kind: debtKindSchema,
  creditorName: z.string().trim().min(1).max(160),
  currency: currencySchema,
  openingBalanceMinor: amountMinorSchema,
  openedOn: businessDateSchema,
  effectiveAnnualRateBp: z.number().int().min(0).max(1_000_000).nullable(),
  minimumPaymentMinor: amountMinorSchema.nullable(),
  paymentDueDay: z.number().int().min(1).max(31).nullable(),
  urgency: debtUrgencySchema,
  promiseSummary: z.string().trim().max(500).nullable(),
  relationshipSensitivity: relationshipSensitivitySchema.nullable(),
  partialPaymentAllowed: z.boolean().nullable(),
  expectedCallDate: businessDateSchema.nullable(),
  dueDate: dueDateSchema.optional(),
  notes: z.string().trim().max(1000).nullable(),
});
export type CreateDebtInput = z.infer<typeof createDebtInputSchema>;

export const recordDebtEventInputSchema = z.object({
  debtId: uuidSchema,
  kind: debtEventKindSchema,
  amountMinor: amountMinorSchema,
  occurredOn: businessDateSchema,
  correctionEffect: z.enum(['increase', 'decrease']).nullable(),
  transactionId: uuidSchema.nullable(),
  note: z.string().trim().max(500).nullable(),
});
export type RecordDebtEventInput = z.infer<typeof recordDebtEventInputSchema>;

/**
 * Confirming a proposed rollover.
 *
 * 08-TEST-PLAN.md § גלגולי חוב requires double confirmation to be idempotent, so
 * the caller states the version it read and a repeat of the same call is a no-op
 * rather than a second link.
 */
export const confirmRolloverInputSchema = z.object({
  rolloverId: uuidSchema,
  expectedVersion: versionSchema,
});
export type ConfirmRolloverInput = z.infer<typeof confirmRolloverInputSchema>;
