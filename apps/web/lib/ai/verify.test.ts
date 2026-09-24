import { addDebt, closeAccount, type StoreDocument } from '@family-finance/local-store';
import { contextFor, seededHousehold } from '@family-finance/local-store/fixtures';
import { exampleOutput } from '@family-finance/ai-proposal';
import { describe, expect, test } from 'vitest';

import { MAX_PROPOSED_MINOR, canonicalDate, verifyProposal } from './verify';

/**
 * The boundary that decides whether anything may be recorded.
 *
 * The prompt is guidance and the schema is a shape. Neither says anything about
 * *this household*, and a perfectly well-formed answer naming a lender who does
 * not exist is exactly what this file has to catch. Every case below is a
 * well-formed answer — they all pass the contract — and the question is only
 * whether the verifier lets it through.
 *
 * The rule being tested, in one sentence: nothing the model produced survives
 * unless this layer could have produced it independently.
 *
 * Synthetic throughout: each case builds its own document from the fixture.
 */

const TODAY = '2026-09-24';

/** A household with one open account and one active lender. */
function household(): { document: StoreDocument; accountId: string; debtId: string } {
  const seeded = seededHousehold();
  let document = seeded.document;

  // Exactly one open account, so "which account" is not the subject here.
  for (const account of seeded.document.accounts) {
    if (account.id === seeded.bankAccountId) continue;
    document = closeAccount(document, { accountId: account.id }, contextFor(document)).document;
  }

  const opened = addDebt(
    document,
    {
      creditorName: 'גמח לבדיקה',
      kind: 'gemach',
      openingBalanceMinor: 100_000,
      openedOn: '2026-08-01',
      effectiveAnnualRateBp: null,
      minimumPaymentMinor: null,
      paymentDueDay: null,
      urgency: 'none',
      promiseSummary: null,
      relationshipSensitivity: 'low',
      partialPaymentAllowed: true,
      expectedCallDate: null,
      notes: null,
    },
    contextFor(document),
  );

  return {
    document: opened.document,
    accountId: seeded.bankAccountId,
    debtId: opened.value,
  };
}

function verify(over: Parameters<typeof exampleOutput>[0], document?: StoreDocument) {
  const built = document ?? household().document;
  return verifyProposal(exampleOutput(over), { document: built, today: TODAY });
}

describe('a clean expense is confirmable', () => {
  const { document } = household();
  const proposal = verify({ date: TODAY }, document);

  test('the figures survive exactly', () => {
    expect(proposal.amountMinor).toBe(12_000);
    expect(proposal.date).toBe(TODAY);
    expect(proposal.state).toBe('ready');
  });

  test('and the server says it may be confirmed', () => {
    expect(proposal.safeToConfirm).toBe(true);
  });

  test('with the Hebrew form of the date filled in by the server', () => {
    expect(proposal.hebrewDate).not.toBeNull();
    expect(proposal.hebrewDate).toMatch(/תשפ/u);
  });
});

describe('an id this household does not have is refused', () => {
  const { document } = household();

  test('an invented lender never becomes a repayment', () => {
    const proposal = verify(
      {
        action: 'debt_repayment',
        debtId: '00000000-0000-4000-8000-000000000000',
        date: TODAY,
      },
      document,
    );
    expect(proposal.debtId).toBeNull();
    expect(proposal.state).toBe('needs_clarification');
    expect(proposal.safeToConfirm).toBe(false);
  });

  test('and the person is asked which lender, rather than shown an error', () => {
    const proposal = verify(
      { action: 'debt_repayment', debtId: 'nope', date: TODAY },
      document,
    );
    expect(proposal.missing.map((item) => item.field)).toContain('lender');
  });

  test('an invented account is dropped and asked for', () => {
    const proposal = verify({ accountId: 'not-an-account', date: TODAY }, document);
    expect(proposal.accountId).toBeNull();
    expect(proposal.safeToConfirm).toBe(false);
  });

  test('a closed account is not an account', () => {
    const seeded = seededHousehold();
    const closedId = seeded.document.accounts[1]?.id ?? '';
    const closed = closeAccount(
      seeded.document,
      { accountId: closedId },
      contextFor(seeded.document),
    ).document;

    const proposal = verifyProposal(exampleOutput({ accountId: closedId, date: TODAY }), {
      document: closed,
      today: TODAY,
    });
    expect(proposal.accountId).toBeNull();
    expect(proposal.safeToConfirm).toBe(false);
  });

  test('a category outside the closed list is dropped', () => {
    const proposal = verify({ categoryId: 'yachts', date: TODAY }, document);
    expect(proposal.categoryId).toBeNull();
    expect(proposal.safeToConfirm).toBe(false);
  });

  test('a real lender of this household is kept', () => {
    const { document: built, debtId } = household();
    const proposal = verifyProposal(
      exampleOutput({ action: 'debt_repayment', debtId, date: TODAY }),
      { document: built, today: TODAY },
    );
    expect(proposal.debtId).toBe(debtId);
    expect(proposal.safeToConfirm).toBe(true);
  });
});

describe('a model claiming to be sure does not make it so', () => {
  test('ready plus high confidence plus an invented lender is still a question', () => {
    const { document } = household();
    const proposal = verifyProposal(
      exampleOutput({
        state: 'ready',
        confidence: 'high',
        action: 'debt_repayment',
        debtId: 'invented',
        date: TODAY,
      }),
      { document, today: TODAY },
    );
    expect(proposal.state).toBe('needs_clarification');
    expect(proposal.safeToConfirm).toBe(false);
  });

  test('low confidence is never confirmable, even when every field verifies', () => {
    const proposal = verify({ confidence: 'low', date: TODAY });
    expect(proposal.amountMinor).toBe(12_000);
    expect(proposal.safeToConfirm).toBe(false);
  });
});

describe('the money rules are applied again', () => {
  test('a fraction of an agora is not an amount', () => {
    const proposal = verify({ amountMinor: 12_000.5, date: TODAY });
    expect(proposal.amountMinor).toBeNull();
    expect(proposal.safeToConfirm).toBe(false);
  });

  test('an absurd amount is refused rather than offered', () => {
    const proposal = verify({ amountMinor: MAX_PROPOSED_MINOR + 1, date: TODAY });
    expect(proposal.amountMinor).toBeNull();
    expect(proposal.safeToConfirm).toBe(false);
  });

  test('an amount the sentence did not give is asked for, never assumed', () => {
    const proposal = verify({ amountMinor: null, date: TODAY });
    expect(proposal.amountMinor).toBeNull();
    expect(proposal.missing.map((item) => item.field)).toContain('amount');
    expect(proposal.safeToConfirm).toBe(false);
  });

  test('the largest permitted amount is still permitted', () => {
    const proposal = verify({ amountMinor: MAX_PROPOSED_MINOR, date: TODAY });
    expect(proposal.amountMinor).toBe(MAX_PROPOSED_MINOR);
  });
});

describe('dates', () => {
  test('a day its month does not have is not a date', () => {
    expect(canonicalDate('2026-02-30')).toBeNull();
    expect(canonicalDate('2026-13-01')).toBeNull();
    expect(canonicalDate('2026-00-10')).toBeNull();
  });

  test('a real day round-trips unchanged', () => {
    expect(canonicalDate('2026-09-24')).toBe('2026-09-24');
    // A leap day in a leap year is a day.
    expect(canonicalDate('2028-02-29')).toBe('2028-02-29');
    expect(canonicalDate('2027-02-29')).toBeNull();
  });

  test('a year far outside a household record is a misreading', () => {
    expect(canonicalDate('1899-01-01')).toBeNull();
    expect(canonicalDate('2999-01-01')).toBeNull();
  });

  test('a day that has not happened yet is refused and asked about', () => {
    const proposal = verify({ date: '2027-01-01' });
    /*
     * Left empty rather than replaced with today.
     *
     * The sentence named a day; substituting a different one would be the exact
     * move this whole layer exists to prevent — quietly turning something we
     * refused into a figure the person never said. So the field comes back null
     * and the screen asks, which is a thing they can answer.
     */
    expect(proposal.date).toBeNull();
    expect(proposal.missing.map((item) => item.field)).toContain('date');
    expect(proposal.safeToConfirm).toBe(false);
  });

  test('no date at all becomes today, said out loud rather than hidden', () => {
    const proposal = verify({
      date: null,
      evidence: { amountText: '120', dateText: null, counterpartyText: null },
    });
    expect(proposal.date).toBe(TODAY);
    // The screen shows the assumption because the evidence has no date in it.
    expect(proposal.evidence.dateText).toBeNull();
    expect(proposal.safeToConfirm).toBe(true);
  });

  test('an unreadable date becomes today, because the sentence named no day we read', () => {
    /*
     * Different from the future-date case, and the difference matters: there the
     * sentence named a day and we refused it, so we ask. Here nothing readable
     * was found at all, which is the same position as a sentence with no date —
     * and that assumption is shown on the screen.
     *
     * The contract refuses this shape before the verifier sees it in practice;
     * checked here so the two layers are known to agree.
     */
    const proposal = verify({ date: '2026-02-30' });
    expect(proposal.date).toBe(TODAY);
  });
});

describe('an action nobody can act on', () => {
  test('unknown is not understood, and never confirmable', () => {
    const proposal = verify({ action: 'unknown', date: TODAY });
    expect(proposal.state).toBe('not_understood');
    expect(proposal.safeToConfirm).toBe(false);
  });

  test('a repayment always needs a lender, whatever else is present', () => {
    const proposal = verify({ action: 'debt_repayment', debtId: null, date: TODAY });
    expect(proposal.safeToConfirm).toBe(false);
    expect(proposal.missing.map((item) => item.field)).toContain('lender');
  });

  test('a transfer is read but not confirmable from here', () => {
    // Two accounts are needed and one sentence names one. The screen routes the
    // person to the form that asks for both.
    const proposal = verify({ action: 'transfer', date: TODAY });
    expect(proposal.action).toBe('transfer');
  });
});

describe('a household with several accounts is asked which one', () => {
  test('two open accounts and no account named is a question', () => {
    const seeded = seededHousehold();
    const proposal = verifyProposal(exampleOutput({ date: TODAY }), {
      document: seeded.document,
      today: TODAY,
    });
    expect(proposal.missing.map((item) => item.field)).toContain('account');
    expect(proposal.safeToConfirm).toBe(false);
  });

  test('one open account needs no question: there is nothing to choose', () => {
    const { document } = household();
    const proposal = verifyProposal(exampleOutput({ date: TODAY }), { document, today: TODAY });
    expect(proposal.missing.map((item) => item.field)).not.toContain('account');
    expect(proposal.safeToConfirm).toBe(true);
  });
});

describe('what the verifier carries forward', () => {
  test('the evidence is kept, so a person can check the reading against their words', () => {
    const proposal = verify({
      date: TODAY,
      evidence: { amountText: '120 שקל', dateText: 'היום', counterpartyText: 'בסופר' },
    });
    expect(proposal.evidence.amountText).toBe('120 שקל');
    expect(proposal.evidence.counterpartyText).toBe('בסופר');
  });

  test('long text is clipped rather than trusted to be short', () => {
    const proposal = verify({
      date: TODAY,
      summary: 'א'.repeat(500),
      reason: 'ב'.repeat(500),
      evidence: { amountText: 'ג'.repeat(500), dateText: null, counterpartyText: null },
    });
    expect(proposal.summary.length).toBeLessThanOrEqual(200);
    expect(proposal.reason.length).toBeLessThanOrEqual(300);
    expect((proposal.evidence.amountText ?? '').length).toBeLessThanOrEqual(80);
  });

  test('never more than three questions', () => {
    const proposal = verify({
      action: 'debt_repayment',
      amountMinor: null,
      debtId: null,
      date: '2027-01-01',
      missing: [{ field: 'description', question: 'על מה?' }],
    });
    expect(proposal.missing.length).toBeLessThanOrEqual(3);
  });
});
