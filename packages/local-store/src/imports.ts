import type {
  ImportBatch,
  ImportProposal,
  ImportWarningCode,
  ProposedPayload,
  ReviewState,
} from '@family-finance/contracts';
import { REVIEW_REQUIREMENT, normaliseLenderName } from '@family-finance/contracts';
import {
  assessDuplicate,
  sourceFingerprint,
  type ExtractionResult,
  type ExistingRecord,
} from '@family-finance/document-import';

import { classifyBatch } from '@family-finance/transaction-intelligence';

import { auditEvent, withAudit } from './audit';
import { clearCheck } from './checks';
import {
  CommandError,
  addDebt,
  recordBalance,
  recordDebtEvent,
  recordTransaction,
  type CommandContext,
  type CommandResult,
} from './commands';
import type { StoreDocument } from './document';
import { activeLearnedRules } from './learned-rules';
import { isRealTransaction } from './projection';

/**
 * The life of an import: staged, reviewed, approved or refused, and reversible.
 *
 * The rule this file exists to make true is the one CLAUDE.md states in three
 * words — draft is not truth. Between `stageExtraction` and `approveBatch` the
 * household's balances, budgets, debts and forecast are untouched. Not
 * "approximately untouched": the proposals live in their own collection, the
 * projection that feeds the engine never reads that collection, and the only
 * function in the codebase that turns a proposal into a transaction is
 * `approveBatch`.
 *
 * Approval is atomic because `FileStore.mutate` writes the whole document by
 * rename. A batch that fails validation halfway leaves nothing behind — there is
 * no partial state to clean up, because nothing was written.
 */

export interface StageExtractionInput {
  readonly extraction: ExtractionResult;
  readonly displayName: string;
  readonly storedId: string;
  readonly sha256: string;
  readonly byteSize: number;
  readonly declaredMimeType: string | null;
  /** Which account the file appears to be about, when the user picked one. */
  readonly targetAccountId: string | null;
}

/**
 * Records what was extracted, as proposals.
 *
 * Every row is `pending` and every row is scored for duplication against what the
 * household already has. A batch cannot be approved while anything is still
 * pending, so silence is never taken as agreement.
 */
export function stageExtraction(
  document: StoreDocument,
  input: StageExtractionInput,
  context: CommandContext,
): CommandResult<string> {
  const batchId = crypto.randomUUID();
  const existing = existingRecordsFor(document);

  /*
   * What each row appears to be, decided before anything is written.
   *
   * The suggestion is attached to the proposal and changes nothing else: no
   * amount, no direction, no date, and no balance anywhere. It exists so the
   * review screen can offer an answer instead of a blank, and so the decision a
   * person makes has something to be a decision *about*.
   */
  const rules = activeLearnedRules(document);
  const debtHints = document.debts.map((debt) => ({
    id: debt.id,
    creditorName: debt.creditorName,
    status: debt.status,
  }));
  const transactionRows = input.extraction.proposals.flatMap((proposal) =>
    proposal.proposed.kind === 'transaction'
      ? [
          {
            description: proposal.proposed.value.description,
            amountMinor: proposal.proposed.value.amountMinor,
            direction: proposal.proposed.value.direction,
            date: proposal.proposed.value.transactionDate,
            reference: proposal.proposed.value.reference,
            bankName: null,
            accountKind: null,
          },
        ]
      : [],
  );
  const suggestions = classifyBatch(transactionRows, {
    householdRules: rules,
    debts: debtHints,
    accountId: input.targetAccountId,
  });
  let suggestionAt = 0;

  const proposals: ImportProposal[] = input.extraction.proposals.map((proposal) => {
    const fingerprint = sourceFingerprint(input.sha256, proposal.location);
    const classification =
      proposal.proposed.kind === 'transaction' ? (suggestions[suggestionAt++] ?? null) : null;
    const assessment =
      proposal.proposed.kind === 'transaction'
        ? assessDuplicate(
            {
              accountId: input.targetAccountId,
              date: proposal.proposed.value.transactionDate,
              amountMinor: proposal.proposed.value.amountMinor,
              direction: proposal.proposed.value.direction,
              description: proposal.proposed.value.description,
              reference: proposal.proposed.value.reference,
              sourceFingerprint: fingerprint,
            },
            existing,
          )
        : { verdict: 'new' as const, matchedId: null };

    return {
      id: crypto.randomUUID(),
      batchId,
      kind: proposal.kind,
      location: proposal.location,
      raw: [...proposal.raw],
      proposed: proposal.proposed,
      correction: null,
      confidenceBp: proposal.confidenceBp,
      warnings: [...proposal.warnings],
      duplicateVerdict: assessment.verdict,
      duplicateOfId: assessment.matchedId,
      reviewState: 'pending' as ReviewState,
      targetAccountId: input.targetAccountId,
      // A suggestion may name a debt, but never attaches the row to it. That is
      // a decision, and it is made on the review screen.
      targetDebtId: null,
      targetCheckId: null,
      committedRecordId: null,
      classification,
      createdAt: context.now,
      updatedAt: context.now,
      version: 1,
    };
  });

  const batch: ImportBatch = {
    id: batchId,
    householdId: document.household.id,
    file: {
      displayName: input.displayName,
      storedId: input.storedId,
      byteSize: input.byteSize,
      fileKind: input.extraction.fileKind,
      declaredMimeType: input.declaredMimeType,
      sha256: input.sha256,
    },
    documentType: input.extraction.documentType,
    documentTypeConfidenceBp: input.extraction.documentTypeConfidenceBp,
    status: 'needs_review',
    summary: input.extraction.summary,
    warnings: [...input.extraction.warnings],
    failureCode: null,
    createdAt: context.now,
    updatedAt: context.now,
    approvedAt: null,
    approvedBy: null,
    rejectedAt: null,
    reversedAt: null,
    version: 1,
  };

  return {
    document: withAudit(
      {
        ...document,
        importBatches: [...document.importBatches, batch],
        importProposals: [...document.importProposals, ...proposals],
      },
      [
        auditEvent({
          householdId: document.household.id,
          actorProfileId: context.actorProfileId,
          action: 'import.staged',
          entityType: 'import_batch',
          entityId: batchId,
          after: {
            id: batchId,
            documentType: batch.documentType,
            rowsProposed: proposals.length,
          },
          occurredAt: context.now,
        }),
      ],
    ),
    value: batchId,
  };
}

/** Records that a file could not be read, so the attempt is still visible. */
export interface StageFailureInput {
  readonly displayName: string;
  readonly storedId: string;
  readonly sha256: string;
  readonly byteSize: number;
  readonly declaredMimeType: string | null;
  readonly fileKind: 'xlsx' | 'csv' | 'pdf';
  readonly failureCode: NonNullable<ImportBatch['failureCode']>;
  readonly warnings: readonly ImportWarningCode[];
}

export function stageFailure(
  document: StoreDocument,
  input: StageFailureInput,
  context: CommandContext,
): CommandResult<string> {
  const batch: ImportBatch = {
    id: crypto.randomUUID(),
    householdId: document.household.id,
    file: {
      displayName: input.displayName,
      storedId: input.storedId,
      byteSize: input.byteSize,
      fileKind: input.fileKind,
      declaredMimeType: input.declaredMimeType,
      sha256: input.sha256,
    },
    documentType: 'unrecognised',
    documentTypeConfidenceBp: 0,
    status: 'failed',
    summary: {
      sheetNames: [],
      pageCount: null,
      rowsScanned: 0,
      rowsProposed: 0,
      rowsSkipped: 0,
      dateRangeStart: null,
      dateRangeEnd: null,
      accountHints: [],
      hasImageOnlyPages: false,
    },
    warnings: [...input.warnings],
    failureCode: input.failureCode,
    createdAt: context.now,
    updatedAt: context.now,
    approvedAt: null,
    approvedBy: null,
    rejectedAt: null,
    reversedAt: null,
    version: 1,
  };

  return {
    document: withAudit({ ...document, importBatches: [...document.importBatches, batch] }, [
      auditEvent({
        householdId: document.household.id,
        actorProfileId: context.actorProfileId,
        action: 'import.failed',
        entityType: 'import_batch',
        entityId: batch.id,
        after: { id: batch.id, status: batch.status },
        occurredAt: context.now,
      }),
    ]),
    value: batch.id,
  };
}

/** What the household already holds, in the shape the duplicate check reads. */
function existingRecordsFor(document: StoreDocument): ExistingRecord[] {
  return document.transactions.filter(isRealTransaction).map((transaction) => ({
    id: transaction.id,
    accountId: transaction.accountId,
    date: transaction.transactionDate,
    amountMinor: transaction.amountMinor,
    direction: transaction.direction,
    description: transaction.merchant ?? transaction.note ?? '',
    reference: null,
    sourceFingerprint: transaction.sourceFingerprint,
  }));
}

export interface ReviewProposalInput {
  readonly proposalId: string;
  readonly reviewState?: ReviewState;
  readonly correction?: ProposedPayload | null;
  readonly targetAccountId?: string | null;
  readonly targetDebtId?: string | null;
  readonly targetCheckId?: string | null;
}

/**
 * A reviewer's decision on one row.
 *
 * A correction never overwrites what the document said. `raw` and `proposed` stay
 * exactly as extracted, and the reviewer's version sits beside them — so the
 * question "did the bank say this, or did we type it?" always has an answer.
 */
export function reviewProposal(
  document: StoreDocument,
  input: ReviewProposalInput,
  context: CommandContext,
): CommandResult {
  const before = document.importProposals.find(
    (candidate) => candidate.id === input.proposalId,
  );
  if (before === undefined) {
    throw new CommandError('unknown_proposal', 'that row is not part of any import');
  }

  const batch = document.importBatches.find((candidate) => candidate.id === before.batchId);
  if (batch === undefined || batch.status !== 'needs_review') {
    throw new CommandError(
      'batch_not_open',
      'this import has already been decided and cannot be edited',
    );
  }

  if (input.correction !== undefined && input.correction !== null) {
    if (input.correction.kind !== before.kind) {
      throw new CommandError(
        'correction_changes_kind',
        'a correction may refine a row, never change what it is',
      );
    }
  }

  const proposal: ImportProposal = {
    ...before,
    reviewState: input.reviewState ?? before.reviewState,
    correction: input.correction === undefined ? before.correction : input.correction,
    targetAccountId:
      input.targetAccountId === undefined ? before.targetAccountId : input.targetAccountId,
    targetDebtId: input.targetDebtId === undefined ? before.targetDebtId : input.targetDebtId,
    targetCheckId:
      input.targetCheckId === undefined ? before.targetCheckId : input.targetCheckId,
    updatedAt: context.now,
    version: before.version + 1,
  };

  return {
    document: withAudit(
      {
        ...document,
        importProposals: document.importProposals.map((candidate) =>
          candidate.id === proposal.id ? proposal : candidate,
        ),
      },
      [
        auditEvent({
          householdId: document.household.id,
          actorProfileId: context.actorProfileId,
          action: 'import.row_reviewed',
          entityType: 'import_proposal',
          entityId: proposal.id,
          before,
          after: proposal,
          occurredAt: context.now,
        }),
      ],
    ),
    value: undefined,
  };
}

/** Applies one decision to every row of a batch at once. */
export function reviewAll(
  document: StoreDocument,
  input: {
    batchId: string;
    reviewState: ReviewState;
    onlyPending: boolean;
    /**
     * Restrict a bulk *include* to rows the classifier was confident about.
     *
     * This is what makes "confirm everything obvious" safe to offer. Without it
     * a single button would sweep in the rows nobody has looked at, which is the
     * exact opposite of what the review screen is for. Excluding in bulk is
     * never restricted: deciding not to import something is always safe.
     */
    onlyHighConfidence?: boolean;
  },
  context: CommandContext,
): CommandResult<number> {
  const batch = document.importBatches.find((candidate) => candidate.id === input.batchId);
  if (batch === undefined || batch.status !== 'needs_review') {
    throw new CommandError('batch_not_open', 'this import has already been decided');
  }

  let touched = 0;
  const importProposals = document.importProposals.map((proposal) => {
    if (proposal.batchId !== input.batchId) return proposal;
    if (input.onlyPending && proposal.reviewState !== 'pending') return proposal;

    if (input.onlyHighConfidence === true && input.reviewState === 'included') {
      const suggestion = proposal.classification ?? null;
      if (suggestion === null) return proposal;
      if (REVIEW_REQUIREMENT[suggestion.confidence] !== 'may_preselect') return proposal;
      // A row that would move a debt balance is never swept in, however
      // confident the reading of the words was.
      if (suggestion.requiresDebtChoice && proposal.targetDebtId === null) return proposal;
    }

    touched += 1;
    return {
      ...proposal,
      reviewState: input.reviewState,
      updatedAt: context.now,
      version: proposal.version + 1,
    };
  });

  return {
    document: withAudit({ ...document, importProposals }, [
      auditEvent({
        householdId: document.household.id,
        actorProfileId: context.actorProfileId,
        action: 'import.rows_reviewed',
        entityType: 'import_batch',
        entityId: input.batchId,
        after: { id: input.batchId, reviewState: input.reviewState },
        occurredAt: context.now,
      }),
    ]),
    value: touched,
  };
}

export interface ApprovalCheck {
  readonly canApprove: boolean;
  readonly pendingCount: number;
  readonly includedCount: number;
  readonly excludedCount: number;
  readonly duplicateIncludedCount: number;
  /** Rows that cannot be committed as they stand, with the reason. */
  readonly blocking: readonly { proposalId: string; reason: string }[];
}

/**
 * Whether a batch is ready, and what is stopping it.
 *
 * Run before approval and shown on the review screen, so a person can see what
 * remains rather than pressing a button that fails.
 */
export function checkApproval(document: StoreDocument, batchId: string): ApprovalCheck {
  const proposals = document.importProposals.filter((proposal) => proposal.batchId === batchId);

  const pending = proposals.filter((proposal) => proposal.reviewState === 'pending');
  const included = proposals.filter((proposal) => proposal.reviewState === 'included');
  const excluded = proposals.filter((proposal) => proposal.reviewState === 'excluded');

  const blocking: { proposalId: string; reason: string }[] = [];

  for (const proposal of included) {
    const payload = proposal.correction ?? proposal.proposed;

    if (payload.kind === 'transaction' && proposal.targetAccountId === null) {
      blocking.push({ proposalId: proposal.id, reason: 'needs_account' });
    }
    if (payload.kind === 'balance' && proposal.targetAccountId === null) {
      blocking.push({ proposalId: proposal.id, reason: 'needs_account' });
    }
    if (payload.kind === 'debt_payment' && proposal.targetDebtId === null) {
      blocking.push({ proposalId: proposal.id, reason: 'needs_debt' });
    }
    if (payload.kind === 'transaction' && payload.value.amountMinor <= 0) {
      blocking.push({ proposalId: proposal.id, reason: 'needs_amount' });
    }

    const suggestion = proposal.classification ?? null;
    if (suggestion !== null) {
      /*
       * A row the classifier read as a repayment but could not tie to a lender.
       *
       * This is the guard the requirement is about: until a person names the
       * loan, no debt balance may move. It is deliberately independent of
       * confidence — a line can say "חיוב הלוואה" beyond doubt and still not say
       * whose loan it was.
       */
      if (suggestion.requiresDebtChoice && proposal.targetDebtId === null) {
        blocking.push({ proposalId: proposal.id, reason: 'needs_debt' });
      }

      /*
       * Low confidence is not blocked here, and that is deliberate.
       *
       * Every row already has to be moved out of `pending` by a person before the
       * batch can be approved, so an unrecognised row cannot pass through on the
       * classifier's word — including it *is* the decision the requirement asks
       * for. Demanding an edit on top of that would force a family to retype an
       * answer for every ordinary shop the rule table happens not to know, which
       * teaches them to click past the screen rather than read it.
       *
       * What confidence governs instead is what the screen may do unasked:
       * `REVIEW_REQUIREMENT` lets only `high` be preselected, and `reviewAll`
       * refuses to bulk-include anything below it.
       */
    }
    /*
     * A debt row naming a lender the household already has.
     *
     * The two readings — "they lent us more" and "this is a second lender who
     * happens to share a name" — are not distinguishable from the file, and
     * guessing either one is unsafe: the first invents money that was never
     * borrowed, the second splits one lender's history in two. So the row waits
     * until a person says which, by attaching it to a lender or excluding it.
     */
    if (payload.kind === 'debt' && proposal.targetDebtId === null) {
      const name = normaliseLenderName(payload.value.creditorName);
      const clash = document.debts.some(
        (debt) =>
          debt.householdId === document.household.id &&
          debt.status !== 'written_off' &&
          normaliseLenderName(debt.creditorName) === name,
      );
      if (clash) blocking.push({ proposalId: proposal.id, reason: 'needs_lender_decision' });
    }
  }

  return {
    canApprove: pending.length === 0 && included.length > 0 && blocking.length === 0,
    pendingCount: pending.length,
    includedCount: included.length,
    excludedCount: excluded.length,
    duplicateIncludedCount: included.filter((proposal) => proposal.duplicateVerdict !== 'new')
      .length,
    blocking,
  };
}

export interface ApprovalOutcome {
  readonly batchId: string;
  readonly transactionsCreated: number;
  readonly balancesCreated: number;
  readonly debtsCreated: number;
  readonly debtEventsCreated: number;
  readonly plannedItemsCreated: number;
  /** The signed change to each account, so the screen can show before and after. */
  readonly accountDeltas: readonly { accountId: string; deltaMinor: number }[];
}

/**
 * Turning approved rows into financial records.
 *
 * The only function that crosses the approval boundary. It refuses outright
 * unless `checkApproval` says the batch is ready, it refuses a second time on a
 * batch already approved — so a double submit creates nothing — and every record
 * it creates carries the batch and proposal it came from, which is what makes
 * `reverseBatch` able to undo exactly this and nothing else.
 */
export function approveBatch(
  document: StoreDocument,
  input: { batchId: string },
  context: CommandContext,
): CommandResult<ApprovalOutcome> {
  const batch = document.importBatches.find((candidate) => candidate.id === input.batchId);
  if (batch === undefined) {
    throw new CommandError('unknown_batch', 'that import does not exist');
  }
  if (batch.status === 'approved') {
    throw new CommandError('already_approved', 'this import has already been approved');
  }
  if (batch.status !== 'needs_review') {
    throw new CommandError('batch_not_open', 'this import is not waiting for a decision');
  }

  const check = checkApproval(document, batch.id);
  if (!check.canApprove) {
    throw new CommandError(
      'not_ready',
      check.pendingCount > 0
        ? 'some rows have not been decided yet'
        : check.includedCount === 0
          ? 'no row was included, so there is nothing to approve'
          : 'some rows are missing an account or a debt to attach to',
    );
  }

  let working = document;
  const outcome = {
    transactionsCreated: 0,
    balancesCreated: 0,
    debtsCreated: 0,
    debtEventsCreated: 0,
    plannedItemsCreated: 0,
  };
  const deltas = new Map<string, number>();
  const committed = new Map<string, string>();

  const included = document.importProposals.filter(
    (proposal) => proposal.batchId === batch.id && proposal.reviewState === 'included',
  );

  for (const proposal of included) {
    const payload = proposal.correction ?? proposal.proposed;

    if (payload.kind === 'transaction') {
      const accountId = proposal.targetAccountId;
      if (accountId === null) {
        throw new CommandError('needs_account', 'a movement must be attached to an account');
      }
      const account = working.accounts.find((candidate) => candidate.id === accountId);
      if (account === undefined) {
        throw new CommandError('unknown_account', 'the account this row points at is gone');
      }

      /*
       * The row a reviewer joined to a post-dated check.
       *
       * Clearing writes the cash movement *and* the repayment together and links
       * both to the check, so the debit is recorded once and only once. Taking
       * the ordinary path instead would create an expense with no link, and the
       * check would still be sitting there waiting to be cleared a second time.
       *
       * `clearCheck` refuses a check that is already cleared, which is what makes
       * re-approving the same file — or importing it twice — idempotent by
       * construction rather than by a duplicate heuristic.
       */
      if (proposal.targetCheckId !== null) {
        const cleared = clearCheck(
          working,
          {
            checkId: proposal.targetCheckId,
            clearedOn: payload.value.transactionDate,
            importBatchId: batch.id,
          },
          context,
        );
        working = cleared.document;
        committed.set(proposal.id, cleared.value.transactionId);
        outcome.transactionsCreated += 1;
        outcome.debtEventsCreated += 1;
        deltas.set(accountId, (deltas.get(accountId) ?? 0) - payload.value.amountMinor);
        continue;
      }

      const created = recordTransaction(
        working,
        {
          accountId,
          counterpartAccountId: null,
          scope: payload.value.scope,
          kind: payload.value.direction === 'inflow' ? 'income' : 'expense',
          direction: payload.value.direction,
          amountMinor: payload.value.amountMinor,
          categoryId: categoryIdForKey(working, payload.value.categoryKey),
          merchant: payload.value.description,
          transactionDate: payload.value.transactionDate,
          postingDate: payload.value.postingDate,
          note: null,
          status: 'confirmed',
          importBatchId: batch.id,
          importProposalId: proposal.id,
          sourceFingerprint: sourceFingerprint(batch.file.sha256, proposal.location),
        },
        context,
      );
      working = created.document;
      committed.set(proposal.id, created.value);
      outcome.transactionsCreated += 1;
      deltas.set(
        accountId,
        (deltas.get(accountId) ?? 0) +
          (payload.value.direction === 'inflow'
            ? payload.value.amountMinor
            : -payload.value.amountMinor),
      );
      continue;
    }

    if (payload.kind === 'balance') {
      const accountId = proposal.targetAccountId;
      if (accountId === null) {
        throw new CommandError('needs_account', 'a balance must be attached to an account');
      }
      const created = recordBalance(
        working,
        {
          accountId,
          balanceMinor: payload.value.balanceMinor,
          balanceDirection: payload.value.balanceDirection,
          verifiedAt: `${payload.value.asOfDate}T00:00:00.000Z`,
          source: 'import',
          note: null,
          importBatchId: batch.id,
        },
        context,
      );
      working = created.document;
      committed.set(proposal.id, created.value);
      outcome.balancesCreated += 1;
      continue;
    }

    if (payload.kind === 'debt_payment') {
      const debtId = proposal.targetDebtId;
      if (debtId === null) {
        throw new CommandError('needs_debt', 'a repayment must be attached to a debt');
      }

      if (payload.value.principalMinor > 0) {
        const created = recordDebtEvent(
          working,
          {
            debtId,
            kind: 'principal_payment',
            amountMinor: payload.value.principalMinor,
            occurredOn: payload.value.occurredOn,
            correctionEffect: null,
            importBatchId: batch.id,
          },
          context,
        );
        working = created.document;
        committed.set(proposal.id, created.value);
        outcome.debtEventsCreated += 1;
      }

      // Interest is recorded separately, because paying interest is not progress
      // on the principal (02-FINANCIAL-RULES.md § אינווריאנטים).
      if (payload.value.interestMinor > 0) {
        const created = recordDebtEvent(
          working,
          {
            debtId,
            kind: 'interest_paid',
            amountMinor: payload.value.interestMinor,
            occurredOn: payload.value.occurredOn,
            correctionEffect: null,
            importBatchId: batch.id,
          },
          context,
        );
        working = created.document;
        outcome.debtEventsCreated += 1;
      }
      continue;
    }

    /*
     * A debt read from a debt list.
     *
     * Two shapes, and the difference between them is a decision a person made:
     *
     *   * `targetDebtId` set — the reviewer said this row belongs to a lender the
     *     household already has, so it is more principal on that debt, not a
     *     second card for the same person.
     *   * `targetDebtId` null — a lender that is new. `checkApproval` has already
     *     refused the batch if a debt with this name exists and the reviewer did
     *     not say which it was, so reaching here means the name is genuinely new.
     *
     * Either way the balance arrives as an event and is never written as a
     * number on the debt: `replayDebtBalances` stays the only definition of what
     * is owed.
     */
    if (payload.kind === 'debt') {
      const value = payload.value;

      if (proposal.targetDebtId !== null) {
        const existing = working.debts.find(
          (candidate) => candidate.id === proposal.targetDebtId,
        );
        if (existing === undefined) {
          throw new CommandError('unknown_debt', 'the lender this row points at is gone');
        }
        const added = recordDebtEvent(
          working,
          {
            debtId: existing.id,
            kind: 'new_principal',
            amountMinor: value.balanceMinor,
            occurredOn: value.openedOn,
            correctionEffect: null,
            note: value.note ?? null,
            importBatchId: batch.id,
          },
          context,
        );
        working = added.document;
        committed.set(proposal.id, existing.id);
        outcome.debtEventsCreated += 1;
        continue;
      }

      const created = addDebt(
        working,
        {
          creditorName: value.creditorName,
          kind: value.kind,
          openingBalanceMinor: value.balanceMinor,
          openedOn: value.openedOn,
          effectiveAnnualRateBp: value.effectiveAnnualRateBp,
          minimumPaymentMinor: value.minimumPaymentMinor,
          paymentDueDay: value.paymentDueDay,
          urgency: 'none',
          promiseSummary: null,
          relationshipSensitivity: null,
          partialPaymentAllowed: null,
          expectedCallDate: null,
          ...(value.dueDate === undefined ? {} : { dueDate: value.dueDate }),
          notes: value.note ?? null,
          importBatchId: batch.id,
        },
        context,
      );
      working = created.document;
      committed.set(proposal.id, created.value);
      outcome.debtsCreated += 1;
      // `addDebt` writes the opening balance with the debt, in one step.
      outcome.debtEventsCreated += 1;
      continue;
    }

    // Account, planned item and budget line proposals are not committed
    // automatically. They describe structure rather than movements, and creating
    // an account from a document without the family naming it produces
    // records nobody recognises. The review screen offers them as a next step.
  }

  const approvedBatch: ImportBatch = {
    ...batch,
    status: 'approved',
    approvedAt: context.now,
    approvedBy: context.actorProfileId,
    updatedAt: context.now,
    version: batch.version + 1,
  };

  const importProposals = working.importProposals.map((proposal) =>
    proposal.batchId === batch.id
      ? { ...proposal, committedRecordId: committed.get(proposal.id) ?? null }
      : proposal,
  );

  const result: ApprovalOutcome = {
    batchId: batch.id,
    ...outcome,
    accountDeltas: [...deltas.entries()].map(([accountId, deltaMinor]) => ({
      accountId,
      deltaMinor,
    })),
  };

  return {
    document: withAudit(
      {
        ...working,
        importBatches: working.importBatches.map((candidate) =>
          candidate.id === batch.id ? approvedBatch : candidate,
        ),
        importProposals,
      },
      [
        auditEvent({
          householdId: document.household.id,
          actorProfileId: context.actorProfileId,
          action: 'import.approved',
          entityType: 'import_batch',
          entityId: batch.id,
          before: { id: batch.id, status: batch.status },
          after: { id: batch.id, status: 'approved' },
          occurredAt: context.now,
        }),
      ],
    ),
    value: result,
  };
}

function categoryIdForKey(document: StoreDocument, key: string | null): string | null {
  if (key === null) return null;
  const line = document.budgetLines.find((candidate) => candidate.categoryKey === key);
  return line?.categoryId ?? null;
}

/** Refusing a whole batch. Nothing is created, and the record of the attempt stays. */
export function rejectBatch(
  document: StoreDocument,
  input: { batchId: string },
  context: CommandContext,
): CommandResult {
  const batch = document.importBatches.find((candidate) => candidate.id === input.batchId);
  if (batch === undefined) {
    throw new CommandError('unknown_batch', 'that import does not exist');
  }
  if (batch.status === 'approved') {
    throw new CommandError(
      'already_approved',
      'this import was already approved; undo it instead of rejecting it',
    );
  }

  const rejected: ImportBatch = {
    ...batch,
    status: 'rejected',
    rejectedAt: context.now,
    updatedAt: context.now,
    version: batch.version + 1,
  };

  return {
    document: withAudit(
      {
        ...document,
        importBatches: document.importBatches.map((candidate) =>
          candidate.id === batch.id ? rejected : candidate,
        ),
      },
      [
        auditEvent({
          householdId: document.household.id,
          actorProfileId: context.actorProfileId,
          action: 'import.rejected',
          entityType: 'import_batch',
          entityId: batch.id,
          before: { id: batch.id, status: batch.status },
          after: { id: batch.id, status: 'rejected' },
          occurredAt: context.now,
        }),
      ],
    ),
    value: undefined,
  };
}

export interface ReversalOutcome {
  readonly transactionsVoided: number;
  readonly balancesRemoved: number;
  readonly debtEventsRemoved: number;
}

/**
 * Undoing an approved import.
 *
 * Only what this batch created is affected, found by the batch id every created
 * record carries — a household that imported a statement, then typed a correction
 * by hand, keeps the correction.
 *
 * Transactions are voided rather than deleted, because money records are never
 * deleted. Balance confirmations and debt events are removed, because those are
 * observations rather than movements: a balance the bank never actually confirmed
 * should leave no trace, and a voided-but-present balance snapshot would keep
 * dragging the freshness figure with it.
 */
export function reverseBatch(
  document: StoreDocument,
  input: { batchId: string; reason: string },
  context: CommandContext,
): CommandResult<ReversalOutcome> {
  const batch = document.importBatches.find((candidate) => candidate.id === input.batchId);
  if (batch === undefined) {
    throw new CommandError('unknown_batch', 'that import does not exist');
  }
  if (batch.status !== 'approved') {
    throw new CommandError('not_approved', 'only an approved import can be undone');
  }

  const transactions = document.transactions.map((transaction) => {
    if (transaction.importBatchId !== batch.id || transaction.status === 'void') {
      return transaction;
    }
    return {
      ...transaction,
      status: 'void' as const,
      note: input.reason.slice(0, 500),
      updatedAt: context.now,
      version: transaction.version + 1,
    };
  });

  const transactionsVoided = transactions.filter(
    (transaction, index) => transaction !== document.transactions[index],
  ).length;

  const balancesRemoved = document.balanceSnapshots.filter(
    (snapshot) => snapshot.importBatchId === batch.id,
  ).length;
  const debtEventsRemoved = document.debtEvents.filter(
    (event) => event.importBatchId === batch.id,
  ).length;

  const reversed: ImportBatch = {
    ...batch,
    status: 'reversed',
    reversedAt: context.now,
    updatedAt: context.now,
    version: batch.version + 1,
  };

  return {
    document: withAudit(
      {
        ...document,
        transactions,
        balanceSnapshots: document.balanceSnapshots.filter(
          (snapshot) => snapshot.importBatchId !== batch.id,
        ),
        debtEvents: document.debtEvents.filter((event) => event.importBatchId !== batch.id),
        importBatches: document.importBatches.map((candidate) =>
          candidate.id === batch.id ? reversed : candidate,
        ),
      },
      [
        auditEvent({
          householdId: document.household.id,
          actorProfileId: context.actorProfileId,
          action: 'import.reversed',
          entityType: 'import_batch',
          entityId: batch.id,
          before: { id: batch.id, status: batch.status },
          after: { id: batch.id, status: 'reversed' },
          occurredAt: context.now,
        }),
      ],
    ),
    value: { transactionsVoided, balancesRemoved, debtEventsRemoved },
  };
}

/** True when this exact file has already been imported and approved. */
export function alreadyImported(document: StoreDocument, sha256: string): ImportBatch | null {
  return (
    document.importBatches.find(
      (batch) => batch.file.sha256 === sha256 && batch.status === 'approved',
    ) ?? null
  );
}
