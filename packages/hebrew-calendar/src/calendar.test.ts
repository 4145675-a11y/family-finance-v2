import { describe, expect, test } from 'vitest';

import {
  HebrewDateError,
  assertHebrewDate,
  daysInHebrewMonth,
  formatGregorian,
  formatHebrewDate,
  gregorianToHebrew,
  hebrewMonthName,
  hebrewMonthNumber,
  hebrewToGregorian,
  isHebrewLeapYear,
  todayInIsrael,
} from './calendar';

/** @hebcal/core month numbers, named so the tests read as dates rather than indices. */
const TISHREI = 7;
const CHESHVAN = 8;
const KISLEV = 9;
const TEVET = 10;
const SHVAT = 11;
const ADAR_I = 12;
const ADAR_II = 13;

describe('hebrewToGregorian', () => {
  test('the worked example from the specification converts exactly', () => {
    // ז׳ טבת תשפ״ז is the date the product spec pairs with 17/12/2026.
    expect(hebrewToGregorian({ day: 7, month: TEVET, year: 5787 })).toBe('2026-12-17');
  });

  test('a second Hebrew date converts to its own civil day', () => {
    expect(hebrewToGregorian({ day: 4, month: SHVAT, year: 5787 })).toBe('2027-01-12');
  });

  test('a day the month does not have is refused, not moved', () => {
    // Kislev has 29 days in 5784. @hebcal/core answers 1 Tevet for this input
    // without complaining, which would silently move a due date by a day and a
    // month. The wrapper refuses instead.
    expect(daysInHebrewMonth(KISLEV, 5784)).toBe(29);
    expect(() => hebrewToGregorian({ day: 30, month: KISLEV, year: 5784 })).toThrow(
      HebrewDateError,
    );
  });

  test('the same day is accepted in a year where the month is long', () => {
    expect(daysInHebrewMonth(KISLEV, 5786)).toBe(30);
    expect(hebrewToGregorian({ day: 30, month: KISLEV, year: 5786 })).toBe('2025-12-20');
  });

  test('Adar II is refused in a year that has one Adar', () => {
    expect(isHebrewLeapYear(5786)).toBe(false);
    expect(() => assertHebrewDate({ day: 4, month: ADAR_II, year: 5786 })).toThrow(
      HebrewDateError,
    );
  });

  test('Adar II is a real month in a leap year', () => {
    expect(isHebrewLeapYear(5787)).toBe(true);
    expect(hebrewToGregorian({ day: 4, month: ADAR_II, year: 5787 })).toBe('2027-03-13');
  });
});

describe('gregorianToHebrew', () => {
  test('the worked example converts back', () => {
    expect(gregorianToHebrew('2026-12-17')).toEqual({ day: 7, month: TEVET, year: 5787 });
  });

  test('every day of a month round-trips through both calendars', () => {
    // A whole month is enough to catch an off-by-one that a single date hides.
    for (let day = 1; day <= 28; day += 1) {
      const gregorian = `2026-11-${String(day).padStart(2, '0')}`;
      const hebrew = gregorianToHebrew(gregorian);
      expect(hebrewToGregorian(hebrew)).toBe(gregorian);
    }
  });

  test('a date that is not a real day is refused', () => {
    expect(() => gregorianToHebrew('2026-02-30')).toThrow(HebrewDateError);
  });

  test('a string that is not a business date is refused', () => {
    expect(() => gregorianToHebrew('17/12/2026')).toThrow(HebrewDateError);
  });
});

describe('leap years and Adar', () => {
  test('the library and the wrapper agree on which years are leap', () => {
    expect([5784, 5785, 5786, 5787, 5788].map(isHebrewLeapYear)).toEqual([
      true,
      false,
      false,
      true,
      false,
    ]);
  });

  test('a leap year has thirteen months and names both Adars', () => {
    expect(hebrewMonthName(ADAR_I, 5787)).toBe('אדר א׳');
    expect(hebrewMonthName(ADAR_II, 5787)).toBe('אדר ב׳');
  });

  test('a plain year has one Adar, named without a number', () => {
    expect(hebrewMonthName(ADAR_I, 5786)).toBe('אדר');
  });

  test('a bare Adar resolves to the single Adar in a plain year', () => {
    expect(hebrewMonthNumber('אדר', 5786)).toBe(ADAR_I);
  });

  test('Adar I and Adar II are told apart in a leap year', () => {
    expect(hebrewMonthNumber('אדר א', 5787)).toBe(ADAR_I);
    expect(hebrewMonthNumber('אדר ב', 5787)).toBe(ADAR_II);
    expect(hebrewMonthNumber('אדר ראשון', 5787)).toBe(ADAR_I);
    expect(hebrewMonthNumber('אדר שני', 5787)).toBe(ADAR_II);
  });

  test('Cheshvan and Kislev change length between years', () => {
    expect(daysInHebrewMonth(CHESHVAN, 5784)).toBe(29);
    expect(daysInHebrewMonth(CHESHVAN, 5787)).toBe(30);
    expect(daysInHebrewMonth(KISLEV, 5784)).toBe(29);
    expect(daysInHebrewMonth(KISLEV, 5787)).toBe(30);
  });

  test('Tishrei is always thirty days', () => {
    for (const year of [5784, 5785, 5786, 5787]) {
      expect(daysInHebrewMonth(TISHREI, year)).toBe(30);
    }
  });
});

describe('month names are matched exactly, never approximately', () => {
  /*
   * @hebcal/core's own `monthFromName` matches loosely. Measured against 6.9.3 it
   * answers Cheshvan for "חוב", Tishrei for "תשלום", Nisan for "בנק" and Kislev
   * for "כשאפשר" — every one of them a word this importer meets on a debt file.
   * These are the words that must not become months.
   */
  test.each([
    ['חוב'],
    ['תשלום'],
    ['לתשלום'],
    ['בנק'],
    ['כשאפשר'],
    ['שלם'],
    ['בחודש'],
    ['הלוואה'],
    ['גמח'],
  ])('"%s" is not a month', (word) => {
    expect(hebrewMonthNumber(word, 5787)).toBeNull();
  });

  test('the real month names still resolve', () => {
    expect(hebrewMonthNumber('טבת', 5787)).toBe(TEVET);
    expect(hebrewMonthNumber('שבט', 5787)).toBe(SHVAT);
    expect(hebrewMonthNumber('כסלו', 5787)).toBe(KISLEV);
    expect(hebrewMonthNumber('מרחשוון', 5787)).toBe(CHESHVAN);
    expect(hebrewMonthNumber('תשרי', 5787)).toBe(TISHREI);
  });
});

describe('formatting', () => {
  test('a Hebrew date renders the way the family writes it', () => {
    expect(formatHebrewDate({ day: 7, month: TEVET, year: 5787 })).toBe('ז׳ טבת תשפ״ז');
  });

  test('the month name carries no vowel points', () => {
    const rendered = formatHebrewDate({ day: 4, month: SHVAT, year: 5787 });
    expect(rendered).toBe('ד׳ שבט תשפ״ז');
    expect(/[֑-ׇ]/.test(rendered)).toBe(false);
  });

  test('a Gregorian date renders day-first, as Israel writes it', () => {
    expect(formatGregorian('2026-12-17')).toBe('17/12/2026');
  });

  test('formatting refuses a date the calendar does not contain', () => {
    expect(() => formatHebrewDate({ day: 30, month: KISLEV, year: 5784 })).toThrow(
      HebrewDateError,
    );
  });
});

describe('todayInIsrael', () => {
  test('an instant late at night in Jerusalem is still that civil day', () => {
    // 21:30 UTC on 16 December is 23:30 in Jerusalem, the same day there.
    expect(todayInIsrael(new Date('2026-12-16T21:30:00Z'))).toBe('2026-12-16');
  });

  test('an instant after midnight in Jerusalem has already turned over', () => {
    // 22:30 UTC is 00:30 the next day in Jerusalem.
    expect(todayInIsrael(new Date('2026-12-16T22:30:00Z'))).toBe('2026-12-17');
  });
});
