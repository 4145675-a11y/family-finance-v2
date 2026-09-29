import { describe, expect, test } from 'vitest';

import {
  CommandError,
  addDebt,
  recordDebtEvent,
  recordRepaymentDemand,
  setRepaymentExpectation,
} from './commands';
import { parseStoreDocument } from './document';
import { apply, contextFor, seededHousehold, TEST_NOW, TEST_TODAY } from './fixtures/household';
import { replayDebtLedger, finalBalanceOf } from '@family-finance/finance-engine';

/**
 * When a loan is expected to be repaid, and every time the lender asked.
 *
 * Two facts with almost opposite rules, which is why they are tested together:
 * the expectation is part of the loan's terms and stops mattering once the loan
 * is closed, while a demand has to keep working *after* the loan is closed and
 * must leave the loan completely untouched. Most of what follows is about that
 * second half, because "recording this changed nothing" is a claim that can only
 * be believed if something checks every part of it.
 */

/** The seeded private loan, and a closed copy of it, for the tests below. */
function household() {
  const seeded = seededHousehold();
  return { ...seeded, context: contextFor(seeded.document) };
}

/** Marks a debt repaid the way the product does: an event, then the status. */
function closed(document: ReturnType<typeof household>['document'], debtId: string) {
  const repaid = recordDebtEvent(
    document,
    {
      debtId,
      kind: 'principal_payment',
      amountMinor: 500_000,
      occurredOn: '2026-08-01',
      correctionEffect: null,
      note: null,
    },
    contextFor(document),
  ).document;

  return {
    ...repaid,
    debts: repaid.debts.map((debt) =>
      debt.id === debtId
        ? { ...debt, status: 'settled' as const, closedAt: '2026-08-01T09:00:00.000Z' }
        : debt,
    ),
  };
}

describe('what is expected about repayment has three states, not two', () => {
  test('a loan can be recorded with an expected repayment date', () => {
    const { document, context } = household();
    const added = addDebt(
      document,
      {
        creditorName: 'דוד',
        kind: 'private_person',
        openingBalanceMinor: 100_000,
        openedOn: '2026-09-01',
        effectiveAnnualRateBp: null,
        minimumPaymentMinor: null,
        paymentDueDay: null,
        urgency: 'none',
        promiseSummary: null,
        relationshipSensitivity: 'low',
        partialPaymentAllowed: true,
        expectedCallDate: null,
        repaymentExpectation: { kind: 'dated', on: '2027-03-01' },
        notes: null,
      },
      context,
    );

    const debt = added.document.debts.find((candidate) => candidate.id === added.value);
    expect(debt?.repaymentExpectation).toEqual({ kind: 'dated', on: '2027-03-01' });
  });

  test('a loan can be recorded as agreed with no repayment date at all', () => {
    /*
     * The state this whole design exists for. A loan from a relative on no
     * terms is an ordinary loan, and the record has to be able to say so.
     */
    const { document, context } = household();
    const added = addDebt(
      document,
      {
        creditorName: 'חמי',
        kind: 'private_person',
        openingBalanceMinor: 100_000,
        openedOn: '2026-09-01',
        effectiveAnnualRateBp: null,
        minimumPaymentMinor: null,
        paymentDueDay: null,
        urgency: 'none',
        promiseSummary: null,
        relationshipSensitivity: 'low',
        partialPaymentAllowed: true,
        expectedCallDate: null,
        repaymentExpectation: { kind: 'none' },
        notes: null,
      },
      context,
    );

    const debt = added.document.debts.find((candidate) => candidate.id === added.value);
    expect(debt?.repaymentExpectation).toEqual({ kind: 'none' });
  });

  test('and "no date was agreed" is not the same record as "nobody has said"', () => {
    const { document, context } = household();
    const seededLoan = document.debts.find((debt) => debt.id === document.debts[0]?.id);

    // Every loan that predates the field is in the third state, and that is
    // correct rather than incomplete.
    expect(seededLoan?.repaymentExpectation).toBeUndefined();

    const withNone = setRepaymentExpectation(
      document,
      { debtId: seededLoan?.id ?? '', expectation: { kind: 'none' } },
      context,
    );
    const after = withNone.document.debts.find((debt) => debt.id === seededLoan?.id);

    expect(after?.repaymentExpectation).toEqual({ kind: 'none' });
    expect(after?.repaymentExpectation).not.toBeUndefined();
  });

  test('the document a loan with an expectation produces is still a valid document', () => {
    const { document, context } = household();
    const changed = setRepaymentExpectation(
      document,
      { debtId: document.debts[0]?.id ?? '', expectation: { kind: 'dated', on: '2027-01-01' } },
      context,
    );
    expect(() => parseStoreDocument(changed.document)).not.toThrow();
  });
});

describe('the expectation can be changed later, and withdrawn', () => {
  test('a date can be set, then moved', () => {
    const { document, privateDebtId, context } = household();
    const first = setRepaymentExpectation(
      document,
      { debtId: privateDebtId, expectation: { kind: 'dated', on: '2027-01-01' } },
      context,
    ).document;
    const moved = setRepaymentExpectation(
      first,
      { debtId: privateDebtId, expectation: { kind: 'dated', on: '2027-06-30' } },
      contextFor(first),
    ).document;

    expect(moved.debts.find((debt) => debt.id === privateDebtId)?.repaymentExpectation).toEqual(
      {
        kind: 'dated',
        on: '2027-06-30',
      },
    );
  });

  test('a date can be replaced by "no date was agreed"', () => {
    const { document, privateDebtId, context } = household();
    const dated = setRepaymentExpectation(
      document,
      { debtId: privateDebtId, expectation: { kind: 'dated', on: '2027-01-01' } },
      context,
    ).document;
    const none = setRepaymentExpectation(
      dated,
      { debtId: privateDebtId, expectation: { kind: 'none' } },
      contextFor(dated),
    ).document;

    expect(none.debts.find((debt) => debt.id === privateDebtId)?.repaymentExpectation).toEqual({
      kind: 'none',
    });
  });

  test('and withdrawn entirely, back to nothing recorded', () => {
    /*
     * A person who typed a date they were not sure of has to be able to take it
     * back. The alternative is a guess left on the record because the form
     * cannot express its absence.
     */
    const { document, privateDebtId, context } = household();
    const dated = setRepaymentExpectation(
      document,
      { debtId: privateDebtId, expectation: { kind: 'dated', on: '2027-01-01' } },
      context,
    ).document;
    const cleared = setRepaymentExpectation(
      dated,
      { debtId: privateDebtId },
      contextFor(dated),
    ).document;

    const debt = cleared.debts.find((candidate) => candidate.id === privateDebtId);
    expect(debt?.repaymentExpectation).toBeUndefined();
    expect('repaymentExpectation' in (debt ?? {})).toBe(false);
  });

  test('setting what is already set writes nothing and says so', () => {
    const { document, privateDebtId, context } = household();
    const dated = setRepaymentExpectation(
      document,
      { debtId: privateDebtId, expectation: { kind: 'dated', on: '2027-01-01' } },
      context,
    ).document;
    const again = setRepaymentExpectation(
      dated,
      { debtId: privateDebtId, expectation: { kind: 'dated', on: '2027-01-01' } },
      contextFor(dated),
    );

    expect(again.alreadyRecorded).toBe(true);
    expect(again.document).toBe(dated);
  });

  test('changing it records who changed it and when', () => {
    const { document, privateDebtId, context } = household();
    const changed = setRepaymentExpectation(
      document,
      { debtId: privateDebtId, expectation: { kind: 'dated', on: '2027-01-01' } },
      context,
    ).document;

    const entry = changed.audit.at(-1);
    expect(entry?.action).toBe('debt.repayment_expectation_set');
    expect(entry?.entityId).toBe(privateDebtId);
  });

  test('a closed loan has no repayment still expected, and the refusal says what is possible', () => {
    const base = household();
    const settled = closed(base.document, base.privateDebtId);

    try {
      setRepaymentExpectation(
        settled,
        { debtId: base.privateDebtId, expectation: { kind: 'dated', on: '2027-01-01' } },
        contextFor(settled),
      );
      throw new Error('expected a refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(CommandError);
      expect((error as CommandError).code).toBe('debt_is_closed');
      expect((error as CommandError).message).toContain('demand');
    }
  });

  test('an unknown loan is refused rather than invented', () => {
    const { document, context } = household();
    expect(() =>
      setRepaymentExpectation(
        document,
        { debtId: '00000000-0000-4000-8000-000000000000', expectation: { kind: 'none' } },
        context,
      ),
    ).toThrow(CommandError);
  });
});

describe('a demand is written down and changes nothing', () => {
  test('it is kept, with its date, deadline, amount and note', () => {
    const { document, privateDebtId, context } = household();
    const after = recordRepaymentDemand(
      document,
      {
        debtId: privateDebtId,
        demandedOn: '2026-09-06',
        requestedDeadline: '2026-10-01',
        amountMinor: 250_000,
        note: 'ביקש בטלפון',
      },
      context,
    ).document;

    expect(after.repaymentDemands).toHaveLength(1);
    expect(after.repaymentDemands[0]).toMatchObject({
      debtId: privateDebtId,
      demandedOn: '2026-09-06',
      requestedDeadline: '2026-10-01',
      amountMinor: 250_000,
      note: 'ביקש בטלפון',
    });
  });

  test('a demand with no figure and no deadline is still a demand', () => {
    /*
     * A lender who said "I need it back" named neither. Recording 0 ₪ or
     * today's date would put words in their mouth that a family would later
     * read as facts.
     */
    const { document, privateDebtId, context } = household();
    const after = recordRepaymentDemand(
      document,
      {
        debtId: privateDebtId,
        demandedOn: '2026-09-06',
        requestedDeadline: null,
        amountMinor: null,
        note: null,
      },
      context,
    ).document;

    expect(after.repaymentDemands[0]?.amountMinor).toBeNull();
    expect(after.repaymentDemands[0]?.requestedDeadline).toBeNull();
  });

  test('the balance, the events and the loan itself are untouched', () => {
    const { document, privateDebtId, context } = household();
    const before = document.debts.find((debt) => debt.id === privateDebtId);
    const balanceBefore = finalBalanceOf(
      replayDebtLedger(document.debtEvents, privateDebtId, TEST_TODAY),
    );

    const after = recordRepaymentDemand(
      document,
      {
        debtId: privateDebtId,
        demandedOn: '2026-09-06',
        requestedDeadline: null,
        amountMinor: 500_000,
        note: null,
      },
      context,
    ).document;

    // Not one field of the debt row, including the version and the timestamp.
    expect(after.debts.find((debt) => debt.id === privateDebtId)).toEqual(before);
    // No event, so no arithmetic can have moved.
    expect(after.debtEvents).toEqual(document.debtEvents);
    expect(finalBalanceOf(replayDebtLedger(after.debtEvents, privateDebtId, TEST_TODAY))).toBe(
      balanceBefore,
    );
    // And no cash movement was invented to go with it.
    expect(after.transactions).toEqual(document.transactions);
  });

  test('`lastDemandAt` on the loan is deliberately not written', () => {
    /*
     * It would modify the loan's own row to store something the collection
     * already says, and the two could then disagree — on a closed loan it would
     * also be a change to a finished record.
     */
    const { document, privateDebtId, context } = household();
    const after = recordRepaymentDemand(
      document,
      {
        debtId: privateDebtId,
        demandedOn: '2026-09-06',
        requestedDeadline: null,
        amountMinor: null,
        note: null,
      },
      context,
    ).document;

    expect(after.debts.find((debt) => debt.id === privateDebtId)?.lastDemandAt).toBeNull();
  });

  test('every demand is kept, and none overwrites another', () => {
    const { document, privateDebtId } = household();
    const after = apply(document, [
      (documentIn, contextIn) =>
        recordRepaymentDemand(
          documentIn,
          {
            debtId: privateDebtId,
            demandedOn: '2026-07-01',
            requestedDeadline: null,
            amountMinor: null,
            note: 'פעם ראשונה',
          },
          contextIn,
        ),
      (documentIn, contextIn) =>
        recordRepaymentDemand(
          documentIn,
          {
            debtId: privateDebtId,
            demandedOn: '2026-08-01',
            requestedDeadline: '2026-08-15',
            amountMinor: 100_000,
            note: 'פעם שנייה',
          },
          contextIn,
        ),
      (documentIn, contextIn) =>
        recordRepaymentDemand(
          documentIn,
          {
            debtId: privateDebtId,
            demandedOn: '2026-09-01',
            requestedDeadline: '2026-09-10',
            amountMinor: 500_000,
            note: 'פעם שלישית',
          },
          contextIn,
        ),
    ]);

    expect(after.repaymentDemands).toHaveLength(3);
    expect(after.repaymentDemands.map((demand) => demand.note)).toEqual([
      'פעם ראשונה',
      'פעם שנייה',
      'פעם שלישית',
    ]);
  });

  test('the same submission twice records one demand', () => {
    const { document, privateDebtId, context } = household();
    const input = {
      debtId: privateDebtId,
      demandedOn: '2026-09-06',
      requestedDeadline: null,
      amountMinor: null,
      note: null,
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
    };
    const first = recordRepaymentDemand(document, input, context);
    const second = recordRepaymentDemand(first.document, input, contextFor(first.document));

    expect(second.alreadyRecorded).toBe(true);
    expect(second.document.repaymentDemands).toHaveLength(1);
  });

  test('a deadline before the day it was asked for is refused', () => {
    const { document, privateDebtId, context } = household();
    try {
      recordRepaymentDemand(
        document,
        {
          debtId: privateDebtId,
          demandedOn: '2026-09-06',
          requestedDeadline: '2026-09-01',
          amountMinor: null,
          note: null,
        },
        context,
      );
      throw new Error('expected a refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(CommandError);
      expect((error as CommandError).code).toBe('deadline_before_demand');
    }
  });

  test('a demand against a loan that does not exist is refused', () => {
    const { document, context } = household();
    expect(() =>
      recordRepaymentDemand(
        document,
        {
          debtId: '00000000-0000-4000-8000-000000000000',
          demandedOn: '2026-09-06',
          requestedDeadline: null,
          amountMinor: null,
          note: null,
        },
        context,
      ),
    ).toThrow(CommandError);
  });

  test('it is recorded in the audit trail under its own action', () => {
    const { document, privateDebtId, context } = household();
    const after = recordRepaymentDemand(
      document,
      {
        debtId: privateDebtId,
        demandedOn: '2026-09-06',
        requestedDeadline: null,
        amountMinor: null,
        note: null,
      },
      context,
    ).document;

    expect(after.audit.at(-1)?.action).toBe('debt.repayment_demanded');
  });
});

describe('a demand on a loan that has already been repaid', () => {
  test('is allowed, which is the whole point', () => {
    const base = household();
    const settled = closed(base.document, base.privateDebtId);

    const after = recordRepaymentDemand(
      settled,
      {
        debtId: base.privateDebtId,
        demandedOn: '2026-09-06',
        requestedDeadline: '2026-09-20',
        amountMinor: 50_000,
        note: 'טוען שנשאר חוב',
      },
      contextFor(settled),
    ).document;

    expect(after.repaymentDemands).toHaveLength(1);
  });

  test('and leaves it closed, with its terms, balance and history as they were', () => {
    const base = household();
    const settled = closed(base.document, base.privateDebtId);
    const before = settled.debts.find((debt) => debt.id === base.privateDebtId);
    const balanceBefore = finalBalanceOf(
      replayDebtLedger(settled.debtEvents, base.privateDebtId, TEST_TODAY),
    );

    const after = recordRepaymentDemand(
      settled,
      {
        debtId: base.privateDebtId,
        demandedOn: '2026-09-06',
        requestedDeadline: null,
        amountMinor: 50_000,
        note: null,
      },
      contextFor(settled),
    ).document;

    const debt = after.debts.find((candidate) => candidate.id === base.privateDebtId);
    expect(debt?.status).toBe('settled');
    expect(debt?.closedAt).toBe('2026-08-01T09:00:00.000Z');
    // Byte for byte: no version bump, no touched timestamp, no changed term.
    expect(debt).toEqual(before);
    expect(after.debtEvents).toEqual(settled.debtEvents);
    expect(
      finalBalanceOf(replayDebtLedger(after.debtEvents, base.privateDebtId, TEST_TODAY)),
    ).toBe(balanceBefore);
    expect(after.transactions).toEqual(settled.transactions);
  });

  test('and does not reopen it by reviving an expectation', () => {
    const base = household();
    const settled = closed(base.document, base.privateDebtId);
    const after = recordRepaymentDemand(
      settled,
      {
        debtId: base.privateDebtId,
        demandedOn: '2026-09-06',
        requestedDeadline: null,
        amountMinor: null,
        note: null,
      },
      contextFor(settled),
    ).document;

    expect(
      after.debts.find((debt) => debt.id === base.privateDebtId)?.repaymentExpectation,
    ).toBeUndefined();
  });

  test('the resulting document is still valid, demands and all', () => {
    const base = household();
    const settled = closed(base.document, base.privateDebtId);
    const after = recordRepaymentDemand(
      settled,
      {
        debtId: base.privateDebtId,
        demandedOn: TEST_TODAY,
        requestedDeadline: null,
        amountMinor: null,
        note: null,
      },
      contextFor(settled, TEST_NOW),
    ).document;

    expect(() => parseStoreDocument(after)).not.toThrow();
  });
});
