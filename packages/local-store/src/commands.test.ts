import { describe, expect, test } from 'vitest';

import {
  CommandError,
  acceptReconciliationGap,
  addAccount,
  addTask,
  recordBalance,
  recordRollover,
  recordTransaction,
  transferToHousehold,
  updateTask,
  voidTransaction,
} from './commands';
import {
  apply,
  contextFor,
  seededHousehold,
  spend,
  TEST_NOW,
  TEST_TODAY,
} from './fixtures/household';
import { balanceOf, isRealTransaction, toEngineInput } from './projection';
import { viewOf } from './store';

/**
 * The financial invariants, held against the store rather than against the engine.
 *
 * The engine has its own suite and it is a pure function, so it can be trusted to
 * do arithmetic. What is tested here is the layer that decides *which* facts the
 * engine is shown — which is where an invariant is actually broken in practice: a
 * draft that leaked into a total, a transfer counted as income, a voided row that
 * kept being included.
 */

describe('a balance is opening plus every real movement', () => {
  test('a confirmed expense lowers the account', () => {
    const seeded = seededHousehold();
    const after = spend(seeded.document, seeded.bankAccountId, 30_000, '2026-09-06', 'מכולת');

    expect(balanceOf(after.document, seeded.bankAccountId).computedMinor).toBe(1_170_000);
  });

  test('a draft does not', () => {
    const seeded = seededHousehold();
    const after = recordTransaction(
      seeded.document,
      {
        accountId: seeded.bankAccountId,
        counterpartAccountId: null,
        scope: 'household',
        kind: 'expense',
        direction: 'outflow',
        amountMinor: 30_000,
        categoryId: null,
        merchant: 'מכולת',
        transactionDate: '2026-09-06',
        note: null,
        status: 'draft',
      },
      contextFor(seeded.document),
    );

    expect(balanceOf(after.document, seeded.bankAccountId).computedMinor).toBe(1_200_000);
  });

  test('a voided row stops counting but stays in the history', () => {
    const seeded = seededHousehold();
    const spent = spend(seeded.document, seeded.bankAccountId, 30_000, '2026-09-06', 'מכולת');
    const voided = voidTransaction(
      spent.document,
      { transactionId: spent.value, reason: 'נרשם פעמיים' },
      contextFor(spent.document),
    );

    expect(balanceOf(voided.document, seeded.bankAccountId).computedMinor).toBe(1_200_000);
    expect(voided.document.transactions).toHaveLength(1);
    expect(voided.document.transactions[0]?.status).toBe('void');
  });

  test('voiding twice is a no-op rather than an error', () => {
    const seeded = seededHousehold();
    const spent = spend(seeded.document, seeded.bankAccountId, 30_000, '2026-09-06', 'מכולת');
    const once = voidTransaction(
      spent.document,
      { transactionId: spent.value, reason: 'טעות' },
      contextFor(spent.document),
    );
    const twice = voidTransaction(
      once.document,
      { transactionId: spent.value, reason: 'טעות' },
      contextFor(once.document),
    );

    expect(twice.document.transactions[0]?.version).toBe(
      once.document.transactions[0]?.version,
    );
  });
});

describe('a card settlement is not a second expense', () => {
  test('paying the card moves money without spending it', () => {
    const seeded = seededHousehold();

    // A purchase on the card.
    const purchase = spend(seeded.document, seeded.cardAccountId, 50_000, '2026-09-02', 'חנות');

    // Then the bank pays the card off.
    const settlement = recordTransaction(
      purchase.document,
      {
        accountId: seeded.bankAccountId,
        counterpartAccountId: seeded.cardAccountId,
        scope: 'household',
        kind: 'settlement',
        direction: 'outflow',
        amountMinor: 50_000,
        categoryId: null,
        merchant: null,
        transactionDate: '2026-09-10',
        note: null,
      },
      contextFor(purchase.document),
    );

    const bank = balanceOf(settlement.document, seeded.bankAccountId).computedMinor;
    const card = balanceOf(settlement.document, seeded.cardAccountId).computedMinor;

    // The bank is down by the payment; the card debt is down by the same.
    expect(bank).toBe(1_200_000 - 50_000);
    expect(card).toBe(-300_000 - 50_000 + 50_000);

    // Household net worth moved by the purchase only, never by the settlement.
    expect(bank + card).toBe(1_200_000 - 300_000 - 50_000);
  });
});

describe('a transfer from the business nets to zero', () => {
  test('both sides move and the consolidated total does not', () => {
    const seeded = seededHousehold();

    const income = recordTransaction(
      seeded.document,
      {
        accountId: seeded.businessAccountId,
        counterpartAccountId: null,
        scope: 'business',
        kind: 'income',
        direction: 'inflow',
        amountMinor: 2_000_000,
        categoryId: null,
        merchant: 'לקוח',
        transactionDate: '2026-09-02',
        note: null,
      },
      contextFor(seeded.document),
    );

    const before =
      balanceOf(income.document, seeded.bankAccountId).computedMinor +
      balanceOf(income.document, seeded.businessAccountId).computedMinor;

    const moved = transferToHousehold(
      income.document,
      {
        businessAccountId: seeded.businessAccountId,
        householdAccountId: seeded.bankAccountId,
        amountMinor: 600_000,
        transactionDate: '2026-09-05',
        note: null,
      },
      contextFor(income.document),
    );

    const after =
      balanceOf(moved.document, seeded.bankAccountId).computedMinor +
      balanceOf(moved.document, seeded.businessAccountId).computedMinor;

    expect(after).toBe(before);
    expect(balanceOf(moved.document, seeded.bankAccountId).computedMinor).toBe(1_800_000);
    expect(balanceOf(moved.document, seeded.businessAccountId).computedMinor).toBe(1_400_000);
  });

  test('money may only travel from the business side to the household side', () => {
    const seeded = seededHousehold();
    expect(() =>
      transferToHousehold(
        seeded.document,
        {
          businessAccountId: seeded.bankAccountId,
          householdAccountId: seeded.businessAccountId,
          amountMinor: 1_000,
          transactionDate: '2026-09-05',
          note: null,
        },
        contextFor(seeded.document),
      ),
    ).toThrow(CommandError);
  });

  test('only an approved transfer reaches reliable household income', () => {
    const seeded = seededHousehold();
    const before = toEngineInput(seeded.document, { asOf: TEST_NOW }).approvedSafeTransferMinor;
    expect(before).toBe(0);

    const moved = transferToHousehold(
      seeded.document,
      {
        businessAccountId: seeded.businessAccountId,
        householdAccountId: seeded.bankAccountId,
        amountMinor: 600_000,
        transactionDate: '2026-09-05',
        note: null,
      },
      contextFor(seeded.document),
    );

    expect(toEngineInput(moved.document, { asOf: TEST_NOW }).approvedSafeTransferMinor).toBe(
      600_000,
    );
  });
});

describe('debt rollover is three facts, not one', () => {
  test('a 5,000 repayment funded by a new 5,000 loan reduces total debt by nothing', () => {
    const seeded = seededHousehold();

    const before = viewOf(seeded.document, TEST_NOW).snapshot.debtTotals.consumerDebtMinor;

    const rolled = recordRollover(
      seeded.document,
      {
        fromDebtId: seeded.privateDebtId,
        toDebtId: seeded.loanDebtId,
        amountMinor: 500_000,
        occurredOn: '2026-09-04',
        notes: null,
      },
      contextFor(seeded.document),
    );

    const view = viewOf(rolled.document, TEST_NOW);

    // Three separate facts recorded.
    const events = rolled.document.debtEvents.filter(
      (event) => event.occurredOn === '2026-09-04',
    );
    expect(events.map((event) => event.kind).sort()).toEqual([
      'new_principal',
      'principal_payment',
    ]);
    expect(rolled.document.rollovers).toHaveLength(1);

    // And the headline number has not moved.
    expect(view.snapshot.debtTotals.consumerDebtMinor).toBe(before);
    expect(view.snapshot.debtMetrics.rolloverFundedRepaymentMinor).toBe(500_000);
    expect(view.snapshot.debtMetrics.incomeFundedPrincipalReductionMinor).toBe(0);
  });

  test('a debt cannot roll over into itself', () => {
    const seeded = seededHousehold();
    expect(() =>
      recordRollover(
        seeded.document,
        {
          fromDebtId: seeded.loanDebtId,
          toDebtId: seeded.loanDebtId,
          amountMinor: 100,
          occurredOn: '2026-09-04',
          notes: null,
        },
        contextFor(seeded.document),
      ),
    ).toThrow(CommandError);
  });
});

describe('reconciliation is shown, never absorbed', () => {
  test('a difference between our records and the bank is reported', () => {
    const seeded = seededHousehold();
    const spent = spend(seeded.document, seeded.bankAccountId, 30_000, '2026-09-06', 'מכולת');

    // The bank says something different from our arithmetic.
    const confirmed = recordBalance(
      spent.document,
      {
        accountId: seeded.bankAccountId,
        balanceMinor: 1_165_000,
        balanceDirection: 'inflow',
        verifiedAt: '2026-09-06T20:00:00.000Z',
        source: 'manual_entry',
        note: null,
      },
      contextFor(spent.document),
    );

    const balance = balanceOf(confirmed.document, seeded.bankAccountId);
    expect(balance.computedMinor).toBe(1_170_000);
    expect(balance.verifiedMinor).toBe(1_165_000);
    expect(balance.reconciliationGapMinor).toBe(5_000);
  });

  test('accepting the difference records a correction, and closes the gap', () => {
    const seeded = seededHousehold();
    const spent = spend(seeded.document, seeded.bankAccountId, 30_000, '2026-09-06', 'מכולת');
    const confirmed = recordBalance(
      spent.document,
      {
        accountId: seeded.bankAccountId,
        balanceMinor: 1_165_000,
        balanceDirection: 'inflow',
        verifiedAt: '2026-09-06T20:00:00.000Z',
        source: 'manual_entry',
        note: null,
      },
      contextFor(spent.document),
    );

    const accepted = acceptReconciliationGap(
      confirmed.document,
      {
        accountId: seeded.bankAccountId,
        differenceMinor: 5_000,
        direction: 'outflow',
        asOfDate: '2026-09-06',
      },
      contextFor(confirmed.document),
    );

    const balance = balanceOf(accepted.document, seeded.bankAccountId);
    expect(balance.reconciliationGapMinor).toBe(0);

    // The correction is a correction, not spending.
    const correction = accepted.document.transactions.find(
      (transaction) => transaction.id === accepted.value,
    );
    expect(correction?.kind).toBe('correction');
    expect(correction?.categoryId).toBeNull();
  });
});

describe('an account is closed, never deleted', () => {
  test('its history survives closing', () => {
    const seeded = seededHousehold();
    const spent = spend(seeded.document, seeded.cardAccountId, 20_000, '2026-09-02', 'חנות');

    const closed = apply(spent.document, [
      (document, context) =>
        recordTransaction(
          document,
          {
            accountId: seeded.bankAccountId,
            counterpartAccountId: null,
            scope: 'household',
            kind: 'expense',
            direction: 'outflow',
            amountMinor: 1_000,
            categoryId: null,
            merchant: 'קפה',
            transactionDate: '2026-09-03',
            note: null,
          },
          context,
        ),
    ]);

    expect(closed.transactions.filter(isRealTransaction)).toHaveLength(2);
  });
});

describe('a transfer must name both sides', () => {
  test('a transfer without a counterpart is refused', () => {
    const seeded = seededHousehold();
    expect(() =>
      recordTransaction(
        seeded.document,
        {
          accountId: seeded.bankAccountId,
          counterpartAccountId: null,
          scope: 'household',
          kind: 'transfer',
          direction: 'outflow',
          amountMinor: 1_000,
          categoryId: null,
          merchant: null,
          transactionDate: '2026-09-05',
          note: null,
        },
        contextFor(seeded.document),
      ),
    ).toThrow(/two sides/);
  });

  test('an ordinary expense may not have one', () => {
    const seeded = seededHousehold();
    expect(() =>
      recordTransaction(
        seeded.document,
        {
          accountId: seeded.bankAccountId,
          counterpartAccountId: seeded.cardAccountId,
          scope: 'household',
          kind: 'expense',
          direction: 'outflow',
          amountMinor: 1_000,
          categoryId: null,
          merchant: null,
          transactionDate: '2026-09-05',
          note: null,
        },
        contextFor(seeded.document),
      ),
    ).toThrow(CommandError);
  });

  test('a zero amount is refused', () => {
    const seeded = seededHousehold();
    expect(() => spend(seeded.document, seeded.bankAccountId, 0, '2026-09-05', 'כלום')).toThrow(
      /greater than zero/,
    );
  });
});

describe('every change leaves a trace', () => {
  test('the audit log grows and is never rewritten', () => {
    const seeded = seededHousehold();
    const before = seeded.document.audit.length;
    expect(before).toBeGreaterThan(0);

    const spent = spend(seeded.document, seeded.bankAccountId, 1_000, '2026-09-06', 'קפה');
    expect(spent.document.audit).toHaveLength(before + 1);
    expect(spent.document.audit.slice(0, before)).toEqual(seeded.document.audit);

    const entry = spent.document.audit[before];
    expect(entry?.action).toBe('transaction.recorded');
    expect(entry?.entityId).toBe(spent.value);
  });

  test('an audit image carries the fields that matter and nothing else', () => {
    const seeded = seededHousehold();
    const spent = spend(seeded.document, seeded.bankAccountId, 1_000, '2026-09-06', 'קפה');
    const entry = spent.document.audit[spent.document.audit.length - 1];

    expect(entry?.afterState).toMatchObject({ amountMinor: 1_000, direction: 'outflow' });
    // Free-text notes are not copied into the audit trail.
    expect(entry?.afterState).not.toHaveProperty('note');
    expect(entry?.afterState).not.toHaveProperty('createdBy');
  });
});

describe('tasks', () => {
  test('a task from a recommendation names the recommendation', () => {
    const seeded = seededHousehold();
    const added = addTask(
      seeded.document,
      {
        title: 'לעדכן יתרה',
        reason: null,
        origin: 'recommendation',
        recommendationKey: 'confirm_balances',
        amountMinor: null,
        relatedDebtId: null,
        relatedAccountId: null,
        assignedMemberId: null,
        dueOn: null,
      },
      contextFor(seeded.document),
    );

    expect(added.document.tasks[0]?.recommendationKey).toBe('confirm_balances');
  });

  test('completing a task records when', () => {
    const seeded = seededHousehold();
    const added = addTask(
      seeded.document,
      {
        title: 'לשלם ארנונה',
        reason: null,
        origin: 'manual',
        recommendationKey: null,
        amountMinor: 61_000,
        relatedDebtId: null,
        relatedAccountId: null,
        assignedMemberId: null,
        dueOn: '2026-09-15',
      },
      contextFor(seeded.document),
    );

    const done = updateTask(
      added.document,
      { taskId: added.value, status: 'done' },
      contextFor(added.document),
    );

    expect(done.document.tasks[0]?.status).toBe('done');
    expect(done.document.tasks[0]?.completedAt).toBe(TEST_NOW);
  });
});

describe('the household view is built from the engine, never from the screen', () => {
  test('a seeded household produces a full snapshot', () => {
    const seeded = seededHousehold();
    const view = viewOf(seeded.document, TEST_NOW);

    expect(view.snapshot.today).toBe(TEST_TODAY);
    expect(view.snapshot.currency).toBe('ILS');
    expect(view.snapshot.decision.calculationVersion).toBeTruthy();
    expect(view.snapshot.safeSpend.breakdown.length).toBeGreaterThan(0);
    expect(view.budget).not.toBeNull();
    expect(view.food).not.toBeNull();
  });

  test('an account added with no balance still appears, marked never confirmed', () => {
    const seeded = seededHousehold();
    const added = addAccount(
      seeded.document,
      {
        name: 'חיסכון',
        kind: 'bank_account',
        scope: 'household',
        institution: null,
        displaySuffix: null,
        openingBalanceMinor: 0,
        openingBalanceDirection: 'inflow',
        openingBalanceDate: '2026-09-01',
      },
      contextFor(seeded.document),
    );

    const view = viewOf(added.document, TEST_NOW);
    const account = view.input.accounts.find((candidate) => candidate.name === 'חיסכון');
    expect(account?.verifiedAt).toBeNull();
  });
});
