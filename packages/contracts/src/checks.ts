import { z } from 'zod';

import { timestampSchema, uuidSchema, versionSchema } from './identity';
import { amountMinorSchema, businessDateSchema, currencySchema } from './money';

/**
 * Post-dated checks, and the one distinction the whole file exists to hold.
 *
 * A gemach lends without interest and asks for the repayments up front, as a
 * stack of checks dated a month apart. Handing that stack over is the moment the
 * borrower feels they have paid — and it is the moment nothing whatsoever has
 * happened to their money.
 *
 * Three separate facts, three separate records, and they must never be merged:
 *
 *   1. The debt exists. That is a debt with an opening balance.
 *   2. A check was written and handed over. Nothing moved. The bank balance is
 *      unchanged and the debt is unchanged. What changed is the *exposure*: a
 *      piece of paper is now in somebody else's hands and it may be cashed at any
 *      moment.
 *   3. The bank honoured the check. Now money has moved, and only now does the
 *      principal come down.
 *
 * Every rule below follows from that. A delivered check is not a payment. A
 * scheduled installment and the check written for it are one obligation, not two.
 * Money that has left the account and money that might leave the account are
 * different colours and are never added together.
 *
 * The `due` state, deliberately absent
 * ------------------------------------
 * "Due" is not something that happens to a check; it is what today's date makes
 * of a check nobody has cashed. Storing it would mean a status that is correct
 * when it is written and quietly wrong the next morning, and a family relying on
 * a background job to tell them a check is overdue. So the stored status says
 * what *happened*, and urgency is derived from the due date every time it is
 * read. See `derivedCheckState` in the finance engine.
 */

/**
 * What has actually happened to a check.
 *
 * `prepared` — written, still in the chequebook, nobody else can cash it.
 * `delivered` — handed to the gemach. From here it can be cashed at any moment.
 * `deposited` — known to be at the bank, not yet honoured.
 * `cleared` — the bank paid it. This is the only state where money moved.
 * `returned` — presented and not honoured. Needs attention, and is not a payment.
 * `cancelled` — withdrawn by agreement, with a reason recorded.
 * `replaced` — swapped for another check, which is linked.
 */
export const checkStatusSchema = z.enum([
  'prepared',
  'delivered',
  'deposited',
  'cleared',
  'returned',
  'cancelled',
  'replaced',
]);
export type CheckStatus = z.infer<typeof checkStatusSchema>;

/**
 * Checks that may still take money out of the account.
 *
 * This is the list the forecast, the warnings and the exposure total are all
 * built from, written once so they cannot disagree. `returned` is deliberately
 * not here: a bounced check will not clear as it stands, so counting it as
 * exposure would double the household's fear. It is surfaced separately, because
 * it needs a decision.
 */
export const OUTSTANDING_CHECK_STATUSES: readonly CheckStatus[] = [
  'prepared',
  'delivered',
  'deposited',
];

/** Checks the gemach is holding, and can present without asking. */
export const AT_LARGE_CHECK_STATUSES: readonly CheckStatus[] = ['delivered', 'deposited'];

/** States a check can never leave. */
export const TERMINAL_CHECK_STATUSES: readonly CheckStatus[] = [
  'cleared',
  'cancelled',
  'replaced',
];

/**
 * Which changes of status are allowed, and in which direction.
 *
 * A check cannot go from prepared straight to cleared: the bank cannot honour a
 * piece of paper nobody has been given. Writing the table out means a wrong
 * transition is refused by the model rather than by whoever happened to write the
 * screen.
 *
 * Nothing leads out of `cleared`, `cancelled` or `replaced`. Those are corrected
 * by an explicit reversal, which is a different operation with its own reason and
 * its own audit entry — not by a status change that would quietly rewrite what
 * happened.
 */
export const CHECK_TRANSITIONS: Readonly<Record<CheckStatus, readonly CheckStatus[]>> = {
  prepared: ['delivered', 'cancelled', 'replaced'],
  delivered: ['deposited', 'cleared', 'returned', 'cancelled', 'replaced'],
  deposited: ['cleared', 'returned'],
  // A returned check can be presented again by agreement, or swapped for a new one.
  returned: ['deposited', 'replaced', 'cancelled'],
  cleared: [],
  cancelled: [],
  replaced: [],
};

export function canTransition(from: CheckStatus, to: CheckStatus): boolean {
  return (CHECK_TRANSITIONS[from] ?? []).includes(to);
}

/** Where the record came from. An imported one is never approved by arriving. */
export const checkSourceSchema = z.enum(['manual', 'import', 'reconciliation']);
export type CheckSource = z.infer<typeof checkSourceSchema>;

/**
 * A check number, as printed.
 *
 * Optional, because a borrower does not always write them down and a model that
 * demands one produces invented data. Kept short and digits-only: anything else
 * is somebody typing a note into the wrong field.
 */
export const checkNumberSchema = z
  .string()
  .trim()
  .regex(/^[0-9]{1,12}$/)
  .nullable();

export const postDatedCheckSchema = z
  .object({
    id: uuidSchema,
    householdId: uuidSchema,
    /** The debt this check repays. Every check belongs to exactly one. */
    debtId: uuidSchema,
    /** The account it will be drawn on. */
    accountId: uuidSchema,
    checkNumber: checkNumberSchema,
    amountMinor: amountMinorSchema,
    currency: currencySchema,
    /** The date printed on the check: the earliest it should be presented. */
    dueDate: businessDateSchema,
    /** When it was physically handed over. Null until it is. */
    deliveredOn: businessDateSchema.nullable(),
    /** Who it is made out to. */
    payeeName: z.string().trim().min(1).max(160),
    /** Its place in the series, when it belongs to one. */
    installmentNumber: z.number().int().min(1).max(600).nullable(),
    note: z.string().trim().max(500).nullable(),
    source: checkSourceSchema,
    status: checkStatusSchema,
    /** When the bank honoured it. Set only in `cleared`. */
    clearedOn: businessDateSchema.nullable(),
    /** The cash movement the clearing created. The link that stops double counting. */
    clearedTransactionId: uuidSchema.nullable(),
    /** The `principal_payment` the clearing created. */
    debtEventId: uuidSchema.nullable(),
    returnedOn: businessDateSchema.nullable(),
    /** Why it was cancelled or returned. Required for both; blame-free wording. */
    resolutionReason: z.string().trim().max(300).nullable(),
    /** The check that took this one's place. */
    replacedByCheckId: uuidSchema.nullable(),
    /** The check this one replaces. */
    replacesCheckId: uuidSchema.nullable(),
    /** The import batch that proposed the clearing, when one did. */
    importBatchId: uuidSchema.nullable(),
    createdBy: uuidSchema,
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    version: versionSchema,
  })
  /*
   * The invariants that keep "delivered" and "paid" apart.
   *
   * Each one is a way the two could be confused if the model allowed it: a
   * cleared check with no transaction would reduce a debt with no money behind
   * it; a transaction on an uncleared check would take money out for a check the
   * bank has not seen.
   */
  .refine((check) => (check.status === 'cleared') === (check.clearedOn !== null), {
    message: 'a check has a clearing date exactly when it is cleared',
    path: ['clearedOn'],
  })
  .refine(
    (check) => (check.clearedTransactionId === null ? true : check.status === 'cleared'),
    {
      message: 'only a cleared check may point at a cash movement',
      path: ['clearedTransactionId'],
    },
  )
  .refine((check) => (check.debtEventId === null ? true : check.status === 'cleared'), {
    message: 'only a cleared check may point at a repayment event',
    path: ['debtEventId'],
  })
  .refine((check) => (check.status === 'returned' ? check.returnedOn !== null : true), {
    message: 'a returned check records when it came back',
    path: ['returnedOn'],
  })
  /*
   * A returned date outlives the returned status, and only in one direction.
   *
   * A check that bounced and was then cancelled or replaced still bounced, and
   * erasing the date to satisfy a tidier rule would delete the fact a family most
   * needs when they reconstruct what happened. What must not happen is a date
   * surviving onto a check that is back in play, so undoing a return clears it and
   * the states that may still carry one are named here.
   */
  .refine(
    (check) =>
      check.returnedOn === null ||
      check.status === 'returned' ||
      check.status === 'cancelled' ||
      check.status === 'replaced',
    {
      message: 'only a returned, cancelled or replaced check may carry a returned date',
      path: ['returnedOn'],
    },
  )
  .refine((check) => (check.status === 'replaced') === (check.replacedByCheckId !== null), {
    message: 'a replaced check names the check that took its place',
    path: ['replacedByCheckId'],
  })
  .refine(
    (check) =>
      check.status === 'cancelled' || check.status === 'returned'
        ? check.resolutionReason !== null
        : true,
    {
      message: 'cancelling or recording a return needs a reason on the record',
      path: ['resolutionReason'],
    },
  )
  /*
   * Never handed over, so it cannot have reached the bank.
   *
   * `cancelled` and `replaced` are permitted alongside `prepared` because both
   * are things that can happen to a check still sitting in the chequebook — it is
   * torn up, or rewritten — and neither implies anybody ever received it.
   */
  .refine(
    (check) =>
      check.deliveredOn === null
        ? check.status === 'prepared' ||
          check.status === 'cancelled' ||
          check.status === 'replaced'
        : true,
    {
      message: 'a check that was never handed over cannot have been deposited or cleared',
      path: ['deliveredOn'],
    },
  )
  .refine((check) => check.replacesCheckId !== check.id, {
    message: 'a check cannot replace itself',
    path: ['replacesCheckId'],
  });
export type PostDatedCheck = z.infer<typeof postDatedCheckSchema>;

/**
 * What was agreed with the gemach.
 *
 * Separate from the checks, because the agreement and the paper are different
 * things and either can exist without the other: a plan may be agreed before a
 * single check is written, and checks can be handed over for an arrangement
 * nobody wrote down. Keeping them apart is what lets the screen answer "do the
 * checks actually cover what we owe?" — a question that has no meaning if the
 * plan is defined as the sum of the checks.
 */
export const repaymentPlanSchema = z
  .object({
    id: uuidSchema,
    householdId: uuidSchema,
    debtId: uuidSchema,
    /** The arrangement in the family's own words. */
    agreementSummary: z.string().trim().max(1000).nullable(),
    installmentCount: z.number().int().min(1).max(600),
    installmentAmountMinor: amountMinorSchema,
    /**
     * A different last payment, when the total does not divide evenly.
     * Null when every installment is the same.
     */
    finalInstallmentAmountMinor: amountMinorSchema.nullable(),
    firstDueDate: businessDateSchema,
    /** Monthly is the only cadence a gemach uses in practice. */
    cadence: z.literal('monthly'),
    createdBy: uuidSchema,
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    version: versionSchema,
  })
  .refine((plan) => plan.installmentAmountMinor > 0, {
    message: 'an installment must be more than nothing',
    path: ['installmentAmountMinor'],
  });
export type RepaymentPlan = z.infer<typeof repaymentPlanSchema>;

/** The total a plan promises to repay. */
export function plannedTotalMinor(plan: {
  readonly installmentCount: number;
  readonly installmentAmountMinor: number;
  readonly finalInstallmentAmountMinor: number | null;
}): number {
  if (plan.finalInstallmentAmountMinor === null) {
    return plan.installmentCount * plan.installmentAmountMinor;
  }
  return (
    (plan.installmentCount - 1) * plan.installmentAmountMinor + plan.finalInstallmentAmountMinor
  );
}

/**
 * A check number, masked for ordinary display.
 *
 * A check number plus an account number is most of what somebody needs to write
 * a fraudulent check, and a report a family prints and leaves on the table does
 * not need it. The last four digits are enough to tell one check from another,
 * which is all a report is for. The full number stays on the record and on the
 * screen where a person is working with that one check.
 */
export function maskCheckNumber(checkNumber: string | null): string | null {
  if (checkNumber === null) return null;
  if (checkNumber.length <= 4) return checkNumber;
  return `••${checkNumber.slice(-4)}`;
}

export const addCheckInputSchema = z.object({
  debtId: uuidSchema,
  accountId: uuidSchema,
  checkNumber: checkNumberSchema,
  amountMinor: amountMinorSchema,
  dueDate: businessDateSchema,
  payeeName: z.string().trim().min(1).max(160),
  installmentNumber: z.number().int().min(1).max(600).nullable(),
  note: z.string().trim().max(500).nullable(),
  deliveredOn: businessDateSchema.nullable(),
});
export type AddCheckInput = z.infer<typeof addCheckInputSchema>;

/**
 * How a series is described before any of it exists.
 *
 * `intendedTotalMinor` is the point of the whole shape: the family says what they
 * believe they are repaying, and the preview says whether the checks add up to
 * it. Without that field the series is self-consistent by construction and a
 * typo in the amount becomes a plan.
 */
export const checkSeriesInputSchema = z.object({
  debtId: uuidSchema,
  accountId: uuidSchema,
  payeeName: z.string().trim().min(1).max(160),
  count: z.number().int().min(1).max(120),
  amountPerCheckMinor: amountMinorSchema,
  finalCheckAmountMinor: amountMinorSchema.nullable(),
  firstDueDate: businessDateSchema,
  /** The first check number, when the family is numbering them. */
  firstCheckNumber: checkNumberSchema,
  intendedTotalMinor: amountMinorSchema.nullable(),
  note: z.string().trim().max(500).nullable(),
});
export type CheckSeriesInput = z.infer<typeof checkSeriesInputSchema>;
