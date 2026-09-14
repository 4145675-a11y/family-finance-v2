import { buildCsv, extractDocument } from '@family-finance/document-import';
import { describe, expect, test } from 'vitest';

import { CommandError } from './commands';
import { parseStoreDocument, type StoreDocument } from './document';
import { contextFor, seededHousehold, spend, TEST_NOW } from './fixtures/household';
import {
  alreadyImported,
  approveBatch,
  checkApproval,
  rejectBatch,
  reverseBatch,
  reviewAll,
  reviewProposal,
  stageExtraction,
} from './imports';
import { balanceOf, isRealTransaction, pendingImportRowCount } from './projection';
import { viewOf } from './store';

/**
 * The approval boundary.
 *
 * This is the file that decides whether the product can be trusted with a bank
 * statement. Everything else about the importer is convenience; this is the part
 * where a document either does or does not silently become the family's financial
 * truth.
 */

const statement = buildCsv({
  delimiter: ';',
  preamble: ['בנק לדוגמה - תנועות בחשבון', 'מספר חשבון 12-345678'],
  header: ['תאריך', 'תיאור', 'חובה', 'זכות', 'יתרה'],
  rows: [
    ['02/09/2026', 'סופרמרקט', '412.30', '', '11,587.70'],
    ['03/09/2026', 'דלק', '318.00', '', '11,269.70'],
    ['04/09/2026', 'החזר', '', '150.00', '11,419.70'],
  ],
});

function stage(document: StoreDocument, accountId: string, bytes = statement) {
  const extraction = extractDocument(bytes, {
    fileName: 'statement.csv',
    currency: 'ILS',
    scope: 'household',
  });

  return stageExtraction(
    document,
    {
      extraction,
      displayName: 'statement.csv',
      storedId: crypto.randomUUID(),
      sha256: 'b'.repeat(64),
      byteSize: bytes.byteLength,
      declaredMimeType: 'text/csv',
      targetAccountId: accountId,
    },
    contextFor(document),
  );
}

describe('nothing crosses into the truth before approval', () => {
  const seeded = seededHousehold();
  const staged = stage(seeded.document, seeded.bankAccountId);

  test('three rows are proposed', () => {
    expect(staged.document.importProposals).toHaveLength(3);
    expect(staged.document.importBatches[0]?.status).toBe('needs_review');
  });

  test('every row starts pending, none included', () => {
    expect(
      staged.document.importProposals.every((proposal) => proposal.reviewState === 'pending'),
    ).toBe(true);
  });

  test('no transaction was created', () => {
    expect(staged.document.transactions).toHaveLength(0);
  });

  test('the balance is exactly what it was', () => {
    expect(balanceOf(staged.document, seeded.bankAccountId).computedMinor).toBe(
      balanceOf(seeded.document, seeded.bankAccountId).computedMinor,
    );
  });

  test('the engine sees none of it', () => {
    const before = viewOf(seeded.document, TEST_NOW);
    const after = viewOf(staged.document, TEST_NOW);

    expect(after.snapshot.safeSpend.resultMinor).toBe(before.snapshot.safeSpend.resultMinor);
    expect(after.snapshot.householdLiquidMinor).toBe(before.snapshot.householdLiquidMinor);
    expect(after.budget?.totals.approvedMinor).toBe(before.budget?.totals.approvedMinor);
  });

  test('the rows are counted as waiting, in their own right', () => {
    expect(pendingImportRowCount(staged.document)).toBe(3);
  });

  test('but they are not counted as unapproved transactions', () => {
    /*
     * The engine scores the approval backlog against the transaction count. A
     * staged proposal is not a transaction and is not in that denominator;
     * counting it there subtracted one population from another, and a household
     * that uploaded a statement watched the safe-spend answer disappear before
     * approving anything.
     */
    const after = viewOf(staged.document, TEST_NOW);
    expect(after.input.dataQuality.pendingApprovalCount).toBe(0);
  });

  test('and the answer the family already had does not disappear', () => {
    const before = viewOf(seeded.document, TEST_NOW);
    const after = viewOf(staged.document, TEST_NOW);
    expect(after.snapshot.decision.status).toBe(before.snapshot.decision.status);
    expect(after.snapshot.quality.confidence).toBe(before.snapshot.quality.confidence);
  });
});

describe('approval requires a decision on every row', () => {
  const seeded = seededHousehold();
  const staged = stage(seeded.document, seeded.bankAccountId);

  test('a batch with pending rows cannot be approved', () => {
    expect(checkApproval(staged.document, staged.value).canApprove).toBe(false);
    expect(() =>
      approveBatch(staged.document, { batchId: staged.value }, contextFor(staged.document)),
    ).toThrow(/not been decided/);
  });

  test('a batch where everything was excluded has nothing to approve', () => {
    const excluded = reviewAll(
      staged.document,
      { batchId: staged.value, reviewState: 'excluded', onlyPending: true },
      contextFor(staged.document),
    );

    expect(checkApproval(excluded.document, staged.value).canApprove).toBe(false);
    expect(() =>
      approveBatch(excluded.document, { batchId: staged.value }, contextFor(excluded.document)),
    ).toThrow(/nothing to approve/);
  });

  test('an included row with no account to attach to blocks approval', () => {
    const detached = reviewAll(
      staged.document,
      { batchId: staged.value, reviewState: 'included', onlyPending: true },
      contextFor(staged.document),
    );
    const unmapped = reviewProposal(
      detached.document,
      {
        proposalId: detached.document.importProposals[0]!.id,
        targetAccountId: null,
      },
      contextFor(detached.document),
    );

    const check = checkApproval(unmapped.document, staged.value);
    expect(check.canApprove).toBe(false);
    expect(check.blocking[0]?.reason).toBe('needs_account');
  });
});

describe('approval creates exactly what was included', () => {
  const seeded = seededHousehold();
  const staged = stage(seeded.document, seeded.bankAccountId);
  const reviewed = reviewAll(
    staged.document,
    { batchId: staged.value, reviewState: 'included', onlyPending: true },
    contextFor(staged.document),
  );
  const excludedOne = reviewProposal(
    reviewed.document,
    { proposalId: reviewed.document.importProposals[1]!.id, reviewState: 'excluded' },
    contextFor(reviewed.document),
  );
  const approved = approveBatch(
    excludedOne.document,
    { batchId: staged.value },
    contextFor(excludedOne.document),
  );

  test('the excluded row created nothing', () => {
    expect(approved.value.transactionsCreated).toBe(2);
    expect(approved.document.transactions).toHaveLength(2);
    expect(
      approved.document.transactions.some((transaction) => transaction.merchant === 'דלק'),
    ).toBe(false);
  });

  test('directions survive the crossing', () => {
    const outflow = approved.document.transactions.find(
      (transaction) => transaction.merchant === 'סופרמרקט',
    );
    const inflow = approved.document.transactions.find(
      (transaction) => transaction.merchant === 'החזר',
    );

    expect(outflow).toMatchObject({
      direction: 'outflow',
      amountMinor: 41_230,
      kind: 'expense',
    });
    expect(inflow).toMatchObject({ direction: 'inflow', amountMinor: 15_000, kind: 'income' });
  });

  test('every created record names the batch and the row it came from', () => {
    for (const transaction of approved.document.transactions) {
      expect(transaction.importBatchId).toBe(staged.value);
      expect(transaction.importProposalId).not.toBeNull();
      expect(transaction.sourceFingerprint).not.toBeNull();
    }
  });

  test('the balance moves by exactly the included rows', () => {
    expect(balanceOf(approved.document, seeded.bankAccountId).computedMinor).toBe(
      1_200_000 - 41_230 + 15_000,
    );
  });

  test('the before-and-after summary matches what actually changed', () => {
    const delta = approved.value.accountDeltas.find(
      (entry) => entry.accountId === seeded.bankAccountId,
    );
    expect(delta?.deltaMinor).toBe(-41_230 + 15_000);
  });

  test('the batch is approved and says who and when', () => {
    const batch = approved.document.importBatches[0];
    expect(batch?.status).toBe('approved');
    expect(batch?.approvedAt).toBe(TEST_NOW);
    expect(batch?.approvedBy).not.toBeNull();
  });

  test('approving twice creates nothing more', () => {
    expect(() =>
      approveBatch(approved.document, { batchId: staged.value }, contextFor(approved.document)),
    ).toThrow(/already been approved/);
    expect(approved.document.transactions).toHaveLength(2);
  });
});

describe('a correction is the reviewer speaking, not the document', () => {
  test('the raw text and the parsed proposal survive a correction untouched', () => {
    const seeded = seededHousehold();
    const staged = stage(seeded.document, seeded.bankAccountId);
    const original = staged.document.importProposals[0]!;

    const corrected = reviewProposal(
      staged.document,
      {
        proposalId: original.id,
        reviewState: 'included',
        correction: {
          kind: 'transaction',
          value: {
            ...(original.proposed.kind === 'transaction'
              ? original.proposed.value
              : ({} as never)),
            amountMinor: 41_200,
            description: 'סופרמרקט — תוקן',
          },
        },
      },
      contextFor(staged.document),
    );

    const after = corrected.document.importProposals[0]!;
    expect(after.raw).toEqual(original.raw);
    expect(after.proposed).toEqual(original.proposed);
    expect(after.correction?.kind).toBe('transaction');
  });

  test('the corrected figure is what gets committed', () => {
    const seeded = seededHousehold();
    const staged = stage(seeded.document, seeded.bankAccountId);
    const original = staged.document.importProposals[0]!;

    let working = reviewAll(
      staged.document,
      { batchId: staged.value, reviewState: 'excluded', onlyPending: true },
      contextFor(staged.document),
    ).document;

    working = reviewProposal(
      working,
      {
        proposalId: original.id,
        reviewState: 'included',
        correction: {
          kind: 'transaction',
          value: {
            ...(original.proposed.kind === 'transaction'
              ? original.proposed.value
              : ({} as never)),
            amountMinor: 41_200,
          },
        },
      },
      contextFor(working),
    ).document;

    const approved = approveBatch(working, { batchId: staged.value }, contextFor(working));

    expect(approved.document.transactions[0]?.amountMinor).toBe(41_200);
  });

  test('a correction may not change what the row is', () => {
    const seeded = seededHousehold();
    const staged = stage(seeded.document, seeded.bankAccountId);
    expect(() =>
      reviewProposal(
        staged.document,
        {
          proposalId: staged.document.importProposals[0]!.id,
          correction: {
            kind: 'balance',
            value: {
              asOfDate: '2026-09-02',
              balanceMinor: 1,
              balanceDirection: 'inflow',
              currency: 'ILS',
              accountHint: null,
            },
          },
        },
        contextFor(staged.document),
      ),
    ).toThrow(CommandError);
  });
});

describe('rejection leaves no trace in the money', () => {
  test('a rejected batch creates nothing and is still visible', () => {
    const seeded = seededHousehold();
    const staged = stage(seeded.document, seeded.bankAccountId);
    const rejected = rejectBatch(
      staged.document,
      { batchId: staged.value },
      contextFor(staged.document),
    );

    expect(rejected.document.transactions).toHaveLength(0);
    expect(rejected.document.importBatches[0]?.status).toBe('rejected');
    expect(rejected.document.importProposals).toHaveLength(3);
  });

  test('a rejected batch cannot then be approved', () => {
    const seeded = seededHousehold();
    const staged = stage(seeded.document, seeded.bankAccountId);
    const rejected = rejectBatch(
      staged.document,
      { batchId: staged.value },
      contextFor(staged.document),
    );

    expect(() =>
      approveBatch(rejected.document, { batchId: staged.value }, contextFor(rejected.document)),
    ).toThrow(/not waiting/);
  });
});

describe('an approved import can be taken back', () => {
  const seeded = seededHousehold();
  const handTyped = spend(seeded.document, seeded.bankAccountId, 5_000, '2026-09-01', 'ידני');
  const staged = stage(handTyped.document, seeded.bankAccountId);
  const reviewed = reviewAll(
    staged.document,
    { batchId: staged.value, reviewState: 'included', onlyPending: true },
    contextFor(staged.document),
  );
  const approved = approveBatch(
    reviewed.document,
    { batchId: staged.value },
    contextFor(reviewed.document),
  );
  const reversed = reverseBatch(
    approved.document,
    { batchId: staged.value, reason: 'הקובץ היה של חודש אחר' },
    contextFor(approved.document),
  );

  test('what the import created stops counting', () => {
    expect(reversed.value.transactionsVoided).toBe(3);
    expect(
      reversed.document.transactions.filter(
        (transaction) => transaction.importBatchId === staged.value,
      ),
    ).toHaveLength(3);
    expect(
      reversed.document.transactions
        .filter((transaction) => transaction.importBatchId === staged.value)
        .every((transaction) => transaction.status === 'void'),
    ).toBe(true);
  });

  test('what the family typed by hand is untouched', () => {
    const typed = reversed.document.transactions.find(
      (transaction) => transaction.merchant === 'ידני',
    );
    expect(typed?.status).toBe('confirmed');
    expect(reversed.document.transactions.filter(isRealTransaction)).toHaveLength(1);
  });

  test('the balance returns to what it was before the import', () => {
    expect(balanceOf(reversed.document, seeded.bankAccountId).computedMinor).toBe(
      balanceOf(handTyped.document, seeded.bankAccountId).computedMinor,
    );
  });

  test('the batch says it was reversed, and when', () => {
    expect(reversed.document.importBatches[0]?.status).toBe('reversed');
    expect(reversed.document.importBatches[0]?.reversedAt).toBe(TEST_NOW);
  });

  test('a reversed batch is still a valid document — it keeps the record of its approval', () => {
    // The store validates every document before writing it. A reversed batch
    // that failed this would leave the reversal impossible to save at all.
    expect(() => parseStoreDocument(reversed.document)).not.toThrow();
    expect(reversed.document.importBatches[0]?.approvedAt).not.toBeNull();
    expect(reversed.document.importBatches[0]?.reversedAt).not.toBeNull();
  });

  test('a batch that was never approved cannot be reversed', () => {
    const other = stage(seeded.document, seeded.bankAccountId);
    expect(() =>
      reverseBatch(
        other.document,
        { batchId: other.value, reason: 'x' },
        contextFor(other.document),
      ),
    ).toThrow(/only an approved import/);
  });
});

describe('the same file, imported twice', () => {
  test('the second upload marks every row a likely duplicate', () => {
    const seeded = seededHousehold();
    const first = stage(seeded.document, seeded.bankAccountId);
    const reviewed = reviewAll(
      first.document,
      { batchId: first.value, reviewState: 'included', onlyPending: true },
      contextFor(first.document),
    );
    const approved = approveBatch(
      reviewed.document,
      { batchId: first.value },
      contextFor(reviewed.document),
    );

    const second = stage(approved.document, seeded.bankAccountId);
    const secondRows = second.document.importProposals.filter(
      (proposal) => proposal.batchId === second.value,
    );

    expect(secondRows).toHaveLength(3);
    expect(
      secondRows.every((proposal) => proposal.duplicateVerdict === 'likely_duplicate'),
    ).toBe(true);
    expect(secondRows.every((proposal) => proposal.reviewState === 'pending')).toBe(true);
  });

  test('the file is recognised before anything is even staged', () => {
    const seeded = seededHousehold();
    const first = stage(seeded.document, seeded.bankAccountId);
    const reviewed = reviewAll(
      first.document,
      { batchId: first.value, reviewState: 'included', onlyPending: true },
      contextFor(first.document),
    );
    const approved = approveBatch(
      reviewed.document,
      { batchId: first.value },
      contextFor(reviewed.document),
    );

    expect(alreadyImported(approved.document, 'b'.repeat(64))?.id).toBe(first.value);
    expect(alreadyImported(approved.document, 'c'.repeat(64))).toBeNull();
  });

  test('reimporting and approving again does not double the money, because the rows are refused', () => {
    const seeded = seededHousehold();
    const first = stage(seeded.document, seeded.bankAccountId);
    const approvedOnce = approveBatch(
      reviewAll(
        first.document,
        { batchId: first.value, reviewState: 'included', onlyPending: true },
        contextFor(first.document),
      ).document,
      { batchId: first.value },
      contextFor(first.document),
    );

    const balanceAfterFirst = balanceOf(
      approvedOnce.document,
      seeded.bankAccountId,
    ).computedMinor;

    // The family sees three "likely duplicate" rows and excludes them all.
    const second = stage(approvedOnce.document, seeded.bankAccountId);
    const excluded = reviewAll(
      second.document,
      { batchId: second.value, reviewState: 'excluded', onlyPending: true },
      contextFor(second.document),
    );

    expect(checkApproval(excluded.document, second.value).canApprove).toBe(false);
    expect(balanceOf(excluded.document, seeded.bankAccountId).computedMinor).toBe(
      balanceAfterFirst,
    );
  });
});

describe('an import that could not be read', () => {
  test('a scan is refused before any proposal exists', () => {
    const seeded = seededHousehold();
    expect(() =>
      extractDocument(new TextEncoder().encode('%PDF-1.4\n'), {
        fileName: 'scan.pdf',
        currency: 'ILS',
        scope: 'household',
      }),
    ).toThrow();
    expect(seeded.document.importProposals).toHaveLength(0);
  });
});
