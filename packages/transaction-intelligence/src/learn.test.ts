import { describe, expect, test } from 'vitest';

import { classifyTransaction, type TransactionFacts } from './classify';
import { matcherTextFrom, ruleFromCorrection, type CorrectionInput } from './learn';
import { normaliseDescription } from './normalise';

const ACTOR = '22222222-2222-4222-8222-222222222222';
const HOUSEHOLD = '11111111-1111-4111-8111-111111111111';
const DEBT = '33333333-3333-4333-8333-333333333333';
const ACCOUNT = '44444444-4444-4444-8444-444444444444';

function correction(overrides: Partial<CorrectionInput> = {}): CorrectionInput {
  return {
    description: 'הוראת קבע עמותת חסד 88219',
    direction: 'outflow',
    class: 'purchase',
    budgetCategoryKey: 'celebrations_and_gifts',
    counterparty: 'עמותת חסד',
    debtId: null,
    accountId: null,
    ...overrides,
  };
}

describe('matcherTextFrom — the durable part of a line', () => {
  test('keeps the words and drops the reference number', () => {
    const matcher = matcherTextFrom('הוראת קבע עמותת חסד 88219');
    expect(matcher).not.toContain('88219');
    expect(matcher).toContain(normaliseDescription('עמותת'));
  });

  test('so next month, whose reference differs, still matches', () => {
    const september = matcherTextFrom('הוראת קבע עמותת חסד 88219');
    const october = matcherTextFrom('הוראת קבע עמותת חסד 90441');
    expect(september).toBe(october);
  });

  test('takes at most four words, so it stays matchable', () => {
    const matcher = matcherTextFrom('אחת שתיים שלוש ארבע חמש שש שבע');
    expect(matcher.split(' ')).toHaveLength(4);
  });

  test('a line of only digits yields nothing to match on', () => {
    expect(matcherTextFrom('4491 88219')).toBe('');
  });

  test('the matcher is already folded, so it matches a folded line', () => {
    const matcher = matcherTextFrom('ע. מסלול מורחב');
    expect(normaliseDescription(matcher)).toBe(matcher);
  });
});

describe('ruleFromCorrection — offered, never taken', () => {
  test('a correction becomes a rule that carries the chosen class', () => {
    const rule = ruleFromCorrection(correction());
    expect(rule).not.toBeNull();
    expect(rule?.class).toBe('purchase');
    expect(rule?.budgetCategoryKey).toBe('celebrations_and_gifts');
    expect(rule?.counterparty).toBe('עמותת חסד');
  });

  test('the rule is scoped to the direction it was corrected in', () => {
    expect(ruleFromCorrection(correction())?.matcher.direction).toBe('outflow');
  });

  test('unless the household says it applies both ways', () => {
    const rule = ruleFromCorrection(correction({ anyDirection: true }));
    expect(rule?.matcher.direction).toBeNull();
  });

  test('a rule can be pinned to one account', () => {
    const rule = ruleFromCorrection(correction({ accountId: ACCOUNT }));
    expect(rule?.matcher.accountId).toBe(ACCOUNT);
  });

  test('a line with nothing durable produces no rule at all', () => {
    // Inventing a rule from a reference number would match that one row for ever
    // and teach the household nothing.
    expect(ruleFromCorrection(correction({ description: '88219 4491' }))).toBeNull();
  });

  test('a debt is carried only on a repayment', () => {
    const asPurchase = ruleFromCorrection(correction({ debtId: DEBT, class: 'purchase' }));
    expect(asPurchase?.debtId).toBeNull();

    const asRepayment = ruleFromCorrection(
      correction({ debtId: DEBT, class: 'loan_repayment' }),
    );
    expect(asRepayment?.debtId).toBe(DEBT);
  });
});

describe('a saved rule actually changes the next classification', () => {
  const facts: TransactionFacts = {
    description: 'הוראת קבע עמותת חסד 90441',
    amountMinor: 20_000,
    direction: 'outflow',
    date: '2026-10-02',
    reference: null,
    bankName: 'בנק הפועלים',
    accountKind: 'bank_account',
  };

  test('without the rule, the line is only a standing order', () => {
    const result = classifyTransaction(facts, { householdRules: [], debts: [] });
    expect(result.class).toBe('standing_order');
    expect(result.fromHouseholdRule).toBe(false);
  });

  test('with the rule saved from September, October is classified by it', () => {
    const created = ruleFromCorrection(correction());
    expect(created).not.toBeNull();
    if (created === null) return;

    const result = classifyTransaction(facts, {
      householdRules: [
        {
          id: '55555555-5555-4555-8555-555555555555',
          householdId: HOUSEHOLD,
          label: created.label,
          matcher: created.matcher,
          class: created.class,
          budgetCategoryKey: created.budgetCategoryKey,
          counterparty: created.counterparty,
          debtId: created.debtId,
          enabled: true,
          timesApplied: 0,
          createdBy: ACTOR,
          createdAt: '2026-09-02T00:00:00.000Z',
          updatedAt: '2026-09-02T00:00:00.000Z',
          version: 1,
        },
      ],
      debts: [],
    });

    expect(result.fromHouseholdRule).toBe(true);
    expect(result.class).toBe('purchase');
    expect(result.budgetCategoryKey).toBe('celebrations_and_gifts');
  });
});
