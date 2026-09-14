import { describe, expect, test } from 'vitest';

import {
  DateError,
  addDays,
  businessDateOf,
  daysBetween,
  dueDateInMonth,
  eachDay,
  endOfMonth,
  startOfMonth,
} from './dates';

describe('businessDateOf', () => {
  test('an evening instant belongs to the Jerusalem day, not the UTC one', () => {
    // 21:30 UTC on the 31st is 00:30 on the 1st in Jerusalem (UTC+3 in summer).
    expect(businessDateOf('2026-08-31T21:30:00.000Z')).toBe('2026-09-01');
  });

  test('a morning instant is the same day in both zones', () => {
    expect(businessDateOf('2026-08-31T09:00:00.000Z')).toBe('2026-08-31');
  });

  test('works either side of a daylight-saving change', () => {
    // Israel leaves DST in late October. Both instants are late evening UTC and
    // both belong to the next Jerusalem day, whatever the offset happens to be.
    expect(businessDateOf('2026-10-24T21:30:00.000Z')).toBe('2026-10-25');
    expect(businessDateOf('2026-11-24T22:30:00.000Z')).toBe('2026-11-25');
  });

  test('rejects an instant it cannot parse rather than guessing', () => {
    expect(() => businessDateOf('not-a-date')).toThrow(DateError);
  });
});

describe('addDays and daysBetween', () => {
  test('crossing a daylight-saving boundary still moves exactly one day', () => {
    expect(addDays('2026-10-24', 1)).toBe('2026-10-25');
    expect(daysBetween('2026-10-24', '2026-10-25')).toBe(1);
  });

  test('crosses a month boundary', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
  });

  test('handles a leap day', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });

  test('is negative when the target is earlier', () => {
    expect(daysBetween('2026-08-20', '2026-08-10')).toBe(-10);
  });

  test('rejects a date that matches the pattern but is not a day', () => {
    expect(() => addDays('2026-02-30', 1)).toThrow(DateError);
  });
});

describe('endOfMonth and startOfMonth', () => {
  test.each([
    ['2026-08-10', '2026-08-31'],
    ['2026-09-10', '2026-09-30'],
    ['2026-02-10', '2026-02-28'],
    ['2028-02-10', '2028-02-29'],
    ['2026-12-31', '2026-12-31'],
  ])('end of the month containing %s is %s', (date, expected) => {
    expect(endOfMonth(date)).toBe(expected);
  });

  test('start of month is always the first', () => {
    expect(startOfMonth('2026-08-31')).toBe('2026-08-01');
  });
});

describe('dueDateInMonth', () => {
  test('a payment due on the 10th falls on the 10th', () => {
    expect(dueDateInMonth('2026-08-01', 10)).toBe('2026-08-10');
  });

  test('a payment due on the 31st clamps to the last day of a short month', () => {
    expect(dueDateInMonth('2026-09-01', 31)).toBe('2026-09-30');
    expect(dueDateInMonth('2026-02-01', 31)).toBe('2026-02-28');
  });

  test('clamping keeps the payment inside its own month', () => {
    const due = dueDateInMonth('2026-02-15', 30);
    expect(due.startsWith('2026-02')).toBe(true);
  });

  test('rejects a day outside 1-31', () => {
    expect(() => dueDateInMonth('2026-08-01', 0)).toThrow(DateError);
    expect(() => dueDateInMonth('2026-08-01', 32)).toThrow(DateError);
  });
});

describe('eachDay', () => {
  test('is inclusive of both ends', () => {
    expect(eachDay('2026-08-10', '2026-08-12')).toEqual([
      '2026-08-10',
      '2026-08-11',
      '2026-08-12',
    ]);
  });

  test('a single day is one entry', () => {
    expect(eachDay('2026-08-10', '2026-08-10')).toEqual(['2026-08-10']);
  });

  test('a reversed range is empty rather than an error or an infinite loop', () => {
    expect(eachDay('2026-08-12', '2026-08-10')).toEqual([]);
  });

  test('covers a whole 31-day month', () => {
    expect(eachDay('2026-08-01', '2026-08-31')).toHaveLength(31);
  });
});
