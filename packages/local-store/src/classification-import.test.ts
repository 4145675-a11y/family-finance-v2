import { buildCsv, extractDocument } from '@family-finance/document-import';
import { replayDebtBalances } from '@family-finance/finance-engine';
import { describe, expect, test } from 'vitest';

import { addDebt } from './commands';
import type { StoreDocument } from './document';
import { contextFor, seededHousehold } from './fixtures/household';
import { approveBatch, checkApproval, reviewAll, stageExtraction } from './imports';
import { activeLearnedRules, addLearnedRule } from './learned-rules';

/**
 * What the classifier is allowed to do to a household's money, which is nothing.
 *
 * The file below is a synthetic bank statement in the shape an Israeli bank
 * exports. The lines are the bank's own vocabulary; the amounts are invented and
 * no real household's file appears here.
 */

const statement = buildCsv({
  delimiter: ';',
  preamble: ['בנק לדוגמה - תנועות בחשבון', 'מספר חשבון 12-345678'],
  header: ['תאריך', 'תיאור', 'חובה', 'זכות', 'יתרה'],
  rows: [
    ['02/09/2026', 'ע. מסלול מורחב', '12.50', '', '11,987.50'],
    ['03/09/2026', 'חיוב הלוואה', '1,500.00', '', '10,487.50'],
    ['04/09/2026', 'סופרמרקט', '412.30', '', '10,075.20'],
    ['05/09/2026', 'משכורת', '', '8,000.00', '18,075.20'],
  ],
});

function stage(document: StoreDocument, accountId: string) {
  const extraction = extractDocument(statement, {
    fileName: 'statement.csv',
    currency: 'ILS',
    scope: 'household',
    importedOn: '2026-09-22',
  });

  return stageExtraction(
    document,
    {
      extraction,
      displayName: 'statement.csv',
      storedId: crypto.randomUUID(),
      sha256: 'e'.repeat(64),
      byteSize: statement.byteLength,
      declaredMimeType: 'text/csv',
      targetAccountId: accountId,
    },
    contextFor(document),
  );
}

function suggestionFor(document: StoreDocument, batchId: string, contains: string) {
  return document.importProposals.find(
    (proposal) =>
      proposal.batchId === batchId &&
      proposal.proposed.kind === 'transaction' &&
      proposal.proposed.value.description.includes(contains),
  );
}

describe('every imported row arrives with a reading of what it is', () => {
  const seeded = seededHousehold();
  const staged = stage(seeded.document, seeded.bankAccountId);

  test('the bank charge is read as a bank fee, with high confidence', () => {
    const row = suggestionFor(staged.document, staged.value, 'מסלול');
    expect(row?.classification?.class).toBe('bank_fee');
    expect(row?.classification?.confidence).toBe('high');
  });

  test('the loan line is read as a repayment, and asks which loan', () => {
    const row = suggestionFor(staged.document, staged.value, 'הלוואה');
    expect(row?.classification?.class).toBe('loan_repayment');
    expect(row?.classification?.requiresDebtChoice).toBe(true);
    expect(row?.classification?.suggestedDebtId).toBeNull();
  });

  test('the salary is read as income', () => {
    const row = suggestionFor(staged.document, staged.value, 'משכורת');
    expect(row?.classification?.class).toBe('salary');
  });

  test('every suggestion says which rule produced it, in Hebrew', () => {
    for (const proposal of staged.document.importProposals) {
      if (proposal.classification == null) continue;
      expect(proposal.classification.ruleId.length).toBeGreaterThan(0);
      expect(proposal.classification.explanation.length).toBeGreaterThan(0);
    }
  });

  test('a suggestion never attaches the row to a debt by itself', () => {
    for (const proposal of staged.document.importProposals) {
      expect(proposal.targetDebtId).toBeNull();
    }
  });

  test('staging still moves no money at all', () => {
    expect(staged.document.transactions).toHaveLength(seeded.document.transactions.length);
    expect(staged.document.debtEvents).toHaveLength(seeded.document.debtEvents.length);
  });

  test('the raw row is kept beside the reading, unchanged', () => {
    const row = suggestionFor(staged.document, staged.value, 'מסלול');
    expect(row?.raw.some((cell) => cell.text.includes('מסלול'))).toBe(true);
  });
});

describe('an ambiguous loan line cannot move a balance', () => {
  const seeded = seededHousehold();
  const staged = stage(seeded.document, seeded.bankAccountId);

  test('including every row leaves the batch unapprovable', () => {
    const reviewed = reviewAll(
      staged.document,
      { batchId: staged.value, reviewState: 'included', onlyPending: false },
      contextFor(staged.document),
    );
    const check = checkApproval(reviewed.document, staged.value);
    expect(check.canApprove).toBe(false);
    expect(check.blocking.some((row) => row.reason === 'needs_debt')).toBe(true);
  });

  test('and approving it throws rather than guessing a lender', () => {
    const reviewed = reviewAll(
      staged.document,
      { batchId: staged.value, reviewState: 'included', onlyPending: false },
      contextFor(staged.document),
    );
    expect(() =>
      approveBatch(reviewed.document, { batchId: staged.value }, contextFor(reviewed.document)),
    ).toThrow();
  });

  test('no debt balance changed while the row sat unresolved', () => {
    const before = replayDebtBalances(seeded.document.debtEvents, '2026-12-31');
    const after = replayDebtBalances(staged.document.debtEvents, '2026-12-31');
    expect([...after.entries()].sort()).toEqual([...before.entries()].sort());
  });

  test('excluding the loan row lets the rest through', () => {
    let working = reviewAll(
      staged.document,
      { batchId: staged.value, reviewState: 'included', onlyPending: false },
      contextFor(staged.document),
    ).document;

    const loanRow = suggestionFor(working, staged.value, 'הלוואה');
    working = {
      ...working,
      importProposals: working.importProposals.map((proposal) =>
        proposal.id === loanRow?.id
          ? { ...proposal, reviewState: 'excluded' as const }
          : proposal,
      ),
    };

    expect(checkApproval(working, staged.value).canApprove).toBe(true);
  });
});

describe('confirming only what was obvious', () => {
  const seeded = seededHousehold();
  const staged = stage(seeded.document, seeded.bankAccountId);

  test('a high-confidence sweep includes the fee and the salary', () => {
    const swept = reviewAll(
      staged.document,
      {
        batchId: staged.value,
        reviewState: 'included',
        onlyPending: true,
        onlyHighConfidence: true,
      },
      contextFor(staged.document),
    );

    const fee = suggestionFor(swept.document, staged.value, 'מסלול');
    const salary = suggestionFor(swept.document, staged.value, 'משכורת');
    expect(fee?.reviewState).toBe('included');
    expect(salary?.reviewState).toBe('included');
  });

  test('it does not sweep in the loan row, however confident the words were', () => {
    const swept = reviewAll(
      staged.document,
      {
        batchId: staged.value,
        reviewState: 'included',
        onlyPending: true,
        onlyHighConfidence: true,
      },
      contextFor(staged.document),
    );

    const loan = suggestionFor(swept.document, staged.value, 'הלוואה');
    expect(loan?.classification?.confidence).toBe('high');
    expect(loan?.reviewState).toBe('pending');
  });

  test('it does not sweep in the unrecognised shop', () => {
    const swept = reviewAll(
      staged.document,
      {
        batchId: staged.value,
        reviewState: 'included',
        onlyPending: true,
        onlyHighConfidence: true,
      },
      contextFor(staged.document),
    );
    const shop = suggestionFor(swept.document, staged.value, 'סופרמרקט');
    expect(shop?.reviewState).toBe('pending');
  });

  test('a bulk exclude is never restricted, because refusing is always safe', () => {
    const swept = reviewAll(
      staged.document,
      {
        batchId: staged.value,
        reviewState: 'excluded',
        onlyPending: true,
        onlyHighConfidence: true,
      },
      contextFor(staged.document),
    );
    const rows = swept.document.importProposals.filter(
      (proposal) => proposal.batchId === staged.value,
    );
    expect(rows.every((row) => row.reviewState === 'excluded')).toBe(true);
  });
});

describe("a household's rules belong to that household", () => {
  test('a rule saved by one household is not in another document at all', () => {
    const first = seededHousehold().document;
    const second = seededHousehold().document;

    const withRule = addLearnedRule(
      first,
      {
        label: 'סופרמרקט הוא אוכל',
        matcher: { descriptionContains: 'סופרמרקט', direction: 'outflow', accountId: null },
        class: 'purchase',
        budgetCategoryKey: 'food',
        counterparty: null,
        debtId: null,
      },
      contextFor(first),
    ).document;

    expect(activeLearnedRules(withRule)).toHaveLength(1);
    // The other household's document never gained it. Isolation is structural:
    // the rule lives in a document, and a document belongs to one household.
    expect(activeLearnedRules(second)).toHaveLength(0);
    expect(withRule.learnedRules[0]?.householdId).toBe(first.household.id);
  });

  test('the rule changes that household next import, and only theirs', () => {
    const seeded = seededHousehold();
    const withRule = addLearnedRule(
      seeded.document,
      {
        label: 'סופרמרקט הוא אוכל',
        matcher: { descriptionContains: 'סופרמרקט', direction: 'outflow', accountId: null },
        class: 'purchase',
        budgetCategoryKey: 'food',
        counterparty: null,
        debtId: null,
      },
      contextFor(seeded.document),
    ).document;

    const withIt = stage(withRule, seeded.bankAccountId);
    const withoutIt = stage(seeded.document, seeded.bankAccountId);

    const taught = suggestionFor(withIt.document, withIt.value, 'סופרמרקט');
    const untaught = suggestionFor(withoutIt.document, withoutIt.value, 'סופרמרקט');

    expect(taught?.classification?.fromHouseholdRule).toBe(true);
    expect(taught?.classification?.budgetCategoryKey).toBe('food');
    expect(untaught?.classification?.fromHouseholdRule).toBe(false);
    expect(untaught?.classification?.budgetCategoryKey).toBeNull();
  });

  test('a disabled rule stops applying but is not lost', () => {
    const seeded = seededHousehold();
    const added = addLearnedRule(
      seeded.document,
      {
        label: 'סופרמרקט הוא אוכל',
        matcher: { descriptionContains: 'סופרמרקט', direction: 'outflow', accountId: null },
        class: 'purchase',
        budgetCategoryKey: 'food',
        counterparty: null,
        debtId: null,
      },
      contextFor(seeded.document),
    );

    const disabled: StoreDocument = {
      ...added.document,
      learnedRules: added.document.learnedRules.map((rule) => ({ ...rule, enabled: false })),
    };

    expect(disabled.learnedRules).toHaveLength(1);
    expect(activeLearnedRules(disabled)).toHaveLength(0);

    const staged = stage(disabled, seeded.bankAccountId);
    const shop = suggestionFor(staged.document, staged.value, 'סופרמרקט');
    expect(shop?.classification?.fromHouseholdRule).toBe(false);
  });
});

describe('a rule that names a debt still does not move it', () => {
  test('the row is attached only when a person approves the batch', () => {
    const seeded = seededHousehold();
    const withDebt = addDebt(
      seeded.document,
      {
        creditorName: 'גמח אור החיים',
        kind: 'gemach',
        openingBalanceMinor: 500_000,
        openedOn: '2026-08-01',
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
      contextFor(seeded.document),
    );
    const debtId = withDebt.value;

    const withRule = addLearnedRule(
      withDebt.document,
      {
        label: 'חיוב הלוואה הוא הגמח',
        matcher: { descriptionContains: 'חיוב הלוואה', direction: 'outflow', accountId: null },
        class: 'loan_repayment',
        budgetCategoryKey: null,
        counterparty: null,
        debtId,
      },
      contextFor(withDebt.document),
    ).document;

    const staged = stage(withRule, seeded.bankAccountId);
    const loan = suggestionFor(staged.document, staged.value, 'חיוב הלוואה');

    // The rule names the debt, so no question is needed…
    expect(loan?.classification?.suggestedDebtId).toBe(debtId);
    expect(loan?.classification?.requiresDebtChoice).toBe(false);

    // …but the row is still not attached, and the balance has not moved.
    expect(loan?.targetDebtId).toBeNull();
    const balances = replayDebtBalances(staged.document.debtEvents, '2026-12-31');
    expect(balances.get(debtId)).toBe(500_000);
  });
});
