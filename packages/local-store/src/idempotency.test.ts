import { buildXlsx, extractDocument } from '@family-finance/document-import';
import { describe, expect, test } from 'vitest';

import {
  addAccount,
  addBusiness,
  addDebt,
  addPlannedItem,
  addTask,
  recordBalance,
  recordDebtEvent,
  recordTransaction,
} from './commands';
import type { StoreDocument } from './document';
import { contextFor, seededHousehold } from './fixtures/household';
import { approveBatch, reverseBatch, reviewAll, stageExtraction } from './imports';
import { addLearnedRule } from './learned-rules';

/**
 * The same intended action, submitted more than once.
 *
 * A form is pressed twice, a slow response is retried, a page that posted is
 * refreshed, two requests race each other. Every one of those arrives at the
 * store as a second call with the identifier the form was rendered with, and
 * every one of them has to leave exactly one record behind.
 *
 * The guarantee is not a disabled button and not a debounce: it is that the
 * identifier *is* the record's primary key. These tests exercise it at the place
 * it actually holds — the command, which is what both the file store and the
 * database write through.
 *
 * Nothing here touches a real household: every test builds its own document.
 */

const KEY = '11111111-1111-4111-8111-111111111111';
const OTHER_KEY = '22222222-2222-4222-8222-222222222222';

/** A small synthetic statement. No real merchant, amount or file appears here. */
const SHEET = buildXlsx([
  {
    name: 'תנועות',
    rows: [
      ['תאריך', 'תיאור', 'סכום'],
      ['01/02/2026', 'סופרמרקט', -4500],
      ['02/02/2026', 'דלק', -20000],
    ],
  },
]);

function household() {
  const seeded = seededHousehold();
  return { document: seeded.document, context: contextFor(seeded.document), seeded };
}

describe('a lender payment pressed twice', () => {
  function withDebt() {
    const { document, context } = household();
    const opened = addDebt(
      document,
      {
        creditorName: 'מלווה בדיקה',
        kind: 'gemach',
        openingBalanceMinor: 500_000,
        openedOn: '2026-01-01',
        effectiveAnnualRateBp: null,
        minimumPaymentMinor: null,
        paymentDueDay: null,
        urgency: 'none',
        promiseSummary: null,
        relationshipSensitivity: null,
        partialPaymentAllowed: null,
        expectedCallDate: null,
        notes: null,
      },
      context,
    );
    return { document: opened.document, debtId: opened.value, context };
  }

  const payment = (
    document: StoreDocument,
    context: ReturnType<typeof contextFor>,
    debtId: string,
    key?: string,
  ) =>
    recordDebtEvent(
      document,
      {
        debtId,
        kind: 'principal_payment',
        amountMinor: 100_000,
        occurredOn: '2026-02-01',
        correctionEffect: null,
        ...(key === undefined ? {} : { idempotencyKey: key }),
      },
      context,
    );

  test('a double click records one payment', () => {
    const { document, debtId, context } = withDebt();
    const first = payment(document, context, debtId, KEY);
    const second = payment(first.document, context, debtId, KEY);

    const payments = second.document.debtEvents.filter((e) => e.kind === 'principal_payment');
    expect(payments).toHaveLength(1);
    expect(second.value).toBe(first.value);
  });

  test('the second press says it was already recorded', () => {
    const { document, debtId, context } = withDebt();
    const first = payment(document, context, debtId, KEY);
    expect(first.alreadyRecorded).toBeFalsy();

    const second = payment(first.document, context, debtId, KEY);
    expect(second.alreadyRecorded).toBe(true);
  });

  test('a retry after a slow response records one payment', () => {
    // The first call succeeded but the answer never reached the browser; the
    // person pressed again with the same form still on screen.
    const { document, debtId, context } = withDebt();
    const committed = payment(document, context, debtId, KEY);
    const retried = payment(committed.document, context, debtId, KEY);

    expect(
      retried.document.debtEvents.filter((e) => e.kind === 'principal_payment'),
    ).toHaveLength(1);
  });

  test('two requests racing each other leave one payment', () => {
    // Both read the same document, both apply the command; whichever is written
    // second is applied to a document that already contains the first.
    const { document, debtId, context } = withDebt();
    const a = payment(document, context, debtId, KEY);
    const b = payment(document, context, debtId, KEY);

    // Each on its own sees an empty history and writes the record…
    expect(a.value).toBe(KEY);
    expect(b.value).toBe(KEY);
    // …and because both name the same identifier, applying the loser on top of
    // the winner changes nothing.
    const merged = payment(a.document, context, debtId, KEY);
    expect(merged.alreadyRecorded).toBe(true);
    expect(
      merged.document.debtEvents.filter((e) => e.kind === 'principal_payment'),
    ).toHaveLength(1);
  });

  test('two genuinely different payments of the same amount both save', () => {
    const { document, debtId, context } = withDebt();
    const first = payment(document, context, debtId, KEY);
    const second = payment(first.document, context, debtId, OTHER_KEY);

    expect(
      second.document.debtEvents.filter((e) => e.kind === 'principal_payment'),
    ).toHaveLength(2);
    expect(second.alreadyRecorded).toBeFalsy();
  });

  test('a caller with no key still records each call — the importer means it', () => {
    const { document, debtId, context } = withDebt();
    const first = payment(document, context, debtId);
    const second = payment(first.document, context, debtId);
    expect(
      second.document.debtEvents.filter((e) => e.kind === 'principal_payment'),
    ).toHaveLength(2);
  });
});

describe('every other command that creates a record', () => {
  test('a new debt submitted twice is one debt', () => {
    const { document, context } = household();
    const input = {
      creditorName: 'מלווה חדש',
      kind: 'gemach' as const,
      openingBalanceMinor: 100_000,
      openedOn: '2026-01-01',
      effectiveAnnualRateBp: null,
      minimumPaymentMinor: null,
      paymentDueDay: null,
      urgency: 'none' as const,
      promiseSummary: null,
      relationshipSensitivity: null,
      partialPaymentAllowed: null,
      expectedCallDate: null,
      notes: null,
      idempotencyKey: KEY,
    };
    const first = addDebt(document, input, context);
    const second = addDebt(first.document, input, context);

    expect(second.document.debts.filter((d) => d.creditorName === 'מלווה חדש')).toHaveLength(1);
    expect(second.alreadyRecorded).toBe(true);
    // And the opening balance was not doubled either.
    expect(
      second.document.debtEvents.filter(
        (e) => e.debtId === first.value && e.kind === 'opening_balance',
      ),
    ).toHaveLength(1);
  });

  test('a manual transaction submitted twice is one transaction', () => {
    const { document, context, seeded } = household();
    const input = {
      accountId: seeded.bankAccountId,
      counterpartAccountId: null,
      scope: 'household' as const,
      kind: 'expense' as const,
      direction: 'outflow' as const,
      amountMinor: 12_300,
      categoryId: null,
      merchant: 'סופרמרקט',
      transactionDate: '2026-02-01',
      note: null,
      status: 'confirmed' as const,
      idempotencyKey: KEY,
    };
    const first = recordTransaction(document, input, context);
    const second = recordTransaction(first.document, input, context);

    expect(second.document.transactions.filter((t) => t.merchant === 'סופרמרקט')).toHaveLength(
      1,
    );
    expect(second.alreadyRecorded).toBe(true);
  });

  test('two different shops of the same amount on the same day both save', () => {
    const { document, context, seeded } = household();
    const base = {
      accountId: seeded.bankAccountId,
      counterpartAccountId: null,
      scope: 'household' as const,
      kind: 'expense' as const,
      direction: 'outflow' as const,
      amountMinor: 12_300,
      categoryId: null,
      transactionDate: '2026-02-01',
      note: null,
      status: 'confirmed' as const,
    };
    const first = recordTransaction(
      document,
      { ...base, merchant: 'חנות א', idempotencyKey: KEY },
      context,
    );
    const second = recordTransaction(
      first.document,
      { ...base, merchant: 'חנות ב', idempotencyKey: OTHER_KEY },
      context,
    );
    expect(second.document.transactions.filter((t) => t.amountMinor === 12_300)).toHaveLength(
      2,
    );
  });

  test('an account added twice is one account', () => {
    const { document, context } = household();
    const input = {
      name: 'עו״ש חדש',
      kind: 'bank_account' as const,
      scope: 'household' as const,
      institution: null,
      displaySuffix: null,
      openingBalanceMinor: 0,
      openingBalanceDirection: 'inflow' as const,
      openingBalanceDate: '2026-01-01',
      idempotencyKey: KEY,
    };
    const first = addAccount(document, input, context);
    const second = addAccount(first.document, input, context);
    expect(second.document.accounts.filter((a) => a.name === 'עו״ש חדש')).toHaveLength(1);
    expect(second.alreadyRecorded).toBe(true);
  });

  test('a balance confirmation submitted twice is one snapshot', () => {
    const { document, context, seeded } = household();
    const before = document.balanceSnapshots.length;
    const input = {
      accountId: seeded.bankAccountId,
      balanceMinor: 250_000,
      balanceDirection: 'inflow' as const,
      verifiedAt: '2026-02-01T10:00:00.000Z',
      source: 'manual_entry' as const,
      note: null,
      idempotencyKey: KEY,
    };
    const first = recordBalance(document, input, context);
    const second = recordBalance(first.document, input, context);
    expect(second.document.balanceSnapshots).toHaveLength(before + 1);
    expect(second.alreadyRecorded).toBe(true);
  });

  test('a reminder added twice is one task', () => {
    const { document, context } = household();
    const input = {
      title: 'לשלם לרפאל',
      reason: null,
      origin: 'manual' as const,
      recommendationKey: null,
      amountMinor: null,
      relatedDebtId: null,
      relatedAccountId: null,
      assignedMemberId: null,
      dueOn: '2026-02-10',
      idempotencyKey: KEY,
    };
    const first = addTask(document, input, context);
    const second = addTask(first.document, input, context);
    expect(second.document.tasks.filter((t) => t.title === 'לשלם לרפאל')).toHaveLength(1);
    expect(second.alreadyRecorded).toBe(true);
  });

  test('a planned item added twice is one item', () => {
    const { document, context, seeded } = household();
    const input = {
      label: 'ארנונה',
      scope: 'household' as const,
      direction: 'outflow' as const,
      amountMinor: 50_000,
      certainty: 'certain' as const,
      expectedDate: '2026-02-15',
      dueDate: null,
      essential: true,
      categoryId: null,
      accountId: seeded.bankAccountId,
      idempotencyKey: KEY,
    };
    const first = addPlannedItem(document, input, context);
    const second = addPlannedItem(first.document, input, context);
    expect(second.document.cashflowItems.filter((c) => c.label === 'ארנונה')).toHaveLength(1);
    expect(second.alreadyRecorded).toBe(true);
  });

  test('a business added twice is refused by the domain, which is stronger', () => {
    /*
     * A household has at most one business, and `addBusiness` has always said
     * so. That rule is a better guarantee than an identifier: it holds even for
     * a genuinely new second attempt, which an identifier would let through.
     * The key is carried anyway so the two cannot disagree.
     */
    const { document, context } = household();
    const input = {
      name: 'עסק נוסף',
      taxReserveRateBp: 2_500,
      operatingReserveMinor: 0,
      idempotencyKey: KEY,
    };
    expect(() => addBusiness(document, input, context)).toThrow(/already has a business/);
  });

  test('which is why the test above throws: the fixture already has one', () => {
    expect(seededHousehold().document.businesses.length).toBeGreaterThan(0);
  });
});

describe('paths that were already protected stay protected', () => {
  test('a classification rule saved twice is one rule', () => {
    const { document, context } = household();
    const input = {
      label: 'סופרמרקט הוא אוכל',
      matcher: {
        descriptionContains: 'סופרמרקט',
        direction: 'outflow' as const,
        accountId: null,
      },
      class: 'purchase' as const,
      budgetCategoryKey: 'food' as const,
      counterparty: null,
      debtId: null,
    };
    const first = addLearnedRule(document, input, context);
    const second = addLearnedRule(first.document, input, context);

    expect(second.document.learnedRules).toHaveLength(1);
    expect(second.value).toBe(first.value);
    expect(second.alreadyRecorded).toBe(true);
  });
});

describe('a repeat writes nothing at all', () => {
  test('the document is returned unchanged, so no change set is produced', () => {
    const { document, context, seeded } = household();
    const input = {
      accountId: seeded.bankAccountId,
      counterpartAccountId: null,
      scope: 'household' as const,
      kind: 'expense' as const,
      direction: 'outflow' as const,
      amountMinor: 900,
      categoryId: null,
      merchant: 'שוב',
      transactionDate: '2026-02-01',
      note: null,
      status: 'confirmed' as const,
      idempotencyKey: KEY,
    };
    const first = recordTransaction(document, input, context);
    const second = recordTransaction(first.document, input, context);

    // Same object identity: nothing was rebuilt, so nothing can be sent.
    expect(second.document).toBe(first.document);
  });

  test('and no audit entry is added for the repeat', () => {
    const { document, context, seeded } = household();
    const input = {
      accountId: seeded.bankAccountId,
      counterpartAccountId: null,
      scope: 'household' as const,
      kind: 'expense' as const,
      direction: 'outflow' as const,
      amountMinor: 900,
      categoryId: null,
      merchant: 'שוב',
      transactionDate: '2026-02-01',
      note: null,
      status: 'confirmed' as const,
      idempotencyKey: KEY,
    };
    const first = recordTransaction(document, input, context);
    const auditAfterFirst = first.document.audit.length;
    const second = recordTransaction(first.document, input, context);
    expect(second.document.audit).toHaveLength(auditAfterFirst);
  });
});

/**
 * The writes that create nothing.
 *
 * Approving an import, undoing one, closing an account — none of these mints a
 * record whose primary key could carry a submission's identifier. They move a
 * thing that already exists from one state to another, and a second move is
 * refused by the state machine itself.
 *
 * These tests exist so that the refusal is a stated property rather than an
 * assumption. Adding a key to these paths as well would put two guards on one
 * door and hide which of them is holding it.
 */
describe('a state change is protected by the state machine, not by a key', () => {
  function importedBatch() {
    const { document, context, seeded } = household();
    const extraction = extractDocument(SHEET, {
      fileName: 'הוצאות.xlsx',
      currency: 'ILS',
      scope: 'household',
      importedOn: '2026-02-01',
    });
    const staged = stageExtraction(
      document,
      {
        extraction,
        displayName: 'הוצאות.xlsx',
        storedId: crypto.randomUUID(),
        sha256: 'd'.repeat(64),
        byteSize: SHEET.byteLength,
        declaredMimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        targetAccountId: seeded.bankAccountId,
      },
      context,
    );
    const batchId = staged.value;
    const reviewed = reviewAll(
      staged.document,
      { batchId, reviewState: 'included', onlyPending: false },
      contextFor(staged.document),
    );
    return { batchId, document: reviewed.document };
  }

  test('an import approved twice is refused the second time', () => {
    const { batchId, document } = importedBatch();
    const approved = approveBatch(document, { batchId }, contextFor(document));
    const before = approved.document.transactions.length;

    expect(() =>
      approveBatch(approved.document, { batchId }, contextFor(approved.document)),
    ).toThrow(/already been approved/);
    // And nothing moved while it was refused.
    expect(approved.document.transactions).toHaveLength(before);
  });

  test('an import undone twice is refused the second time', () => {
    const { batchId, document } = importedBatch();
    const approved = approveBatch(document, { batchId }, contextFor(document));
    const undone = reverseBatch(
      approved.document,
      { batchId, reason: 'הועלה בטעות' },
      contextFor(approved.document),
    );

    expect(() =>
      reverseBatch(
        undone.document,
        { batchId, reason: 'הועלה בטעות' },
        contextFor(undone.document),
      ),
    ).toThrow(/only an approved import/);
  });
});
