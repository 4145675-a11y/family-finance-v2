import { describe, expect, test } from 'vitest';

import {
  debtEventDeltaMinor,
  finalBalanceOf,
  replayDebtBalances,
  replayDebtLedger,
} from './debt';
import { debtEvent } from './fixtures/scenario';

/**
 * One answer to "what is owed", wherever it is asked.
 *
 * The production inconsistency these tests exist for: the lender card walked the
 * events itself and clamped at zero after every line, while the totals walked
 * them once and clamped only at the end. On any debt that had dipped below zero
 * and recovered the two disagreed — the heading said one number and the last row
 * of the column beneath it said another.
 *
 * The sequence below is the one from the audit, and it is the sequence every one
 * of these tests is built on: 100 owed, 150 repaid, 100 borrowed again. The
 * answer is 50, everywhere.
 */

const asOf = '2026-12-31';

/** 100 in, 150 out, 100 in — dips to −50 and recovers. */
const AUDIT_SEQUENCE = [
  debtEvent({ id: 'a', kind: 'opening_balance', amountMinor: 100, occurredOn: '2026-01-01' }),
  debtEvent({
    id: 'b',
    kind: 'principal_payment',
    amountMinor: 150,
    occurredOn: '2026-01-02',
  }),
  debtEvent({ id: 'c', kind: 'new_principal', amountMinor: 100, occurredOn: '2026-01-03' }),
];

describe('the audit sequence: 100 → −150 → +100', () => {
  test('the totals say 50', () => {
    expect(replayDebtBalances(AUDIT_SEQUENCE, asOf).get('debt-1')).toBe(50);
  });

  test('the ledger says 50', () => {
    expect(finalBalanceOf(replayDebtLedger(AUDIT_SEQUENCE, 'debt-1', asOf))).toBe(50);
  });

  test('the two agree — which is the whole point', () => {
    const fromTotals = replayDebtBalances(AUDIT_SEQUENCE, asOf).get('debt-1');
    const fromLedger = finalBalanceOf(replayDebtLedger(AUDIT_SEQUENCE, 'debt-1', asOf));
    expect(fromLedger).toBe(fromTotals);
  });

  test('the running column shows the dip rather than hiding it', () => {
    const lines = replayDebtLedger(AUDIT_SEQUENCE, 'debt-1', asOf);
    expect(lines.map((line) => line.balanceAfterMinor)).toEqual([100, -50, 50]);
  });

  test('the old per-step clamp is what disagreed, and it is gone', () => {
    // Reproduces exactly what the screen used to do.
    let stepClamped = 0;
    for (const line of replayDebtLedger(AUDIT_SEQUENCE, 'debt-1', asOf)) {
      stepClamped = Math.max(0, stepClamped + line.deltaMinor);
    }
    expect(stepClamped).toBe(100);

    // And what the engine actually reports.
    expect(finalBalanceOf(replayDebtLedger(AUDIT_SEQUENCE, 'debt-1', asOf))).toBe(50);
    expect(stepClamped).not.toBe(50);
  });

  test('each line carries the engine own signed delta', () => {
    expect(replayDebtLedger(AUDIT_SEQUENCE, 'debt-1', asOf).map((l) => l.deltaMinor)).toEqual([
      100, -150, 100,
    ]);
  });
});

describe('the ledger and the totals agree in general, not only on that one case', () => {
  const cases: readonly { name: string; events: ReturnType<typeof debtEvent>[] }[] = [
    { name: 'an opening balance alone', events: [debtEvent({ amountMinor: 500 })] },
    {
      name: 'a partial repayment',
      events: [
        debtEvent({ id: 'a', amountMinor: 500 }),
        debtEvent({ id: 'b', kind: 'principal_payment', amountMinor: 200 }),
      ],
    },
    {
      name: 'repaid in full',
      events: [
        debtEvent({ id: 'a', amountMinor: 500 }),
        debtEvent({ id: 'b', kind: 'principal_payment', amountMinor: 500 }),
      ],
    },
    {
      name: 'over-repaid and left negative',
      events: [
        debtEvent({ id: 'a', amountMinor: 500 }),
        debtEvent({ id: 'b', kind: 'principal_payment', amountMinor: 800 }),
      ],
    },
    {
      name: 'a note, which moves nothing',
      events: [
        debtEvent({ id: 'a', amountMinor: 500 }),
        debtEvent({ id: 'b', kind: 'note', amountMinor: 0 }),
      ],
    },
    {
      name: 'interest charged and interest paid',
      events: [
        debtEvent({ id: 'a', amountMinor: 500 }),
        debtEvent({ id: 'b', kind: 'interest_charge', amountMinor: 50 }),
        debtEvent({ id: 'c', kind: 'interest_paid', amountMinor: 50 }),
      ],
    },
    {
      name: 'a correction downwards',
      events: [
        debtEvent({ id: 'a', amountMinor: 500 }),
        debtEvent({
          id: 'b',
          kind: 'balance_correction',
          amountMinor: 100,
          correctionEffect: 'decrease',
        }),
      ],
    },
    {
      name: 'a write-off',
      events: [
        debtEvent({ id: 'a', amountMinor: 500 }),
        debtEvent({ id: 'b', kind: 'write_off', amountMinor: 500 }),
      ],
    },
  ];

  test.each(cases)('$name', ({ events }) => {
    const fromTotals = replayDebtBalances(events, asOf).get('debt-1') ?? 0;
    const fromLedger = finalBalanceOf(replayDebtLedger(events, 'debt-1', asOf));
    expect(fromLedger).toBe(fromTotals);
  });
});

describe('one delta function, used by both', () => {
  test('the sum of the deltas is the unclamped balance', () => {
    const lines = replayDebtLedger(AUDIT_SEQUENCE, 'debt-1', asOf);
    const summed = lines.reduce((total, line) => total + line.deltaMinor, 0);
    expect(summed).toBe(lines[lines.length - 1]?.balanceAfterMinor);
  });

  test('a note has no effect on a balance', () => {
    expect(debtEventDeltaMinor(debtEvent({ kind: 'note', amountMinor: 0 }))).toBe(0);
  });

  test('paying interest is not progress on principal', () => {
    expect(debtEventDeltaMinor(debtEvent({ kind: 'interest_paid', amountMinor: 50 }))).toBe(0);
  });

  test('a correction carries its own direction', () => {
    expect(
      debtEventDeltaMinor(
        debtEvent({
          kind: 'balance_correction',
          amountMinor: 40,
          correctionEffect: 'increase',
        }),
      ),
    ).toBe(40);
    expect(
      debtEventDeltaMinor(
        debtEvent({
          kind: 'balance_correction',
          amountMinor: 40,
          correctionEffect: 'decrease',
        }),
      ),
    ).toBe(-40);
  });
});

describe('the ledger reads only the debt it was asked about', () => {
  test('another debt events are not in it', () => {
    const mixed = [
      debtEvent({ id: 'a', debtId: 'debt-1', amountMinor: 100 }),
      debtEvent({ id: 'b', debtId: 'debt-2', amountMinor: 900 }),
    ];
    const lines = replayDebtLedger(mixed, 'debt-1', asOf);
    expect(lines).toHaveLength(1);
    expect(finalBalanceOf(lines)).toBe(100);
  });

  test('an event after the as-of date is not counted', () => {
    const lines = replayDebtLedger(AUDIT_SEQUENCE, 'debt-1', '2026-01-02');
    expect(lines).toHaveLength(2);
    expect(lines[lines.length - 1]?.balanceAfterMinor).toBe(-50);
    // And the totals agree at that same moment.
    expect(replayDebtBalances(AUDIT_SEQUENCE, '2026-01-02').get('debt-1')).toBe(0);
    expect(finalBalanceOf(lines)).toBe(0);
  });

  test('a debt with no events owes nothing', () => {
    expect(finalBalanceOf(replayDebtLedger([], 'debt-1', asOf))).toBe(0);
  });
});
