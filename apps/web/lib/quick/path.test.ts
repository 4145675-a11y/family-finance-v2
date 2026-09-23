import { replayDebtBalances } from '@family-finance/finance-engine';
import {
  addDebt,
  closeAccount,
  recordDebtEvent,
  recordTransaction,
  type StoreDocument,
} from '@family-finance/local-store';
import { contextFor, seededHousehold } from '@family-finance/local-store/fixtures';
import { interpretQuickUpdate } from '@family-finance/quick-update';
import { describe, expect, test } from 'vitest';

import { debtEventKey } from './keys';
import { contextFromDocument } from './read';

/**
 * A sentence, all the way to a record.
 *
 * The reading is covered by the pure tests in `@family-finance/quick-update`.
 * What this file proves is the part that only exists once reading meets money:
 *
 *   * the quick screen writes through the **same commands** as every form, so no
 *     money rule can hold on one screen and not another;
 *   * a repayment approved twice leaves one transaction and one debt event, and
 *     the balance moves once (scenario 11 in docs/QUICK-UPDATE.md);
 *   * the proposal's own figures, and not a browser's, are what get written.
 *
 * Nothing here reaches a real household: every test builds its own document
 * from the fixture and throws it away.
 */

const TODAY = '2026-09-23';
const SUBMISSION = '11111111-1111-4111-8111-111111111111';

/**
 * A household with one open account and one lender owed 1,000.00.
 *
 * The fixture's other accounts are closed rather than ignored, because the
 * reader decides what is choosable from the document and a test that quietly
 * filtered them would be proving something the product does not do. Whether a
 * sentence can name an account among several is a separate question, answered
 * by its own tests in the reader.
 */
function household(): { document: StoreDocument; debtId: string } {
  const seeded = seededHousehold();
  let base = seeded.document;
  for (const account of seeded.document.accounts) {
    if (account.id === seeded.bankAccountId) continue;
    base = closeAccount(base, { accountId: account.id }, contextFor(base)).document;
  }

  const opened = addDebt(
    base,
    {
      creditorName: 'גמח אור החיים',
      kind: 'gemach',
      openingBalanceMinor: 100_000,
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
    contextFor(base),
  );
  return { document: opened.document, debtId: opened.value };
}

/** Exactly what `confirmQuickUpdateAction` does, minus the store round trip. */
function approveRepayment(document: StoreDocument, text: string, key: string): StoreDocument {
  const proposals = interpretQuickUpdate(text, contextFromDocument(document, TODAY));
  const proposal = proposals[0];
  if (proposal === undefined) throw new Error('nothing was read');
  if (
    proposal.accountId === null ||
    proposal.debtId === null ||
    proposal.amountMinor === null
  ) {
    throw new Error('the proposal was not ready');
  }

  const spent = recordTransaction(
    document,
    {
      idempotencyKey: key,
      accountId: proposal.accountId,
      counterpartAccountId: null,
      scope: proposal.scope,
      kind: 'expense',
      direction: 'outflow',
      amountMinor: proposal.amountMinor,
      categoryId: null,
      merchant: proposal.description,
      transactionDate: proposal.date,
      note: text,
      status: 'confirmed',
    },
    contextFor(document),
  );

  const moved = recordDebtEvent(
    spent.document,
    {
      idempotencyKey: debtEventKey(key),
      debtId: proposal.debtId,
      kind: 'principal_payment',
      amountMinor: proposal.amountMinor,
      occurredOn: proposal.date,
      correctionEffect: null,
      note: proposal.description,
    },
    contextFor(spent.document),
  );

  return moved.document;
}

const SENTENCE = 'החזרתי 500 לגמח אור החיים היום';

describe('a spoken repayment becomes one transaction and one debt event', () => {
  const { document, debtId } = household();
  const after = approveRepayment(document, SENTENCE, SUBMISSION);

  test('the money leaving the account is recorded', () => {
    expect(after.transactions).toHaveLength(document.transactions.length + 1);
    expect(after.transactions.at(-1)?.amountMinor).toBe(50_000);
  });

  test('and the balance moves, through an event rather than a written figure', () => {
    expect(after.debtEvents).toHaveLength(document.debtEvents.length + 1);
    const balances = replayDebtBalances(after.debtEvents, TODAY);
    expect(balances.get(debtId)).toBe(50_000);
  });
});

describe('11. approving the same sentence twice', () => {
  const { document, debtId } = household();
  const once = approveRepayment(document, SENTENCE, SUBMISSION);
  const twice = approveRepayment(once, SENTENCE, SUBMISSION);

  test('leaves one transaction', () => {
    expect(twice.transactions).toHaveLength(once.transactions.length);
  });

  test('leaves one debt event', () => {
    expect(twice.debtEvents).toHaveLength(once.debtEvents.length);
  });

  test('and the balance moved exactly once', () => {
    expect(replayDebtBalances(twice.debtEvents, TODAY).get(debtId)).toBe(50_000);
  });
});

describe('two genuine repayments of the same amount both count', () => {
  const { document, debtId } = household();
  const first = approveRepayment(document, SENTENCE, SUBMISSION);
  const second = approveRepayment(first, SENTENCE, '22222222-2222-4222-8222-222222222222');

  test('because the submission, not the amount, is what identifies a record', () => {
    expect(second.debtEvents).toHaveLength(first.debtEvents.length + 1);
    expect(replayDebtBalances(second.debtEvents, TODAY).get(debtId)).toBe(0);
  });
});

describe('the derived key', () => {
  test('is a different identifier from the submission it came from', () => {
    expect(debtEventKey(SUBMISSION)).not.toBe(SUBMISSION);
  });

  test('is the same one every time, which is the whole point', () => {
    expect(debtEventKey(SUBMISSION)).toBe(debtEventKey(SUBMISSION));
  });

  test('is a different identifier for a different submission', () => {
    expect(debtEventKey(SUBMISSION)).not.toBe(
      debtEventKey('22222222-2222-4222-8222-222222222222'),
    );
  });

  test('has the shape of the column it is written into', () => {
    expect(debtEventKey(SUBMISSION)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe('the household is read as the reader needs to see it', () => {
  const { document } = household();
  const context = contextFromDocument(document, TODAY);

  test('a closed account is carried as closed rather than dropped', () => {
    // Dropping it would make the reader unable to say why an account a family
    // named is not on offer. Marked closed, the refusal has a reason.
    expect(context.accounts.length).toBe(document.accounts.length);
    expect(context.accounts.filter((account) => account.status === 'open')).toHaveLength(1);
    expect(context.accounts.some((account) => account.status === 'closed')).toBe(true);
  });

  test('the lender the family has is one the sentence can name', () => {
    expect(context.debts.map((debt) => debt.creditorName)).toContain('גמח אור החיים');
  });

  test('today is what was passed in, never a clock this module read', () => {
    expect(context.today).toBe(TODAY);
  });
});
