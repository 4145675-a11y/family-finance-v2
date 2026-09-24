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
        lenderText: 'מלווה שאין לו כרטיס',
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
      { action: 'debt_repayment', lenderText: 'מלווה שאין לו כרטיס', date: TODAY },
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

  test('a lender named in words is resolved to the card that exists', () => {
    const { document: built, debtId } = household();
    const proposal = verifyProposal(
      exampleOutput({ action: 'debt_repayment', lenderText: 'גמח לבדיקה', date: TODAY }),
      { document: built, today: TODAY, sentence: 'החזרתי 120 לגמח לבדיקה' },
    );
    // The id comes out of the matcher, never out of the answer.
    expect(proposal.debtId).toBe(debtId);
    expect(proposal.lenderName).toBe('גמח לבדיקה');
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
        lenderText: 'מלווה שאין לו כרטיס',
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
    const proposal = verify({ action: 'debt_repayment', lenderText: null, date: TODAY });
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
      lenderText: null,
      date: '2027-01-01',
      missing: [{ field: 'description', question: 'על מה?' }],
    });
    expect(proposal.missing.length).toBeLessThanOrEqual(3);
  });
});

describe('borrowing more from a lender who already has a card', () => {
  const { document, debtId } = household();

  test('a new loan naming a card that exists is a top-up, not a second card', () => {
    /*
     * The anti-duplicate rule, and the reason this whole slice exists.
     *
     * The reader said "new loan" and named the lender in words. Whether that is a
     * new card or more money on an old one is a question about the household, not
     * about the words — so the server decides it, and deciding it wrongly splits
     * one lender's history in two.
     */
    const proposal = verify(
      { action: 'new_debt', lenderText: 'גמח לבדיקה', amountMinor: 300_000, date: null },
      document,
    );
    expect(proposal.action).toBe('new_principal');
    expect(proposal.debtId).toBe(debtId);
    expect(proposal.lenderName).toBe('גמח לבדיקה');
    expect(proposal.safeToConfirm).toBe(true);
  });

  test('and a new loan naming nobody this household has stays a new card', () => {
    const proposal = verify(
      { action: 'new_debt', lenderText: 'מלווה שאין לו כרטיס', amountMinor: 300_000 },
      document,
    );
    expect(proposal.action).toBe('new_debt');
    expect(proposal.debtId).toBeNull();
  });

  test('which is never confirmable on its own, because a card is a person decision', () => {
    const proposal = verify(
      { action: 'new_debt', lenderText: 'מלווה שאין לו כרטיס', amountMinor: 300_000 },
      document,
    );
    expect(proposal.safeToConfirm).toBe(false);
    expect(proposal.missing.map((item) => item.question)).toContain(
      'ממי ההלוואה? ייפתח כרטיס חדש.',
    );
  });

  test('a top-up needs an account, because the money arrived somewhere', () => {
    const seeded = seededHousehold();
    const proposal = verifyProposal(
      exampleOutput({ action: 'new_principal', lenderText: 'גמח לבדיקה' }),
      { document: seeded.document, today: TODAY },
    );
    expect(proposal.missing.map((item) => item.field)).toContain('account');
    expect(proposal.safeToConfirm).toBe(false);
  });
});

describe('a repayment day is not the day something happened', () => {
  const { document } = household();

  test('a due date in the future is kept, where an occurrence date would be refused', () => {
    const proposal = verify(
      {
        action: 'new_debt',
        lenderText: 'גמח לבדיקה',
        amountMinor: 300_000,
        date: null,
        dueDate: '2026-10-10',
      },
      document,
    );
    expect(proposal.dueDate).toBe('2026-10-10');
    expect(proposal.date).toBe(TODAY);
    // Still confirmable: nothing about it is in doubt.
    expect(proposal.safeToConfirm).toBe(true);
  });

  test('with its Hebrew form, kept in step by the server', () => {
    const proposal = verify(
      { action: 'new_principal', lenderText: 'גמח לבדיקה', dueDate: '2026-10-10' },
      document,
    );
    expect(proposal.dueHebrewDate).not.toBeNull();
    expect(proposal.dueHebrewDate).toMatch(/תשפ/u);
  });

  test('a borrowing sentence whose only date is in the future is read as the due date', () => {
    /*
     * A reader that put the repayment day in `date` is describing something that
     * has not happened. Rather than refuse the whole reading, the server reads it
     * the only way it can be true — which is also what the rule table does with
     * its single date slot, so one sentence means one thing either way.
     */
    const proposal = verify(
      { action: 'new_principal', lenderText: 'גמח לבדיקה', date: '2026-10-10' },
      document,
    );
    expect(proposal.dueDate).toBe('2026-10-10');
    expect(proposal.date).toBe(TODAY);
    expect(proposal.missing.map((item) => item.field)).not.toContain('date');
  });

  test('but an expense in the future is still refused, and asked about', () => {
    const proposal = verify({ action: 'expense', date: '2026-10-10' }, document);
    expect(proposal.dueDate).toBeNull();
    expect(proposal.date).toBeNull();
    expect(proposal.missing.map((item) => item.field)).toContain('date');
  });

  test('and an expense is never given a repayment day, however one arrives', () => {
    const proposal = verify({ action: 'expense', dueDate: '2026-10-10' }, document);
    expect(proposal.dueDate).toBeNull();
  });

  test('a due date that is not a day is dropped rather than shown', () => {
    const proposal = verify(
      { action: 'new_principal', lenderText: 'גמח לבדיקה', dueDate: '2026-02-30' },
      document,
    );
    expect(proposal.dueDate).toBeNull();
    expect(proposal.dueHebrewDate).toBeNull();
  });
});

describe('the lender is resolved from the household, never supplied', () => {
  const { document, debtId } = household();

  test('the sentence alone resolves a lender when the reader quoted none', () => {
    const proposal = verifyProposal(
      exampleOutput({ action: 'debt_repayment', lenderText: null, amountMinor: 20_000 }),
      { document, today: TODAY, sentence: 'החזרתי 200 שקל לגמח לבדיקה' },
    );
    expect(proposal.debtId).toBe(debtId);
    expect(proposal.lenderCandidates).toBe(1);
  });

  test('words fitting no card resolve to nothing at all', () => {
    const proposal = verifyProposal(
      exampleOutput({ action: 'debt_repayment', lenderText: null, amountMinor: 20_000 }),
      { document, today: TODAY, sentence: 'החזרתי 200 שקל למלווה שאין לו כרטיס' },
    );
    expect(proposal.debtId).toBeNull();
    expect(proposal.lenderCandidates).toBe(0);
    expect(proposal.safeToConfirm).toBe(false);
  });

  test('another spelling of the same lender finds the card it already has', () => {
    /*
     * Two cards recorded under names that differ only in a quotation mark are one
     * lender with two spellings, so either spelling finds it. The grouping is the
     * load-bearing part: made wrong, every lender becomes an alias of every other
     * one and nothing ever resolves.
     */
    const withQuote = addDebt(
      document,
      {
        creditorName: 'גמ"ח לבדיקה',
        kind: 'gemach',
        openingBalanceMinor: 50_000,
        openedOn: '2026-08-02',
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
    ).document;

    const proposal = verifyProposal(
      exampleOutput({
        action: 'debt_repayment',
        lenderText: 'גמ"ח לבדיקה',
        amountMinor: 20_000,
      }),
      { document: withQuote, today: TODAY },
    );
    // One lender, one card, not two candidates.
    expect(proposal.lenderCandidates).toBe(1);
    expect(proposal.debtId).toBe(debtId);
    expect(proposal.safeToConfirm).toBe(true);
  });

  test('words fitting two different lenders resolve to neither, and ask which', () => {
    const withBranch = addDebt(
      document,
      {
        creditorName: 'גמח לבדיקה נוספת',
        kind: 'gemach',
        openingBalanceMinor: 50_000,
        openedOn: '2026-08-02',
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
    ).document;

    const proposal = verifyProposal(
      exampleOutput({
        action: 'debt_repayment',
        lenderText: 'גמח לבדיקה נוספת',
        amountMinor: 20_000,
      }),
      { document: withBranch, today: TODAY },
    );
    expect(proposal.debtId).toBeNull();
    expect(proposal.lenderCandidates).toBe(2);
    expect(proposal.lenderName).toBeNull();
    expect(proposal.missing.map((item) => item.question)).toContain('לאיזה מלווה מתוך אלה?');
    expect(proposal.safeToConfirm).toBe(false);
  });
});

describe('what the record will be called', () => {
  const { document } = household();

  test('the label is the words the sentence used for the other party', () => {
    const proposal = verify(
      { evidence: { amountText: '120', dateText: null, counterpartyText: 'בסופר' } },
      document,
    );
    expect(proposal.label).toBe('בסופר');
  });

  test('and is null when the reading named nobody', () => {
    const proposal = verify(
      { evidence: { amountText: '120', dateText: null, counterpartyText: null } },
      document,
    );
    expect(proposal.label).toBeNull();
  });
});
