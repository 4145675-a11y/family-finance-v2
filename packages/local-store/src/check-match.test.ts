import { describe, expect, test } from 'vitest';

import { addCheck, clearCheck, markCheckReturned } from './checks';
import { addDebt } from './commands';
import type { StoreDocument } from './document';
import {
  digitRunsIn,
  looksLikeCheckDebit,
  matchesForDebit,
  proposeCheckMatch,
} from './check-match';
import { contextFor, seededHousehold } from './fixtures/household';

/**
 * Joining a bank debit to the check behind it.
 *
 * The failure this prevents is specific and expensive: a statement is imported,
 * the row "צ׳ק 1043 — 1,500" is approved as an ordinary expense, and the check it
 * actually was stays outstanding. The household now shows 1,500 spent *and* 1,500
 * of exposure for the same piece of paper, and their debt never comes down.
 *
 * The other failure is the opposite, and is worse: guessing which of two
 * identical checks a debit was, and reducing the wrong month's obligation. So the
 * tests below spend as much effort on what stays ambiguous as on what matches.
 */

function scene() {
  const seeded = seededHousehold();
  const debt = addDebt(
    seeded.document,
    {
      creditorName: 'גמ״ח שכונתי',
      kind: 'gemach',
      openingBalanceMinor: 900_000,
      openedOn: '2026-05-01',
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

  return {
    document: debt.document,
    bankAccountId: seeded.bankAccountId,
    cardAccountId: seeded.cardAccountId,
    debtId: debt.value,
  };
}

function withCheck(
  document: StoreDocument,
  input: {
    debtId: string;
    accountId: string;
    checkNumber: string | null;
    amountMinor: number;
    dueDate: string;
  },
): { document: StoreDocument; checkId: string } {
  const added = addCheck(
    document,
    {
      ...input,
      payeeName: 'גמ״ח שכונתי',
      installmentNumber: null,
      note: null,
      deliveredOn: '2026-09-01',
    },
    contextFor(document),
  );
  return { document: added.document, checkId: added.value };
}

describe('reading a check number out of a statement line', () => {
  test('finds runs of digits', () => {
    expect(digitRunsIn("צ'ק 1043 גמח")).toEqual(['1043']);
  });

  test('finds several, because a bank line may carry more than one', () => {
    expect(digitRunsIn('CHQ 001043 REF 88123')).toEqual(['001043', '88123']);
  });

  test('ignores a single digit, which is never a check number', () => {
    expect(digitRunsIn('משיכה 5')).toEqual([]);
  });

  test('recognises the ways a statement says "check"', () => {
    for (const text of [
      "צ'ק 1043",
      'צ׳ק 1043',
      'שיק 1043',
      'המחאה 1043',
      'CHQ 1043',
      'Cheque',
    ]) {
      expect(looksLikeCheckDebit(text)).toBe(true);
    }
  });

  test('does not mistake an ordinary purchase for one', () => {
    expect(looksLikeCheckDebit('סופרמרקט הרצל')).toBe(false);
  });
});

describe('what can match', () => {
  test('the amount must be exact', () => {
    // A check clears for its face value. One agora out is a different debit, and
    // matching it would silently change the amount of a repayment.
    const base = scene();
    const { document } = withCheck(base.document, {
      debtId: base.debtId,
      accountId: base.bankAccountId,
      checkNumber: '1043',
      amountMinor: 150_000,
      dueDate: '2026-10-12',
    });

    expect(
      matchesForDebit(document, {
        accountId: base.bankAccountId,
        amountMinor: 149_999,
        transactionDate: '2026-10-13',
        reference: "צ'ק 1043",
      }),
    ).toHaveLength(0);
  });

  test('the account must be the same', () => {
    const base = scene();
    const { document } = withCheck(base.document, {
      debtId: base.debtId,
      accountId: base.bankAccountId,
      checkNumber: '1043',
      amountMinor: 150_000,
      dueDate: '2026-10-12',
    });

    expect(
      matchesForDebit(document, {
        accountId: base.cardAccountId,
        amountMinor: 150_000,
        transactionDate: '2026-10-13',
        reference: "צ'ק 1043",
      }),
    ).toHaveLength(0);
  });

  test('a debit long after the date is outside the window', () => {
    const base = scene();
    const { document } = withCheck(base.document, {
      debtId: base.debtId,
      accountId: base.bankAccountId,
      checkNumber: '1043',
      amountMinor: 150_000,
      dueDate: '2026-10-12',
    });

    expect(
      matchesForDebit(document, {
        accountId: base.bankAccountId,
        amountMinor: 150_000,
        transactionDate: '2027-02-01',
        reference: "צ'ק",
      }),
    ).toHaveLength(0);
  });

  test('a debit a few weeks after the date is inside it', () => {
    // A gemach deposits when it gets to the bank, not on the printed date.
    const base = scene();
    const { document } = withCheck(base.document, {
      debtId: base.debtId,
      accountId: base.bankAccountId,
      checkNumber: '1043',
      amountMinor: 150_000,
      dueDate: '2026-10-12',
    });

    expect(
      matchesForDebit(document, {
        accountId: base.bankAccountId,
        amountMinor: 150_000,
        transactionDate: '2026-11-05',
        reference: "צ'ק",
      }),
    ).toHaveLength(1);
  });

  test('a debit well before the date is not', () => {
    const base = scene();
    const { document } = withCheck(base.document, {
      debtId: base.debtId,
      accountId: base.bankAccountId,
      checkNumber: '1043',
      amountMinor: 150_000,
      dueDate: '2026-10-12',
    });

    expect(
      matchesForDebit(document, {
        accountId: base.bankAccountId,
        amountMinor: 150_000,
        transactionDate: '2026-09-01',
        reference: "צ'ק",
      }),
    ).toHaveLength(0);
  });

  test('a cleared check is never offered again', () => {
    const base = scene();
    const written = withCheck(base.document, {
      debtId: base.debtId,
      accountId: base.bankAccountId,
      checkNumber: '1043',
      amountMinor: 150_000,
      dueDate: '2026-10-12',
    });
    const cleared = clearCheck(
      written.document,
      { checkId: written.checkId, clearedOn: '2026-10-13' },
      contextFor(written.document),
    );

    expect(
      matchesForDebit(cleared.document, {
        accountId: base.bankAccountId,
        amountMinor: 150_000,
        transactionDate: '2026-10-13',
        reference: "צ'ק 1043",
      }),
    ).toHaveLength(0);
  });

  test('a returned check is never offered as a match for a new debit', () => {
    // A debit reversing a bounced check looks arithmetically like a payment and
    // is the opposite of one.
    const base = scene();
    const written = withCheck(base.document, {
      debtId: base.debtId,
      accountId: base.bankAccountId,
      checkNumber: '1043',
      amountMinor: 150_000,
      dueDate: '2026-10-12',
    });
    const returned = markCheckReturned(
      written.document,
      { checkId: written.checkId, occurredOn: '2026-10-14', reason: 'חזר' },
      contextFor(written.document),
    );

    expect(
      matchesForDebit(returned.document, {
        accountId: base.bankAccountId,
        amountMinor: 150_000,
        transactionDate: '2026-10-20',
        reference: "צ'ק 1043",
      }),
    ).toHaveLength(0);
  });
});

describe('how confident a match is', () => {
  function twoChecks() {
    const base = scene();
    const first = withCheck(base.document, {
      debtId: base.debtId,
      accountId: base.bankAccountId,
      checkNumber: '1043',
      amountMinor: 150_000,
      dueDate: '2026-10-12',
    });
    const second = withCheck(first.document, {
      debtId: base.debtId,
      accountId: base.bankAccountId,
      checkNumber: '1044',
      amountMinor: 150_000,
      dueDate: '2026-11-12',
    });
    return {
      ...base,
      document: second.document,
      firstId: first.checkId,
      secondId: second.checkId,
    };
  }

  test('the number printed on the statement decides it', () => {
    const world = twoChecks();
    const proposal = proposeCheckMatch(world.document, {
      accountId: world.bankAccountId,
      amountMinor: 150_000,
      transactionDate: '2026-10-15',
      reference: "צ'ק 1044",
    });

    expect(proposal.best?.checkId).toBe(world.secondId);
    expect(proposal.best?.reasons).toContain('check_number_in_reference');
    expect(proposal.ambiguous).toBe(false);
  });

  test('leading zeros do not stop the number matching', () => {
    const base = scene();
    const { document } = withCheck(base.document, {
      debtId: base.debtId,
      accountId: base.bankAccountId,
      checkNumber: '001043',
      amountMinor: 150_000,
      dueDate: '2026-10-12',
    });

    const proposal = proposeCheckMatch(document, {
      accountId: base.bankAccountId,
      amountMinor: 150_000,
      transactionDate: '2026-10-13',
      reference: "צ'ק 1043",
    });
    expect(proposal.best?.reasons).toContain('check_number_in_reference');
  });

  test('without a number, the closer date wins', () => {
    const world = twoChecks();
    const proposal = proposeCheckMatch(world.document, {
      accountId: world.bankAccountId,
      amountMinor: 150_000,
      transactionDate: '2026-10-13',
      reference: "צ'ק",
    });

    expect(proposal.best?.checkId).toBe(world.firstId);
    expect(proposal.best?.reasons).toContain('due_date_exact');
  });

  test('two indistinguishable checks stay ambiguous', () => {
    // The most important test here. Both are for the same amount on the same
    // day; the statement says nothing that separates them; picking one would be
    // inventing which month's repayment this was.
    const base = scene();
    const first = withCheck(base.document, {
      debtId: base.debtId,
      accountId: base.bankAccountId,
      checkNumber: null,
      amountMinor: 150_000,
      dueDate: '2026-10-12',
    });
    const second = withCheck(first.document, {
      debtId: base.debtId,
      accountId: base.bankAccountId,
      checkNumber: null,
      amountMinor: 150_000,
      dueDate: '2026-10-12',
    });

    const proposal = proposeCheckMatch(second.document, {
      accountId: base.bankAccountId,
      amountMinor: 150_000,
      transactionDate: '2026-10-13',
      reference: "צ'ק",
    });

    expect(proposal.ambiguous).toBe(true);
    expect(proposal.best).toBeNull();
    expect(proposal.candidates).toHaveLength(2);
  });

  test('the payee appearing in the reference adds to the case', () => {
    const base = scene();
    const { document } = withCheck(base.document, {
      debtId: base.debtId,
      accountId: base.bankAccountId,
      checkNumber: null,
      amountMinor: 150_000,
      dueDate: '2026-10-12',
    });

    const withPayee = proposeCheckMatch(document, {
      accountId: base.bankAccountId,
      amountMinor: 150_000,
      transactionDate: '2026-10-13',
      reference: 'גמ״ח שכונתי',
    });
    const without = proposeCheckMatch(document, {
      accountId: base.bankAccountId,
      amountMinor: 150_000,
      transactionDate: '2026-10-13',
      reference: 'משיכה',
    });

    expect(withPayee.best?.confidenceBp).toBeGreaterThan(without.best?.confidenceBp ?? 0);
  });

  test('confidence never exceeds certainty', () => {
    const base = scene();
    const { document } = withCheck(base.document, {
      debtId: base.debtId,
      accountId: base.bankAccountId,
      checkNumber: '1043',
      amountMinor: 150_000,
      dueDate: '2026-10-12',
    });

    const proposal = proposeCheckMatch(document, {
      accountId: base.bankAccountId,
      amountMinor: 150_000,
      transactionDate: '2026-10-12',
      reference: "צ'ק 1043 גמ״ח שכונתי",
    });
    expect(proposal.best?.confidenceBp).toBeLessThanOrEqual(10_000);
  });

  test('every match explains itself', () => {
    // A reviewer shown a bare percentage has no way to argue with it.
    const base = scene();
    const { document } = withCheck(base.document, {
      debtId: base.debtId,
      accountId: base.bankAccountId,
      checkNumber: '1043',
      amountMinor: 150_000,
      dueDate: '2026-10-12',
    });

    const proposal = proposeCheckMatch(document, {
      accountId: base.bankAccountId,
      amountMinor: 150_000,
      transactionDate: '2026-10-13',
      reference: "צ'ק 1043",
    });

    expect(proposal.best?.reasons).toEqual(
      expect.arrayContaining(['same_account', 'exact_amount', 'check_number_in_reference']),
    );
  });

  test('a household with no checks proposes nothing', () => {
    const base = scene();
    const proposal = proposeCheckMatch(base.document, {
      accountId: base.bankAccountId,
      amountMinor: 150_000,
      transactionDate: '2026-10-13',
      reference: "צ'ק 1043",
    });

    expect(proposal.best).toBeNull();
    expect(proposal.candidates).toHaveLength(0);
    expect(proposal.ambiguous).toBe(false);
  });
});
