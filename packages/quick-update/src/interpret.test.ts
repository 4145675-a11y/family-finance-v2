import type { LearnedRule } from '@family-finance/contracts';
import type { DebtHint } from '@family-finance/transaction-intelligence';
import { describe, expect, test } from 'vitest';

import {
  interpretQuickUpdate,
  type InterpretContext,
  type QuickAccountHint,
} from './interpret';

/**
 * A sentence a family says, read into something they can check.
 *
 * Every scenario in docs/QUICK-UPDATE.md section 7 is here, and the ones that
 * matter most are the refusals: the sentence with no sum, the repayment with no
 * lender, the two lenders with similar names, the hedged date. Reading those
 * confidently is how a quick screen becomes a fast way to write down the wrong
 * number, which is worse than the six-field form it replaces.
 *
 * Everything is synthetic. No real lender, shop, amount or account appears.
 */

const TODAY = '2026-09-23';

const BANK: QuickAccountHint = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'עובר ושב',
  scope: 'household',
  kind: 'bank_account',
  status: 'open',
};

const CARD: QuickAccountHint = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'כרטיס אשראי',
  scope: 'household',
  kind: 'credit_card',
  status: 'open',
};

const GEMACH: DebtHint = {
  id: '33333333-3333-4333-8333-333333333333',
  creditorName: 'גמח אור החיים',
  status: 'active',
};

const COHEN: DebtHint = {
  id: '44444444-4444-4444-8444-444444444444',
  creditorName: 'משפחת כהן',
  status: 'active',
};

function context(over: Partial<InterpretContext> = {}): InterpretContext {
  return {
    today: TODAY,
    accounts: [BANK],
    debts: [GEMACH],
    householdRules: [] as readonly LearnedRule[],
    ...over,
  };
}

/** The single proposal a sentence produced, asserted to be single. */
function one(text: string, over: Partial<InterpretContext> = {}) {
  const proposals = interpretQuickUpdate(text, context(over));
  expect(proposals).toHaveLength(1);
  const first = proposals[0];
  if (first === undefined) throw new Error('no proposal');
  return first;
}

describe('1. an ordinary expense', () => {
  const proposal = one('שילמתי 120 שקל בסופר היום');

  test('is an outflow of the sum that was said', () => {
    expect(proposal.intent).toBe('expense');
    expect(proposal.direction).toBe('outflow');
    expect(proposal.amountMinor).toBe(12_000);
  });

  test('is dated the day that was said, not the day it was typed', () => {
    expect(proposal.date).toBe(TODAY);
    expect(proposal.dateAssumed).toBe(false);
  });

  test('is ready, and keeps the words it was read from', () => {
    expect(proposal.state).toBe('ready');
    expect(proposal.sourceText).toBe('שילמתי 120 שקל בסופר היום');
  });

  test('carries a classification rather than a bare label', () => {
    expect(proposal.classification).not.toBeNull();
    expect(proposal.classification?.class).toBeDefined();
  });
});

describe('2. money coming in', () => {
  const proposal = one('קיבלתי משכורת 8000');

  test('is an inflow, not an expense', () => {
    expect(proposal.intent).toBe('income');
    expect(proposal.direction).toBe('inflow');
    expect(proposal.amountMinor).toBe(800_000);
  });

  test('says out loud that today was assumed', () => {
    expect(proposal.dateAssumed).toBe(true);
    expect(proposal.date).toBe(TODAY);
  });
});

describe('3. a repayment that names its lender', () => {
  const proposal = one('החזרתי 500 לגמח אור החיים');

  test('is a repayment, resolved to the one debt that matches', () => {
    expect(proposal.intent).toBe('debt_payment');
    expect(proposal.debtId).toBe(GEMACH.id);
    expect(proposal.debtCandidates).toBe(1);
  });

  test('is ready to approve', () => {
    expect(proposal.state).toBe('ready');
  });
});

describe('4. a repayment that names no lender', () => {
  const proposal = one('החזרתי 500 להלוואה');

  test('does not pick one', () => {
    expect(proposal.debtId).toBeNull();
    expect(proposal.state).toBe('needs_debt');
  });

  test('says what is missing, in words a person can act on', () => {
    expect(proposal.explanation).toContain('לבחור');
  });
});

describe('5. two lenders whose names both fit', () => {
  /*
   * Two real gemachs whose names overlap. The sentence names both of them at
   * once without meaning to, which is exactly how a balance ends up moving
   * against the wrong lender.
   */
  const twins: readonly DebtHint[] = [
    { id: GEMACH.id, creditorName: 'גמח אור', status: 'active' },
    { id: COHEN.id, creditorName: 'אור החיים', status: 'active' },
  ];
  const proposal = one('החזרתי 500 לגמח אור החיים', { debts: twins });

  test('picks neither', () => {
    expect(proposal.debtId).toBeNull();
    expect(proposal.state).toBe('needs_debt');
  });

  test('and says there was more than one', () => {
    expect(proposal.debtCandidates).toBeGreaterThan(1);
    expect(proposal.explanation).toContain('יותר מהלוואה אחת');
  });
});

describe('6. a sentence with no sum', () => {
  const proposal = one('שילמתי בסופר');

  test('does not invent one', () => {
    expect(proposal.amountMinor).toBeNull();
    expect(proposal.state).toBe('needs_amount');
  });

  test('and is not zero, which would be a number nobody said', () => {
    expect(proposal.amountMinor).not.toBe(0);
  });
});

describe('7. a balance, which is neither an expense nor an income', () => {
  const proposal = one('יתרה בבנק 3200');

  test('is read as a balance', () => {
    expect(proposal.intent).toBe('balance');
    expect(proposal.direction).toBeNull();
    expect(proposal.amountMinor).toBe(320_000);
  });

  test('and is not classified as a transaction at all', () => {
    expect(proposal.classification).toBeNull();
  });
});

describe('8. two updates in one breath', () => {
  const proposals = interpretQuickUpdate('שילמתי 120 בסופר ו-50 בדלק', context());

  test('become two proposals', () => {
    expect(proposals).toHaveLength(2);
  });

  test('each with its own sum', () => {
    expect(proposals.map((proposal) => proposal.amountMinor)).toEqual([12_000, 5_000]);
  });

  test('and each addressable on its own', () => {
    expect(proposals.map((proposal) => proposal.index)).toEqual([0, 1]);
  });
});

describe('9. one purchase that happens to list two things', () => {
  const proposals = interpretQuickUpdate('קניתי לחם וחלב ב-30 שקל', context());

  test('stays one proposal', () => {
    expect(proposals).toHaveLength(1);
  });

  test('for the sum that was actually spent', () => {
    expect(proposals[0]?.amountMinor).toBe(3_000);
  });
});

describe('10. a date the writer hedged', () => {
  const proposal = one('בערך ג׳ טבת שילמתי 200');

  test('is not turned into a date', () => {
    expect(proposal.state).toBe('needs_date');
    expect(proposal.dateProblem).toBe('uncertainty_marker');
  });

  test('and is not quietly recorded as today either', () => {
    expect(proposal.dateAssumed).toBe(false);
  });
});

describe('12. nothing to read', () => {
  test('an empty sentence produces no proposal and does not throw', () => {
    expect(interpretQuickUpdate('   ', context())).toHaveLength(0);
  });

  test('words with no intent are said to be not understood', () => {
    const proposal = one('אבגד הוזח');
    expect(proposal.state).toBe('not_understood');
    expect(proposal.intent).toBe('unknown');
  });

  test('a sum with no verb is still not understood, rather than assumed', () => {
    const proposal = one('120 שקל');
    expect(proposal.state).toBe('not_understood');
  });
});

describe('13. a sum written in words', () => {
  test('מאה עשרים is a hundred and twenty', () => {
    expect(one('שילמתי מאה עשרים שקל בסופר').amountMinor).toBe(12_000);
  });

  test('אלף is a thousand', () => {
    expect(one('קיבלתי אלף שקל').amountMinor).toBe(100_000);
  });

  test('חמש מאות is five hundred', () => {
    expect(one('שילמתי חמש מאות שקל').amountMinor).toBe(50_000);
  });

  test('שלוש מאות וחמישים reads the conjunction', () => {
    expect(one('שילמתי שלוש מאות וחמישים שקל').amountMinor).toBe(35_000);
  });
});

describe('choosing an account is a question, not a guess', () => {
  test('with one open account the sentence needs no help', () => {
    expect(one('שילמתי 120 בסופר').accountId).toBe(BANK.id);
  });

  test('with two, and no account named, the screen asks', () => {
    const proposal = one('שילמתי 120 בסופר', { accounts: [BANK, CARD] });
    expect(proposal.accountId).toBeNull();
    expect(proposal.state).toBe('needs_account');
  });

  test('with two, and one named, that one is used', () => {
    const proposal = one('שילמתי 120 בכרטיס אשראי', { accounts: [BANK, CARD] });
    expect(proposal.accountId).toBe(CARD.id);
    expect(proposal.state).toBe('ready');
  });

  test('a closed account is never the answer', () => {
    const closed: QuickAccountHint = { ...CARD, status: 'closed' };
    expect(one('שילמתי 120 בסופר', { accounts: [BANK, closed] }).accountId).toBe(BANK.id);
  });

  test('the scope follows the account, and is not asked for separately', () => {
    const business: QuickAccountHint = { ...BANK, scope: 'business' };
    expect(one('שילמתי 120 בספק', { accounts: [business] }).scope).toBe('business');
  });
});

describe('a day that was named is read, not assumed', () => {
  test('אתמול is the day before today', () => {
    expect(one('שילמתי 120 בסופר אתמול').date).toBe('2026-09-22');
  });

  test('שלשום is two days before', () => {
    expect(one('שילמתי 120 בסופר שלשום').date).toBe('2026-09-21');
  });

  test('a written date is day-first, the way it is written in Israel', () => {
    expect(one('שילמתי 300 בסופר 3/9/2026').date).toBe('2026-09-03');
  });

  test('and the day in a written date is not read as the sum', () => {
    expect(one('שילמתי 300 בסופר 3/9/2026').amountMinor).toBe(30_000);
  });

  test('a day its month does not have is refused, not rolled over', () => {
    const proposal = one('שילמתי 300 בסופר 31/9/2026');
    expect(proposal.state).toBe('needs_date');
    expect(proposal.dateProblem).toBe('day_not_in_month');
  });
});

describe('a household rule is honoured here too', () => {
  const rule: LearnedRule = {
    id: '55555555-5555-4555-8555-555555555555',
    householdId: '66666666-6666-4666-8666-666666666666',
    label: 'הסופר הוא אוכל',
    matcher: { descriptionContains: 'סופר', direction: 'outflow', accountId: null },
    class: 'purchase',
    budgetCategoryKey: 'food',
    counterparty: null,
    debtId: null,
    enabled: true,
    createdBy: '77777777-7777-4777-8777-777777777777',
    timesApplied: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    version: 1,
  };

  test('the rule the family confirmed decides the category', () => {
    const proposal = one('שילמתי 120 בסופר', { householdRules: [rule] });
    expect(proposal.classification?.budgetCategoryKey).toBe('food');
    expect(proposal.classification?.fromHouseholdRule).toBe(true);
  });
});

describe('the same sentence always reads the same way', () => {
  test('nothing in the reading depends on a clock or on chance', () => {
    const first = interpretQuickUpdate('שילמתי 120 בסופר', context());
    const second = interpretQuickUpdate('שילמתי 120 בסופר', context());
    expect(second).toEqual(first);
  });
});

describe('borrowing more from a lender who already has a card', () => {
  const proposals = interpretQuickUpdate(
    'קיבלתי עוד 3,000 ₪ מגמח אור החיים, לפירעון ב־10/10/2026',
    context(),
  );
  const proposal = proposals[0];

  test('is one update, not two', () => {
    // The comma belongs to the number and to the clause after it, not to a
    // second thing that happened.
    expect(proposals).toHaveLength(1);
  });

  test('is a top-up rather than a new loan', () => {
    // "עוד" is the one word in the sentence that says "again", so it decides the
    // reading; which card it belongs to is then a question about the household.
    expect(proposal?.intent).toBe('new_principal');
    expect(proposal?.direction).toBe('inflow');
  });

  test('attached to the card the words name', () => {
    expect(proposal?.debtId).toBe(GEMACH.id);
    expect(proposal?.debtCandidates).toBe(1);
  });

  test('with the whole sum, not the digits of the date', () => {
    expect(proposal?.amountMinor).toBe(300_000);
  });

  test('and nothing left to ask', () => {
    expect(proposal?.state).toBe('ready');
  });
});

describe('a top-up whose lender the words do not find', () => {
  const proposal = interpretQuickUpdate('קיבלתי עוד 3,000 שקל ממישהו אחר', context())[0];

  test('waits for the lender rather than picking one', () => {
    /*
     * The same refusal a repayment makes, for the same reason: a top-up moves an
     * existing card's balance, and moving the wrong one is wrong in a way no
     * later correction fully undoes.
     */
    expect(proposal?.intent).toBe('new_principal');
    expect(proposal?.debtId).toBeNull();
    expect(proposal?.state).toBe('needs_debt');
  });
});
