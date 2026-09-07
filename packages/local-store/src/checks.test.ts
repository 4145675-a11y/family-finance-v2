import { maskCheckNumber, plannedTotalMinor } from '@family-finance/contracts';
import { replayDebtBalances, summariseChecks } from '@family-finance/finance-engine';
import { beforeEach, describe, expect, test } from 'vitest';

import {
  addCheck,
  addCheckSeries,
  cancelCheck,
  checksForDebt,
  clearCheck,
  deliverChecks,
  markCheckDeposited,
  markCheckReturned,
  plannedRepaymentTotal,
  previewCheckSeries,
  replaceCheck,
  revertCheckStatus,
  setRepaymentPlan,
} from './checks';
import { addDebt, CommandError } from './commands';
import { storeDocumentSchema, type StoreDocument } from './document';
import { balanceOf, toEngineInput } from './projection';
import { contextFor, seededHousehold, TEST_NOW, TEST_TODAY } from './fixtures/household';

/**
 * Gemach loans and the checks that repay them.
 *
 * The suite is organised around one sentence, and most of it exists to prove
 * that sentence has not quietly stopped being true:
 *
 *   **Handing a check to the gemach changes no number. The bank honouring it
 *   changes exactly two, exactly once.**
 *
 * The tests that matter most are therefore the ones that assert nothing happened.
 * A product where delivering a check reduced the balance would pass every
 * cheerful test about totals and would be wrong about the household's money in
 * the way that costs them the most.
 */

const OPENED = '2026-05-01';

interface Scene {
  document: StoreDocument;
  bankAccountId: string;
  gemachDebtId: string;
}

function gemachScene(): Scene {
  const seeded = seededHousehold();
  const created = addDebt(
    seeded.document,
    {
      creditorName: 'גמ״ח שכונתי',
      kind: 'gemach',
      openingBalanceMinor: 900_000,
      openedOn: OPENED,
      // A gemach charges nothing, and zero is a fact rather than a missing value.
      effectiveAnnualRateBp: 0,
      minimumPaymentMinor: 150_000,
      paymentDueDay: 12,
      urgency: 'none',
      promiseSummary: 'שישה תשלומים שווים, צ׳קים מראש',
      relationshipSensitivity: null,
      partialPaymentAllowed: null,
      expectedCallDate: null,
      notes: null,
    },
    contextFor(seeded.document),
  );

  return {
    document: created.document,
    bankAccountId: seeded.bankAccountId,
    gemachDebtId: created.value,
  };
}

function debtBalanceOf(document: StoreDocument, debtId: string, today = TEST_TODAY): number {
  return replayDebtBalances(document.debtEvents, today).get(debtId) ?? 0;
}

function run<T>(
  document: StoreDocument,
  command: (
    document: StoreDocument,
    context: ReturnType<typeof contextFor>,
  ) => { document: StoreDocument; value: T },
  now = TEST_NOW,
): { document: StoreDocument; value: T } {
  return command(document, contextFor(document, now));
}

function codeOf(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    return error instanceof CommandError ? error.code : `unexpected:${String(error)}`;
  }
  return 'no_error';
}

describe('creating a gemach loan', () => {
  let scene: Scene;
  beforeEach(() => {
    scene = gemachScene();
  });

  test('is a debt like any other, with its own kind', () => {
    const debt = scene.document.debts.find((candidate) => candidate.id === scene.gemachDebtId);
    expect(debt?.kind).toBe('gemach');
    expect(debt?.creditorName).toBe('גמ״ח שכונתי');
  });

  test('an interest-free loan records zero rather than unknown', () => {
    // Two very different statements. "Unknown" would make the debt screen warn
    // that the cost cannot be compared; zero is the truth and can be.
    const debt = scene.document.debts.find((candidate) => candidate.id === scene.gemachDebtId);
    expect(debt?.effectiveAnnualRateBp).toBe(0);
  });

  test('the opening balance is what is owed before anything is repaid', () => {
    expect(debtBalanceOf(scene.document, scene.gemachDebtId)).toBe(900_000);
  });

  test('a gemach counts as consumer debt, not a mortgage', () => {
    const input = toEngineInput(scene.document, { asOf: TEST_NOW });
    const gemach = input.debts.find((debt) => debt.id === scene.gemachDebtId);
    expect(gemach?.kind).toBe('gemach');
  });
});

describe('the repayment agreement', () => {
  test('is recorded separately from the checks', () => {
    const scene = gemachScene();
    const planned = run(scene.document, (document, context) =>
      setRepaymentPlan(
        document,
        {
          debtId: scene.gemachDebtId,
          agreementSummary: 'שישה תשלומים חודשיים',
          installmentCount: 6,
          installmentAmountMinor: 150_000,
          finalInstallmentAmountMinor: null,
          firstDueDate: '2026-06-12',
        },
        context,
      ),
    );

    expect(planned.document.repaymentPlans).toHaveLength(1);
    expect(plannedRepaymentTotal(planned.document, scene.gemachDebtId)).toBe(900_000);
    // No checks were created by agreeing a plan. The paper is a separate act.
    expect(planned.document.checks).toHaveLength(0);
  });

  test('an uneven plan totals correctly', () => {
    expect(
      plannedTotalMinor({
        installmentCount: 3,
        installmentAmountMinor: 333_333,
        finalInstallmentAmountMinor: 333_334,
      }),
    ).toBe(1_000_000);
  });

  test('setting it again updates rather than duplicating', () => {
    const scene = gemachScene();
    let document = scene.document;

    for (const count of [6, 12]) {
      document = run(document, (current, context) =>
        setRepaymentPlan(
          current,
          {
            debtId: scene.gemachDebtId,
            agreementSummary: null,
            installmentCount: count,
            installmentAmountMinor: 150_000,
            finalInstallmentAmountMinor: null,
            firstDueDate: '2026-06-12',
          },
          context,
        ),
      ).document;
    }

    expect(document.repaymentPlans).toHaveLength(1);
    expect(document.repaymentPlans[0]?.installmentCount).toBe(12);
    expect(document.repaymentPlans[0]?.version).toBe(2);
  });

  test('an installment of nothing is refused', () => {
    const scene = gemachScene();
    expect(
      codeOf(() =>
        run(scene.document, (document, context) =>
          setRepaymentPlan(
            document,
            {
              debtId: scene.gemachDebtId,
              agreementSummary: null,
              installmentCount: 6,
              installmentAmountMinor: 0,
              finalInstallmentAmountMinor: null,
              firstDueDate: '2026-06-12',
            },
            context,
          ),
        ),
      ),
    ).toBe('amount_required');
  });
});

describe('writing checks', () => {
  test('one check, not yet handed over, is prepared', () => {
    const scene = gemachScene();
    const added = run(scene.document, (document, context) =>
      addCheck(
        document,
        {
          debtId: scene.gemachDebtId,
          accountId: scene.bankAccountId,
          checkNumber: '001042',
          amountMinor: 150_000,
          dueDate: '2026-10-12',
          payeeName: 'גמ״ח שכונתי',
          installmentNumber: 1,
          note: null,
          deliveredOn: null,
        },
        context,
      ),
    );

    const check = added.document.checks[0];
    expect(check?.status).toBe('prepared');
    expect(check?.deliveredOn).toBeNull();
    expect(check?.source).toBe('manual');
  });

  test('a check written and handed over in one go is delivered', () => {
    const scene = gemachScene();
    const added = run(scene.document, (document, context) =>
      addCheck(
        document,
        {
          debtId: scene.gemachDebtId,
          accountId: scene.bankAccountId,
          checkNumber: null,
          amountMinor: 150_000,
          dueDate: '2026-10-12',
          payeeName: 'גמ״ח',
          installmentNumber: null,
          note: null,
          deliveredOn: '2026-09-01',
        },
        context,
      ),
    );
    expect(added.document.checks[0]?.status).toBe('delivered');
  });

  test('a check for nothing is refused', () => {
    const scene = gemachScene();
    expect(
      codeOf(() =>
        run(scene.document, (document, context) =>
          addCheck(
            document,
            {
              debtId: scene.gemachDebtId,
              accountId: scene.bankAccountId,
              checkNumber: null,
              amountMinor: 0,
              dueDate: '2026-10-12',
              payeeName: 'גמ״ח',
              installmentNumber: null,
              note: null,
              deliveredOn: null,
            },
            context,
          ),
        ),
      ),
    ).toBe('amount_required');
  });

  test('a check against a debt that does not exist is refused', () => {
    const scene = gemachScene();
    expect(
      codeOf(() =>
        run(scene.document, (document, context) =>
          addCheck(
            document,
            {
              debtId: crypto.randomUUID(),
              accountId: scene.bankAccountId,
              checkNumber: null,
              amountMinor: 150_000,
              dueDate: '2026-10-12',
              payeeName: 'גמ״ח',
              installmentNumber: null,
              note: null,
              deliveredOn: null,
            },
            context,
          ),
        ),
      ),
    ).toBe('unknown_debt');
  });

  test('the same check number twice on one account is refused', () => {
    const scene = gemachScene();
    const first = run(scene.document, (document, context) =>
      addCheck(
        document,
        {
          debtId: scene.gemachDebtId,
          accountId: scene.bankAccountId,
          checkNumber: '1042',
          amountMinor: 150_000,
          dueDate: '2026-10-12',
          payeeName: 'גמ״ח',
          installmentNumber: 1,
          note: null,
          deliveredOn: null,
        },
        context,
      ),
    );

    expect(
      codeOf(() =>
        run(first.document, (document, context) =>
          addCheck(
            document,
            {
              debtId: scene.gemachDebtId,
              accountId: scene.bankAccountId,
              checkNumber: '1042',
              amountMinor: 150_000,
              dueDate: '2026-11-12',
              payeeName: 'גמ״ח',
              installmentNumber: 2,
              note: null,
              deliveredOn: null,
            },
            context,
          ),
        ),
      ),
    ).toBe('duplicate_check_number');
  });

  test('two checks with no number are both fine', () => {
    // Most families do not record the numbers, and demanding them would produce
    // invented data.
    const scene = gemachScene();
    let document = scene.document;

    for (const dueDate of ['2026-10-12', '2026-11-12']) {
      document = run(document, (current, context) =>
        addCheck(
          current,
          {
            debtId: scene.gemachDebtId,
            accountId: scene.bankAccountId,
            checkNumber: null,
            amountMinor: 150_000,
            dueDate,
            payeeName: 'גמ״ח',
            installmentNumber: null,
            note: null,
            deliveredOn: null,
          },
          context,
        ),
      ).document;
    }

    expect(document.checks).toHaveLength(2);
  });
});

describe('generating a series', () => {
  test('the preview shows the whole year before anything is written', () => {
    const preview = previewCheckSeries({
      debtId: 'x',
      accountId: 'y',
      payeeName: 'גמ״ח',
      count: 6,
      amountPerCheckMinor: 150_000,
      finalCheckAmountMinor: null,
      firstDueDate: '2026-10-12',
      firstCheckNumber: '1001',
      intendedTotalMinor: 900_000,
      note: null,
      deliveredOn: null,
    });

    expect(preview.checks).toHaveLength(6);
    expect(preview.totalMinor).toBe(900_000);
    expect(preview.warnings).toEqual([]);
  });

  test('creating the series produces one check per installment', () => {
    const scene = gemachScene();
    const created = run(scene.document, (document, context) =>
      addCheckSeries(
        document,
        {
          debtId: scene.gemachDebtId,
          accountId: scene.bankAccountId,
          payeeName: 'גמ״ח שכונתי',
          count: 6,
          amountPerCheckMinor: 150_000,
          finalCheckAmountMinor: null,
          firstDueDate: '2026-10-12',
          firstCheckNumber: '1001',
          intendedTotalMinor: 900_000,
          note: null,
          deliveredOn: '2026-09-06',
        },
        context,
      ),
    );

    expect(created.value).toHaveLength(6);
    const checks = checksForDebt(created.document, scene.gemachDebtId);
    expect(checks.map((check) => check.checkNumber)).toEqual([
      '1001',
      '1002',
      '1003',
      '1004',
      '1005',
      '1006',
    ]);
    expect(checks.every((check) => check.status === 'delivered')).toBe(true);
  });

  test('a series with a different final check totals what was intended', () => {
    const scene = gemachScene();
    const created = run(scene.document, (document, context) =>
      addCheckSeries(
        document,
        {
          debtId: scene.gemachDebtId,
          accountId: scene.bankAccountId,
          payeeName: 'גמ״ח',
          count: 3,
          amountPerCheckMinor: 333_333,
          finalCheckAmountMinor: 333_334,
          firstDueDate: '2026-10-12',
          firstCheckNumber: null,
          intendedTotalMinor: 1_000_000,
          note: null,
          deliveredOn: null,
        },
        context,
      ),
    );

    const total = checksForDebt(created.document, scene.gemachDebtId).reduce(
      (sum, check) => sum + check.amountMinor,
      0,
    );
    expect(total).toBe(1_000_000);
  });

  test('a series that would repeat an existing check number is refused whole', () => {
    // All or nothing: a series that created four checks and then stopped would
    // leave the family reconciling a half-written year.
    const scene = gemachScene();
    const first = run(scene.document, (document, context) =>
      addCheck(
        document,
        {
          debtId: scene.gemachDebtId,
          accountId: scene.bankAccountId,
          checkNumber: '1003',
          amountMinor: 150_000,
          dueDate: '2026-09-12',
          payeeName: 'גמ״ח',
          installmentNumber: null,
          note: null,
          deliveredOn: null,
        },
        context,
      ),
    );

    expect(
      codeOf(() =>
        run(first.document, (document, context) =>
          addCheckSeries(
            document,
            {
              debtId: scene.gemachDebtId,
              accountId: scene.bankAccountId,
              payeeName: 'גמ״ח',
              count: 6,
              amountPerCheckMinor: 150_000,
              finalCheckAmountMinor: null,
              firstDueDate: '2026-10-12',
              firstCheckNumber: '1001',
              intendedTotalMinor: 900_000,
              note: null,
              deliveredOn: null,
            },
            context,
          ),
        ),
      ),
    ).toBe('duplicate_check_number');

    // And the document the caller still holds is untouched.
    expect(first.document.checks).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------

describe('handing checks over changes no figure', () => {
  function sceneWithSeries() {
    const scene = gemachScene();
    const created = run(scene.document, (document, context) =>
      addCheckSeries(
        document,
        {
          debtId: scene.gemachDebtId,
          accountId: scene.bankAccountId,
          payeeName: 'גמ״ח שכונתי',
          count: 6,
          amountPerCheckMinor: 150_000,
          finalCheckAmountMinor: null,
          firstDueDate: '2026-10-12',
          firstCheckNumber: '1001',
          intendedTotalMinor: 900_000,
          note: null,
          deliveredOn: null,
        },
        context,
      ),
    );
    return { ...scene, document: created.document, checkIds: created.value };
  }

  test('the bank balance is exactly what it was', () => {
    const scene = sceneWithSeries();
    const before = balanceOf(scene.document, scene.bankAccountId).computedMinor;

    const delivered = run(scene.document, (document, context) =>
      deliverChecks(document, { checkIds: scene.checkIds, deliveredOn: '2026-09-06' }, context),
    );

    expect(balanceOf(delivered.document, scene.bankAccountId).computedMinor).toBe(before);
  });

  test('the debt is exactly what it was', () => {
    const scene = sceneWithSeries();
    const before = debtBalanceOf(scene.document, scene.gemachDebtId);

    const delivered = run(scene.document, (document, context) =>
      deliverChecks(document, { checkIds: scene.checkIds, deliveredOn: '2026-09-06' }, context),
    );

    expect(debtBalanceOf(delivered.document, scene.gemachDebtId)).toBe(before);
    expect(before).toBe(900_000);
  });

  test('no transaction and no debt event were created', () => {
    const scene = sceneWithSeries();
    const transactionsBefore = scene.document.transactions.length;
    const eventsBefore = scene.document.debtEvents.length;

    const delivered = run(scene.document, (document, context) =>
      deliverChecks(document, { checkIds: scene.checkIds, deliveredOn: '2026-09-06' }, context),
    );

    expect(delivered.document.transactions).toHaveLength(transactionsBefore);
    expect(delivered.document.debtEvents).toHaveLength(eventsBefore);
  });

  test('what did change is the exposure, which is the whole point', () => {
    const scene = sceneWithSeries();
    const before = summariseChecks(
      toEngineInput(scene.document, { asOf: TEST_NOW }).checks,
      TEST_TODAY,
    );
    expect(before.atLargeTotalMinor).toBe(0);

    const delivered = run(scene.document, (document, context) =>
      deliverChecks(document, { checkIds: scene.checkIds, deliveredOn: '2026-09-06' }, context),
    );

    const after = summariseChecks(
      toEngineInput(delivered.document, { asOf: TEST_NOW }).checks,
      TEST_TODAY,
    );
    expect(after.atLargeTotalMinor).toBe(900_000);
    expect(after.outstandingTotalMinor).toBe(900_000);
  });

  test('delivering the same checks twice is not an error and changes nothing twice', () => {
    const scene = sceneWithSeries();
    const once = run(scene.document, (document, context) =>
      deliverChecks(document, { checkIds: scene.checkIds, deliveredOn: '2026-09-06' }, context),
    );
    const twice = run(once.document, (document, context) =>
      deliverChecks(document, { checkIds: scene.checkIds, deliveredOn: '2026-09-07' }, context),
    );

    expect(twice.value).toBe(0);
    expect(twice.document.checks.every((check) => check.deliveredOn === '2026-09-06')).toBe(
      true,
    );
  });

  test('an audit entry is written for each delivery', () => {
    const scene = sceneWithSeries();
    const before = scene.document.audit.length;
    const delivered = run(scene.document, (document, context) =>
      deliverChecks(document, { checkIds: scene.checkIds, deliveredOn: '2026-09-06' }, context),
    );

    const added = delivered.document.audit.slice(before);
    expect(added).toHaveLength(6);
    expect(added.every((entry) => entry.action === 'check.delivered')).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('clearing a check moves money exactly once', () => {
  function sceneWithDelivered() {
    const scene = gemachScene();
    const created = run(scene.document, (document, context) =>
      addCheckSeries(
        document,
        {
          debtId: scene.gemachDebtId,
          accountId: scene.bankAccountId,
          payeeName: 'גמ״ח שכונתי',
          count: 6,
          amountPerCheckMinor: 150_000,
          finalCheckAmountMinor: null,
          firstDueDate: '2026-10-12',
          firstCheckNumber: '1001',
          intendedTotalMinor: 900_000,
          note: null,
          deliveredOn: '2026-09-06',
        },
        context,
      ),
    );
    return { ...scene, document: created.document, checkIds: created.value };
  }

  test('the bank balance falls by the face value, once', () => {
    const scene = sceneWithDelivered();
    const before = balanceOf(scene.document, scene.bankAccountId).computedMinor;

    const cleared = run(scene.document, (document, context) =>
      clearCheck(document, { checkId: scene.checkIds[0]!, clearedOn: '2026-10-13' }, context),
    );

    expect(balanceOf(cleared.document, scene.bankAccountId).computedMinor).toBe(
      before - 150_000,
    );
  });

  test('the debt falls by the face value, once', () => {
    const scene = sceneWithDelivered();
    const cleared = run(scene.document, (document, context) =>
      clearCheck(document, { checkId: scene.checkIds[0]!, clearedOn: '2026-10-13' }, context),
    );

    expect(debtBalanceOf(cleared.document, scene.gemachDebtId, '2026-10-31')).toBe(750_000);
  });

  test('exactly one transaction and one debt event are created', () => {
    const scene = sceneWithDelivered();
    const transactionsBefore = scene.document.transactions.length;
    const eventsBefore = scene.document.debtEvents.length;

    const cleared = run(scene.document, (document, context) =>
      clearCheck(document, { checkId: scene.checkIds[0]!, clearedOn: '2026-10-13' }, context),
    );

    expect(cleared.document.transactions).toHaveLength(transactionsBefore + 1);
    expect(cleared.document.debtEvents).toHaveLength(eventsBefore + 1);
  });

  test('the repayment reduces principal and is not interest', () => {
    // A gemach charges nothing, so every shekel is progress. Recording it as
    // anything else would understate what the family has achieved.
    const scene = sceneWithDelivered();
    const cleared = run(scene.document, (document, context) =>
      clearCheck(document, { checkId: scene.checkIds[0]!, clearedOn: '2026-10-13' }, context),
    );

    const event = cleared.document.debtEvents.find(
      (candidate) => candidate.id === cleared.value.debtEventId,
    );
    expect(event?.kind).toBe('principal_payment');
    expect(event?.amountMinor).toBe(150_000);
  });

  test('the check links to both records it created', () => {
    const scene = sceneWithDelivered();
    const cleared = run(scene.document, (document, context) =>
      clearCheck(document, { checkId: scene.checkIds[0]!, clearedOn: '2026-10-13' }, context),
    );

    const check = cleared.document.checks.find(
      (candidate) => candidate.id === scene.checkIds[0],
    );
    expect(check?.status).toBe('cleared');
    expect(check?.clearedOn).toBe('2026-10-13');
    expect(check?.clearedTransactionId).toBe(cleared.value.transactionId);
    expect(check?.debtEventId).toBe(cleared.value.debtEventId);
  });

  test('a cleared check leaves the outstanding total', () => {
    const scene = sceneWithDelivered();
    const cleared = run(scene.document, (document, context) =>
      clearCheck(document, { checkId: scene.checkIds[0]!, clearedOn: '2026-10-13' }, context),
    );

    const exposure = summariseChecks(
      toEngineInput(cleared.document, { asOf: TEST_NOW }).checks,
      TEST_TODAY,
    );
    expect(exposure.outstandingCount).toBe(5);
    expect(exposure.outstandingTotalMinor).toBe(750_000);
    expect(exposure.clearedTotalMinor).toBe(150_000);
  });

  test('clearing the same check twice is refused', () => {
    // The defence that makes a repeated import harmless. Not deduplication —
    // refusal, by the record's own state.
    const scene = sceneWithDelivered();
    const once = run(scene.document, (document, context) =>
      clearCheck(document, { checkId: scene.checkIds[0]!, clearedOn: '2026-10-13' }, context),
    );

    expect(
      codeOf(() =>
        run(once.document, (document, context) =>
          clearCheck(
            document,
            { checkId: scene.checkIds[0]!, clearedOn: '2026-10-14' },
            context,
          ),
        ),
      ),
    ).toBe('check_already_cleared');
  });

  test('after a refused second clearing the figures are unchanged', () => {
    const scene = sceneWithDelivered();
    const once = run(scene.document, (document, context) =>
      clearCheck(document, { checkId: scene.checkIds[0]!, clearedOn: '2026-10-13' }, context),
    );

    try {
      run(once.document, (document, context) =>
        clearCheck(document, { checkId: scene.checkIds[0]!, clearedOn: '2026-10-14' }, context),
      );
    } catch {
      // Expected; the assertion below is the point.
    }

    expect(balanceOf(once.document, scene.bankAccountId).computedMinor).toBe(
      balanceOf(scene.document, scene.bankAccountId).computedMinor - 150_000,
    );
    expect(debtBalanceOf(once.document, scene.gemachDebtId, '2026-10-31')).toBe(750_000);
  });

  test('a prepared check cannot clear, because nobody has it', () => {
    const scene = gemachScene();
    const added = run(scene.document, (document, context) =>
      addCheck(
        document,
        {
          debtId: scene.gemachDebtId,
          accountId: scene.bankAccountId,
          checkNumber: null,
          amountMinor: 150_000,
          dueDate: '2026-10-12',
          payeeName: 'גמ״ח',
          installmentNumber: null,
          note: null,
          deliveredOn: null,
        },
        context,
      ),
    );

    expect(
      codeOf(() =>
        run(added.document, (document, context) =>
          clearCheck(document, { checkId: added.value, clearedOn: '2026-10-13' }, context),
        ),
      ),
    ).toBe('check_transition_not_allowed');
  });

  test('clearing all six repays the loan exactly', () => {
    const scene = sceneWithDelivered();
    let document = scene.document;

    const clearingDates = [
      '2026-10-13',
      '2026-11-13',
      '2026-12-13',
      '2027-01-13',
      '2027-02-13',
      '2027-03-13',
    ];

    for (const [index, checkId] of scene.checkIds.entries()) {
      document = run(document, (current, context) =>
        clearCheck(current, { checkId, clearedOn: clearingDates[index]! }, context),
      ).document;
    }

    expect(debtBalanceOf(document, scene.gemachDebtId, '2027-04-01')).toBe(0);
    const exposure = summariseChecks(
      toEngineInput(document, { asOf: TEST_NOW }).checks,
      TEST_TODAY,
    );
    expect(exposure.outstandingCount).toBe(0);
    expect(exposure.clearedTotalMinor).toBe(900_000);
  });

  test('depositing before clearing is allowed and moves nothing', () => {
    const scene = sceneWithDelivered();
    const before = balanceOf(scene.document, scene.bankAccountId).computedMinor;

    const deposited = run(scene.document, (document, context) =>
      markCheckDeposited(document, { checkId: scene.checkIds[0]! }, context),
    );

    expect(deposited.document.checks[0]?.status).toBe('deposited');
    expect(balanceOf(deposited.document, scene.bankAccountId).computedMinor).toBe(before);
  });
});

// ---------------------------------------------------------------------------

describe('the unhappy paths', () => {
  function delivered() {
    const scene = gemachScene();
    const added = run(scene.document, (document, context) =>
      addCheck(
        document,
        {
          debtId: scene.gemachDebtId,
          accountId: scene.bankAccountId,
          checkNumber: '1001',
          amountMinor: 150_000,
          dueDate: '2026-10-12',
          payeeName: 'גמ״ח שכונתי',
          installmentNumber: 1,
          note: null,
          deliveredOn: '2026-09-06',
        },
        context,
      ),
    );
    return { ...scene, document: added.document, checkId: added.value };
  }

  test('a returned check is not a repayment', () => {
    const scene = delivered();
    const returned = run(scene.document, (document, context) =>
      markCheckReturned(
        document,
        { checkId: scene.checkId, occurredOn: '2026-10-14', reason: 'אין כיסוי מספיק' },
        context,
      ),
    );

    expect(debtBalanceOf(returned.document, scene.gemachDebtId, '2026-10-31')).toBe(900_000);
    expect(balanceOf(returned.document, scene.bankAccountId).computedMinor).toBe(
      balanceOf(scene.document, scene.bankAccountId).computedMinor,
    );
  });

  test('a returned check leaves the exposure but is reported on its own', () => {
    const scene = delivered();
    const returned = run(scene.document, (document, context) =>
      markCheckReturned(
        document,
        { checkId: scene.checkId, occurredOn: '2026-10-14', reason: 'אין כיסוי' },
        context,
      ),
    );

    const exposure = summariseChecks(
      toEngineInput(returned.document, { asOf: TEST_NOW }).checks,
      TEST_TODAY,
    );
    expect(exposure.outstandingCount).toBe(0);
    expect(exposure.returnedCount).toBe(1);
  });

  test('a return needs a reason', () => {
    const scene = delivered();
    expect(
      codeOf(() =>
        run(scene.document, (document, context) =>
          markCheckReturned(
            document,
            { checkId: scene.checkId, occurredOn: '2026-10-14', reason: '   ' },
            context,
          ),
        ),
      ),
    ).toBe('reason_required');
  });

  test('cancelling needs a reason and records it', () => {
    const scene = delivered();
    const cancelled = run(scene.document, (document, context) =>
      cancelCheck(
        document,
        { checkId: scene.checkId, occurredOn: '2026-09-20', reason: 'סוכם על העברה בנקאית' },
        context,
      ),
    );

    const check = cancelled.document.checks[0];
    expect(check?.status).toBe('cancelled');
    expect(check?.resolutionReason).toBe('סוכם על העברה בנקאית');
    expect(debtBalanceOf(cancelled.document, scene.gemachDebtId)).toBe(900_000);
  });

  test('a cleared check cannot be cancelled behind the money', () => {
    const scene = delivered();
    const cleared = run(scene.document, (document, context) =>
      clearCheck(document, { checkId: scene.checkId, clearedOn: '2026-10-13' }, context),
    );

    expect(
      codeOf(() =>
        run(cleared.document, (document, context) =>
          cancelCheck(
            document,
            { checkId: scene.checkId, occurredOn: '2026-10-20', reason: 'טעות' },
            context,
          ),
        ),
      ),
    ).toBe('check_transition_not_allowed');
  });

  test('a replacement links to what it replaced, in both directions', () => {
    const scene = delivered();
    const replaced = run(scene.document, (document, context) =>
      replaceCheck(
        document,
        {
          checkId: scene.checkId,
          reason: 'הצ׳ק הראשון אבד',
          checkNumber: '1099',
          amountMinor: 150_000,
          dueDate: '2026-11-12',
          note: null,
          deliveredOn: '2026-10-20',
        },
        context,
      ),
    );

    const original = replaced.document.checks.find(
      (candidate) => candidate.id === scene.checkId,
    );
    const replacement = replaced.document.checks.find(
      (candidate) => candidate.id === replaced.value,
    );

    expect(original?.status).toBe('replaced');
    expect(original?.replacedByCheckId).toBe(replaced.value);
    expect(replacement?.replacesCheckId).toBe(scene.checkId);
    expect(replacement?.status).toBe('delivered');
  });

  test('a replacement does not double the exposure', () => {
    // Two records, one obligation. Counting both would tell the family they owe
    // twice what they do.
    const scene = delivered();
    const replaced = run(scene.document, (document, context) =>
      replaceCheck(
        document,
        {
          checkId: scene.checkId,
          reason: 'אבד',
          checkNumber: '1099',
          amountMinor: 150_000,
          dueDate: '2026-11-12',
          note: null,
          deliveredOn: '2026-10-20',
        },
        context,
      ),
    );

    const exposure = summariseChecks(
      toEngineInput(replaced.document, { asOf: TEST_NOW }).checks,
      TEST_TODAY,
    );
    expect(exposure.outstandingCount).toBe(1);
    expect(exposure.outstandingTotalMinor).toBe(150_000);
    expect(exposure.replacedCount).toBe(1);
  });

  test('a returned check can be replaced', () => {
    const scene = delivered();
    const returned = run(scene.document, (document, context) =>
      markCheckReturned(
        document,
        { checkId: scene.checkId, occurredOn: '2026-10-14', reason: 'חזר' },
        context,
      ),
    );

    const replaced = run(returned.document, (document, context) =>
      replaceCheck(
        document,
        {
          checkId: scene.checkId,
          reason: 'החלפה אחרי חזרה',
          checkNumber: '1100',
          amountMinor: 150_000,
          dueDate: '2026-11-12',
          note: null,
          deliveredOn: '2026-10-20',
        },
        context,
      ),
    );

    expect(replaced.document.checks).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------

describe('correcting a mistake', () => {
  function clearedByMistake() {
    const scene = gemachScene();
    const added = run(scene.document, (document, context) =>
      addCheck(
        document,
        {
          debtId: scene.gemachDebtId,
          accountId: scene.bankAccountId,
          checkNumber: '1001',
          amountMinor: 150_000,
          dueDate: '2026-10-12',
          payeeName: 'גמ״ח',
          installmentNumber: 1,
          note: null,
          deliveredOn: '2026-09-06',
        },
        context,
      ),
    );
    const cleared = run(added.document, (document, context) =>
      clearCheck(document, { checkId: added.value, clearedOn: '2026-10-13' }, context),
    );
    return { ...scene, document: cleared.document, checkId: added.value, cleared };
  }

  test('undoing a clearing puts the debt back', () => {
    const scene = clearedByMistake();
    expect(debtBalanceOf(scene.document, scene.gemachDebtId, '2026-10-31')).toBe(750_000);

    const reverted = run(scene.document, (document, context) =>
      revertCheckStatus(
        document,
        { checkId: scene.checkId, reason: 'זוהה בטעות בדף החשבון', occurredOn: '2026-10-20' },
        context,
      ),
    );

    expect(debtBalanceOf(reverted.document, scene.gemachDebtId, '2026-10-31')).toBe(900_000);
  });

  test('and puts the money back', () => {
    const scene = clearedByMistake();
    const reverted = run(scene.document, (document, context) =>
      revertCheckStatus(
        document,
        { checkId: scene.checkId, reason: 'טעות', occurredOn: '2026-10-20' },
        context,
      ),
    );

    // The voided transaction stops counting, so the balance returns to where it
    // was before the clearing.
    const voided = reverted.document.transactions.find(
      (transaction) => transaction.id === scene.cleared.value.transactionId,
    );
    expect(voided?.status).toBe('void');
    expect(balanceOf(reverted.document, scene.bankAccountId).computedMinor).toBe(
      balanceOf(scene.document, scene.bankAccountId).computedMinor + 150_000,
    );
  });

  test('and puts the check back where it was', () => {
    const scene = clearedByMistake();
    const reverted = run(scene.document, (document, context) =>
      revertCheckStatus(
        document,
        { checkId: scene.checkId, reason: 'טעות', occurredOn: '2026-10-20' },
        context,
      ),
    );

    const check = reverted.document.checks[0];
    expect(reverted.value).toBe('delivered');
    expect(check?.status).toBe('delivered');
    expect(check?.clearedOn).toBeNull();
    expect(check?.clearedTransactionId).toBeNull();
    expect(check?.debtEventId).toBeNull();
  });

  test('nothing is erased: history says what happened and then says it was wrong', () => {
    const scene = clearedByMistake();
    const eventsBefore = scene.document.debtEvents.length;

    const reverted = run(scene.document, (document, context) =>
      revertCheckStatus(
        document,
        { checkId: scene.checkId, reason: 'טעות', occurredOn: '2026-10-20' },
        context,
      ),
    );

    // The repayment is still there; an opposing event cancels it out.
    expect(reverted.document.debtEvents).toHaveLength(eventsBefore + 1);
    expect(
      reverted.document.debtEvents.some((event) => event.kind === 'principal_payment'),
    ).toBe(true);
    expect(reverted.document.debtEvents.some((event) => event.kind === 'new_principal')).toBe(
      true,
    );
  });

  test('the correction is in the audit trail with its reason', () => {
    const scene = clearedByMistake();
    const reverted = run(scene.document, (document, context) =>
      revertCheckStatus(
        document,
        { checkId: scene.checkId, reason: 'טעות בקריאת הדף', occurredOn: '2026-10-20' },
        context,
      ),
    );

    const entry = reverted.document.audit.findLast(
      (candidate) => candidate.action === 'check.corrected',
    );
    expect(entry).toBeDefined();
    expect(entry?.entityId).toBe(scene.checkId);
  });

  test('a correction needs a reason', () => {
    const scene = clearedByMistake();
    expect(
      codeOf(() =>
        run(scene.document, (document, context) =>
          revertCheckStatus(
            document,
            { checkId: scene.checkId, reason: '', occurredOn: '2026-10-20' },
            context,
          ),
        ),
      ),
    ).toBe('reason_required');
  });

  test('undoing a return puts the check back in play', () => {
    const scene = gemachScene();
    const added = run(scene.document, (document, context) =>
      addCheck(
        document,
        {
          debtId: scene.gemachDebtId,
          accountId: scene.bankAccountId,
          checkNumber: null,
          amountMinor: 150_000,
          dueDate: '2026-10-12',
          payeeName: 'גמ״ח',
          installmentNumber: null,
          note: null,
          deliveredOn: '2026-09-06',
        },
        context,
      ),
    );
    const returned = run(added.document, (document, context) =>
      markCheckReturned(
        document,
        { checkId: added.value, occurredOn: '2026-10-14', reason: 'חזר' },
        context,
      ),
    );
    const reverted = run(returned.document, (document, context) =>
      revertCheckStatus(
        document,
        { checkId: added.value, reason: 'לא באמת חזר', occurredOn: '2026-10-15' },
        context,
      ),
    );

    expect(reverted.document.checks[0]?.status).toBe('delivered');
    expect(reverted.document.checks[0]?.returnedOn).toBeNull();
  });

  test('a replaced check cannot be quietly un-replaced', () => {
    const scene = gemachScene();
    const added = run(scene.document, (document, context) =>
      addCheck(
        document,
        {
          debtId: scene.gemachDebtId,
          accountId: scene.bankAccountId,
          checkNumber: null,
          amountMinor: 150_000,
          dueDate: '2026-10-12',
          payeeName: 'גמ״ח',
          installmentNumber: null,
          note: null,
          deliveredOn: '2026-09-06',
        },
        context,
      ),
    );
    const replaced = run(added.document, (document, context) =>
      replaceCheck(
        document,
        {
          checkId: added.value,
          reason: 'אבד',
          checkNumber: null,
          amountMinor: 150_000,
          dueDate: '2026-11-12',
          note: null,
          deliveredOn: '2026-10-01',
        },
        context,
      ),
    );

    expect(
      codeOf(() =>
        run(replaced.document, (document, context) =>
          revertCheckStatus(
            document,
            { checkId: added.value, reason: 'שיניתי דעתי', occurredOn: '2026-10-20' },
            context,
          ),
        ),
      ),
    ).toBe('check_cannot_be_reverted');
  });
});

describe('the document stays valid throughout', () => {
  test('every state a check can reach parses', () => {
    // The schema carries invariants that pair status with dates and links. If a
    // command could produce a state the schema refuses, the store would fail to
    // save at the worst possible moment.
    const scene = gemachScene();
    let document = run(scene.document, (current, context) =>
      addCheckSeries(
        current,
        {
          debtId: scene.gemachDebtId,
          accountId: scene.bankAccountId,
          payeeName: 'גמ״ח',
          count: 5,
          amountPerCheckMinor: 150_000,
          finalCheckAmountMinor: null,
          firstDueDate: '2026-10-12',
          firstCheckNumber: '2001',
          intendedTotalMinor: 750_000,
          note: null,
          deliveredOn: '2026-09-06',
        },
        context,
      ),
    ).document;

    const ids = document.checks.map((check) => check.id);

    document = run(document, (current, context) =>
      clearCheck(current, { checkId: ids[0]!, clearedOn: '2026-10-13' }, context),
    ).document;
    document = run(document, (current, context) =>
      markCheckDeposited(current, { checkId: ids[1]! }, context),
    ).document;
    document = run(document, (current, context) =>
      markCheckReturned(
        current,
        { checkId: ids[2]!, occurredOn: '2026-12-14', reason: 'חזר' },
        context,
      ),
    ).document;
    document = run(document, (current, context) =>
      cancelCheck(
        current,
        { checkId: ids[3]!, occurredOn: '2026-12-20', reason: 'סוכם אחרת' },
        context,
      ),
    ).document;
    document = run(document, (current, context) =>
      replaceCheck(
        current,
        {
          checkId: ids[4]!,
          reason: 'אבד',
          checkNumber: '2099',
          amountMinor: 150_000,
          dueDate: '2027-03-12',
          note: null,
          deliveredOn: '2027-01-05',
        },
        context,
      ),
    ).document;

    expect(storeDocumentSchema.safeParse(document).success).toBe(true);
    expect(document.checks).toHaveLength(6);
  });
});

describe('showing a check number', () => {
  test('an ordinary report shows only the last four digits', () => {
    expect(maskCheckNumber('001042')).toBe('••1042');
  });

  test('a short number is left alone rather than made meaningless', () => {
    expect(maskCheckNumber('42')).toBe('42');
  });

  test('no number stays no number', () => {
    expect(maskCheckNumber(null)).toBeNull();
  });
});
