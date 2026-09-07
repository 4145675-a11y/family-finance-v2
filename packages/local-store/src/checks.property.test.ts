import { summariseChecks } from '@family-finance/finance-engine';
import fc from 'fast-check';
import { describe, expect, test } from 'vitest';

import {
  addCheckSeries,
  cancelCheck,
  clearCheck,
  deliverChecks,
  markCheckDeposited,
  markCheckReturned,
  revertCheckStatus,
} from './checks';
import { addDebt, CommandError } from './commands';
import { storeDocumentSchema, type StoreDocument } from './document';
import { balanceOf, toEngineInput } from './projection';
import { contextFor, seededHousehold, TEST_NOW, TEST_TODAY } from './fixtures/household';

/**
 * The check invariants, under arbitrary sequences of operations.
 *
 * The example tests prove each operation does the right thing in the situation it
 * was written for. These prove the properties survive orderings nobody thought
 * about — a check deposited, returned, corrected and cleared, in whatever order a
 * confused Tuesday produces.
 *
 * Three properties, and each is a way a family loses money or trust:
 *
 *   1. Only a clearing moves cash. If any other operation could, a household
 *      would find their balance changing when they wrote something down.
 *   2. Cash and debt move together, by the same amount. If they could diverge,
 *      the ledger would stop matching the bank.
 *   3. Every reachable state is a valid document. If it were not, the store would
 *      refuse to save at the moment a person pressed a button.
 */

type Operation =
  | { kind: 'deliver'; index: number }
  | { kind: 'deposit'; index: number }
  | { kind: 'clear'; index: number }
  | { kind: 'return'; index: number }
  | { kind: 'cancel'; index: number }
  | { kind: 'revert'; index: number };

const CHECK_COUNT = 4;
const CHECK_AMOUNT_MINOR = 150_000;

const operationArbitrary = fc.oneof(
  fc.record({
    kind: fc.constant('deliver' as const),
    index: fc.integer({ min: 0, max: CHECK_COUNT - 1 }),
  }),
  fc.record({
    kind: fc.constant('deposit' as const),
    index: fc.integer({ min: 0, max: CHECK_COUNT - 1 }),
  }),
  fc.record({
    kind: fc.constant('clear' as const),
    index: fc.integer({ min: 0, max: CHECK_COUNT - 1 }),
  }),
  fc.record({
    kind: fc.constant('return' as const),
    index: fc.integer({ min: 0, max: CHECK_COUNT - 1 }),
  }),
  fc.record({
    kind: fc.constant('cancel' as const),
    index: fc.integer({ min: 0, max: CHECK_COUNT - 1 }),
  }),
  fc.record({
    kind: fc.constant('revert' as const),
    index: fc.integer({ min: 0, max: CHECK_COUNT - 1 }),
  }),
);

interface World {
  readonly document: StoreDocument;
  readonly bankAccountId: string;
  readonly debtId: string;
  readonly checkIds: readonly string[];
}

function startingWorld(): World {
  const seeded = seededHousehold();
  const debt = addDebt(
    seeded.document,
    {
      creditorName: 'גמ״ח',
      kind: 'gemach',
      openingBalanceMinor: CHECK_COUNT * CHECK_AMOUNT_MINOR,
      openedOn: '2026-08-01',
      effectiveAnnualRateBp: 0,
      minimumPaymentMinor: CHECK_AMOUNT_MINOR,
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

  const series = addCheckSeries(
    debt.document,
    {
      debtId: debt.value,
      accountId: seeded.bankAccountId,
      payeeName: 'גמ״ח',
      count: CHECK_COUNT,
      amountPerCheckMinor: CHECK_AMOUNT_MINOR,
      finalCheckAmountMinor: null,
      firstDueDate: '2026-09-12',
      firstCheckNumber: '3001',
      intendedTotalMinor: CHECK_COUNT * CHECK_AMOUNT_MINOR,
      note: null,
      deliveredOn: null,
    },
    contextFor(debt.document),
  );

  return {
    document: series.document,
    bankAccountId: seeded.bankAccountId,
    debtId: debt.value,
    checkIds: series.value,
  };
}

/**
 * Applies one operation, ignoring the ones the model refuses.
 *
 * A refused transition is the model working, not the test failing — the point is
 * what the *accepted* sequences produce.
 */
function step(
  document: StoreDocument,
  checkIds: readonly string[],
  operation: Operation,
): StoreDocument {
  const checkId = checkIds[operation.index];
  if (checkId === undefined) return document;

  const context = contextFor(document);

  try {
    switch (operation.kind) {
      case 'deliver':
        return deliverChecks(
          document,
          { checkIds: [checkId], deliveredOn: '2026-09-06' },
          context,
        ).document;
      case 'deposit':
        return markCheckDeposited(document, { checkId }, context).document;
      case 'clear':
        return clearCheck(document, { checkId, clearedOn: '2026-09-13' }, context).document;
      case 'return':
        return markCheckReturned(
          document,
          { checkId, occurredOn: '2026-09-14', reason: 'חזר' },
          context,
        ).document;
      case 'cancel':
        return cancelCheck(
          document,
          { checkId, occurredOn: '2026-09-15', reason: 'בוטל בהסכמה' },
          context,
        ).document;
      case 'revert':
        return revertCheckStatus(
          document,
          { checkId, reason: 'תיקון', occurredOn: '2026-09-16' },
          context,
        ).document;
    }
  } catch (error) {
    // Only a refusal by the model is acceptable here. Anything else is a defect
    // and must not be swallowed by a permissive catch.
    if (error instanceof CommandError) return document;
    throw error;
  }
}

function debtBalance(document: StoreDocument, debtId: string): number {
  return document.debtEvents
    .filter((event) => event.debtId === debtId)
    .reduce((total, event) => {
      if (event.kind === 'opening_balance' || event.kind === 'new_principal') {
        return total + event.amountMinor;
      }
      if (event.kind === 'principal_payment' || event.kind === 'write_off') {
        return total - event.amountMinor;
      }
      return total;
    }, 0);
}

describe('whatever happens to the checks', () => {
  test('cash only ever moves by whole checks', () => {
    fc.assert(
      fc.property(fc.array(operationArbitrary, { maxLength: 24 }), (operations) => {
        const world = startingWorld();
        const openingCash = balanceOf(world.document, world.bankAccountId).computedMinor;

        let document = world.document;
        for (const operation of operations) {
          document = step(document, world.checkIds, operation);
        }

        const movement = openingCash - balanceOf(document, world.bankAccountId).computedMinor;
        expect(movement % CHECK_AMOUNT_MINOR).toBe(0);
        expect(movement).toBeGreaterThanOrEqual(0);
        expect(movement).toBeLessThanOrEqual(CHECK_COUNT * CHECK_AMOUNT_MINOR);
      }),
      { numRuns: 200 },
    );
  });

  test('the cash that left and the debt that fell are the same amount', () => {
    // The property that keeps the ledger matching the bank. A clearing that
    // wrote one half and not the other would break this on the first run.
    fc.assert(
      fc.property(fc.array(operationArbitrary, { maxLength: 24 }), (operations) => {
        const world = startingWorld();
        const openingCash = balanceOf(world.document, world.bankAccountId).computedMinor;
        const openingDebt = debtBalance(world.document, world.debtId);

        let document = world.document;
        for (const operation of operations) {
          document = step(document, world.checkIds, operation);
        }

        const cashOut = openingCash - balanceOf(document, world.bankAccountId).computedMinor;
        const debtDown = openingDebt - debtBalance(document, world.debtId);

        expect(cashOut).toBe(debtDown);
      }),
      { numRuns: 200 },
    );
  });

  test('cleared and outstanding never overlap, and never exceed what was written', () => {
    fc.assert(
      fc.property(fc.array(operationArbitrary, { maxLength: 24 }), (operations) => {
        const world = startingWorld();

        let document = world.document;
        for (const operation of operations) {
          document = step(document, world.checkIds, operation);
        }

        const exposure = summariseChecks(
          toEngineInput(document, { asOf: TEST_NOW }).checks,
          TEST_TODAY,
        );

        // A check is in exactly one bucket, so the buckets add to the number of
        // checks — no piece of paper counted twice, none lost.
        const accounted =
          exposure.outstandingCount +
          exposure.clearedCount +
          exposure.returnedCount +
          exposure.cancelledCount +
          exposure.replacedCount;
        expect(accounted).toBe(CHECK_COUNT);

        expect(exposure.outstandingTotalMinor + exposure.clearedTotalMinor).toBeLessThanOrEqual(
          CHECK_COUNT * CHECK_AMOUNT_MINOR,
        );
      }),
      { numRuns: 200 },
    );
  });

  test('the forecast never counts one check twice', () => {
    fc.assert(
      fc.property(fc.array(operationArbitrary, { maxLength: 24 }), (operations) => {
        const world = startingWorld();

        let document = world.document;
        for (const operation of operations) {
          document = step(document, world.checkIds, operation);
        }

        const items = toEngineInput(document, { asOf: TEST_NOW }).plannedItems.filter((item) =>
          world.checkIds.includes(item.id),
        );

        expect(new Set(items.map((item) => item.id)).size).toBe(items.length);

        const exposure = summariseChecks(
          toEngineInput(document, { asOf: TEST_NOW }).checks,
          TEST_TODAY,
        );
        expect(items).toHaveLength(exposure.outstandingCount);
      }),
      { numRuns: 200 },
    );
  });

  test('every reachable document is one the store could save', () => {
    fc.assert(
      fc.property(fc.array(operationArbitrary, { maxLength: 24 }), (operations) => {
        const world = startingWorld();

        let document = world.document;
        for (const operation of operations) {
          document = step(document, world.checkIds, operation);
        }

        expect(storeDocumentSchema.safeParse(document).success).toBe(true);
      }),
      { numRuns: 150 },
    );
  });
});
