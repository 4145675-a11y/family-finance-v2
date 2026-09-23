import { buildCsv, extractDocument } from '@family-finance/document-import';
import { projectDailyBalance, summariseChecks } from '@family-finance/finance-engine';
import { describe, expect, test } from 'vitest';

import { createBackup, documentToRestore, previewRestore, serialiseBackup } from './backup';
import { addCheck, addCheckSeries, clearCheck, setRepaymentPlan } from './checks';
import { addDebt, addPlannedItem } from './commands';
import {
  CURRENT_FORMAT_VERSION,
  migrateDocument,
  parseStoreDocument,
  type StoreDocument,
} from './document';
import { proposeCheckMatch } from './check-match';
import { approveBatch, reviewProposal, stageExtraction } from './imports';
import { balanceOf, toEngineInput } from './projection';
import { contextFor, seededHousehold, TEST_NOW, TEST_TODAY } from './fixtures/household';

/**
 * The places checks meet the rest of the product.
 *
 * A check that is modelled perfectly and then counted twice by the forecast, or
 * cleared a second time by a re-imported statement, is a check that is wrong
 * where it matters. These tests cross the seams deliberately.
 */

const NOW = TEST_NOW;
const TODAY = TEST_TODAY;

/**
 * A gemach loan with three monthly checks.
 *
 * `firstDueDate` defaults to a month ahead, which is what the forecast tests are
 * about. The clearing and import tests pass a date behind us instead: a check
 * cannot be honoured before its printed date, and a statement cannot carry a
 * debit that has not happened.
 */
function gemachWithChecks(
  options: { deliveredOn?: string | null; firstDueDate?: string } = {},
) {
  const seeded = seededHousehold();
  const debt = addDebt(
    seeded.document,
    {
      creditorName: 'גמ״ח שכונתי',
      kind: 'gemach',
      openingBalanceMinor: 450_000,
      openedOn: '2026-08-01',
      effectiveAnnualRateBp: 0,
      minimumPaymentMinor: 150_000,
      paymentDueDay: 12,
      urgency: 'none',
      promiseSummary: null,
      relationshipSensitivity: null,
      partialPaymentAllowed: null,
      expectedCallDate: null,
      notes: null,
    },
    contextFor(seeded.document),
  );

  const series = addCheckSeries(
    debt.document,
    {
      debtId: debt.value,
      accountId: seeded.bankAccountId,
      payeeName: 'גמ״ח שכונתי',
      count: 3,
      amountPerCheckMinor: 150_000,
      finalCheckAmountMinor: null,
      firstDueDate: options.firstDueDate ?? '2026-09-12',
      firstCheckNumber: '1001',
      intendedTotalMinor: 450_000,
      note: null,
      deliveredOn: options.deliveredOn === undefined ? '2026-09-01' : options.deliveredOn,
    },
    contextFor(debt.document),
  );

  return {
    document: series.document,
    bankAccountId: seeded.bankAccountId,
    debtId: debt.value,
    checkIds: series.value,
  };
}

describe('the forecast counts a delivered check once', () => {
  test('an outstanding check appears as one planned outflow', () => {
    const world = gemachWithChecks();
    const input = toEngineInput(world.document, { asOf: NOW });

    const items = input.plannedItems.filter((item) => world.checkIds.includes(item.id));
    expect(items).toHaveLength(3);
    expect(new Set(items.map((item) => item.id)).size).toBe(3);
  });

  test('and reduces the projected balance by its face value, once', () => {
    const world = gemachWithChecks();
    const input = toEngineInput(world.document, { asOf: NOW });

    const withChecks = projectDailyBalance(input, TODAY, 'conservative', '2026-09-30');

    // The same household with only the checks taken out, so the difference is
    // the checks and nothing else.
    const withoutChecks = projectDailyBalance(
      {
        ...input,
        plannedItems: input.plannedItems.filter((item) => !world.checkIds.includes(item.id)),
        checks: [],
      },
      TODAY,
      'conservative',
      '2026-09-30',
    );

    // One check falls inside September; the other two are later months.
    expect(withoutChecks.endOfPeriodMinor - withChecks.endOfPeriodMinor).toBe(150_000);
  });

  test('a repayment plan adds nothing of its own', () => {
    // The plan and the checks describe the same obligation. Counting both would
    // charge the family twice for every month of the loan.
    const world = gemachWithChecks();
    const before = toEngineInput(world.document, { asOf: NOW }).plannedItems.length;

    const planned = setRepaymentPlan(
      world.document,
      {
        debtId: world.debtId,
        agreementSummary: 'שלושה תשלומים',
        installmentCount: 3,
        installmentAmountMinor: 150_000,
        finalInstallmentAmountMinor: null,
        firstDueDate: '2026-09-12',
      },
      contextFor(world.document),
    );

    expect(toEngineInput(planned.document, { asOf: NOW }).plannedItems).toHaveLength(before);
  });

  test('a cleared check leaves the forecast entirely', () => {
    const world = gemachWithChecks({ firstDueDate: '2026-06-12' });
    const cleared = clearCheck(
      world.document,
      { checkId: world.checkIds[0]!, clearedOn: '2026-06-13' },
      contextFor(world.document),
    );

    const input = toEngineInput(cleared.document, { asOf: NOW });
    expect(input.plannedItems.some((item) => item.id === world.checkIds[0])).toBe(false);
  });

  test('an overdue check is carried to today rather than disappearing', () => {
    /*
     * The forecast walks forward from today, so an item dated last week would
     * simply vanish from it — and a late uncleared check is the single most
     * likely thing to come out of the account this morning.
     */
    const seeded = seededHousehold();
    const debt = addDebt(
      seeded.document,
      {
        creditorName: 'גמ״ח',
        kind: 'gemach',
        openingBalanceMinor: 150_000,
        openedOn: '2026-06-01',
        effectiveAnnualRateBp: 0,
        minimumPaymentMinor: null,
        paymentDueDay: null,
        urgency: 'none',
        promiseSummary: null,
        relationshipSensitivity: null,
        partialPaymentAllowed: null,
        expectedCallDate: null,
        notes: null,
      },
      contextFor(seeded.document),
    );

    const late = addCheck(
      debt.document,
      {
        debtId: debt.value,
        accountId: seeded.bankAccountId,
        checkNumber: null,
        amountMinor: 150_000,
        // Three weeks before TEST_TODAY, and never cleared.
        dueDate: '2026-08-15',
        payeeName: 'גמ״ח',
        installmentNumber: null,
        note: null,
        deliveredOn: '2026-08-01',
      },
      contextFor(debt.document),
    );

    const input = toEngineInput(late.document, { asOf: NOW });
    const item = input.plannedItems.find((candidate) => candidate.id === late.value);

    expect(item?.expectedDate).toBe(TODAY);

    // The date printed on the paper is not lost — it lives on the check, which
    // is what the screens read.
    expect(late.document.checks.find((check) => check.id === late.value)?.dueDate).toBe(
      '2026-08-15',
    );

    const forecast = projectDailyBalance(input, TODAY, 'conservative', '2026-09-30');
    expect(forecast.days[0]?.outflowMinor).toBe(150_000);
  });

  test('a prepared check is counted but marked as less certain', () => {
    const world = gemachWithChecks({ deliveredOn: null });
    const input = toEngineInput(world.document, { asOf: NOW });
    const item = input.plannedItems.find((candidate) => candidate.id === world.checkIds[0]);

    expect(item?.certainty).toBe('probable');
    // Still counted in full: the forecast is pessimistic about spending by
    // design, and certainty only ever gates income.
    expect(item?.amountMinor).toBe(150_000);
  });

  test('a check is essential, because bouncing one costs more than the money', () => {
    const world = gemachWithChecks();
    const input = toEngineInput(world.document, { asOf: NOW });
    expect(
      input.plannedItems
        .filter((item) => world.checkIds.includes(item.id))
        .every((item) => item.essential),
    ).toBe(true);
  });

  test('an ordinary planned item is untouched by any of this', () => {
    const world = gemachWithChecks();
    const withBill = addPlannedItem(
      world.document,
      {
        label: 'חשמל',
        scope: 'household',
        accountId: null,
        direction: 'outflow',
        amountMinor: 40_000,
        certainty: 'certain',
        expectedDate: '2026-09-20',
        dueDate: '2026-09-20',
        essential: true,
        categoryId: null,
      },
      contextFor(world.document),
    );

    const input = toEngineInput(withBill.document, { asOf: NOW });
    expect(input.plannedItems.filter((item) => item.label === 'חשמל')).toHaveLength(1);
  });
});

describe('importing the clearing of a check', () => {
  /**
   * A statement carrying one row: the gemach banked check 1001.
   *
   * Built as a real CSV and read by the real extractor, so what is being tested
   * is the path a family's file actually takes rather than a hand-written
   * proposal that happens to have the right shape.
   */
  function importedDebit(world: ReturnType<typeof gemachWithChecks>) {
    const csv = buildCsv({
      delimiter: ';',
      preamble: ['בנק לדוגמה - תנועות בחשבון'],
      header: ['תאריך', 'תיאור', 'חובה', 'זכות', 'יתרה'],
      rows: [['13/06/2026', "צ'ק 1001", '1,500.00', '', '10,000.00']],
    });

    return stageExtraction(
      world.document,
      {
        extraction: extractDocument(csv, {
          fileName: 'statement.csv',
          currency: 'ILS',
          scope: 'household',
          importedOn: '2026-09-22',
        }),
        displayName: 'statement.csv',
        storedId: crypto.randomUUID(),
        sha256: crypto.randomUUID().replace(/-/g, '').padEnd(64, '0'),
        byteSize: csv.byteLength,
        declaredMimeType: 'text/csv',
        targetAccountId: world.bankAccountId,
      },
      contextFor(world.document),
    );
  }

  test('the matcher finds the check behind the debit', () => {
    const world = gemachWithChecks({ firstDueDate: '2026-06-12' });
    const proposal = proposeCheckMatch(world.document, {
      accountId: world.bankAccountId,
      amountMinor: 150_000,
      transactionDate: '2026-06-13',
      reference: "צ'ק 1001",
    });

    expect(proposal.best?.checkId).toBe(world.checkIds[0]);
  });

  test('a staged import moves nothing at all until it is approved', () => {
    // The approval boundary, restated for checks: uploading a statement that
    // clears three checks must not clear anything.
    const world = gemachWithChecks({ firstDueDate: '2026-06-12' });
    const staged = importedDebit(world);

    const before = summariseChecks(toEngineInput(world.document, { asOf: NOW }).checks, TODAY);
    const after = summariseChecks(toEngineInput(staged.document, { asOf: NOW }).checks, TODAY);

    expect(after.outstandingTotalMinor).toBe(before.outstandingTotalMinor);
    expect(balanceOf(staged.document, world.bankAccountId).computedMinor).toBe(
      balanceOf(world.document, world.bankAccountId).computedMinor,
    );
  });

  test('approving a matched row clears the check exactly once', () => {
    const world = gemachWithChecks({ firstDueDate: '2026-06-12' });
    const staged = importedDebit(world);
    const proposalId = staged.document.importProposals[0]!.id;

    const reviewed = reviewProposal(
      staged.document,
      {
        proposalId,
        reviewState: 'included',
        targetAccountId: world.bankAccountId,
        targetCheckId: world.checkIds[0]!,
      },
      contextFor(staged.document),
    );

    const bankBefore = balanceOf(reviewed.document, world.bankAccountId).computedMinor;
    const approved = approveBatch(
      reviewed.document,
      { batchId: staged.value },
      contextFor(reviewed.document),
    );

    const check = approved.document.checks.find(
      (candidate) => candidate.id === world.checkIds[0],
    );
    expect(check?.status).toBe('cleared');

    // One movement, not two: no separate expense was created beside the clearing.
    expect(balanceOf(approved.document, world.bankAccountId).computedMinor).toBe(
      bankBefore - 150_000,
    );
    expect(approved.value.transactionsCreated).toBe(1);
    expect(approved.value.debtEventsCreated).toBe(1);
  });

  test('the repayment is linked to the check and to the movement', () => {
    const world = gemachWithChecks({ firstDueDate: '2026-06-12' });
    const staged = importedDebit(world);
    const proposalId = staged.document.importProposals[0]!.id;

    const reviewed = reviewProposal(
      staged.document,
      {
        proposalId,
        reviewState: 'included',
        targetAccountId: world.bankAccountId,
        targetCheckId: world.checkIds[0]!,
      },
      contextFor(staged.document),
    );
    const approved = approveBatch(
      reviewed.document,
      { batchId: staged.value },
      contextFor(reviewed.document),
    );

    const check = approved.document.checks.find(
      (candidate) => candidate.id === world.checkIds[0],
    );
    const event = approved.document.debtEvents.find(
      (candidate) => candidate.id === check?.debtEventId,
    );

    expect(event?.kind).toBe('principal_payment');
    expect(event?.transactionId).toBe(check?.clearedTransactionId);
    expect(event?.importBatchId).toBe(staged.value);
  });

  test('importing the same statement again cannot clear the check twice', () => {
    // The idempotency that matters. The second attempt is refused by the check's
    // own state rather than caught by a duplicate heuristic.
    const world = gemachWithChecks({ firstDueDate: '2026-06-12' });
    const first = importedDebit(world);
    const reviewedFirst = reviewProposal(
      first.document,
      {
        proposalId: first.document.importProposals[0]!.id,
        reviewState: 'included',
        targetAccountId: world.bankAccountId,
        targetCheckId: world.checkIds[0]!,
      },
      contextFor(first.document),
    );
    const approvedFirst = approveBatch(
      reviewedFirst.document,
      { batchId: first.value },
      contextFor(reviewedFirst.document),
    );

    const second = importedDebit({ ...world, document: approvedFirst.document });
    const reviewedSecond = reviewProposal(
      second.document,
      {
        proposalId: second.document.importProposals.at(-1)!.id,
        reviewState: 'included',
        targetAccountId: world.bankAccountId,
        targetCheckId: world.checkIds[0]!,
      },
      contextFor(second.document),
    );

    expect(() =>
      approveBatch(
        reviewedSecond.document,
        { batchId: second.value },
        contextFor(reviewedSecond.document),
      ),
    ).toThrow(/already been cleared/);

    // And the figures after the refusal are the ones from the first approval.
    expect(balanceOf(approvedFirst.document, world.bankAccountId).computedMinor).toBe(
      balanceOf(world.document, world.bankAccountId).computedMinor - 150_000,
    );
  });

  test('a row with no check attached imports as an ordinary expense', () => {
    // Not everything is a check, and a family who does not match the row should
    // still get their statement imported.
    const world = gemachWithChecks({ firstDueDate: '2026-06-12' });
    const staged = importedDebit(world);
    const reviewed = reviewProposal(
      staged.document,
      {
        proposalId: staged.document.importProposals[0]!.id,
        reviewState: 'included',
        targetAccountId: world.bankAccountId,
      },
      contextFor(staged.document),
    );
    const approved = approveBatch(
      reviewed.document,
      { batchId: staged.value },
      contextFor(reviewed.document),
    );

    // The money moved, and the check is still waiting — which is exactly what
    // the gemach screen will then be telling them to look at.
    expect(approved.value.transactionsCreated).toBe(1);
    expect(approved.value.debtEventsCreated).toBe(0);
    expect(
      approved.document.checks.find((candidate) => candidate.id === world.checkIds[0])?.status,
    ).toBe('delivered');
  });
});

describe('backup and restore carry the checks', () => {
  test('a round trip preserves every check and its links', () => {
    const world = gemachWithChecks({ firstDueDate: '2026-06-12' });
    const planned = setRepaymentPlan(
      world.document,
      {
        debtId: world.debtId,
        agreementSummary: 'שלושה תשלומים חודשיים',
        installmentCount: 3,
        installmentAmountMinor: 150_000,
        finalInstallmentAmountMinor: null,
        firstDueDate: '2026-06-12',
      },
      contextFor(world.document),
    );
    const cleared = clearCheck(
      planned.document,
      { checkId: world.checkIds[0]!, clearedOn: '2026-06-13' },
      contextFor(planned.document),
    );

    const text = serialiseBackup(createBackup(cleared.document, NOW));
    const preview = previewRestore(text, null);
    const restored = documentToRestore(preview);

    expect(restored.checks).toHaveLength(3);
    expect(restored.repaymentPlans).toHaveLength(1);

    const check = restored.checks.find((candidate) => candidate.id === world.checkIds[0]);
    expect(check?.status).toBe('cleared');
    expect(check?.clearedTransactionId).not.toBeNull();
    expect(check?.debtEventId).not.toBeNull();
  });

  test('the restored document produces the same exposure', () => {
    const world = gemachWithChecks();
    const text = serialiseBackup(createBackup(world.document, NOW));
    const restored = documentToRestore(previewRestore(text, null));

    expect(summariseChecks(toEngineInput(restored, { asOf: NOW }).checks, TODAY)).toEqual(
      summariseChecks(toEngineInput(world.document, { asOf: NOW }).checks, TODAY),
    );
  });

  test('a backup written before checks existed still restores', () => {
    /*
     * The migration, exercised as a family would meet it: a backup taken last
     * month, from a build that had never heard of a check. It must restore
     * cleanly with no checks rather than be refused as the wrong shape.
     */
    const world = gemachWithChecks();
    const olderShape: Record<string, unknown> = { ...world.document, formatVersion: 1 };
    delete olderShape['checks'];
    delete olderShape['repaymentPlans'];

    const envelope = createBackup(olderShape as unknown as StoreDocument, NOW);
    const restored = documentToRestore(previewRestore(serialiseBackup(envelope), null));

    expect(restored.formatVersion).toBe(CURRENT_FORMAT_VERSION);
    expect(restored.checks).toEqual([]);
    expect(restored.repaymentPlans).toEqual([]);
  });

  test('a backup from a future format is refused rather than half-read', () => {
    const world = gemachWithChecks();
    const envelope = createBackup(
      { ...world.document, formatVersion: 99 } as unknown as StoreDocument,
      NOW,
    );

    expect(() => previewRestore(serialiseBackup(envelope), null)).toThrow(
      /cannot read|format/i,
    );
  });

  test('a tampered backup is caught by its checksum', () => {
    const world = gemachWithChecks();
    const text = serialiseBackup(createBackup(world.document, NOW));
    const tampered = text.replace('"amountMinor": 150000', '"amountMinor": 15000');

    expect(text).not.toBe(tampered);
    expect(() => previewRestore(tampered, null)).toThrow(/checksum/i);
  });
});

describe('the migration itself', () => {
  test('adds the empty collections and nothing else', () => {
    const before: Record<string, unknown> = { formatVersion: 1, household: { name: 'x' } };
    const after = migrateDocument(before) as Record<string, unknown>;

    expect(after['formatVersion']).toBe(2);
    expect(after['checks']).toEqual([]);
    expect(after['repaymentPlans']).toEqual([]);
    expect(after['household']).toEqual({ name: 'x' });
  });

  test('leaves a current document alone', () => {
    const document: Record<string, unknown> = {
      formatVersion: 2,
      checks: [{ id: 'keep-me' }],
      repaymentPlans: [],
    };
    expect(migrateDocument(document)).toEqual(document);
  });

  test('does not invent collections for something that is not a document', () => {
    expect(migrateDocument(null)).toBeNull();
    expect(migrateDocument('nonsense')).toBe('nonsense');
  });

  test('a document whose proposals predate the check field still parses', () => {
    /*
     * The case the first version of this migration missed, and that a browser
     * found within a minute of the code being right in every test.
     *
     * Version 2 added a collection *and* a field on an existing row. The
     * collection is obviously absent from an older file; the field is not, and
     * omitting it meant every household that had ever imported a statement met
     * an unreadable document on their next page load.
     */
    const world = gemachWithChecks();
    const older = JSON.parse(JSON.stringify(world.document)) as Record<string, unknown>;
    older['formatVersion'] = 1;
    delete older['checks'];
    delete older['repaymentPlans'];
    older['importProposals'] = [
      {
        id: crypto.randomUUID(),
        batchId: crypto.randomUUID(),
        kind: 'transaction',
        location: { sheetName: null, page: null, row: 2, snippet: null },
        raw: [{ column: 'תיאור', text: 'סופרמרקט' }],
        proposed: {
          kind: 'transaction',
          value: {
            transactionDate: '2026-09-02',
            postingDate: null,
            description: 'סופרמרקט',
            amountMinor: 41_230,
            direction: 'outflow',
            currency: 'ILS',
            scope: 'household',
            categoryKey: null,
            reference: null,
            installmentNumber: null,
            installmentTotal: null,
            balanceAfterMinor: null,
            balanceAfterDirection: null,
          },
        },
        correction: null,
        confidenceBp: 9_000,
        warnings: [],
        duplicateVerdict: 'new',
        duplicateOfId: null,
        reviewState: 'pending',
        targetAccountId: world.bankAccountId,
        targetDebtId: null,
        // No `targetCheckId`: this row was written before the field existed.
        committedRecordId: null,
        createdAt: NOW,
        updatedAt: NOW,
        version: 1,
      },
    ];

    const parsed = parseStoreDocument(older);
    expect(parsed.formatVersion).toBe(CURRENT_FORMAT_VERSION);
    expect(parsed.importProposals[0]?.targetCheckId).toBeNull();
  });

  test('a migrated document parses', () => {
    const world = gemachWithChecks();
    const older: Record<string, unknown> = { ...world.document, formatVersion: 1 };
    delete older['checks'];
    delete older['repaymentPlans'];

    expect(() => parseStoreDocument(older)).not.toThrow();
  });
});
