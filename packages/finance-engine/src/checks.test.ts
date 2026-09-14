import { describe, expect, test } from 'vitest';

import {
  DUE_SOON_DAYS,
  coverageOf,
  derivedCheckState,
  evenSeriesFor,
  isAtLarge,
  isOutstanding,
  planCheckSeries,
  summariseChecks,
  type CheckRecord,
} from './checks';

/**
 * The classification of post-dated checks.
 *
 * Every test here is about one of two mistakes. The first is counting a check
 * that has been handed over as money already spent — which makes a family look
 * poorer than they are and would have them scraping by needlessly. The second is
 * not counting it at all — which makes them look richer than they are and is how
 * a check bounces.
 */

const TODAY = '2026-09-07';

function check(overrides: Partial<CheckRecord> = {}): CheckRecord {
  return {
    id: 'check-1',
    debtId: 'debt-gemach',
    accountId: 'account-1',
    amountMinor: 150_000,
    dueDate: '2026-10-12',
    status: 'delivered',
    installmentNumber: 1,
    payeeName: 'גמ״ח',
    deliveredOn: '2026-06-01',
    clearedOn: null,
    ...overrides,
  };
}

describe('what a check is, today', () => {
  test('a prepared check has no urgency however old its date', () => {
    // Still in the chequebook. Nobody else can present it, so a date in the past
    // means somebody wrote it early, not that money is about to move.
    const state = derivedCheckState(
      check({ status: 'prepared', dueDate: '2026-01-01', deliveredOn: null }),
      TODAY,
    );
    expect(state).toBe('prepared');
  });

  test('a delivered check dated in the future is simply delivered', () => {
    expect(derivedCheckState(check({ dueDate: '2026-12-01' }), TODAY)).toBe('delivered');
  });

  test('a delivered check dated today is due', () => {
    expect(derivedCheckState(check({ dueDate: TODAY }), TODAY)).toBe('due');
  });

  test('a delivered check dated before today is overdue', () => {
    expect(derivedCheckState(check({ dueDate: '2026-08-12' }), TODAY)).toBe('overdue');
  });

  test('the derived state changes with the date and nothing else', () => {
    // The reason `due` is not stored: the same record means different things on
    // different mornings, and no background job is required for that to be true.
    const one = check({ dueDate: '2026-09-08' });
    expect(derivedCheckState(one, '2026-09-07')).toBe('delivered');
    expect(derivedCheckState(one, '2026-09-08')).toBe('due');
    expect(derivedCheckState(one, '2026-09-09')).toBe('overdue');
  });

  test('a cleared check is never due, whatever its date says', () => {
    expect(
      derivedCheckState(
        check({ status: 'cleared', dueDate: '2026-01-01', clearedOn: '2026-01-02' }),
        TODAY,
      ),
    ).toBe('cleared');
  });

  test.each(['returned', 'cancelled', 'replaced'] as const)(
    'a %s check keeps its own state',
    (status) => {
      expect(derivedCheckState(check({ status, dueDate: '2026-01-01' }), TODAY)).toBe(status);
    },
  );
});

describe('which checks can still take money', () => {
  test('prepared, delivered and deposited are outstanding', () => {
    expect(isOutstanding(check({ status: 'prepared' }))).toBe(true);
    expect(isOutstanding(check({ status: 'delivered' }))).toBe(true);
    expect(isOutstanding(check({ status: 'deposited' }))).toBe(true);
  });

  test('cleared, returned, cancelled and replaced are not', () => {
    for (const status of ['cleared', 'returned', 'cancelled', 'replaced'] as const) {
      expect(isOutstanding(check({ status }))).toBe(false);
    }
  });

  test('only a delivered or deposited check is in somebody else’s hands', () => {
    expect(isAtLarge(check({ status: 'prepared' }))).toBe(false);
    expect(isAtLarge(check({ status: 'delivered' }))).toBe(true);
    expect(isAtLarge(check({ status: 'deposited' }))).toBe(true);
  });
});

describe('the exposure a family is carrying', () => {
  const checks = [
    check({ id: 'c1', status: 'cleared', dueDate: '2026-06-12', clearedOn: '2026-06-13' }),
    check({ id: 'c2', status: 'cleared', dueDate: '2026-07-12', clearedOn: '2026-07-12' }),
    check({ id: 'c3', status: 'delivered', dueDate: '2026-08-12' }),
    check({ id: 'c4', status: 'delivered', dueDate: '2026-09-12' }),
    check({ id: 'c5', status: 'delivered', dueDate: '2026-10-12' }),
    check({ id: 'c6', status: 'prepared', dueDate: '2026-11-12', deliveredOn: null }),
  ];

  const exposure = summariseChecks(checks, TODAY);

  test('counts everything that can still move money', () => {
    expect(exposure.outstandingCount).toBe(4);
    expect(exposure.outstandingTotalMinor).toBe(600_000);
  });

  test('separates what somebody else is holding from what is still ours', () => {
    // Three delivered; the prepared one is in our own drawer.
    expect(exposure.atLargeCount).toBe(3);
    expect(exposure.atLargeTotalMinor).toBe(450_000);
  });

  test('never adds money already spent to money still promised', () => {
    // The single most important line in this file. Two totals, never one.
    expect(exposure.clearedTotalMinor).toBe(300_000);
    expect(exposure.outstandingTotalMinor).toBe(600_000);
    expect(exposure.clearedTotalMinor + exposure.outstandingTotalMinor).toBe(900_000);
  });

  test('finds the late one', () => {
    expect(exposure.overdueCount).toBe(1);
    expect(exposure.overdueTotalMinor).toBe(150_000);
  });

  test('finds the ones about to land', () => {
    // c4 falls on the 12th, five days out. c3 is already late, so it is not
    // "soon" — it is now, and it is counted as overdue instead.
    expect(exposure.dueSoonCount).toBe(1);
    expect(exposure.dueSoonTotalMinor).toBe(150_000);
  });

  test('names the next one that might come out', () => {
    expect(exposure.nextCheck?.id).toBe('c3');
  });

  test('a cleared check is never the next one, however early its date', () => {
    const summary = summariseChecks(
      [
        check({ id: 'old', status: 'cleared', dueDate: '2026-01-01', clearedOn: '2026-01-02' }),
        check({ id: 'live', status: 'delivered', dueDate: '2026-12-01' }),
      ],
      TODAY,
    );
    expect(summary.nextCheck?.id).toBe('live');
  });

  test('a returned check is not exposure and is not lost either', () => {
    // It will not clear as it stands, so counting it as money about to leave
    // would double the family's fear. It still needs a decision, so it is
    // reported on its own.
    const summary = summariseChecks(
      [check({ id: 'bounced', status: 'returned', dueDate: '2026-08-01' })],
      TODAY,
    );
    expect(summary.outstandingTotalMinor).toBe(0);
    expect(summary.returnedCount).toBe(1);
    expect(summary.returnedTotalMinor).toBe(150_000);
  });

  test('a household with no checks has nothing to report', () => {
    const empty = summariseChecks([], TODAY);
    expect(empty.outstandingCount).toBe(0);
    expect(empty.outstandingTotalMinor).toBe(0);
    expect(empty.nextCheck).toBeNull();
  });

  test('a check exactly on the horizon counts as due soon', () => {
    const edge = summariseChecks([check({ dueDate: '2026-09-21' })], TODAY);
    expect(DUE_SOON_DAYS).toBe(14);
    expect(edge.dueSoonCount).toBe(1);
  });

  test('a check one day beyond it does not', () => {
    expect(summariseChecks([check({ dueDate: '2026-09-22' })], TODAY).dueSoonCount).toBe(0);
  });
});

describe('do the checks cover what is owed', () => {
  test('exactly covered', () => {
    const exposure = summariseChecks([check(), check({ id: 'c2' })], TODAY);
    const coverage = coverageOf(300_000, exposure);
    expect(coverage.fullyCovered).toBe(true);
    expect(coverage.shortfallMinor).toBe(0);
    expect(coverage.excessMinor).toBe(0);
  });

  test('a shortfall is reported as one', () => {
    const exposure = summariseChecks([check()], TODAY);
    const coverage = coverageOf(500_000, exposure);
    expect(coverage.fullyCovered).toBe(false);
    expect(coverage.shortfallMinor).toBe(350_000);
  });

  test('more paper than debt is reported rather than hidden', () => {
    // Usually means a check cleared without being recorded, which is worth
    // saying out loud instead of clamping to zero and looking tidy.
    const exposure = summariseChecks([check(), check({ id: 'c2' })], TODAY);
    const coverage = coverageOf(100_000, exposure);
    expect(coverage.excessMinor).toBe(200_000);
    expect(coverage.fullyCovered).toBe(true);
  });
});

describe('planning a series of checks', () => {
  test('produces one check a month from the first date', () => {
    const plan = planCheckSeries({
      count: 6,
      amountPerCheckMinor: 150_000,
      finalCheckAmountMinor: null,
      firstDueDate: '2026-10-12',
      firstCheckNumber: null,
      intendedTotalMinor: 900_000,
    });

    expect(plan.checks).toHaveLength(6);
    expect(plan.checks.map((entry) => entry.dueDate)).toEqual([
      '2026-10-12',
      '2026-11-12',
      '2026-12-12',
      '2027-01-12',
      '2027-02-12',
      '2027-03-12',
    ]);
    expect(plan.totalMinor).toBe(900_000);
    expect(plan.warnings).not.toContain('total_does_not_match');
  });

  test('a single check is a series of one', () => {
    const plan = planCheckSeries({
      count: 1,
      amountPerCheckMinor: 500_00,
      finalCheckAmountMinor: null,
      firstDueDate: '2026-10-01',
      firstCheckNumber: null,
      intendedTotalMinor: 500_00,
    });
    expect(plan.checks).toHaveLength(1);
    expect(plan.totalMinor).toBe(500_00);
  });

  test('the last check may be a different amount', () => {
    const plan = planCheckSeries({
      count: 3,
      amountPerCheckMinor: 100_000,
      finalCheckAmountMinor: 133_333,
      firstDueDate: '2026-10-05',
      firstCheckNumber: null,
      intendedTotalMinor: 333_333,
    });

    expect(plan.checks.map((entry) => entry.amountMinor)).toEqual([100_000, 100_000, 133_333]);
    expect(plan.totalMinor).toBe(333_333);
    expect(plan.warnings).toContain('final_check_larger_than_others');
    expect(plan.warnings).not.toContain('total_does_not_match');
  });

  test('a total that does not match what the family said is reported, not corrected', () => {
    // The arithmetic is theirs. Ours is to notice, and to say so before the
    // checks are written rather than in month twelve.
    const plan = planCheckSeries({
      count: 6,
      amountPerCheckMinor: 150_000,
      finalCheckAmountMinor: null,
      firstDueDate: '2026-10-12',
      firstCheckNumber: null,
      intendedTotalMinor: 1_000_000,
    });

    expect(plan.warnings).toContain('total_does_not_match');
    expect(plan.differenceMinor).toBe(-100_000);
    expect(plan.checks).toHaveLength(6);
  });

  test('not saying what the total should be is itself worth a warning', () => {
    const plan = planCheckSeries({
      count: 2,
      amountPerCheckMinor: 100_000,
      finalCheckAmountMinor: null,
      firstDueDate: '2026-10-12',
      firstCheckNumber: null,
      intendedTotalMinor: null,
    });
    expect(plan.warnings).toContain('no_intended_total');
    expect(plan.differenceMinor).toBe(0);
  });

  test('check numbers run consecutively and keep their leading zeros', () => {
    const plan = planCheckSeries({
      count: 3,
      amountPerCheckMinor: 100_000,
      finalCheckAmountMinor: null,
      firstDueDate: '2026-10-12',
      firstCheckNumber: '000998',
      intendedTotalMinor: 300_000,
    });
    expect(plan.checks.map((entry) => entry.checkNumber)).toEqual([
      '000998',
      '000999',
      '001000',
    ]);
  });

  test('a series from the 31st lands on the last day of shorter months', () => {
    // A borrower writing "the 31st of every month" gets the 28th in February,
    // because that is what the bank does with it.
    const plan = planCheckSeries({
      count: 4,
      amountPerCheckMinor: 100_000,
      finalCheckAmountMinor: null,
      firstDueDate: '2026-12-31',
      firstCheckNumber: null,
      intendedTotalMinor: 400_000,
    });

    expect(plan.checks.map((entry) => entry.dueDate)).toEqual([
      '2026-12-31',
      '2027-01-31',
      '2027-02-28',
      '2027-03-31',
    ]);
    expect(plan.warnings).toContain('due_date_clamped');
  });

  test('a series that stays on the same day says nothing about clamping', () => {
    const plan = planCheckSeries({
      count: 3,
      amountPerCheckMinor: 100_000,
      finalCheckAmountMinor: null,
      firstDueDate: '2026-10-15',
      firstCheckNumber: null,
      intendedTotalMinor: 300_000,
    });
    expect(plan.warnings).not.toContain('due_date_clamped');
  });

  test('a series crossing a leap year lands on the 29th', () => {
    const plan = planCheckSeries({
      count: 2,
      amountPerCheckMinor: 100_000,
      finalCheckAmountMinor: null,
      firstDueDate: '2028-01-31',
      firstCheckNumber: null,
      intendedTotalMinor: 200_000,
    });
    expect(plan.checks[1]?.dueDate).toBe('2028-02-29');
  });

  test('installments are numbered from one', () => {
    const plan = planCheckSeries({
      count: 3,
      amountPerCheckMinor: 100_000,
      finalCheckAmountMinor: null,
      firstDueDate: '2026-10-12',
      firstCheckNumber: null,
      intendedTotalMinor: 300_000,
    });
    expect(plan.checks.map((entry) => entry.installmentNumber)).toEqual([1, 2, 3]);
  });
});

describe('dividing a total into checks', () => {
  test('an even total divides evenly', () => {
    expect(evenSeriesFor(900_000, 6)).toEqual({
      perCheckMinor: 150_000,
      finalCheckMinor: null,
    });
  });

  test('a remainder goes on the last check, exactly', () => {
    // 10,000.00 over three checks. Not 3,333.33 three times, which is 9,999.99
    // and a family eventually one agora short.
    const { perCheckMinor, finalCheckMinor } = evenSeriesFor(1_000_000, 3);
    expect(perCheckMinor).toBe(333_333);
    expect(finalCheckMinor).toBe(333_334);
    expect(perCheckMinor * 2 + (finalCheckMinor ?? 0)).toBe(1_000_000);
  });

  test('the pieces always add back to the whole', () => {
    for (let total = 99_990; total <= 100_010; total += 1) {
      for (let count = 1; count <= 12; count += 1) {
        const { perCheckMinor, finalCheckMinor } = evenSeriesFor(total, count);
        const sum =
          finalCheckMinor === null
            ? perCheckMinor * count
            : perCheckMinor * (count - 1) + finalCheckMinor;
        expect(sum).toBe(total);
      }
    }
  });

  test('a series of one is the whole amount', () => {
    expect(evenSeriesFor(123_457, 1)).toEqual({
      perCheckMinor: 123_457,
      finalCheckMinor: null,
    });
  });

  test('a count of zero is refused rather than dividing by it', () => {
    expect(() => evenSeriesFor(100, 0)).toThrow();
  });
});
