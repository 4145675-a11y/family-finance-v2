import {
  OUTSTANDING_CHECK_STATUSES,
  canTransition,
  plannedTotalMinor,
  type CheckSource,
  type CheckStatus,
  type PostDatedCheck,
  type RepaymentPlan,
} from '@family-finance/contracts';
import { planCheckSeries, type CheckSeriesPlan } from '@family-finance/finance-engine';

import { auditEvent, withAudit } from './audit';
import {
  CommandError,
  recordDebtEvent,
  recordTransaction,
  type CommandContext,
  type CommandResult,
} from './commands';
import type { StoreDocument } from './document';

/**
 * Everything that can be done to a gemach loan and its checks.
 *
 * The rule this file exists to hold, stated once so that every function below can
 * be read against it:
 *
 *   **Handing over a check changes no number. Clearing one changes two.**
 *
 * `deliverCheck` writes a date and a status and touches nothing else — no
 * transaction, no debt event, no balance. `clearCheck` writes a transaction (the
 * money left the account) and a `principal_payment` (the debt came down) and
 * links both to the check, so the pair can be found, shown together, and undone
 * together.
 *
 * The links are what make double counting structurally impossible rather than
 * merely unlikely. A check that is already cleared cannot be cleared again
 * because its status forbids the transition; a check that carries a
 * `clearedTransactionId` cannot acquire a second one because clearing is the only
 * function that sets it and it refuses a cleared check. An import proposing the
 * same bank debit twice therefore cannot produce two repayments — the second
 * attempt is refused by name, not deduplicated by a heuristic.
 */

const newId = (): string => crypto.randomUUID();

function requireDebt(document: StoreDocument, debtId: string) {
  const debt = document.debts.find((candidate) => candidate.id === debtId);
  if (debt === undefined) {
    throw new CommandError('unknown_debt', `no debt with id ${debtId}`);
  }
  return debt;
}

function requireAccount(document: StoreDocument, accountId: string) {
  const account = document.accounts.find((candidate) => candidate.id === accountId);
  if (account === undefined) {
    throw new CommandError('unknown_account', `no account with id ${accountId}`);
  }
  return account;
}

export function requireCheck(document: StoreDocument, checkId: string): PostDatedCheck {
  const check = document.checks.find((candidate) => candidate.id === checkId);
  if (check === undefined) {
    throw new CommandError('unknown_check', `no check with id ${checkId}`);
  }
  return check;
}

/**
 * Refuses a check number already used on the same account.
 *
 * Only within an account, and only when a number was actually supplied: two
 * different chequebooks legitimately share numbers, and most families do not
 * record the numbers at all. Cancelled and replaced checks still count — the
 * paper exists and the bank will still honour it if it turns up.
 */
function assertNumberUnused(
  document: StoreDocument,
  accountId: string,
  checkNumber: string | null,
  exceptCheckId: string | null = null,
): void {
  if (checkNumber === null) return;

  const clash = document.checks.find(
    (candidate) =>
      candidate.id !== exceptCheckId &&
      candidate.accountId === accountId &&
      candidate.checkNumber === checkNumber,
  );

  if (clash !== undefined) {
    throw new CommandError(
      'duplicate_check_number',
      `check number ${checkNumber} is already recorded on this account`,
    );
  }
}

function updated(check: PostDatedCheck, now: string): PostDatedCheck {
  return { ...check, updatedAt: now, version: check.version + 1 };
}

function replaceCheckIn(document: StoreDocument, check: PostDatedCheck): StoreDocument {
  return {
    ...document,
    checks: document.checks.map((candidate) => (candidate.id === check.id ? check : candidate)),
  };
}

function checkAudit(
  document: StoreDocument,
  context: CommandContext,
  action: string,
  before: PostDatedCheck | null,
  after: PostDatedCheck,
) {
  return auditEvent({
    householdId: document.household.id,
    actorProfileId: context.actorProfileId,
    action,
    entityType: 'check',
    entityId: after.id,
    ...(before === null ? {} : { before }),
    after,
    occurredAt: context.now,
  });
}

// ---------------------------------------------------------------------------
// The repayment agreement
// ---------------------------------------------------------------------------

export interface SetRepaymentPlanInput {
  readonly debtId: string;
  readonly agreementSummary: string | null;
  readonly installmentCount: number;
  readonly installmentAmountMinor: number;
  readonly finalInstallmentAmountMinor: number | null;
  readonly firstDueDate: string;
}

/**
 * Records what was agreed, which is not the same as what has been written.
 *
 * Kept separate from the checks so the screen can answer "do the checks cover
 * what we agreed?" — a question that becomes meaningless if the plan is defined
 * as the sum of the checks.
 */
export function setRepaymentPlan(
  document: StoreDocument,
  input: SetRepaymentPlanInput,
  context: CommandContext,
): CommandResult<string> {
  requireDebt(document, input.debtId);

  if (input.installmentAmountMinor <= 0) {
    throw new CommandError('amount_required', 'an installment must be more than nothing');
  }

  const existing = document.repaymentPlans.find((plan) => plan.debtId === input.debtId);

  const plan: RepaymentPlan = {
    id: existing?.id ?? newId(),
    householdId: document.household.id,
    debtId: input.debtId,
    agreementSummary: input.agreementSummary,
    installmentCount: input.installmentCount,
    installmentAmountMinor: input.installmentAmountMinor,
    finalInstallmentAmountMinor: input.finalInstallmentAmountMinor,
    firstDueDate: input.firstDueDate,
    cadence: 'monthly',
    createdBy: existing?.createdBy ?? context.actorProfileId,
    createdAt: existing?.createdAt ?? context.now,
    updatedAt: context.now,
    version: (existing?.version ?? 0) + 1,
  };

  const repaymentPlans =
    existing === undefined
      ? [...document.repaymentPlans, plan]
      : document.repaymentPlans.map((candidate) =>
          candidate.id === plan.id ? plan : candidate,
        );

  return {
    document: withAudit({ ...document, repaymentPlans }, [
      auditEvent({
        householdId: document.household.id,
        actorProfileId: context.actorProfileId,
        action: existing === undefined ? 'repayment_plan.set' : 'repayment_plan.updated',
        entityType: 'repayment_plan',
        entityId: plan.id,
        ...(existing === undefined ? {} : { before: existing }),
        after: plan,
        occurredAt: context.now,
      }),
    ]),
    value: plan.id,
  };
}

/** What a plan promises to repay in total, or null when there is no plan. */
export function plannedRepaymentTotal(document: StoreDocument, debtId: string): number | null {
  const plan = document.repaymentPlans.find((candidate) => candidate.debtId === debtId);
  return plan === undefined ? null : plannedTotalMinor(plan);
}

// ---------------------------------------------------------------------------
// Writing checks
// ---------------------------------------------------------------------------

export interface AddCheckInput {
  readonly debtId: string;
  readonly accountId: string;
  readonly checkNumber: string | null;
  readonly amountMinor: number;
  readonly dueDate: string;
  readonly payeeName: string;
  readonly installmentNumber: number | null;
  readonly note: string | null;
  /** Set when the check has already been handed over. */
  readonly deliveredOn: string | null;
  readonly source?: CheckSource;
  readonly importBatchId?: string | null;
  readonly replacesCheckId?: string | null;
}

export function addCheck(
  document: StoreDocument,
  input: AddCheckInput,
  context: CommandContext,
): CommandResult<string> {
  requireDebt(document, input.debtId);
  requireAccount(document, input.accountId);

  if (input.amountMinor <= 0) {
    throw new CommandError('amount_required', 'a check must be for more than nothing');
  }
  assertNumberUnused(document, input.accountId, input.checkNumber);

  const check: PostDatedCheck = {
    id: newId(),
    householdId: document.household.id,
    debtId: input.debtId,
    accountId: input.accountId,
    checkNumber: input.checkNumber,
    amountMinor: input.amountMinor,
    currency: document.settings.currency,
    dueDate: input.dueDate,
    deliveredOn: input.deliveredOn,
    payeeName: input.payeeName.trim(),
    installmentNumber: input.installmentNumber,
    note: input.note,
    source: input.source ?? 'manual',
    // Written but not handed over is the honest default. A check recorded as
    // delivered when it is still in the chequebook overstates the exposure.
    status: input.deliveredOn === null ? 'prepared' : 'delivered',
    clearedOn: null,
    clearedTransactionId: null,
    debtEventId: null,
    returnedOn: null,
    resolutionReason: null,
    replacedByCheckId: null,
    replacesCheckId: input.replacesCheckId ?? null,
    importBatchId: input.importBatchId ?? null,
    createdBy: context.actorProfileId,
    createdAt: context.now,
    updatedAt: context.now,
    version: 1,
  };

  return {
    document: withAudit({ ...document, checks: [...document.checks, check] }, [
      checkAudit(document, context, 'check.added', null, check),
    ]),
    value: check.id,
  };
}

export interface AddCheckSeriesInput {
  readonly debtId: string;
  readonly accountId: string;
  readonly payeeName: string;
  readonly count: number;
  readonly amountPerCheckMinor: number;
  readonly finalCheckAmountMinor: number | null;
  readonly firstDueDate: string;
  readonly firstCheckNumber: string | null;
  readonly intendedTotalMinor: number | null;
  readonly note: string | null;
  /** All handed over at once, which is how a gemach usually takes them. */
  readonly deliveredOn: string | null;
}

/**
 * What a series would be, without creating it.
 *
 * Exposed so the screen can show the family the dates, the last one and the total
 * before anything is written down. Twelve checks entered blind is twelve chances
 * to be wrong about a year of payments.
 */
export function previewCheckSeries(input: AddCheckSeriesInput): CheckSeriesPlan {
  return planCheckSeries({
    count: input.count,
    amountPerCheckMinor: input.amountPerCheckMinor,
    finalCheckAmountMinor: input.finalCheckAmountMinor,
    firstDueDate: input.firstDueDate,
    firstCheckNumber: input.firstCheckNumber,
    intendedTotalMinor: input.intendedTotalMinor,
  });
}

export function addCheckSeries(
  document: StoreDocument,
  input: AddCheckSeriesInput,
  context: CommandContext,
): CommandResult<readonly string[]> {
  requireDebt(document, input.debtId);
  requireAccount(document, input.accountId);

  if (input.amountPerCheckMinor <= 0) {
    throw new CommandError('amount_required', 'a check must be for more than nothing');
  }

  const plan = previewCheckSeries(input);

  let working = document;
  const created: string[] = [];

  for (const planned of plan.checks) {
    const outcome = addCheck(
      working,
      {
        debtId: input.debtId,
        accountId: input.accountId,
        checkNumber: planned.checkNumber,
        amountMinor: planned.amountMinor,
        dueDate: planned.dueDate,
        payeeName: input.payeeName,
        installmentNumber: planned.installmentNumber,
        note: input.note,
        deliveredOn: input.deliveredOn,
      },
      context,
    );
    working = outcome.document;
    created.push(outcome.value);
  }

  return { document: working, value: created };
}

// ---------------------------------------------------------------------------
// Handing them over — the operation that must change no figure
// ---------------------------------------------------------------------------

export interface DeliverChecksInput {
  readonly checkIds: readonly string[];
  readonly deliveredOn: string;
}

/**
 * Records that checks were handed to the gemach.
 *
 * Writes a date and a status. That is the entire effect, and it is the point:
 * the household's cash is unchanged, the debt is unchanged, and what changed is
 * that somebody else can now present these. The screens carry that difference;
 * this function must not blur it by touching a balance.
 */
export function deliverChecks(
  document: StoreDocument,
  input: DeliverChecksInput,
  context: CommandContext,
): CommandResult<number> {
  let working = document;
  const entries = [];

  for (const checkId of input.checkIds) {
    const before = requireCheck(working, checkId);

    if (before.status === 'delivered') continue;
    if (!canTransition(before.status, 'delivered')) {
      throw new CommandError(
        'check_transition_not_allowed',
        `a ${before.status} check cannot be handed over`,
      );
    }

    const after = updated(
      { ...before, status: 'delivered' as CheckStatus, deliveredOn: input.deliveredOn },
      context.now,
    );
    working = replaceCheckIn(working, after);
    entries.push(checkAudit(document, context, 'check.delivered', before, after));
  }

  return { document: withAudit(working, entries), value: entries.length };
}

export interface MarkDepositedInput {
  readonly checkId: string;
}

/**
 * The gemach has put it in. Still not money: the bank has not answered yet.
 *
 * A check that bounced can be presented again, by agreement, and that is the one
 * case where this does more than change a status: the record goes back into play,
 * so the marks left by the bounce come off it. The bounce is not lost — it is in
 * the audit trail, which is where history belongs. Leaving a returned date on a
 * check that is currently at the bank would be a record contradicting itself.
 */
export function markCheckDeposited(
  document: StoreDocument,
  input: MarkDepositedInput,
  context: CommandContext,
): CommandResult<void> {
  const before = requireCheck(document, input.checkId);
  if (!canTransition(before.status, 'deposited')) {
    throw new CommandError(
      'check_transition_not_allowed',
      `a ${before.status} check cannot be recorded as deposited`,
    );
  }

  const representing = before.status === 'returned';

  const after = updated(
    {
      ...before,
      status: 'deposited' as CheckStatus,
      returnedOn: representing ? null : before.returnedOn,
      resolutionReason: representing ? null : before.resolutionReason,
    },
    context.now,
  );
  return {
    document: withAudit(replaceCheckIn(document, after), [
      checkAudit(
        document,
        context,
        representing ? 'check.represented' : 'check.deposited',
        before,
        after,
      ),
    ]),
    value: undefined,
  };
}

// ---------------------------------------------------------------------------
// Clearing — the only operation that moves money
// ---------------------------------------------------------------------------

export interface ClearCheckInput {
  readonly checkId: string;
  readonly clearedOn: string;
  /** The cash movement, when the import already created one to link to. */
  readonly transactionId?: string | null;
  readonly importBatchId?: string | null;
  readonly note?: string | null;
}

export interface ClearCheckOutcome {
  readonly transactionId: string;
  readonly debtEventId: string;
}

/**
 * The bank honoured the check.
 *
 * Now, and only now, three things happen together: the money leaves the account,
 * the principal comes down by the same amount, and the check records both links.
 * They are written in one command so that no failure can leave a household with a
 * smaller debt and the same balance, or the reverse.
 *
 * Interest is not a consideration here. A gemach lends without it, and if a debt
 * ever did carry interest the repayment would be recorded through the ordinary
 * debt-payment path where principal and interest are separated. A check clears
 * for its face value against the principal, which is what the paper says.
 */
export function clearCheck(
  document: StoreDocument,
  input: ClearCheckInput,
  context: CommandContext,
): CommandResult<ClearCheckOutcome> {
  const before = requireCheck(document, input.checkId);

  if (before.status === 'cleared') {
    // Not a silent success. A caller asking twice has lost track of something,
    // and answering "fine" would be how the same debit becomes two repayments.
    throw new CommandError('check_already_cleared', 'this check has already been cleared');
  }
  if (!canTransition(before.status, 'cleared')) {
    throw new CommandError(
      'check_transition_not_allowed',
      `a ${before.status} check cannot clear`,
    );
  }

  let working = document;
  let transactionId = input.transactionId ?? null;

  if (transactionId === null) {
    const paid = recordTransaction(
      working,
      {
        accountId: before.accountId,
        counterpartAccountId: null,
        scope: 'household',
        kind: 'expense',
        direction: 'outflow',
        amountMinor: before.amountMinor,
        categoryId: null,
        merchant: before.payeeName,
        transactionDate: input.clearedOn,
        note: input.note ?? null,
        status: 'confirmed',
        importBatchId: input.importBatchId ?? null,
      },
      context,
    );
    working = paid.document;
    transactionId = paid.value;
  }

  const repayment = recordDebtEvent(
    working,
    {
      debtId: before.debtId,
      kind: 'principal_payment',
      amountMinor: before.amountMinor,
      occurredOn: input.clearedOn,
      correctionEffect: null,
      transactionId,
      note: input.note ?? null,
      importBatchId: input.importBatchId ?? null,
    },
    context,
  );
  working = repayment.document;

  const after = updated(
    {
      ...before,
      status: 'cleared' as CheckStatus,
      clearedOn: input.clearedOn,
      clearedTransactionId: transactionId,
      debtEventId: repayment.value,
      importBatchId: input.importBatchId ?? before.importBatchId,
      // A check the bank honoured was, self-evidently, handed over. A record that
      // missed the delivery step would otherwise fail its own invariant.
      deliveredOn: before.deliveredOn ?? input.clearedOn,
    },
    context.now,
  );

  return {
    document: withAudit(replaceCheckIn(working, after), [
      checkAudit(document, context, 'check.cleared', before, after),
    ]),
    value: { transactionId, debtEventId: repayment.value },
  };
}

// ---------------------------------------------------------------------------
// The unhappy paths
// ---------------------------------------------------------------------------

export interface ResolveCheckInput {
  readonly checkId: string;
  readonly occurredOn: string;
  readonly reason: string;
}

/**
 * The bank refused it.
 *
 * No money moved and the debt is unchanged — a returned check is not a repayment
 * and must never be mistaken for one. It leaves the exposure total, because it
 * will not clear as it stands, and appears in its own list because it needs a
 * conversation with the gemach rather than a calculation.
 */
export function markCheckReturned(
  document: StoreDocument,
  input: ResolveCheckInput,
  context: CommandContext,
): CommandResult<void> {
  const before = requireCheck(document, input.checkId);
  if (!canTransition(before.status, 'returned')) {
    throw new CommandError(
      'check_transition_not_allowed',
      `a ${before.status} check cannot be returned`,
    );
  }
  if (input.reason.trim() === '') {
    throw new CommandError('reason_required', 'a returned check needs a reason on the record');
  }

  const after = updated(
    {
      ...before,
      status: 'returned' as CheckStatus,
      returnedOn: input.occurredOn,
      resolutionReason: input.reason.trim(),
    },
    context.now,
  );

  return {
    document: withAudit(replaceCheckIn(document, after), [
      checkAudit(document, context, 'check.returned', before, after),
    ]),
    value: undefined,
  };
}

export function cancelCheck(
  document: StoreDocument,
  input: ResolveCheckInput,
  context: CommandContext,
): CommandResult<void> {
  const before = requireCheck(document, input.checkId);
  if (!canTransition(before.status, 'cancelled')) {
    throw new CommandError(
      'check_transition_not_allowed',
      `a ${before.status} check cannot be cancelled`,
    );
  }
  if (input.reason.trim() === '') {
    throw new CommandError(
      'reason_required',
      'cancelling a check needs a reason on the record',
    );
  }

  const after = updated(
    {
      ...before,
      status: 'cancelled' as CheckStatus,
      resolutionReason: input.reason.trim(),
    },
    context.now,
  );

  return {
    document: withAudit(replaceCheckIn(document, after), [
      checkAudit(document, context, 'check.cancelled', before, after),
    ]),
    value: undefined,
  };
}

export interface ReplaceCheckInput {
  readonly checkId: string;
  readonly reason: string;
  /** The replacement. Its amount and date may legitimately differ. */
  readonly checkNumber: string | null;
  readonly amountMinor: number;
  readonly dueDate: string;
  readonly note: string | null;
  readonly deliveredOn: string | null;
}

/**
 * Swaps one check for another, keeping the link in both directions.
 *
 * A replacement is not a new obligation, and the old check is not cancelled into
 * thin air. Both records survive and each names the other, so a year later the
 * question "what happened to check 1042?" has an answer instead of a gap.
 */
export function replaceCheck(
  document: StoreDocument,
  input: ReplaceCheckInput,
  context: CommandContext,
): CommandResult<string> {
  const before = requireCheck(document, input.checkId);
  if (!canTransition(before.status, 'replaced')) {
    throw new CommandError(
      'check_transition_not_allowed',
      `a ${before.status} check cannot be replaced`,
    );
  }
  if (input.reason.trim() === '') {
    throw new CommandError('reason_required', 'replacing a check needs a reason on the record');
  }

  const created = addCheck(
    document,
    {
      debtId: before.debtId,
      accountId: before.accountId,
      checkNumber: input.checkNumber,
      amountMinor: input.amountMinor,
      dueDate: input.dueDate,
      payeeName: before.payeeName,
      installmentNumber: before.installmentNumber,
      note: input.note,
      deliveredOn: input.deliveredOn,
      replacesCheckId: before.id,
    },
    context,
  );

  const after = updated(
    {
      ...before,
      status: 'replaced' as CheckStatus,
      replacedByCheckId: created.value,
      resolutionReason: input.reason.trim(),
    },
    context.now,
  );

  return {
    document: withAudit(replaceCheckIn(created.document, after), [
      checkAudit(document, context, 'check.replaced', before, after),
    ]),
    value: created.value,
  };
}

// ---------------------------------------------------------------------------
// Undoing a mistake
// ---------------------------------------------------------------------------

export interface RevertCheckInput {
  readonly checkId: string;
  readonly reason: string;
  readonly occurredOn: string;
}

/**
 * Takes a check back to where it was before somebody was wrong about it.
 *
 * Marking a check cleared by mistake is easy — the bank statement is read
 * quickly, and one row looks much like another. Undoing it has to restore *both*
 * halves: the money must come back and the debt must go back up, or the
 * correction leaves the household with a balance that does not match its own
 * ledger.
 *
 * So the cash movement is voided rather than deleted, and the repayment is
 * cancelled by an opposing `new_principal` event rather than removed. History
 * says what happened and then says it was corrected, which is what an audit
 * trail is for; a history that can be edited proves nothing.
 */
export function revertCheckStatus(
  document: StoreDocument,
  input: RevertCheckInput,
  context: CommandContext,
): CommandResult<CheckStatus> {
  const before = requireCheck(document, input.checkId);

  if (input.reason.trim() === '') {
    throw new CommandError('reason_required', 'a correction needs a reason on the record');
  }

  let working = document;
  let restored: CheckStatus;

  if (before.status === 'cleared') {
    if (before.clearedTransactionId !== null) {
      working = {
        ...working,
        transactions: working.transactions.map((transaction) =>
          transaction.id === before.clearedTransactionId
            ? {
                ...transaction,
                status: 'void' as const,
                note: input.reason.trim(),
                updatedAt: context.now,
                version: transaction.version + 1,
              }
            : transaction,
        ),
      };
    }

    // The repayment is undone by its opposite, so the debt returns to what it
    // was without either event being erased.
    const reversal = recordDebtEvent(
      working,
      {
        debtId: before.debtId,
        kind: 'new_principal',
        amountMinor: before.amountMinor,
        occurredOn: input.occurredOn,
        correctionEffect: null,
        transactionId: null,
        note: input.reason.trim(),
      },
      context,
    );
    working = reversal.document;

    // Back to where it stood before the bank was believed to have paid it.
    restored = before.deliveredOn === null ? 'prepared' : 'delivered';
  } else if (before.status === 'returned' || before.status === 'deposited') {
    restored = before.deliveredOn === null ? 'prepared' : 'delivered';
  } else if (before.status === 'cancelled') {
    restored = before.deliveredOn === null ? 'prepared' : 'delivered';
  } else if (before.status === 'delivered') {
    restored = 'prepared';
  } else {
    throw new CommandError(
      'check_cannot_be_reverted',
      `a ${before.status} check cannot be corrected this way`,
    );
  }

  const after = updated(
    {
      ...before,
      status: restored,
      clearedOn: null,
      clearedTransactionId: null,
      debtEventId: null,
      returnedOn: null,
      resolutionReason: input.reason.trim(),
      deliveredOn: restored === 'prepared' ? null : before.deliveredOn,
    },
    context.now,
  );

  return {
    document: withAudit(replaceCheckIn(working, after), [
      checkAudit(document, context, 'check.corrected', before, after),
    ]),
    value: restored,
  };
}

export interface CloseLoanInput {
  readonly debtId: string;
}

export interface CloseLoanBlockers {
  readonly outstandingBalanceMinor: number;
  readonly unresolvedCheckCount: number;
  readonly canClose: boolean;
}

/**
 * Whether a gemach loan may be closed, and what is in the way.
 *
 * Two conditions, and both are about truth rather than tidiness. A debt with a
 * balance is not repaid, however much the family would like the row gone. A debt
 * with checks still outstanding is worse: the paper is in somebody's drawer and
 * closing the loan would take it off every screen that warns about it, which is
 * how a closed loan bounces a check three months later.
 */
export function closeLoanBlockers(document: StoreDocument, debtId: string): CloseLoanBlockers {
  const balance = document.debtEvents
    .filter((event) => event.debtId === debtId)
    .reduce((total, event) => {
      if (event.kind === 'opening_balance' || event.kind === 'new_principal') {
        return total + event.amountMinor;
      }
      if (event.kind === 'principal_payment' || event.kind === 'write_off') {
        return total - event.amountMinor;
      }
      if (event.kind === 'balance_correction') {
        return event.correctionEffect === 'increase'
          ? total + event.amountMinor
          : total - event.amountMinor;
      }
      if (event.kind === 'interest_charge' || event.kind === 'fee_charge') {
        return total + event.amountMinor;
      }
      return total;
    }, 0);

  const unresolved = document.checks.filter(
    (check) => check.debtId === debtId && OUTSTANDING_CHECK_STATUSES.includes(check.status),
  ).length;

  return {
    outstandingBalanceMinor: balance,
    unresolvedCheckCount: unresolved,
    canClose: balance === 0 && unresolved === 0,
  };
}

/** Closes the loan, and refuses when the figures do not permit it. */
export function closeLoan(
  document: StoreDocument,
  input: CloseLoanInput,
  context: CommandContext,
): CommandResult<void> {
  const debt = requireDebt(document, input.debtId);
  const blockers = closeLoanBlockers(document, input.debtId);

  if (!blockers.canClose) {
    throw new CommandError(
      'debt_not_closable',
      blockers.unresolvedCheckCount > 0
        ? 'there are still checks outstanding on this loan'
        : 'this loan still has a balance',
    );
  }

  const after = {
    ...debt,
    status: 'settled' as const,
    closedAt: context.now,
    updatedAt: context.now,
    version: debt.version + 1,
  };

  return {
    document: withAudit(
      {
        ...document,
        debts: document.debts.map((candidate) =>
          candidate.id === debt.id ? after : candidate,
        ),
      },
      [
        auditEvent({
          householdId: document.household.id,
          actorProfileId: context.actorProfileId,
          action: 'debt.closed',
          entityType: 'debt',
          entityId: debt.id,
          before: debt,
          after,
          occurredAt: context.now,
        }),
      ],
    ),
    value: undefined,
  };
}

/** Every check written against one debt, newest due date last. */
export function checksForDebt(document: StoreDocument, debtId: string): PostDatedCheck[] {
  return document.checks
    .filter((check) => check.debtId === debtId)
    .sort(
      (a, b) =>
        a.dueDate.localeCompare(b.dueDate) ||
        (a.installmentNumber ?? 0) - (b.installmentNumber ?? 0),
    );
}
