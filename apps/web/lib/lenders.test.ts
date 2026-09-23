import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  finalBalanceOf,
  replayDebtBalances,
  replayDebtLedger,
} from '@family-finance/finance-engine';
import { addDebt, recordDebtEvent, type StoreDocument } from '@family-finance/local-store';
import {
  contextFor,
  seededHousehold,
} from '../../../packages/local-store/src/fixtures/household';
import { describe, expect, test } from 'vitest';

import { lenderCard, lenderCards } from './lenders';

/**
 * The lender card shows the number the engine computed, and no other.
 *
 * Two kinds of test here, and both are needed. The first kind checks the values:
 * the heading, the last row of the running column and the engine's own totals
 * all agree on the audit sequence. The second kind checks the *source*: it reads
 * this module's text and refuses any arithmetic over debt events, because a
 * second calculation that happens to agree today is exactly what drifted before.
 */

const TODAY = '2026-12-31';

function householdWithAuditSequence(): { document: StoreDocument; debtId: string } {
  const seeded = seededHousehold();
  const context = contextFor(seeded.document);

  const opened = addDebt(
    seeded.document,
    {
      creditorName: 'מלווה בדיקה',
      kind: 'private_person',
      openingBalanceMinor: 100,
      openedOn: '2026-01-01',
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
    context,
  );
  const debtId = opened.value;

  // 150 repaid — more than was ever owed — and then 100 borrowed again.
  const paid = recordDebtEvent(
    opened.document,
    {
      debtId,
      kind: 'principal_payment',
      amountMinor: 150,
      occurredOn: '2026-01-02',
      correctionEffect: null,
    },
    context,
  );
  const reborrowed = recordDebtEvent(
    paid.document,
    {
      debtId,
      kind: 'new_principal',
      amountMinor: 100,
      occurredOn: '2026-01-03',
      correctionEffect: null,
    },
    context,
  );

  return { document: reborrowed.document, debtId };
}

describe('100 owed, 150 repaid, 100 borrowed again — everything says 50', () => {
  const { document, debtId } = householdWithAuditSequence();
  const card = lenderCards(document, TODAY).find((c) => c.displayName === 'מלווה בדיקה');

  test('the lender card exists', () => {
    expect(card).toBeDefined();
  });

  test('the heading says 50', () => {
    expect(card?.currentBalanceMinor).toBe(50);
  });

  test('the engine totals say 50', () => {
    expect(replayDebtBalances(document.debtEvents, TODAY).get(debtId)).toBe(50);
  });

  test('the ledger last line, clamped once, says 50', () => {
    expect(finalBalanceOf(replayDebtLedger(document.debtEvents, debtId, TODAY))).toBe(50);
  });

  test('the heading equals the engine totals', () => {
    expect(card?.currentBalanceMinor).toBe(
      replayDebtBalances(document.debtEvents, TODAY).get(debtId),
    );
  });

  test('the running column shows the dip, and ends where the heading is', () => {
    // The card lists newest first, so the last event is the first row.
    const rows = [...(card?.ledger ?? [])].reverse();
    expect(rows.map((row) => row.balanceAfterMinor)).toEqual([100, -50, 50]);
    expect(rows[rows.length - 1]?.balanceAfterMinor).toBe(card?.currentBalanceMinor);
  });

  test('the per-step clamp that used to be here would have said 100', () => {
    let stepClamped = 0;
    for (const row of [...(card?.ledger ?? [])].reverse()) {
      stepClamped = Math.max(0, stepClamped + row.deltaMinor);
    }
    expect(stepClamped).toBe(100);
    expect(card?.currentBalanceMinor).not.toBe(stepClamped);
  });

  test('the single-lender view agrees with the list', () => {
    const one = lenderCard(document, TODAY, card?.key ?? '');
    expect(one?.currentBalanceMinor).toBe(card?.currentBalanceMinor);
  });
});

describe('an ordinary debt is unaffected by the change', () => {
  test('a debt that never dips reports what it always did', () => {
    const seeded = seededHousehold();
    const context = contextFor(seeded.document);
    const opened = addDebt(
      seeded.document,
      {
        creditorName: 'מלווה רגיל',
        kind: 'gemach',
        openingBalanceMinor: 500_000,
        openedOn: '2026-01-01',
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
      context,
    );
    const paid = recordDebtEvent(
      opened.document,
      {
        debtId: opened.value,
        kind: 'principal_payment',
        amountMinor: 200_000,
        occurredOn: '2026-02-01',
        correctionEffect: null,
      },
      context,
    );

    const card = lenderCards(paid.document, TODAY).find((c) => c.displayName === 'מלווה רגיל');
    expect(card?.currentBalanceMinor).toBe(300_000);
    expect(card?.currentBalanceMinor).toBe(
      replayDebtBalances(paid.document.debtEvents, TODAY).get(opened.value),
    );
  });
});

describe('there is no second debt-balance calculation in the lender UI', () => {
  const source = readFileSync(fileURLToPath(new URL('./lenders.ts', import.meta.url)), 'utf8');
  /** The file without its comments, so prose describing the old bug is not read as code. */
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');

  test('it does not clamp a balance itself', () => {
    expect(code).not.toContain('Math.max(0');
    expect(code).not.toContain('Math.min(');
  });

  test('it declares no effect table of its own', () => {
    // A `directionOf`-style switch over event kinds was the duplicate that
    // drifted; the effect table belongs to the contracts and to nowhere else.
    expect(code).not.toMatch(/function\s+directionOf/);
    expect(code).not.toContain('DEBT_EVENT_BALANCE_EFFECT');
    expect(code).not.toMatch(/case\s+'principal_payment'/);
    expect(code).not.toMatch(/case\s+'opening_balance'/);
  });

  test('it does no arithmetic on an event amount', () => {
    // The only sums left are over values the engine already computed.
    expect(code).not.toMatch(/amountMinor\s*[*+-]/);
    expect(code).not.toMatch(/[*+-]\s*\w+\.amountMinor/);
  });

  test('it gets its numbers from the engine', () => {
    expect(code).toContain('replayDebtLedger');
    expect(code).toContain('finalBalanceOf');
  });

  test('the lender page renders the engine figures rather than deriving them', () => {
    const page = readFileSync(
      fileURLToPath(new URL('../app/lenders/[lender]/page.tsx', import.meta.url)),
      'utf8',
    );
    const pageCode = page
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');

    expect(pageCode).not.toContain('Math.max(0');
    expect(pageCode).not.toMatch(/amountMinor\s*[*+]/);
    expect(pageCode).not.toMatch(/function\s+directionOf/);
  });
});
