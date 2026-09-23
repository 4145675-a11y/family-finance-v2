import {
  BUDGET_CATEGORY_KEYS,
  WEEKLY_GUIDED_CATEGORY,
  type AccountKind,
  type BudgetCategoryKey,
  type Certainty,
  type DebtEventKind,
  type DebtKind,
  type DebtUrgency,
  type Direction,
  type DueDate,
  type RecordScope,
  type RelationshipSensitivity,
  type TransactionKind,
  type TransactionStatus,
} from '@family-finance/contracts';

import { auditEvent, withAudit } from './audit';
import type { StoreDocument, StoredTransaction } from './document';

/**
 * Every change the product can make to the household's truth.
 *
 * Each command is a pure function: document in, document out, plus the audit
 * entries the change earned. Nothing here touches a file, which is what makes the
 * whole set testable without a filesystem, and what lets `FileStore.mutate` decide
 * on its own terms whether a change is written.
 *
 * Two rules run through all of them. Money is never deleted — a mistake becomes a
 * void or a correction, so the history stays readable. And every command that
 * changes a financial fact writes an audit entry naming what changed, because
 * "why is this number different from yesterday" has to have an answer.
 */

export interface CommandContext {
  readonly actorProfileId: string;
  /** The instant to stamp on everything this command writes. */
  readonly now: string;
}

export interface CommandResult<T = void> {
  readonly document: StoreDocument;
  readonly value: T;
}

export class CommandError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'CommandError';
    this.code = code;
  }
}

const newId = (): string => crypto.randomUUID();

function requireAccount(document: StoreDocument, accountId: string) {
  const account = document.accounts.find((candidate) => candidate.id === accountId);
  if (account === undefined) {
    throw new CommandError('unknown_account', `no account with id ${accountId}`);
  }
  return account;
}

function requireDebt(document: StoreDocument, debtId: string) {
  const debt = document.debts.find((candidate) => candidate.id === debtId);
  if (debt === undefined) {
    throw new CommandError('unknown_debt', `no debt with id ${debtId}`);
  }
  return debt;
}

// ---------------------------------------------------------------------------
// Household, members and settings
// ---------------------------------------------------------------------------

export interface RenameHouseholdInput {
  readonly name: string;
}

export function renameHousehold(
  document: StoreDocument,
  input: RenameHouseholdInput,
  context: CommandContext,
): CommandResult {
  const before = document.household;
  const household = {
    ...before,
    name: input.name.trim(),
    updatedAt: context.now,
    version: before.version + 1,
  };

  return {
    document: withAudit(
      { ...document, household, setup: { ...document.setup, householdNamed: true } },
      [
        auditEvent({
          householdId: household.id,
          actorProfileId: context.actorProfileId,
          action: 'household.renamed',
          entityType: 'household',
          entityId: household.id,
          before,
          after: household,
          occurredAt: context.now,
        }),
      ],
    ),
    value: undefined,
  };
}

export interface AddMemberInput {
  readonly displayName: string;
}

export function addMember(
  document: StoreDocument,
  input: AddMemberInput,
  context: CommandContext,
): CommandResult<string> {
  const profileId = newId();
  const profile = {
    id: profileId,
    displayName: input.displayName.trim(),
    locale: 'he-IL' as const,
    timeZone: document.settings.timeZone,
    createdAt: context.now,
    updatedAt: context.now,
    version: 1,
  };

  const member = {
    id: newId(),
    householdId: document.household.id,
    profileId,
    status: 'active' as const,
    invitedBy: context.actorProfileId,
    joinedAt: context.now,
    revokedAt: null,
    version: 1,
  };

  return {
    document: withAudit(
      {
        ...document,
        profiles: [...document.profiles, profile],
        members: [...document.members, member],
        setup: { ...document.setup, membersAdded: true },
      },
      [
        auditEvent({
          householdId: document.household.id,
          actorProfileId: context.actorProfileId,
          action: 'member.added',
          entityType: 'profile',
          entityId: profileId,
          after: profile,
          occurredAt: context.now,
        }),
      ],
    ),
    value: profileId,
  };
}

export interface UpdateSettingsInput {
  readonly monthStartDay?: number;
  readonly manualReserveFloorMinor?: number | null;
  readonly incidentBufferMinor?: number | null;
  readonly revolvingAvoidanceMinor?: number | null;
  readonly protectedReservesMinor?: number;
  readonly weeklyFoodGuidance?: boolean;
  readonly balanceFreshnessReminder?: boolean;
  readonly balanceFreshnessDays?: number;
  readonly privacyExplained?: boolean;
}

export function updateSettings(
  document: StoreDocument,
  input: UpdateSettingsInput,
  context: CommandContext,
): CommandResult {
  const before = document.settings;

  const settings = {
    ...before,
    monthStartDay: input.monthStartDay ?? before.monthStartDay,
    manualReserveFloorMinor:
      input.manualReserveFloorMinor === undefined
        ? before.manualReserveFloorMinor
        : input.manualReserveFloorMinor,
    incidentBufferMinor:
      input.incidentBufferMinor === undefined
        ? before.incidentBufferMinor
        : input.incidentBufferMinor,
    revolvingAvoidanceMinor:
      input.revolvingAvoidanceMinor === undefined
        ? before.revolvingAvoidanceMinor
        : input.revolvingAvoidanceMinor,
    protectedReservesMinor: input.protectedReservesMinor ?? before.protectedReservesMinor,
    notifications: {
      weeklyFoodGuidance: input.weeklyFoodGuidance ?? before.notifications.weeklyFoodGuidance,
      balanceFreshnessReminder:
        input.balanceFreshnessReminder ?? before.notifications.balanceFreshnessReminder,
      balanceFreshnessDays:
        input.balanceFreshnessDays ?? before.notifications.balanceFreshnessDays,
    },
    updatedAt: context.now,
    version: before.version + 1,
  };

  const setup =
    input.privacyExplained === undefined
      ? document.setup
      : { ...document.setup, privacyExplained: input.privacyExplained };

  return {
    document: withAudit({ ...document, settings, setup }, [
      auditEvent({
        householdId: document.household.id,
        actorProfileId: context.actorProfileId,
        action: 'settings.updated',
        entityType: 'settings',
        entityId: null,
        before,
        after: settings,
        occurredAt: context.now,
      }),
    ]),
    value: undefined,
  };
}

// ---------------------------------------------------------------------------
// Accounts and balances
// ---------------------------------------------------------------------------

export interface AddAccountInput {
  readonly name: string;
  readonly kind: AccountKind;
  readonly scope: RecordScope;
  readonly institution: string | null;
  readonly displaySuffix: string | null;
  readonly openingBalanceMinor: number;
  readonly openingBalanceDirection: Direction;
  readonly openingBalanceDate: string;
}

export function addAccount(
  document: StoreDocument,
  input: AddAccountInput,
  context: CommandContext,
): CommandResult<string> {
  const business = input.scope === 'business' ? document.businesses[0] : undefined;
  if (input.scope === 'business' && business === undefined) {
    throw new CommandError('no_business', 'a business account needs a business to belong to');
  }

  const account = {
    id: newId(),
    householdId: document.household.id,
    businessId: business?.id ?? null,
    scope: input.scope,
    kind: input.kind,
    name: input.name.trim(),
    institution: input.institution,
    currency: document.settings.currency,
    displaySuffix: input.displaySuffix,
    openingBalanceMinor: input.openingBalanceMinor,
    openingBalanceDirection: input.openingBalanceDirection,
    openingBalanceDate: input.openingBalanceDate,
    closedAt: null,
    createdAt: context.now,
    updatedAt: context.now,
    version: 1,
  };

  return {
    document: withAudit(
      {
        ...document,
        accounts: [...document.accounts, account],
        setup: { ...document.setup, accountsAdded: true },
      },
      [
        auditEvent({
          householdId: document.household.id,
          actorProfileId: context.actorProfileId,
          action: 'account.added',
          entityType: 'account',
          entityId: account.id,
          after: account,
          occurredAt: context.now,
        }),
      ],
    ),
    value: account.id,
  };
}

export interface CloseAccountInput {
  readonly accountId: string;
}

/**
 * Closing an account.
 *
 * Not a delete. The transactions that happened on it are history, and a household
 * that closed a card in March still needs March to add up.
 */
export function closeAccount(
  document: StoreDocument,
  input: CloseAccountInput,
  context: CommandContext,
): CommandResult {
  const before = requireAccount(document, input.accountId);
  const account = {
    ...before,
    closedAt: context.now,
    updatedAt: context.now,
    version: before.version + 1,
  };

  return {
    document: withAudit(
      {
        ...document,
        accounts: document.accounts.map((candidate) =>
          candidate.id === account.id ? account : candidate,
        ),
      },
      [
        auditEvent({
          householdId: document.household.id,
          actorProfileId: context.actorProfileId,
          action: 'account.closed',
          entityType: 'account',
          entityId: account.id,
          before,
          after: account,
          occurredAt: context.now,
        }),
      ],
    ),
    value: undefined,
  };
}

export interface RecordBalanceInput {
  readonly accountId: string;
  readonly balanceMinor: number;
  readonly balanceDirection: Direction;
  readonly verifiedAt: string;
  readonly source: 'manual_entry' | 'statement' | 'import';
  readonly note: string | null;
  readonly importBatchId?: string | null;
}

/**
 * Confirming what an account really holds.
 *
 * This is the freshness signal the whole dashboard leans on, and it is also the
 * reconciliation point: the difference between what our records say and what the
 * bank says becomes visible here. It is not absorbed —
 * 05-ARCHITECTURE-DATA.md § Reconciliation forbids that — it is left for the
 * family to close with `acceptReconciliationGap`, which records the correction as
 * a correction.
 */
export function recordBalance(
  document: StoreDocument,
  input: RecordBalanceInput,
  context: CommandContext,
): CommandResult<string> {
  requireAccount(document, input.accountId);

  const snapshot = {
    id: newId(),
    householdId: document.household.id,
    accountId: input.accountId,
    balanceMinor: input.balanceMinor,
    balanceDirection: input.balanceDirection,
    verifiedAt: input.verifiedAt,
    source: input.source,
    note: input.note,
    createdBy: context.actorProfileId,
    createdAt: context.now,
    importBatchId: input.importBatchId ?? null,
  };

  return {
    document: withAudit(
      {
        ...document,
        balanceSnapshots: [...document.balanceSnapshots, snapshot],
        setup: { ...document.setup, balancesConfirmed: true },
      },
      [
        auditEvent({
          householdId: document.household.id,
          actorProfileId: context.actorProfileId,
          action: 'balance.confirmed',
          entityType: 'balance_snapshot',
          entityId: snapshot.id,
          after: snapshot,
          occurredAt: context.now,
        }),
      ],
    ),
    value: snapshot.id,
  };
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

export interface RecordTransactionInput {
  readonly accountId: string;
  readonly counterpartAccountId: string | null;
  readonly scope: RecordScope;
  readonly kind: TransactionKind;
  readonly direction: Direction;
  readonly amountMinor: number;
  readonly categoryId: string | null;
  readonly merchant: string | null;
  readonly transactionDate: string;
  readonly postingDate?: string | null;
  readonly note: string | null;
  readonly status?: TransactionStatus;
  readonly importBatchId?: string | null;
  readonly importProposalId?: string | null;
  readonly sourceFingerprint?: string | null;
  readonly refundsTransactionId?: string | null;
}

export function recordTransaction(
  document: StoreDocument,
  input: RecordTransactionInput,
  context: CommandContext,
): CommandResult<string> {
  requireAccount(document, input.accountId);
  if (input.counterpartAccountId !== null) requireAccount(document, input.counterpartAccountId);

  const isTransferLike = input.kind === 'transfer' || input.kind === 'settlement';
  if (isTransferLike && input.counterpartAccountId === null) {
    throw new CommandError(
      'transfer_needs_counterpart',
      'a transfer or a card settlement has two sides, and both must be named',
    );
  }
  if (!isTransferLike && input.counterpartAccountId !== null) {
    throw new CommandError(
      'counterpart_not_allowed',
      'only a transfer or a settlement has a second account',
    );
  }
  if (input.amountMinor <= 0) {
    throw new CommandError('amount_required', 'an amount must be greater than zero');
  }

  const transaction: StoredTransaction = {
    id: newId(),
    householdId: document.household.id,
    accountId: input.accountId,
    counterpartAccountId: input.counterpartAccountId,
    scope: input.scope,
    kind: input.kind,
    direction: input.direction,
    amountMinor: input.amountMinor,
    currency: document.settings.currency,
    status: input.status ?? 'confirmed',
    categoryId: input.categoryId,
    merchant: input.merchant,
    transactionDate: input.transactionDate,
    postingDate: input.postingDate ?? null,
    valueDate: null,
    refundsTransactionId: input.refundsTransactionId ?? null,
    correctsTransactionId: null,
    note: input.note,
    createdBy: context.actorProfileId,
    createdAt: context.now,
    updatedAt: context.now,
    version: 1,
    importBatchId: input.importBatchId ?? null,
    importProposalId: input.importProposalId ?? null,
    sourceFingerprint: input.sourceFingerprint ?? null,
  };

  return {
    document: withAudit(
      { ...document, transactions: [...document.transactions, transaction] },
      [
        auditEvent({
          householdId: document.household.id,
          actorProfileId: context.actorProfileId,
          action: 'transaction.recorded',
          entityType: 'transaction',
          entityId: transaction.id,
          after: transaction,
          occurredAt: context.now,
        }),
      ],
    ),
    value: transaction.id,
  };
}

export interface VoidTransactionInput {
  readonly transactionId: string;
  readonly reason: string;
}

/**
 * Undoing a transaction without deleting it.
 *
 * 02-FINANCIAL-RULES.md § אינווריאנטים: "כספים לא נמחקים; void/correction".
 * A voided row stays visible in the activity list, marked, so a family can see
 * that something was entered and taken back rather than finding a gap.
 */
export function voidTransaction(
  document: StoreDocument,
  input: VoidTransactionInput,
  context: CommandContext,
): CommandResult {
  const before = document.transactions.find(
    (candidate) => candidate.id === input.transactionId,
  );
  if (before === undefined) {
    throw new CommandError('unknown_transaction', 'that record does not exist');
  }
  if (before.status === 'void') return { document, value: undefined };

  const transaction: StoredTransaction = {
    ...before,
    status: 'void',
    note: input.reason.trim().length > 0 ? input.reason.trim().slice(0, 500) : before.note,
    updatedAt: context.now,
    version: before.version + 1,
  };

  return {
    document: withAudit(
      {
        ...document,
        transactions: document.transactions.map((candidate) =>
          candidate.id === transaction.id ? transaction : candidate,
        ),
      },
      [
        auditEvent({
          householdId: document.household.id,
          actorProfileId: context.actorProfileId,
          action: 'transaction.voided',
          entityType: 'transaction',
          entityId: transaction.id,
          before,
          after: transaction,
          occurredAt: context.now,
        }),
      ],
    ),
    value: undefined,
  };
}

export interface AcceptGapInput {
  readonly accountId: string;
  readonly differenceMinor: number;
  readonly direction: Direction;
  readonly asOfDate: string;
}

/**
 * Closing a reconciliation difference, on purpose.
 *
 * The difference becomes a `correction` transaction with a note saying what it
 * is. It is not a "miscellaneous expense": a correction is excluded from spending
 * analysis and shown separately, because a family that reconciles a 40 ₪ gap has
 * not spent 40 ₪ on anything.
 */
export function acceptReconciliationGap(
  document: StoreDocument,
  input: AcceptGapInput,
  context: CommandContext,
): CommandResult<string> {
  requireAccount(document, input.accountId);
  if (input.differenceMinor <= 0) {
    throw new CommandError('nothing_to_reconcile', 'there is no difference to close');
  }

  return recordTransaction(
    document,
    {
      accountId: input.accountId,
      counterpartAccountId: null,
      scope: 'household',
      kind: 'correction',
      direction: input.direction,
      amountMinor: input.differenceMinor,
      categoryId: null,
      merchant: null,
      transactionDate: input.asOfDate,
      note: 'התאמה ליתרה שאושרה מול הבנק',
      status: 'confirmed',
    },
    context,
  );
}

// ---------------------------------------------------------------------------
// Expected money in and out
// ---------------------------------------------------------------------------

export interface AddPlannedItemInput {
  readonly label: string;
  readonly scope: RecordScope;
  readonly direction: Direction;
  readonly amountMinor: number;
  readonly certainty: Certainty;
  readonly expectedDate: string;
  readonly dueDate: string | null;
  readonly essential: boolean;
  readonly categoryId: string | null;
  readonly accountId: string | null;
  readonly importBatchId?: string | null;
}

export function addPlannedItem(
  document: StoreDocument,
  input: AddPlannedItemInput,
  context: CommandContext,
): CommandResult<string> {
  const item = {
    id: newId(),
    householdId: document.household.id,
    scope: input.scope,
    accountId: input.accountId,
    direction: input.direction,
    amountMinor: input.amountMinor,
    currency: document.settings.currency,
    label: input.label.trim(),
    categoryId: input.categoryId,
    certainty: input.certainty,
    expectedDate: input.expectedDate,
    dueDate: input.dueDate,
    essential: input.essential,
    settledTransactionId: null,
    createdBy: context.actorProfileId,
    createdAt: context.now,
    updatedAt: context.now,
    version: 1,
    importBatchId: input.importBatchId ?? null,
  };

  const setup = {
    ...document.setup,
    recurringIncomeRecorded:
      document.setup.recurringIncomeRecorded || input.direction === 'inflow',
    recurringObligationsRecorded:
      document.setup.recurringObligationsRecorded || input.direction === 'outflow',
  };

  return {
    document: withAudit(
      { ...document, cashflowItems: [...document.cashflowItems, item], setup },
      [
        auditEvent({
          householdId: document.household.id,
          actorProfileId: context.actorProfileId,
          action: 'planned_item.added',
          entityType: 'cashflow_item',
          entityId: item.id,
          after: item,
          occurredAt: context.now,
        }),
      ],
    ),
    value: item.id,
  };
}

export interface SettlePlannedItemInput {
  readonly itemId: string;
  readonly transactionId: string;
}

/**
 * Marking an expected movement as having happened.
 *
 * The forecast walks unsettled items only. Without this step a bill that has been
 * paid keeps being counted as still to pay, and the family is told they owe money
 * they have already sent — the single most common way a forecast lies.
 */
export function settlePlannedItem(
  document: StoreDocument,
  input: SettlePlannedItemInput,
  context: CommandContext,
): CommandResult {
  const before = document.cashflowItems.find((candidate) => candidate.id === input.itemId);
  if (before === undefined) {
    throw new CommandError('unknown_planned_item', 'that expected item does not exist');
  }

  const item = {
    ...before,
    settledTransactionId: input.transactionId,
    updatedAt: context.now,
    version: before.version + 1,
  };

  return {
    document: withAudit(
      {
        ...document,
        cashflowItems: document.cashflowItems.map((candidate) =>
          candidate.id === item.id ? item : candidate,
        ),
      },
      [
        auditEvent({
          householdId: document.household.id,
          actorProfileId: context.actorProfileId,
          action: 'planned_item.settled',
          entityType: 'cashflow_item',
          entityId: item.id,
          before,
          after: item,
          occurredAt: context.now,
        }),
      ],
    ),
    value: undefined,
  };
}

export interface RemovePlannedItemInput {
  readonly itemId: string;
}

export function removePlannedItem(
  document: StoreDocument,
  input: RemovePlannedItemInput,
  context: CommandContext,
): CommandResult {
  const before = document.cashflowItems.find((candidate) => candidate.id === input.itemId);
  if (before === undefined) return { document, value: undefined };

  return {
    document: withAudit(
      {
        ...document,
        cashflowItems: document.cashflowItems.filter((candidate) => candidate.id !== before.id),
      },
      [
        auditEvent({
          householdId: document.household.id,
          actorProfileId: context.actorProfileId,
          action: 'planned_item.removed',
          entityType: 'cashflow_item',
          entityId: before.id,
          before,
          occurredAt: context.now,
        }),
      ],
    ),
    value: undefined,
  };
}

// ---------------------------------------------------------------------------
// Debts
// ---------------------------------------------------------------------------

export interface AddDebtInput {
  readonly creditorName: string;
  readonly kind: DebtKind;
  readonly openingBalanceMinor: number;
  readonly openedOn: string;
  readonly effectiveAnnualRateBp: number | null;
  readonly minimumPaymentMinor: number | null;
  readonly paymentDueDay: number | null;
  readonly urgency: DebtUrgency;
  readonly promiseSummary: string | null;
  readonly relationshipSensitivity: RelationshipSensitivity | null;
  readonly partialPaymentAllowed: boolean | null;
  readonly expectedCallDate: string | null;
  readonly notes: string | null;
  /** When the payment falls due, in whichever calendar the family wrote it. */
  readonly dueDate?: DueDate;
  /**
   * The import this debt came from, recorded on its opening balance.
   *
   * It is what makes the debt reversible: `reverseBatch` removes exactly the
   * events a batch created, so an import that turns out to be wrong can be
   * undone without touching anything a person entered by hand.
   */
  readonly importBatchId?: string | null;
}

export function addDebt(
  document: StoreDocument,
  input: AddDebtInput,
  context: CommandContext,
): CommandResult<string> {
  const isPrivate = input.kind === 'private_person';

  const debt = {
    id: newId(),
    householdId: document.household.id,
    kind: input.kind,
    creditorName: input.creditorName.trim(),
    currency: document.settings.currency,
    status: 'active' as const,
    effectiveAnnualRateBp: input.effectiveAnnualRateBp,
    minimumPaymentMinor: input.minimumPaymentMinor,
    paymentDueDay: input.paymentDueDay,
    urgency: input.urgency,
    promiseSummary: input.promiseSummary,
    // The relationship fields belong to a private debt and only to one.
    relationshipSensitivity: isPrivate ? (input.relationshipSensitivity ?? 'low') : null,
    partialPaymentAllowed: isPrivate ? (input.partialPaymentAllowed ?? true) : null,
    lastDemandAt: null,
    lastConversationAt: null,
    expectedCallDate: input.expectedCallDate,
    ...(input.dueDate === undefined ? {} : { dueDate: input.dueDate }),
    notes: input.notes,
    openedOn: input.openedOn,
    closedAt: null,
    createdBy: context.actorProfileId,
    createdAt: context.now,
    updatedAt: context.now,
    version: 1,
  };

  const opening = {
    id: newId(),
    householdId: document.household.id,
    debtId: debt.id,
    kind: 'opening_balance' as const,
    amountMinor: input.openingBalanceMinor,
    currency: document.settings.currency,
    occurredOn: input.openedOn,
    correctionEffect: null,
    transactionId: null,
    note: null,
    createdBy: context.actorProfileId,
    createdAt: context.now,
    importBatchId: input.importBatchId ?? null,
  };

  return {
    document: withAudit(
      {
        ...document,
        debts: [...document.debts, debt],
        debtEvents: [...document.debtEvents, opening],
        setup: { ...document.setup, debtsRecorded: true },
      },
      [
        auditEvent({
          householdId: document.household.id,
          actorProfileId: context.actorProfileId,
          action: 'debt.added',
          entityType: 'debt',
          entityId: debt.id,
          after: debt,
          occurredAt: context.now,
        }),
      ],
    ),
    value: debt.id,
  };
}

export interface RecordDebtEventInput {
  readonly debtId: string;
  readonly kind: DebtEventKind;
  readonly amountMinor: number;
  readonly occurredOn: string;
  readonly correctionEffect: 'increase' | 'decrease' | null;
  readonly transactionId?: string | null;
  readonly note?: string | null;
  readonly importBatchId?: string | null;
}

export function recordDebtEvent(
  document: StoreDocument,
  input: RecordDebtEventInput,
  context: CommandContext,
): CommandResult<string> {
  requireDebt(document, input.debtId);

  if (input.kind === 'balance_correction' && input.correctionEffect === null) {
    throw new CommandError(
      'correction_needs_direction',
      'a balance correction must say whether it raises or lowers the debt',
    );
  }
  if (input.kind !== 'balance_correction' && input.correctionEffect !== null) {
    throw new CommandError(
      'correction_effect_not_allowed',
      'only a balance correction carries a direction of its own',
    );
  }

  const event = {
    id: newId(),
    householdId: document.household.id,
    debtId: input.debtId,
    kind: input.kind,
    amountMinor: input.amountMinor,
    currency: document.settings.currency,
    occurredOn: input.occurredOn,
    correctionEffect: input.correctionEffect,
    transactionId: input.transactionId ?? null,
    note: input.note ?? null,
    createdBy: context.actorProfileId,
    createdAt: context.now,
    importBatchId: input.importBatchId ?? null,
  };

  return {
    document: withAudit({ ...document, debtEvents: [...document.debtEvents, event] }, [
      auditEvent({
        householdId: document.household.id,
        actorProfileId: context.actorProfileId,
        action: 'debt_event.recorded',
        entityType: 'debt_event',
        entityId: event.id,
        after: event,
        occurredAt: context.now,
      }),
    ]),
    value: event.id,
  };
}

export interface RecordRolloverInput {
  readonly fromDebtId: string;
  readonly toDebtId: string;
  readonly amountMinor: number;
  readonly occurredOn: string;
  readonly notes: string | null;
}

/**
 * Recording that a new debt paid off an old one.
 *
 * Three separate facts, exactly as 02-FINANCIAL-RULES.md § גלגול חוב requires: the
 * old debt was repaid, a new debt was created, and a link explains that the second
 * funded the first. The link changes no balance of its own — it is what lets the
 * debt meter show a 5,000 ₪ repayment that was not progress.
 */
export function recordRollover(
  document: StoreDocument,
  input: RecordRolloverInput,
  context: CommandContext,
): CommandResult<string> {
  if (input.fromDebtId === input.toDebtId) {
    throw new CommandError('same_debt', 'a debt cannot pay itself off');
  }
  requireDebt(document, input.fromDebtId);
  requireDebt(document, input.toDebtId);

  const repayment = recordDebtEvent(
    document,
    {
      debtId: input.fromDebtId,
      kind: 'principal_payment',
      amountMinor: input.amountMinor,
      occurredOn: input.occurredOn,
      correctionEffect: null,
      note: 'נפרע מתוך חוב חדש',
    },
    context,
  );

  const origination = recordDebtEvent(
    repayment.document,
    {
      debtId: input.toDebtId,
      kind: 'new_principal',
      amountMinor: input.amountMinor,
      occurredOn: input.occurredOn,
      correctionEffect: null,
      note: 'נלקח כדי לפרוע חוב קיים',
    },
    context,
  );

  const link = {
    id: newId(),
    householdId: document.household.id,
    fromDebtId: input.fromDebtId,
    toDebtId: input.toDebtId,
    repaymentEventId: repayment.value,
    originationEventId: origination.value,
    amountMinor: input.amountMinor,
    occurredOn: input.occurredOn,
    source: 'user_confirmed' as const,
    status: 'confirmed' as const,
    confidenceBp: null,
    notes: input.notes,
    confirmedBy: context.actorProfileId,
    confirmedAt: context.now,
    createdBy: context.actorProfileId,
    createdAt: context.now,
    updatedAt: context.now,
    version: 1,
  };

  return {
    document: withAudit(
      { ...origination.document, rollovers: [...origination.document.rollovers, link] },
      [
        auditEvent({
          householdId: document.household.id,
          actorProfileId: context.actorProfileId,
          action: 'rollover.recorded',
          entityType: 'debt_rollover',
          entityId: link.id,
          after: link,
          occurredAt: context.now,
        }),
      ],
    ),
    value: link.id,
  };
}

// ---------------------------------------------------------------------------
// Business
// ---------------------------------------------------------------------------

export interface AddBusinessInput {
  readonly name: string;
  readonly taxReserveRateBp: number;
  readonly operatingReserveMinor: number;
}

export function addBusiness(
  document: StoreDocument,
  input: AddBusinessInput,
  context: CommandContext,
): CommandResult<string> {
  if (document.businesses.length > 0) {
    throw new CommandError('business_exists', 'this household already has a business');
  }

  const business = {
    id: newId(),
    householdId: document.household.id,
    name: input.name.trim(),
    taxReserveRateBp: input.taxReserveRateBp,
    operatingReserveMinor: input.operatingReserveMinor,
    createdAt: context.now,
    updatedAt: context.now,
    version: 1,
  };

  return {
    document: withAudit(
      {
        ...document,
        businesses: [business],
        setup: { ...document.setup, businessDecided: true },
      },
      [
        auditEvent({
          householdId: document.household.id,
          actorProfileId: context.actorProfileId,
          action: 'business.added',
          entityType: 'business',
          entityId: business.id,
          after: business,
          occurredAt: context.now,
        }),
      ],
    ),
    value: business.id,
  };
}

export function declareNoBusiness(
  document: StoreDocument,
  context: CommandContext,
): CommandResult {
  return {
    document: withAudit({ ...document, setup: { ...document.setup, businessDecided: true } }, [
      auditEvent({
        householdId: document.household.id,
        actorProfileId: context.actorProfileId,
        action: 'business.declined',
        entityType: 'business',
        entityId: null,
        occurredAt: context.now,
      }),
    ]),
    value: undefined,
  };
}

export interface TransferToHouseholdInput {
  readonly businessAccountId: string;
  readonly householdAccountId: string;
  readonly amountMinor: number;
  readonly transactionDate: string;
  readonly note: string | null;
}

/**
 * Moving money from the business to the household.
 *
 * One transaction with two sides, so the consolidated view nets to zero exactly
 * as 02-FINANCIAL-RULES.md § Scopes ותנועות requires. It is recorded as a
 * `transfer`, never as business spending and never as household income, and the
 * engine treats an approved transfer — this — as the only business money that may
 * appear in reliable household income.
 */
export function transferToHousehold(
  document: StoreDocument,
  input: TransferToHouseholdInput,
  context: CommandContext,
): CommandResult<string> {
  const from = requireAccount(document, input.businessAccountId);
  const to = requireAccount(document, input.householdAccountId);

  if (from.scope !== 'business') {
    throw new CommandError(
      'not_a_business_account',
      'the money must come from the business side',
    );
  }
  if (to.scope !== 'household') {
    throw new CommandError(
      'not_a_household_account',
      'the money must arrive on the household side',
    );
  }

  return recordTransaction(
    document,
    {
      accountId: from.id,
      counterpartAccountId: to.id,
      scope: 'business',
      kind: 'transfer',
      direction: 'outflow',
      amountMinor: input.amountMinor,
      categoryId: null,
      merchant: null,
      transactionDate: input.transactionDate,
      note: input.note ?? 'העברה מהעסק לבית',
      status: 'confirmed',
    },
    context,
  );
}

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

export interface StartBudgetInput {
  /** `YYYY-MM`. */
  readonly period: string;
  readonly lines: readonly { categoryKey: BudgetCategoryKey; plannedMinor: number }[];
}

/**
 * Creating a month's budget.
 *
 * Categories are created alongside the lines when the household does not have
 * them yet, because the ten keys are fixed by the engine and a family should not
 * have to build a chart of accounts before they can plan a month.
 */
export function startBudget(
  document: StoreDocument,
  input: StartBudgetInput,
  context: CommandContext,
): CommandResult<string> {
  if (document.budgets.some((budget) => budget.period === input.period)) {
    throw new CommandError('budget_exists', 'this month already has a budget');
  }

  const budget = {
    id: newId(),
    householdId: document.household.id,
    period: input.period,
    currency: document.settings.currency,
    status: 'active' as const,
    isFirstMonthDraft: document.budgets.length === 0,
    createdBy: context.actorProfileId,
    createdAt: context.now,
    updatedAt: context.now,
    version: 1,
  };

  const categories = [...document.categories];
  const lines = input.lines.map((line) => {
    let category = categories.find(
      (candidate) => candidate.name === categoryNameFor(line.categoryKey),
    );
    if (category === undefined) {
      category = {
        id: newId(),
        householdId: document.household.id,
        name: categoryNameFor(line.categoryKey),
        scope: 'household' as const,
        essential: ESSENTIAL_CATEGORY_KEYS.includes(line.categoryKey),
        archivedAt: null,
        createdAt: context.now,
        updatedAt: context.now,
        version: 1,
      };
      categories.push(category);
    }

    return {
      id: newId(),
      householdId: document.household.id,
      budgetId: budget.id,
      categoryId: category.id,
      categoryKey: line.categoryKey,
      plannedMinor: line.plannedMinor,
      weeklyGuidance: line.categoryKey === WEEKLY_GUIDED_CATEGORY,
      note: null,
      createdAt: context.now,
      updatedAt: context.now,
      version: 1,
    };
  });

  return {
    document: withAudit(
      {
        ...document,
        categories,
        budgets: [...document.budgets, budget],
        budgetLines: [...document.budgetLines, ...lines],
        setup: { ...document.setup, budgetStarted: true },
      },
      [
        auditEvent({
          householdId: document.household.id,
          actorProfileId: context.actorProfileId,
          action: 'budget.started',
          entityType: 'budget',
          entityId: budget.id,
          after: budget,
          occurredAt: context.now,
        }),
      ],
    ),
    value: budget.id,
  };
}

export interface SetBudgetLineInput {
  readonly budgetId: string;
  readonly categoryKey: BudgetCategoryKey;
  readonly plannedMinor: number;
}

export function setBudgetLine(
  document: StoreDocument,
  input: SetBudgetLineInput,
  context: CommandContext,
): CommandResult {
  const budget = document.budgets.find((candidate) => candidate.id === input.budgetId);
  if (budget === undefined) {
    throw new CommandError('unknown_budget', 'that month has no budget');
  }

  const existing = document.budgetLines.find(
    (line) => line.budgetId === budget.id && line.categoryKey === input.categoryKey,
  );

  if (existing !== undefined) {
    const line = {
      ...existing,
      plannedMinor: input.plannedMinor,
      updatedAt: context.now,
      version: existing.version + 1,
    };
    return {
      document: withAudit(
        {
          ...document,
          budgetLines: document.budgetLines.map((candidate) =>
            candidate.id === line.id ? line : candidate,
          ),
        },
        [
          auditEvent({
            householdId: document.household.id,
            actorProfileId: context.actorProfileId,
            action: 'budget_line.changed',
            entityType: 'budget_line',
            entityId: line.id,
            before: existing,
            after: line,
            occurredAt: context.now,
          }),
        ],
      ),
      value: undefined,
    };
  }

  const added = startBudgetLine(document, budget.id, input, context);
  return added;
}

function startBudgetLine(
  document: StoreDocument,
  budgetId: string,
  input: SetBudgetLineInput,
  context: CommandContext,
): CommandResult {
  const categories = [...document.categories];
  let category = categories.find(
    (candidate) => candidate.name === categoryNameFor(input.categoryKey),
  );
  if (category === undefined) {
    category = {
      id: newId(),
      householdId: document.household.id,
      name: categoryNameFor(input.categoryKey),
      scope: 'household',
      essential: ESSENTIAL_CATEGORY_KEYS.includes(input.categoryKey),
      archivedAt: null,
      createdAt: context.now,
      updatedAt: context.now,
      version: 1,
    };
    categories.push(category);
  }

  const line = {
    id: newId(),
    householdId: document.household.id,
    budgetId,
    categoryId: category.id,
    categoryKey: input.categoryKey,
    plannedMinor: input.plannedMinor,
    weeklyGuidance: input.categoryKey === WEEKLY_GUIDED_CATEGORY,
    note: null,
    createdAt: context.now,
    updatedAt: context.now,
    version: 1,
  };

  return {
    document: withAudit(
      {
        ...document,
        categories,
        budgetLines: [...document.budgetLines, line],
      },
      [
        auditEvent({
          householdId: document.household.id,
          actorProfileId: context.actorProfileId,
          action: 'budget_line.added',
          entityType: 'budget_line',
          entityId: line.id,
          after: line,
          occurredAt: context.now,
        }),
      ],
    ),
    value: undefined,
  };
}

/** Categories whose failure causes material harm; step 1 of the waterfall. */
const ESSENTIAL_CATEGORY_KEYS: readonly BudgetCategoryKey[] = [
  'food',
  'housing_and_bills',
  'health',
  'transport_and_fuel',
];

/** The Hebrew name a category key is stored under. */
export function categoryNameFor(key: BudgetCategoryKey): string {
  const names: Record<BudgetCategoryKey, string> = {
    food: 'מזון',
    housing_and_bills: 'דיור וחשבונות',
    transport_and_fuel: 'תחבורה ודלק',
    health: 'בריאות',
    education: 'חינוך',
    clothing: 'ביגוד',
    celebrations_and_gifts: 'שמחות ומתנות',
    cash_and_small: 'מזומן והוצאות קטנות',
    holidays: 'חגים',
    other: 'שונות',
  };
  return names[key];
}

export const ALL_BUDGET_CATEGORY_KEYS = BUDGET_CATEGORY_KEYS;

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export interface AddTaskInput {
  readonly title: string;
  readonly reason: string | null;
  readonly origin: 'manual' | 'recommendation';
  readonly recommendationKey: string | null;
  readonly amountMinor: number | null;
  readonly relatedDebtId: string | null;
  readonly relatedAccountId: string | null;
  readonly assignedMemberId: string | null;
  readonly dueOn: string | null;
}

export function addTask(
  document: StoreDocument,
  input: AddTaskInput,
  context: CommandContext,
): CommandResult<string> {
  const task = {
    id: newId(),
    householdId: document.household.id,
    title: input.title.trim(),
    reason: input.reason,
    origin: input.origin,
    recommendationKey:
      input.origin === 'recommendation' ? (input.recommendationKey ?? 'unknown') : null,
    amountMinor: input.amountMinor,
    relatedDebtId: input.relatedDebtId,
    relatedAccountId: input.relatedAccountId,
    assignedMemberId: input.assignedMemberId,
    dueOn: input.dueOn,
    followUpOn: null,
    status: 'open' as const,
    completedAt: null,
    createdAt: context.now,
    updatedAt: context.now,
    version: 1,
  };

  return {
    document: withAudit({ ...document, tasks: [...document.tasks, task] }, [
      auditEvent({
        householdId: document.household.id,
        actorProfileId: context.actorProfileId,
        action: 'task.added',
        entityType: 'task',
        entityId: task.id,
        after: task,
        occurredAt: context.now,
      }),
    ]),
    value: task.id,
  };
}

export interface UpdateTaskInput {
  readonly taskId: string;
  readonly status?: 'open' | 'done' | 'dismissed';
  readonly assignedMemberId?: string | null;
  readonly dueOn?: string | null;
  readonly followUpOn?: string | null;
}

export function updateTask(
  document: StoreDocument,
  input: UpdateTaskInput,
  context: CommandContext,
): CommandResult {
  const before = document.tasks.find((candidate) => candidate.id === input.taskId);
  if (before === undefined) {
    throw new CommandError('unknown_task', 'that task does not exist');
  }

  const status = input.status ?? before.status;
  const task = {
    ...before,
    status,
    assignedMemberId:
      input.assignedMemberId === undefined ? before.assignedMemberId : input.assignedMemberId,
    dueOn: input.dueOn === undefined ? before.dueOn : input.dueOn,
    followUpOn: input.followUpOn === undefined ? before.followUpOn : input.followUpOn,
    completedAt: status === 'done' ? (before.completedAt ?? context.now) : null,
    updatedAt: context.now,
    version: before.version + 1,
  };

  return {
    document: withAudit(
      {
        ...document,
        tasks: document.tasks.map((candidate) => (candidate.id === task.id ? task : candidate)),
      },
      [
        auditEvent({
          householdId: document.household.id,
          actorProfileId: context.actorProfileId,
          action: 'task.updated',
          entityType: 'task',
          entityId: task.id,
          before,
          after: task,
          occurredAt: context.now,
        }),
      ],
    ),
    value: undefined,
  };
}
