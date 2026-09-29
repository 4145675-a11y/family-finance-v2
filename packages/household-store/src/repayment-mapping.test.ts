import {
  addDebt,
  emptyDocument,
  recordRepaymentDemand,
  setRepaymentExpectation,
  type StoreDocument,
} from '@family-finance/local-store';
import { describe, expect, test } from 'vitest';

import { changesBetween, documentFromLoaded, type LoadedHousehold } from './document-mapping';
import { PersistenceError } from './port';
import { rowToSnake } from './rows';

/**
 * Between the two new facts and the columns that hold them.
 *
 * This file exists because of a specific failure, twice over. Ten `due_date`
 * columns were added to `debts` and the function that writes a debt lists its
 * columns by hand, so a date the family typed reached the database and was
 * dropped on the way in — no error, and the screen said it was saved. The fix
 * then had to be written again when a restated loader emptied a key.
 *
 * So: every direction is checked here. A row coming back becomes the right one
 * of three states; a change going out carries the columns and carries them only
 * for the debts that changed; and a database that has neither column yet reads
 * as "nothing recorded" rather than as an error.
 */

const NOW = '2026-09-29T10:00:00.000Z';
const ALICE = '11111111-1111-4111-8111-111111111111';
const HOUSEHOLD = '22222222-2222-4222-8222-222222222222';

function seed(): StoreDocument {
  return emptyDocument({
    householdId: HOUSEHOLD,
    householdName: 'הבית',
    profileId: ALICE,
    profileName: 'אליס',
    now: NOW,
    currency: 'ILS',
    timeZone: 'Asia/Jerusalem',
  });
}

function withDebt(document: StoreDocument = seed()) {
  const added = addDebt(
    document,
    {
      creditorName: 'משה',
      kind: 'private_person',
      openingBalanceMinor: 500_000,
      openedOn: '2026-05-01',
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
    { actorProfileId: ALICE, now: NOW },
  );
  return { document: added.document, debtId: added.value };
}

/**
 * The document as the loader returns it, with the debt columns spelled out.
 *
 * `rowToSnake` alone would turn the expectation into a single JSON column, which
 * is not what the table holds — so the fixture writes the two real columns and
 * the test is therefore about the real shape.
 */
function loadedWith(
  debtColumns: Record<string, unknown>,
  demands: Record<string, unknown>[] | undefined,
): LoadedHousehold {
  const document = seed();
  const { notifications, ...settings } = document.settings;
  return {
    household: rowToSnake({ ...document.household }),
    settings: rowToSnake({
      household_id: HOUSEHOLD,
      ...settings,
      ...notifications,
    }),
    setup: rowToSnake({ household_id: HOUSEHOLD, ...document.setup }),
    members: document.members.map((m) => rowToSnake({ ...m })),
    profiles: document.profiles.map((p) => rowToSnake({ ...p })),
    invitations: [],
    businesses: [],
    accounts: [],
    categories: document.categories.map((c) => rowToSnake({ ...c })),
    balanceSnapshots: [],
    transactions: [],
    cashflowItems: [],
    debts: [
      {
        ...rowToSnake({
          id: '33333333-3333-4333-8333-333333333333',
          householdId: HOUSEHOLD,
          kind: 'private_person',
          creditorName: 'משה',
          currency: 'ILS',
          status: 'active',
          effectiveAnnualRateBp: null,
          minimumPaymentMinor: null,
          paymentDueDay: null,
          urgency: 'none',
          promiseSummary: null,
          relationshipSensitivity: 'low',
          partialPaymentAllowed: true,
          lastDemandAt: null,
          lastConversationAt: null,
          expectedCallDate: null,
          notes: null,
          openedOn: '2026-05-01',
          closedAt: null,
          createdBy: ALICE,
          createdAt: NOW,
          updatedAt: NOW,
          version: 1,
        }),
        ...debtColumns,
      },
    ],
    debtEvents: [],
    rollovers: [],
    ...(demands === undefined ? {} : { repaymentDemands: demands }),
    checks: [],
    repaymentPlans: [],
    budgets: [],
    budgetLines: [],
    tasks: [],
    importSourceFiles: [],
    importBatches: [],
    importProposals: [],
    learnedRules: [],
    audit: [],
  };
}

describe('reading what the columns say', () => {
  test('a dated expectation comes back as a date', () => {
    const document = documentFromLoaded(
      loadedWith({ repayment_expectation: 'dated', expected_repayment_on: '2027-03-01' }, []),
    );
    expect(document.debts[0]?.repaymentExpectation).toEqual({
      kind: 'dated',
      on: '2027-03-01',
    });
  });

  test('a date carrying a timestamp is read as the day it names', () => {
    const document = documentFromLoaded(
      loadedWith(
        { repayment_expectation: 'dated', expected_repayment_on: '2027-03-01T00:00:00.000Z' },
        [],
      ),
    );
    expect(document.debts[0]?.repaymentExpectation).toEqual({
      kind: 'dated',
      on: '2027-03-01',
    });
  });

  test('an agreed absence of a date comes back as exactly that', () => {
    const document = documentFromLoaded(
      loadedWith({ repayment_expectation: 'none', expected_repayment_on: null }, []),
    );
    expect(document.debts[0]?.repaymentExpectation).toEqual({ kind: 'none' });
  });

  test('two empty columns mean nothing was recorded, and the key is absent', () => {
    const document = documentFromLoaded(
      loadedWith({ repayment_expectation: null, expected_repayment_on: null }, []),
    );
    expect(document.debts[0]?.repaymentExpectation).toBeUndefined();
    expect('repaymentExpectation' in (document.debts[0] ?? {})).toBe(false);
  });

  test('a database without the columns at all reads the same way', () => {
    /*
     * The window between a deployment and its migration. Reading has to work,
     * and "nothing recorded" is the truthful answer there — writing is what
     * gets refused out loud.
     */
    const document = documentFromLoaded(loadedWith({}, undefined));
    expect(document.debts[0]?.repaymentExpectation).toBeUndefined();
  });

  test('and its missing demands read as none rather than as a failure', () => {
    const document = documentFromLoaded(loadedWith({}, undefined));
    expect(document.repaymentDemands).toEqual([]);
  });

  test('a stray column is not smuggled onto the debt as a field', () => {
    const document = documentFromLoaded(
      loadedWith({ repayment_expectation: 'none', expected_repayment_on: null }, []),
    );
    const debt = document.debts[0] as Record<string, unknown>;
    expect(debt['expectedRepaymentOn']).toBeUndefined();
  });

  test('demands come back as records of the right shape', () => {
    const document = documentFromLoaded(
      loadedWith({ repayment_expectation: null, expected_repayment_on: null }, [
        rowToSnake({
          id: '44444444-4444-4444-8444-444444444444',
          householdId: HOUSEHOLD,
          debtId: '33333333-3333-4333-8333-333333333333',
          demandedOn: '2026-09-01',
          requestedDeadline: '2026-09-30',
          amountMinor: 250_000,
          note: 'ביקש בטלפון',
          createdBy: ALICE,
          createdAt: NOW,
        }),
      ]),
    );

    expect(document.repaymentDemands).toHaveLength(1);
    expect(document.repaymentDemands[0]).toMatchObject({
      demandedOn: '2026-09-01',
      requestedDeadline: '2026-09-30',
      amountMinor: 250_000,
      note: 'ביקש בטלפון',
    });
  });
});

describe('writing what changed', () => {
  test('an expectation travels as its own key, not on the debt row', () => {
    /*
     * The debt upsert in `apply_household_changes` names its columns by hand.
     * Widening the row it receives would be ignored in silence — which is the
     * failure this whole arrangement is built to avoid.
     */
    const { document, debtId } = withDebt();
    const after = setRepaymentExpectation(
      document,
      { debtId, expectation: { kind: 'dated', on: '2027-03-01' } },
      { actorProfileId: ALICE, now: NOW },
    ).document;

    const changes = changesBetween(document, after, ALICE);
    const expectations = changes['debtRepaymentExpectations'] as {
      upsert: Record<string, unknown>[];
    };

    expect(expectations.upsert).toEqual([
      {
        id: debtId,
        repayment_expectation: 'dated',
        expected_repayment_on: '2027-03-01',
      },
    ]);

    const debts = changes['debts'] as { upsert: Record<string, unknown>[] } | undefined;
    for (const row of debts?.upsert ?? []) {
      expect(row['repayment_expectation']).toBeUndefined();
      expect(row['expected_repayment_on']).toBeUndefined();
      expect(row['repaymentExpectation']).toBeUndefined();
    }
  });

  test('an agreed absence of a date is sent, not omitted as an empty value', () => {
    const { document, debtId } = withDebt();
    const after = setRepaymentExpectation(
      document,
      { debtId, expectation: { kind: 'none' } },
      { actorProfileId: ALICE, now: NOW },
    ).document;

    const expectations = changesBetween(document, after, ALICE)[
      'debtRepaymentExpectations'
    ] as { upsert: Record<string, unknown>[] };

    expect(expectations.upsert[0]).toEqual({
      id: debtId,
      repayment_expectation: 'none',
      expected_repayment_on: null,
    });
  });

  test('a withdrawn expectation is sent as two nulls, so the old date is cleared', () => {
    const { document, debtId } = withDebt();
    const dated = setRepaymentExpectation(
      document,
      { debtId, expectation: { kind: 'dated', on: '2027-03-01' } },
      { actorProfileId: ALICE, now: NOW },
    ).document;
    const cleared = setRepaymentExpectation(
      dated,
      { debtId },
      { actorProfileId: ALICE, now: NOW },
    ).document;

    const expectations = changesBetween(dated, cleared, ALICE)['debtRepaymentExpectations'] as {
      upsert: Record<string, unknown>[];
    };

    expect(expectations.upsert[0]).toEqual({
      id: debtId,
      repayment_expectation: null,
      expected_repayment_on: null,
    });
  });

  test('a loan recorded with an expectation in one breath carries it', () => {
    /*
     * A new debt is not in the "before" document, so a rule that only looked
     * for a changed value would send nothing and the date typed on the creation
     * form would be dropped.
     */
    const before = seed();
    const added = addDebt(
      before,
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
        repaymentExpectation: { kind: 'dated', on: '2027-05-01' },
        notes: null,
      },
      { actorProfileId: ALICE, now: NOW },
    );

    const expectations = changesBetween(before, added.document, ALICE)[
      'debtRepaymentExpectations'
    ] as { upsert: Record<string, unknown>[] };

    expect(expectations.upsert).toEqual([
      {
        id: added.value,
        repayment_expectation: 'dated',
        expected_repayment_on: '2027-05-01',
      },
    ]);
  });

  test('a loan recorded without one sends no expectation key at all', () => {
    const before = seed();
    const { document } = withDebt(before);
    expect(
      changesBetween(before, document, ALICE)['debtRepaymentExpectations'],
    ).toBeUndefined();
  });

  test('a save that touched a debt for another reason does not rewrite its date', () => {
    const { document, debtId } = withDebt();
    const dated = setRepaymentExpectation(
      document,
      { debtId, expectation: { kind: 'dated', on: '2027-03-01' } },
      { actorProfileId: ALICE, now: NOW },
    ).document;

    // The debt row changes, the expectation does not.
    const renamed: StoreDocument = {
      ...dated,
      debts: dated.debts.map((debt) =>
        debt.id === debtId ? { ...debt, notes: 'הערה חדשה', version: debt.version + 1 } : debt,
      ),
    };

    const changes = changesBetween(dated, renamed, ALICE);
    expect(changes['debts']).toBeDefined();
    expect(changes['debtRepaymentExpectations']).toBeUndefined();
  });

  test('a demand travels as a row of its own collection', () => {
    const { document, debtId } = withDebt();
    const after = recordRepaymentDemand(
      document,
      {
        debtId,
        demandedOn: '2026-09-29',
        requestedDeadline: '2026-10-15',
        amountMinor: 120_000,
        note: 'ביקש',
      },
      { actorProfileId: ALICE, now: NOW },
    ).document;

    const demands = changesBetween(document, after, ALICE)['repaymentDemands'] as {
      upsert: Record<string, unknown>[];
    };

    expect(demands.upsert).toHaveLength(1);
    expect(demands.upsert[0]).toMatchObject({
      debt_id: debtId,
      demanded_on: '2026-09-29',
      requested_deadline: '2026-10-15',
      amount_minor: 120_000,
      note: 'ביקש',
      created_by: ALICE,
    });
  });

  test('recording a demand sends no change to the debt itself', () => {
    const { document, debtId } = withDebt();
    const after = recordRepaymentDemand(
      document,
      {
        debtId,
        demandedOn: '2026-09-29',
        requestedDeadline: null,
        amountMinor: null,
        note: null,
      },
      { actorProfileId: ALICE, now: NOW },
    ).document;

    const changes = changesBetween(document, after, ALICE);
    expect(changes['debts']).toBeUndefined();
    expect(changes['debtEvents']).toBeUndefined();
    expect(changes['transactions']).toBeUndefined();
    expect(changes['debtRepaymentExpectations']).toBeUndefined();
  });

  test('a demand that disappeared is refused rather than deleted', () => {
    /*
     * Nothing in this collection is ever removed (ADR-0032). A command that
     * dropped one would be asking for a deletion the database will not do, and
     * the mismatch has to surface here rather than as a silent no-op.
     */
    const { document, debtId } = withDebt();
    const after = recordRepaymentDemand(
      document,
      {
        debtId,
        demandedOn: '2026-09-29',
        requestedDeadline: null,
        amountMinor: null,
        note: null,
      },
      { actorProfileId: ALICE, now: NOW },
    ).document;

    expect(() => changesBetween(after, document, ALICE)).toThrow(PersistenceError);
  });
});
