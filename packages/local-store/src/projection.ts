import {
  CONSUMER_DEBT_KINDS,
  WEEKLY_GUIDED_CATEGORY,
  type BudgetCategoryKey,
  type Direction,
} from '@family-finance/contracts';
import { OUTSTANDING_CHECK_STATUSES } from '@family-finance/contracts';
import type {
  AccountPosition,
  CheckRecord,
  BudgetInput,
  BusinessInputs,
  DataQualityInputs,
  DebtBaseline,
  DebtEventRecord,
  DebtRecord,
  EngineInput,
  FoodWeekInput,
  PlannedItem,
  ReserveInputs,
  RolloverLink,
} from '@family-finance/finance-engine';

import type { StoreDocument, StoredTransaction } from './document';

/**
 * Turning stored records into what the engine is allowed to see.
 *
 * This is the only place the two sides meet, and the rules it enforces are the
 * ones that would otherwise be quietly broken in a hundred places.
 *
 * A draft never crosses. A void never crosses. An import proposal never crosses —
 * it is not a transaction, it is a suggestion, and CLAUDE.md's approval boundary
 * is a property of this function as much as of the review screen. A transfer
 * between the family's own accounts crosses as a movement of cash and never as
 * income or spending.
 *
 * Nothing here calculates a result. It assembles facts; the engine decides what
 * they mean. When the two are mixed the product ends up with two answers to
 * "how much is safe", which is worse than having none.
 */

/** Transactions that are real: confirmed or reconciled, never draft, never void. */
export function isRealTransaction(transaction: StoredTransaction): boolean {
  return transaction.status === 'confirmed' || transaction.status === 'reconciled';
}

/** Drafts: money that has very likely moved, but which nobody has approved. */
export function isPendingTransaction(transaction: StoredTransaction): boolean {
  return transaction.status === 'draft';
}

const signOf = (direction: Direction): 1 | -1 => (direction === 'inflow' ? 1 : -1);

/**
 * The signed effect of a transaction on the account it is recorded against.
 *
 * A settlement of a card from the bank is an outflow from the bank and an inflow
 * to the card, and it is not spending on either side. Both halves are handled by
 * treating the counterpart explicitly rather than by special-casing the kind
 * downstream.
 */
function effectOn(transaction: StoredTransaction, accountId: string): number {
  if (transaction.accountId === accountId) {
    return signOf(transaction.direction) * transaction.amountMinor;
  }
  if (transaction.counterpartAccountId === accountId) {
    // The other side of a transfer or settlement moves the opposite way.
    return -signOf(transaction.direction) * transaction.amountMinor;
  }
  return 0;
}

export interface AccountBalance {
  readonly accountId: string;
  /** Opening balance plus every real movement. */
  readonly computedMinor: number;
  /** The most recent balance a person confirmed, if any. */
  readonly verifiedMinor: number | null;
  readonly verifiedAt: string | null;
  /**
   * Computed minus confirmed at the moment of confirmation.
   *
   * 05-ARCHITECTURE-DATA.md § Reconciliation forbids absorbing this into a
   * "miscellaneous" line. It is carried, shown, and closed only by a correction
   * the family makes deliberately.
   */
  readonly reconciliationGapMinor: number;
}

/** Signed balance of one account: positive is held, negative is owed. */
export function balanceOf(document: StoreDocument, accountId: string): AccountBalance {
  const account = document.accounts.find((candidate) => candidate.id === accountId);
  if (account === undefined) {
    return {
      accountId,
      computedMinor: 0,
      verifiedMinor: null,
      verifiedAt: null,
      reconciliationGapMinor: 0,
    };
  }

  const opening = signOf(account.openingBalanceDirection) * account.openingBalanceMinor;
  const movements = document.transactions.filter(
    (transaction) => isRealTransaction(transaction) && effectOn(transaction, accountId) !== 0,
  );

  const computedMinor =
    opening +
    movements.reduce((total, transaction) => total + effectOn(transaction, accountId), 0);

  const snapshots = document.balanceSnapshots
    .filter((snapshot) => snapshot.accountId === accountId)
    .sort((a, b) => a.verifiedAt.localeCompare(b.verifiedAt));
  const latest = snapshots[snapshots.length - 1];

  if (latest === undefined) {
    return {
      accountId,
      computedMinor,
      verifiedMinor: null,
      verifiedAt: null,
      reconciliationGapMinor: 0,
    };
  }

  const verifiedMinor = signOf(latest.balanceDirection) * latest.balanceMinor;
  const verifiedDate = latest.verifiedAt.slice(0, 10);

  // What our records said the balance was on the day it was confirmed.
  const computedAtConfirmation =
    opening +
    movements
      .filter((transaction) => transaction.transactionDate <= verifiedDate)
      .reduce((total, transaction) => total + effectOn(transaction, accountId), 0);

  return {
    accountId,
    computedMinor,
    verifiedMinor,
    verifiedAt: latest.verifiedAt,
    reconciliationGapMinor: computedAtConfirmation - verifiedMinor,
  };
}

/**
 * The balance the engine is given.
 *
 * A confirmed balance is better evidence than a computed one, so it wins — but
 * only up to the day it was confirmed. Movements recorded since are added on top,
 * because a balance confirmed last Tuesday is not this morning's balance.
 */
function engineBalanceOf(document: StoreDocument, accountId: string): number {
  const balance = balanceOf(document, accountId);
  if (balance.verifiedAt === null) return balance.computedMinor;

  const verifiedDate = balance.verifiedAt.slice(0, 10);
  const since = document.transactions
    .filter(
      (transaction) =>
        isRealTransaction(transaction) && transaction.transactionDate > verifiedDate,
    )
    .reduce((total, transaction) => total + effectOn(transaction, accountId), 0);

  return (balance.verifiedMinor ?? 0) + since;
}

function accountPositions(document: StoreDocument): AccountPosition[] {
  return document.accounts
    .filter((account) => account.closedAt === null)
    .map((account) => {
      const signed = engineBalanceOf(document, account.id);
      const snapshot = balanceOf(document, account.id);
      return {
        id: account.id,
        name: account.name,
        scope: account.scope,
        kind: account.kind,
        balance: {
          amountMinor: Math.abs(signed),
          direction: signed < 0 ? ('outflow' as const) : ('inflow' as const),
        },
        verifiedAt: snapshot.verifiedAt,
      };
    });
}

function plannedItems(document: StoreDocument, today: string): PlannedItem[] {
  const fromCashflow = document.cashflowItems
    .filter((item) => item.settledTransactionId === null)
    .map((item) => ({
      id: item.id,
      label: item.label,
      scope: item.scope,
      direction: item.direction,
      amountMinor: item.amountMinor,
      certainty: item.certainty,
      expectedDate: item.expectedDate,
      dueDate: item.dueDate,
      essential: item.essential,
    }));

  return [...fromCashflow, ...checksAsPlannedItems(document, today)];
}

/**
 * Outstanding checks, as money that is going to leave.
 *
 * The forecast has to know about a check the gemach is holding, or a household
 * with four thousand shekels of paper out there is told it can safely spend four
 * thousand shekels. So each outstanding check becomes one planned item — and
 * exactly one, keyed by the check's own id, which is what stops it appearing
 * twice however many times this runs.
 *
 * The repayment plan deliberately produces nothing here. An installment and the
 * check written for it are one obligation seen from two sides, and adding both
 * would charge the family twice for the same month. The checks win because a
 * check is a real instrument with a real date; the plan is an intention, and it
 * is shown on the gemach screen as a plan.
 *
 * Two details that are not obvious:
 *
 *   - An overdue check moves to *today*. The forecast walks forward from today,
 *     so an item dated last week would simply vanish — and a check that is late
 *     and uncleared is not gone, it is the most likely thing to come out of the
 *     account this morning.
 *   - A prepared check is `probable` rather than `certain`; a delivered one is
 *     `certain`, because it can be presented without anybody asking us. Both are
 *     counted in full as outflows either way: the forecast is pessimistic about
 *     spending by design, and the certainty is carried for the screens that
 *     explain the difference.
 */
function checksAsPlannedItems(document: StoreDocument, today: string): PlannedItem[] {
  return document.checks
    .filter((check) => OUTSTANDING_CHECK_STATUSES.includes(check.status))
    .map((check) => {
      /*
       * An overdue check moves to today, on both dates.
       *
       * The forecast walks forward from today and settles an item on its due date
       * in preference to its expected one, so a check dated last week would fall
       * outside the walk entirely and vanish — when it is in fact the most likely
       * thing to come out of the account this morning. Both fields move together
       * because leaving the due date in the past would put the item back outside
       * the walk through the very rule this is working around.
       *
       * The date printed on the paper is not lost: it lives on the check, which is
       * what every screen reads.
       */
      const effectiveDate = check.dueDate < today ? today : check.dueDate;

      return {
        id: check.id,
        label: `צ׳ק ל${check.payeeName}`,
        scope: 'household' as const,
        direction: 'outflow' as const,
        amountMinor: check.amountMinor,
        certainty: check.status === 'prepared' ? ('probable' as const) : ('certain' as const),
        expectedDate: effectiveDate,
        dueDate: effectiveDate,
        // A bounced check costs a fee and a conversation with the gemach.
        essential: true,
      };
    });
}

function checkRecords(document: StoreDocument): CheckRecord[] {
  return document.checks.map((check) => ({
    id: check.id,
    debtId: check.debtId,
    accountId: check.accountId,
    amountMinor: check.amountMinor,
    dueDate: check.dueDate,
    status: check.status,
    installmentNumber: check.installmentNumber,
    payeeName: check.payeeName,
    deliveredOn: check.deliveredOn,
    clearedOn: check.clearedOn,
  }));
}

function debtRecords(document: StoreDocument): DebtRecord[] {
  return document.debts.map((debt) => ({
    id: debt.id,
    creditorName: debt.creditorName,
    kind: debt.kind,
    status: debt.status,
    minimumPaymentMinor: debt.minimumPaymentMinor,
    paymentDueDay: debt.paymentDueDay,
    effectiveAnnualRateBp: debt.effectiveAnnualRateBp,
    urgency: debt.urgency,
    expectedCallDate: debt.expectedCallDate,
  }));
}

function debtEvents(document: StoreDocument): DebtEventRecord[] {
  return document.debtEvents.map((event) => ({
    id: event.id,
    debtId: event.debtId,
    kind: event.kind,
    amountMinor: event.amountMinor,
    occurredOn: event.occurredOn,
    correctionEffect: event.correctionEffect,
  }));
}

function rollovers(document: StoreDocument): RolloverLink[] {
  return document.rollovers.map((link) => ({
    id: link.id,
    fromDebtId: link.fromDebtId,
    toDebtId: link.toDebtId,
    amountMinor: link.amountMinor,
    occurredOn: link.occurredOn,
    status: link.status,
  }));
}

function reserveInputs(document: StoreDocument): ReserveInputs {
  return {
    manualFloorMinor: document.settings.manualReserveFloorMinor,
    incidentBufferMinor: document.settings.incidentBufferMinor,
    revolvingAvoidanceMinor: document.settings.revolvingAvoidanceMinor,
    protectedReservesMinor: document.settings.protectedReservesMinor,
  };
}

/** Half-up on integers: `12_345 * 1_800 / 10_000` without a float in sight. */
function applyRateBp(amountMinor: number, rateBp: number): number {
  const product = BigInt(amountMinor) * BigInt(rateBp);
  const scaled = (product * 2n + 10_000n) / 20_000n;
  return Number(scaled);
}

/**
 * What the business side looks like, for the period the snapshot covers.
 *
 * The one thing this must never do is present the business account balance as
 * money the household can have. 02-FINANCIAL-RULES.md § נוסחאות takes tax,
 * committed obligations, overdue payables and an operating reserve out first, and
 * every one of those is assembled here so the engine can do that subtraction.
 */
function businessInputs(
  document: StoreDocument,
  periodStart: string,
  periodEnd: string,
): BusinessInputs | null {
  const business = document.businesses[0];
  if (business === undefined) return null;

  const inPeriod = (date: string) => date >= periodStart && date <= periodEnd;

  const businessTransactions = document.transactions.filter(
    (transaction) =>
      isRealTransaction(transaction) &&
      transaction.scope === 'business' &&
      transaction.kind !== 'transfer' &&
      transaction.kind !== 'settlement',
  );

  const receivedIncomeMinor = businessTransactions
    .filter(
      (transaction) =>
        transaction.direction === 'inflow' && inPeriod(transaction.transactionDate),
    )
    .reduce((total, transaction) => total + transaction.amountMinor, 0);

  const paidExpensesMinor = businessTransactions
    .filter(
      (transaction) =>
        transaction.direction === 'outflow' && inPeriod(transaction.transactionDate),
    )
    .reduce((total, transaction) => total + transaction.amountMinor, 0);

  const businessPlanned = document.cashflowItems.filter(
    (item) => item.scope === 'business' && item.settledTransactionId === null,
  );

  const certainObligationsMinor = businessPlanned
    .filter((item) => item.direction === 'outflow' && item.certainty === 'certain')
    .reduce((total, item) => total + item.amountMinor, 0);

  const overduePayablesMinor = businessPlanned
    .filter(
      (item) =>
        item.direction === 'outflow' && item.dueDate !== null && item.dueDate < periodEnd,
    )
    .reduce((total, item) => total + item.amountMinor, 0);

  // Approved expenses are what the business has committed to, paid or not.
  const approvedExpensesMinor = paidExpensesMinor + certainObligationsMinor;

  // Cumulative realised profit: every period, not only this one, less anything
  // already moved to the household.
  const lifetimeReceived = businessTransactions
    .filter((transaction) => transaction.direction === 'inflow')
    .reduce((total, transaction) => total + transaction.amountMinor, 0);
  const lifetimePaid = businessTransactions
    .filter((transaction) => transaction.direction === 'outflow')
    .reduce((total, transaction) => total + transaction.amountMinor, 0);
  const lifetimeTax = applyRateBp(lifetimeReceived, business.taxReserveRateBp);
  const alreadyTransferred = document.transactions
    .filter(
      (transaction) =>
        isRealTransaction(transaction) &&
        transaction.kind === 'transfer' &&
        transaction.scope === 'business' &&
        transaction.direction === 'outflow',
    )
    .reduce((total, transaction) => total + transaction.amountMinor, 0);

  const cumulativeRealizedProfitMinor = Math.max(
    0,
    lifetimeReceived - lifetimePaid - lifetimeTax - alreadyTransferred,
  );

  return {
    id: business.id,
    name: business.name,
    receivedIncomeMinor,
    approvedExpensesMinor,
    paidExpensesMinor,
    accruedTaxReserveMinor: applyRateBp(receivedIncomeMinor, business.taxReserveRateBp),
    certainObligationsMinor,
    operatingReserveMinor: business.operatingReserveMinor,
    overduePayablesMinor,
    cumulativeRealizedProfitMinor,
  };
}

function dataQuality(document: StoreDocument, periodStart: string): DataQualityInputs {
  const recent = document.transactions.filter(
    (transaction) =>
      isRealTransaction(transaction) && transaction.transactionDate >= periodStart,
  );

  /*
   * Drafts only, and deliberately.
   *
   * The engine scores the approval backlog as a ratio against
   * `recentTransactionCount` — how many of the household's transactions are still
   * unapproved. A staged import proposal is not a transaction: it lives outside
   * the truth entirely and is not in that denominator. Counting it here subtracted
   * one population from another, and a family who uploaded a statement watched the
   * safe-spend answer disappear before they had approved anything.
   *
   * The import backlog is real information and it is not lost — it is what the
   * approvals screen is for, and the home screen says when a file is waiting. What
   * it must not do is pretend to be a proportion of something it is not part of.
   */
  const pendingApprovalCount = document.transactions.filter(isPendingTransaction).length;

  const unclassifiedCashMinor = recent
    .filter(
      (transaction) =>
        transaction.categoryId === null &&
        transaction.kind === 'expense' &&
        transaction.scope === 'household',
    )
    .reduce((total, transaction) => total + transaction.amountMinor, 0);

  const unresolvedReconciliationGapMinor = document.accounts.reduce((total, account) => {
    const balance = balanceOf(document, account.id);
    return total + Math.abs(balance.reconciliationGapMinor);
  }, 0);

  return {
    unclassifiedCashMinor,
    pendingApprovalCount,
    recentTransactionCount: recent.length,
    transactionsMissingClassificationCount: recent.filter(
      (transaction) => transaction.categoryId === null && transaction.kind === 'expense',
    ).length,
    unresolvedReconciliationGapMinor,
  };
}

/**
 * Where debt stood at the start of the period.
 *
 * Replayed from events rather than stored, so the baseline can never disagree
 * with the history it is supposed to summarise. 02-FINANCIAL-RULES.md § גלגול חוב
 * makes the change between two such points the headline debt measure, so getting
 * this from a cached figure would put the product's most important number at the
 * mercy of a stale write.
 */
function debtBaseline(document: StoreDocument, periodStart: string): DebtBaseline | null {
  if (document.debts.length === 0) return null;

  const balances = new Map<string, number>();
  for (const debt of document.debts) balances.set(debt.id, 0);

  for (const event of document.debtEvents) {
    if (event.occurredOn >= periodStart) continue;
    const current = balances.get(event.debtId);
    if (current === undefined) continue;

    switch (event.kind) {
      case 'opening_balance':
      case 'new_principal':
      case 'interest_charge':
      case 'fee_charge':
        balances.set(event.debtId, current + event.amountMinor);
        break;
      case 'principal_payment':
      case 'write_off':
        balances.set(event.debtId, current - event.amountMinor);
        break;
      case 'balance_correction':
        balances.set(
          event.debtId,
          event.correctionEffect === 'decrease'
            ? current - event.amountMinor
            : current + event.amountMinor,
        );
        break;
      case 'interest_paid':
      case 'fee_paid':
        // Paying interest does not reduce the principal. Deliberately no change.
        break;
    }
  }

  let consumerDebtMinor = 0;
  let totalDebtMinor = 0;

  for (const debt of document.debts) {
    const balance = Math.max(0, balances.get(debt.id) ?? 0);
    totalDebtMinor += balance;
    if (CONSUMER_DEBT_KINDS.includes(debt.kind)) consumerDebtMinor += balance;
  }

  return {
    asOf: periodStart,
    consumerDebtMinor,
    totalDebtMinor,
  };
}

export interface ProjectionOptions {
  /** The instant the picture is taken. Passed in so a snapshot can be replayed. */
  readonly asOf: string;
}

/** The start of the household's financial month, honouring `monthStartDay`. */
export function periodStartFor(document: StoreDocument, today: string): string {
  const day = document.settings.monthStartDay;
  const [year, month, date] = today.split('-').map(Number);
  if (year === undefined || month === undefined || date === undefined) return today;

  if (date >= day) {
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  const previousMonth = month === 1 ? 12 : month - 1;
  const previousYear = month === 1 ? year - 1 : year;
  return `${previousYear}-${String(previousMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The last day of the household's financial month. */
export function periodEndFor(document: StoreDocument, today: string): string {
  const start = periodStartFor(document, today);
  const [year, month, day] = start.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) return today;

  const end = new Date(Date.UTC(year, month - 1, day));
  end.setUTCMonth(end.getUTCMonth() + 1);
  end.setUTCDate(end.getUTCDate() - 1);
  return end.toISOString().slice(0, 10);
}

export function toEngineInput(
  document: StoreDocument,
  options: ProjectionOptions,
): EngineInput {
  const today = options.asOf.slice(0, 10);
  const periodStart = periodStartFor(document, today);
  const periodEnd = periodEndFor(document, today);

  // Only an approved transfer counts as household income
  // (02-FINANCIAL-RULES.md § נוסחאות).
  const approvedSafeTransferMinor = document.transactions
    .filter(
      (transaction) =>
        isRealTransaction(transaction) &&
        transaction.kind === 'transfer' &&
        transaction.scope === 'business' &&
        transaction.direction === 'outflow' &&
        transaction.transactionDate >= periodStart &&
        transaction.transactionDate <= periodEnd,
    )
    .reduce((total, transaction) => total + transaction.amountMinor, 0);

  return {
    asOf: options.asOf,
    timeZone: document.settings.timeZone,
    currency: document.settings.currency,
    accounts: accountPositions(document),
    plannedItems: plannedItems(document, today),
    debts: debtRecords(document),
    debtEvents: debtEvents(document),
    rollovers: rollovers(document),
    checks: checkRecords(document),
    reserve: reserveInputs(document),
    business: businessInputs(document, periodStart, periodEnd),
    approvedSafeTransferMinor,
    debtBaseline: debtBaseline(document, periodStart),
    dataQuality: dataQuality(document, periodStart),
  };
}

/**
 * Import rows still waiting for a person.
 *
 * Counted as what they are, and reported separately from the transaction backlog,
 * because the two are different populations and mixing them made the dashboard
 * refuse to answer.
 */
export function pendingImportRowCount(document: StoreDocument): number {
  const waiting = new Set(
    document.importBatches
      .filter((batch) => batch.status === 'needs_review')
      .map((batch) => batch.id),
  );
  return document.importProposals.filter((proposal) => waiting.has(proposal.batchId)).length;
}

/** The freshest confirmed balance, in days. `null` when nothing was ever confirmed. */
export function dataAgeDays(document: StoreDocument, asOf: string): number | null {
  const times = document.balanceSnapshots.map((snapshot) => Date.parse(snapshot.verifiedAt));
  if (times.length === 0) return null;
  const freshest = Math.max(...times);
  const now = Date.parse(asOf);
  if (!Number.isFinite(freshest) || !Number.isFinite(now)) return null;
  return Math.max(0, Math.floor((now - freshest) / 86_400_000));
}

/** `YYYY-MM` of the period a date falls in. */
export function periodKey(date: string): string {
  return date.slice(0, 7);
}

export function toBudgetInput(
  document: StoreDocument,
  options: ProjectionOptions,
): BudgetInput | null {
  const today = options.asOf.slice(0, 10);
  const period = periodKey(periodStartFor(document, today));

  const budget = document.budgets.find(
    (candidate) => candidate.period === period && candidate.status !== 'archived',
  );
  if (budget === undefined) return null;

  /*
   * A budget with no categories yet is still a budget.
   *
   * Returning null here made the screen tell a family to start a budget they had
   * just started, because "no budget for this month" and "a budget nobody has put
   * a category in" looked identical from the outside. The engine reports the
   * empty case honestly — it adds a `budget.no_lines` note and lowers its own
   * confidence — so the right answer is to let it.
   */
  const lines = document.budgetLines.filter((line) => line.budgetId === budget.id);

  const periodStart = periodStartFor(document, today);
  const periodEnd = periodEndFor(document, today);

  const spend = lines.map((line) => {
    const inCategory = (transaction: StoredTransaction) =>
      transaction.categoryId === line.categoryId &&
      transaction.kind === 'expense' &&
      transaction.scope === 'household' &&
      transaction.transactionDate >= periodStart &&
      transaction.transactionDate <= periodEnd;

    const approvedMinor = document.transactions
      .filter((transaction) => isRealTransaction(transaction) && inCategory(transaction))
      .reduce((total, transaction) => total + transaction.amountMinor, 0);

    const pendingMinor = document.transactions
      .filter((transaction) => isPendingTransaction(transaction) && inCategory(transaction))
      .reduce((total, transaction) => total + transaction.amountMinor, 0);

    // A committed charge is a planned outflow in this category that has not yet
    // happened: the rent standing order, the insurance that leaves on the 10th.
    const committedMinor = document.cashflowItems
      .filter(
        (item) =>
          item.categoryId === line.categoryId &&
          item.settledTransactionId === null &&
          item.direction === 'outflow' &&
          item.scope === 'household' &&
          item.expectedDate >= today &&
          item.expectedDate <= periodEnd,
      )
      .reduce((total, item) => total + item.amountMinor, 0);

    return { categoryId: line.categoryId, approvedMinor, pendingMinor, committedMinor };
  });

  const earlierBudgets = document.budgets.filter((candidate) => candidate.period < period);

  return {
    period,
    asOf: today,
    currency: document.settings.currency,
    lines: lines.map((line) => ({
      categoryId: line.categoryId,
      categoryKey: line.categoryKey,
      plannedMinor: line.plannedMinor,
      weeklyGuidance: line.weeklyGuidance,
    })),
    spend,
    dataAgeDays: dataAgeDays(document, options.asOf),
    isFirstMonthDraft: earlierBudgets.length === 0,
  };
}

/**
 * A purchase large enough to be a stock-up rather than a habit.
 *
 * Set at a third of the month's food plan: below that a big shop is an ordinary
 * week, above it the family bought for longer than a week and the pace judgement
 * would be wrong to count it. The threshold is a product decision and it lives
 * here rather than in the engine, which takes the figure as a fact.
 */
const LARGE_PURCHASE_SHARE_OF_MONTH = 3;

export function toFoodWeekInput(
  document: StoreDocument,
  options: ProjectionOptions,
): FoodWeekInput | null {
  const today = options.asOf.slice(0, 10);
  const period = periodKey(periodStartFor(document, today));

  const budget = document.budgets.find(
    (candidate) => candidate.period === period && candidate.status !== 'archived',
  );
  if (budget === undefined) return null;

  const foodLine = document.budgetLines.find(
    (line) => line.budgetId === budget.id && line.categoryKey === WEEKLY_GUIDED_CATEGORY,
  );
  if (foodLine === undefined) return null;

  const periodStart = periodStartFor(document, today);
  const periodEnd = periodEndFor(document, today);

  const inFood = (transaction: StoredTransaction) =>
    transaction.categoryId === foodLine.categoryId &&
    transaction.kind === 'expense' &&
    transaction.scope === 'household' &&
    transaction.transactionDate >= periodStart &&
    transaction.transactionDate <= periodEnd;

  const approvedThisMonthMinor = document.transactions
    .filter((transaction) => isRealTransaction(transaction) && inFood(transaction))
    .reduce((total, transaction) => total + transaction.amountMinor, 0);

  const pendingThisMonthMinor = document.transactions
    .filter((transaction) => isPendingTransaction(transaction) && inFood(transaction))
    .reduce((total, transaction) => total + transaction.amountMinor, 0);

  // The week runs from Sunday, which is how an Israeli household shops.
  const weekStart = startOfWeek(today);
  const thisWeek = document.transactions.filter(
    (transaction) =>
      (isRealTransaction(transaction) || isPendingTransaction(transaction)) &&
      inFood(transaction) &&
      transaction.transactionDate >= weekStart,
  );

  const spentThisWeekMinor = thisWeek.reduce(
    (total, transaction) => total + transaction.amountMinor,
    0,
  );

  const largeThreshold = Math.floor(foodLine.plannedMinor / LARGE_PURCHASE_SHARE_OF_MONTH);
  const largePurchaseThisWeekMinor = thisWeek
    .filter((transaction) => largeThreshold > 0 && transaction.amountMinor >= largeThreshold)
    .reduce((total, transaction) => total + transaction.amountMinor, 0);

  return {
    asOf: today,
    monthlyPlannedMinor: foodLine.plannedMinor,
    approvedThisMonthMinor,
    pendingThisMonthMinor,
    spentThisWeekMinor,
    largePurchaseThisWeekMinor,
    carryForwardEnabled: true,
    dataAgeDays: dataAgeDays(document, options.asOf),
  };
}

/** The Sunday on or before a date. */
export function startOfWeek(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  parsed.setUTCDate(parsed.getUTCDate() - parsed.getUTCDay());
  return parsed.toISOString().slice(0, 10);
}

/** Category ids the household has, keyed by the budget key they map to. */
export function categoryIdFor(
  document: StoreDocument,
  key: BudgetCategoryKey,
): string | undefined {
  const budget = document.budgets[document.budgets.length - 1];
  if (budget === undefined) return undefined;
  return document.budgetLines.find(
    (line) => line.budgetId === budget.id && line.categoryKey === key,
  )?.categoryId;
}
