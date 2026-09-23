import type { LearnedRule } from '@family-finance/contracts';
import { REVIEW_REQUIREMENT } from '@family-finance/contracts';
import { describe, expect, test } from 'vitest';

import {
  classifyBatch,
  classifyTransaction,
  type ClassificationContext,
  type DebtHint,
  type TransactionFacts,
} from './classify';

/**
 * What the classifier says about a statement line, and what it refuses to say.
 *
 * Every description here is a form an Israeli bank actually prints. No real
 * household's amounts, lenders or files appear: the lenders are invented and the
 * sums are round.
 */

const HOUSEHOLD = '11111111-1111-4111-8111-111111111111';
const ACTOR = '22222222-2222-4222-8222-222222222222';
const GEMACH_DEBT = '33333333-3333-4333-8333-333333333333';
const BANK_DEBT = '44444444-4444-4444-8444-444444444444';

function facts(overrides: Partial<TransactionFacts> = {}): TransactionFacts {
  return {
    description: 'תיאור',
    amountMinor: 10_000,
    direction: 'outflow',
    date: '2026-09-02',
    reference: null,
    bankName: 'בנק הפועלים',
    accountKind: 'bank_account',
    ...overrides,
  };
}

const NO_DEBTS: readonly DebtHint[] = [];

function context(overrides: Partial<ClassificationContext> = {}): ClassificationContext {
  return { householdRules: [], debts: NO_DEBTS, ...overrides };
}

function rule(overrides: Partial<LearnedRule> = {}): LearnedRule {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    householdId: HOUSEHOLD,
    label: 'העברה לאמא היא מתנה',
    matcher: { descriptionContains: 'העברה לאמא', direction: 'outflow', accountId: null },
    class: 'purchase',
    budgetCategoryKey: 'celebrations_and_gifts',
    counterparty: 'אמא',
    debtId: null,
    enabled: true,
    timesApplied: 0,
    createdBy: ACTOR,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    version: 1,
    ...overrides,
  };
}

describe('the bank-fee example from the requirement', () => {
  test('"ע. מסלול מורחב" is a bank fee, with high confidence', () => {
    const result = classifyTransaction(facts({ description: 'ע. מסלול מורחב' }), context());
    expect(result.class).toBe('bank_fee');
    expect(result.confidence).toBe('high');
    expect(result.ruleId).toBe('fee.account_plan');
  });

  test('it says why, in Hebrew, without a number', () => {
    const result = classifyTransaction(facts({ description: 'ע. מסלול מורחב' }), context());
    expect(result.explanation).toContain('עמלה');
    expect(/\d/.test(result.explanation)).toBe(false);
  });

  test('every spelling of it reaches the same rule', () => {
    for (const description of [
      'ע.מסלול מורחב',
      'ע׳ מסלול מורחב',
      'עמלת מסלול מורחב',
      'דמי מסלול בסיסי',
    ]) {
      const result = classifyTransaction(facts({ description }), context());
      expect(result.class).toBe('bank_fee');
    }
  });

  test('a fee is not given a budget envelope, because it is not household spend', () => {
    const result = classifyTransaction(facts({ description: 'ע. מסלול מורחב' }), context());
    expect(result.budgetCategoryKey).toBeNull();
  });

  test('the same words arriving as money in are not a fee', () => {
    const result = classifyTransaction(
      facts({ description: 'ע. מסלול מורחב', direction: 'inflow' }),
      context(),
    );
    expect(result.class).not.toBe('bank_fee');
  });

  test('a bare "עמלה" is a fee, but only at medium confidence', () => {
    const result = classifyTransaction(facts({ description: 'עמלה' }), context());
    expect(result.class).toBe('bank_fee');
    expect(result.confidence).toBe('medium');
    expect(result.ruleId).toBe('fee.generic');
  });
});

describe('the loan-repayment example from the requirement', () => {
  test('"חיוב הלוואה" is a loan repayment', () => {
    const result = classifyTransaction(facts({ description: 'חיוב הלוואה' }), context());
    expect(result.class).toBe('loan_repayment');
    expect(result.confidence).toBe('high');
  });

  test('with no lender named, it refuses to pick one and asks', () => {
    const result = classifyTransaction(
      facts({ description: 'חיוב הלוואה' }),
      context({
        debts: [
          { id: GEMACH_DEBT, creditorName: 'גמח אור החיים', status: 'active' },
          { id: BANK_DEBT, creditorName: 'בנק לדוגמה', status: 'active' },
        ],
      }),
    );
    expect(result.suggestedDebtId).toBeNull();
    expect(result.requiresDebtChoice).toBe(true);
  });

  test('a line naming exactly one lender offers that lender', () => {
    const result = classifyTransaction(
      facts({ description: 'חיוב הלוואה גמח אור החיים' }),
      context({
        debts: [
          { id: GEMACH_DEBT, creditorName: 'גמח אור החיים', status: 'active' },
          { id: BANK_DEBT, creditorName: 'בנק לדוגמה', status: 'active' },
        ],
      }),
    );
    expect(result.suggestedDebtId).toBe(GEMACH_DEBT);
    expect(result.requiresDebtChoice).toBe(false);
  });

  test('two lenders matching the same line is not a match at all', () => {
    const result = classifyTransaction(
      facts({ description: 'חיוב הלוואה משפחת כהן' }),
      context({
        debts: [
          { id: GEMACH_DEBT, creditorName: 'משפחת כהן', status: 'active' },
          { id: BANK_DEBT, creditorName: 'משפחת כהן', status: 'active' },
        ],
      }),
    );
    expect(result.suggestedDebtId).toBeNull();
    expect(result.requiresDebtChoice).toBe(true);
    expect(result.explanation).toContain('יותר מהלוואה אחת');
  });

  test('a settled debt is not offered', () => {
    const result = classifyTransaction(
      facts({ description: 'חיוב הלוואה גמח אור החיים' }),
      context({
        debts: [{ id: GEMACH_DEBT, creditorName: 'גמח אור החיים', status: 'settled' }],
      }),
    );
    expect(result.suggestedDebtId).toBeNull();
    expect(result.requiresDebtChoice).toBe(true);
  });

  test('confidence in the class does not remove the need to choose the loan', () => {
    const result = classifyTransaction(facts({ description: 'חיוב הלוואה' }), context());
    expect(result.confidence).toBe('high');
    expect(result.requiresDebtChoice).toBe(true);
  });

  test('a mortgage repayment also asks which one', () => {
    const result = classifyTransaction(facts({ description: 'החזר משכנתא' }), context());
    expect(result.class).toBe('loan_repayment');
    expect(result.requiresDebtChoice).toBe(true);
  });

  test('a loan arriving is not a repayment and not income', () => {
    const result = classifyTransaction(
      facts({ description: 'קבלת הלוואה', direction: 'inflow' }),
      context(),
    );
    expect(result.class).toBe('loan_received');
    expect(result.requiresDebtChoice).toBe(false);
  });
});

describe('the rest of the vocabulary', () => {
  test.each([
    ['משכורת חודש 8', 'inflow', 'salary'],
    ['ביטוח לאומי', 'inflow', 'benefit'],
    ['ישראכרט', 'outflow', 'card_settlement'],
    ['משיכה בכספומט', 'outflow', 'cash_withdrawal'],
    ['חברת החשמל', 'outflow', 'utility_bill'],
    ['ארנונה', 'outflow', 'utility_bill'],
    ['מס הכנסה', 'outflow', 'tax'],
    ['ריבית חובה', 'outflow', 'bank_interest'],
    ['הו"ק לחשמל', 'outflow', 'utility_bill'],
  ] as const)('"%s" %s → %s', (description, direction, expected) => {
    const result = classifyTransaction(facts({ description, direction }), context());
    expect(result.class).toBe(expected);
  });

  test('a utility bill gets the household-bills envelope', () => {
    const result = classifyTransaction(facts({ description: 'חברת החשמל' }), context());
    expect(result.budgetCategoryKey).toBe('housing_and_bills');
  });
});

describe('what the classifier does when it does not know', () => {
  test('an unreadable line is unclassified, at low confidence', () => {
    const result = classifyTransaction(facts({ description: 'XJ4491' }), context());
    expect(result.class).toBe('unclassified');
    expect(result.confidence).toBe('low');
    expect(REVIEW_REQUIREMENT[result.confidence]).toBe('needs_decision');
  });

  test('it never claims a debt link when it does not know', () => {
    const result = classifyTransaction(facts({ description: 'XJ4491' }), context());
    expect(result.suggestedDebtId).toBeNull();
    expect(result.requiresDebtChoice).toBe(false);
  });

  test('a named counterparty is worth medium, not high', () => {
    const result = classifyTransaction(
      facts({ description: 'העברה לישראל ישראלי' }),
      context(),
    );
    expect(result.counterparty).toBe('ישראל ישראלי');
    expect(result.confidence).toBe('medium');
  });

  test('every suggestion names the rule that produced it', () => {
    for (const description of ['ע. מסלול מורחב', 'חיוב הלוואה', 'XJ4491']) {
      const result = classifyTransaction(facts({ description }), context());
      expect(result.ruleId.length).toBeGreaterThan(0);
      expect(result.explanation.length).toBeGreaterThan(0);
    }
  });
});

describe('confidence decides what the review screen may do', () => {
  test('high may be preselected, medium and low may not', () => {
    expect(REVIEW_REQUIREMENT.high).toBe('may_preselect');
    expect(REVIEW_REQUIREMENT.medium).toBe('needs_review');
    expect(REVIEW_REQUIREMENT.low).toBe('needs_decision');
  });
});

describe("a household's own rules come first", () => {
  test('a household rule beats the built-in table', () => {
    const result = classifyTransaction(
      facts({ description: 'העברה לאמא' }),
      context({ householdRules: [rule()] }),
    );
    expect(result.class).toBe('purchase');
    expect(result.budgetCategoryKey).toBe('celebrations_and_gifts');
    expect(result.fromHouseholdRule).toBe(true);
    expect(result.confidence).toBe('high');
    expect(result.explanation).toContain('כלל שהגדרתם');
  });

  test('a household rule can override a built-in match', () => {
    const override = rule({
      label: 'עמלת מסלול היא בעצם דמי ניהול',
      matcher: { descriptionContains: 'מסלול מורחב', direction: 'outflow', accountId: null },
      class: 'bank_fee',
      budgetCategoryKey: 'other',
      counterparty: null,
    });
    const result = classifyTransaction(
      facts({ description: 'ע. מסלול מורחב' }),
      context({ householdRules: [override] }),
    );
    expect(result.fromHouseholdRule).toBe(true);
    expect(result.budgetCategoryKey).toBe('other');
  });

  test('a disabled rule is ignored, and the built-in answer returns', () => {
    const result = classifyTransaction(
      facts({ description: 'העברה לאמא' }),
      context({ householdRules: [rule({ enabled: false })] }),
    );
    expect(result.fromHouseholdRule).toBe(false);
  });

  test('a rule restricted to one direction does not apply to the other', () => {
    const result = classifyTransaction(
      facts({ description: 'העברה לאמא', direction: 'inflow' }),
      context({ householdRules: [rule()] }),
    );
    expect(result.fromHouseholdRule).toBe(false);
  });

  test('a rule restricted to one account does not apply to another', () => {
    const scoped = rule({
      matcher: {
        descriptionContains: 'העברה לאמא',
        direction: 'outflow',
        accountId: '66666666-6666-4666-8666-666666666666',
      },
    });
    const result = classifyTransaction(
      facts({ description: 'העברה לאמא' }),
      context({ householdRules: [scoped], accountId: '77777777-7777-4777-8777-777777777777' }),
    );
    expect(result.fromHouseholdRule).toBe(false);
  });

  test("one household's rules are never consulted for another", () => {
    /*
     * Isolation is structural: the classifier is only ever handed the rules of
     * the household whose file is being read. This test states the contract that
     * the caller must satisfy — a rule list from elsewhere changes nothing here,
     * because nothing here reaches for rules it was not given.
     */
    const otherHouseholdsRules: readonly LearnedRule[] = [];
    const withTheirRule = classifyTransaction(
      facts({ description: 'העברה לאמא' }),
      context({ householdRules: [rule()] }),
    );
    const withoutIt = classifyTransaction(
      facts({ description: 'העברה לאמא' }),
      context({ householdRules: otherHouseholdsRules }),
    );

    expect(withTheirRule.fromHouseholdRule).toBe(true);
    expect(withTheirRule.budgetCategoryKey).toBe('celebrations_and_gifts');

    // The same line, for a household that never made that rule: nothing of the
    // rule reaches it.
    expect(withoutIt.fromHouseholdRule).toBe(false);
    expect(withoutIt.budgetCategoryKey).toBeNull();
    expect(withoutIt.ruleId).not.toBe(withTheirRule.ruleId);
  });

  test('a household rule may attach a repayment to a debt, and still be confirmed', () => {
    const repaymentRule = rule({
      label: 'חיוב הלוואה הוא הגמח',
      matcher: { descriptionContains: 'חיוב הלוואה', direction: 'outflow', accountId: null },
      class: 'loan_repayment',
      budgetCategoryKey: null,
      counterparty: null,
      debtId: GEMACH_DEBT,
    });
    const result = classifyTransaction(
      facts({ description: 'חיוב הלוואה' }),
      context({ householdRules: [repaymentRule] }),
    );
    expect(result.suggestedDebtId).toBe(GEMACH_DEBT);
    expect(result.requiresDebtChoice).toBe(false);
  });

  test('a repayment rule with no debt still asks which loan', () => {
    const repaymentRule = rule({
      matcher: { descriptionContains: 'חיוב הלוואה', direction: 'outflow', accountId: null },
      class: 'loan_repayment',
      budgetCategoryKey: null,
      counterparty: null,
      debtId: null,
    });
    const result = classifyTransaction(
      facts({ description: 'חיוב הלוואה' }),
      context({ householdRules: [repaymentRule] }),
    );
    expect(result.requiresDebtChoice).toBe(true);
  });
});

describe('what the rest of the file says', () => {
  test('the same charge repeating is read as a standing arrangement', () => {
    const rows = Array.from({ length: 4 }, () =>
      facts({ description: 'חיוב חודשי 4491', amountMinor: 25_000 }),
    );
    const results = classifyBatch(rows, { householdRules: [], debts: NO_DEBTS });
    expect(results[0]?.class).toBe('standing_order');
    expect(results[0]?.confidence).toBe('medium');
    expect(results[0]?.ruleId).toBe('pattern.recurring');
  });

  test('a charge appearing twice is not yet a pattern', () => {
    const rows = Array.from({ length: 2 }, () =>
      facts({ description: 'חיוב חודשי 4491', amountMinor: 25_000 }),
    );
    const results = classifyBatch(rows, { householdRules: [], debts: NO_DEBTS });
    expect(results[0]?.class).not.toBe('standing_order');
  });

  test('repetition never changes a row own amount or date', () => {
    const rows = [
      facts({ description: 'חיוב חודשי 4491', amountMinor: 25_000, date: '2026-07-02' }),
      facts({ description: 'חיוב חודשי 4491', amountMinor: 25_000, date: '2026-08-02' }),
      facts({ description: 'חיוב חודשי 4491', amountMinor: 25_000, date: '2026-09-02' }),
    ];
    const results = classifyBatch(rows, { householdRules: [], debts: NO_DEBTS });
    // The suggestion carries no amount and no date at all — by construction.
    for (const result of results) {
      expect(result).not.toHaveProperty('amountMinor');
      expect(result).not.toHaveProperty('date');
    }
  });

  test('classifying the same input twice gives the same answer', () => {
    const input = facts({ description: 'ע. מסלול מורחב' });
    expect(classifyTransaction(input, context())).toStrictEqual(
      classifyTransaction(input, context()),
    );
  });
});
