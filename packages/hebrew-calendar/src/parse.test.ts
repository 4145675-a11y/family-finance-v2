import { describe, expect, test } from 'vitest';

import { parseDueDateText } from './parse';

const TEVET = 10;
const SHVAT = 11;
const ADAR_I = 12;

describe('parseDueDateText — Hebrew dates', () => {
  test('a bare Hebrew date resolves to both calendars', () => {
    const result = parseDueDateText('ז׳ טבת תשפ״ז');
    expect(result.outcome).toBe('resolved');
    if (result.outcome !== 'resolved') return;
    expect(result.source).toBe('hebrew');
    expect(result.hebrew).toEqual({ day: 7, month: TEVET, year: 5787 });
    expect(result.gregorian).toBe('2026-12-17');
    expect(result.note).toBeNull();
  });

  test('a sentence around the date keeps the date and the sentence apart', () => {
    const result = parseDueDateText('לתשלום ד׳ שבט תשפ״ז');
    expect(result.outcome).toBe('resolved');
    if (result.outcome !== 'resolved') return;
    expect(result.hebrew).toEqual({ day: 4, month: SHVAT, year: 5787 });
    expect(result.gregorian).toBe('2027-01-12');
    expect(result.note).toBe('לתשלום');
  });

  test('the text as written is always carried back for the audit trail', () => {
    const original = '  לתשלום ד׳ שבט תשפ״ז  ';
    expect(parseDueDateText(original).originalText).toBe(original);
  });

  test('a date typed with straight quotes reads the same', () => {
    const result = parseDueDateText(`ז' טבת תשפ"ז`);
    expect(result.outcome).toBe('resolved');
    if (result.outcome !== 'resolved') return;
    expect(result.gregorian).toBe('2026-12-17');
  });

  test('a day written in digits beside a Hebrew month still reads', () => {
    const result = parseDueDateText('7 טבת תשפ״ז');
    expect(result.outcome).toBe('resolved');
    if (result.outcome !== 'resolved') return;
    expect(result.gregorian).toBe('2026-12-17');
  });
});

describe('parseDueDateText — Gregorian dates', () => {
  test('a day-first Israeli date resolves to both calendars', () => {
    const result = parseDueDateText('17/12/2026');
    expect(result.outcome).toBe('resolved');
    if (result.outcome !== 'resolved') return;
    expect(result.source).toBe('gregorian');
    expect(result.gregorian).toBe('2026-12-17');
    expect(result.hebrew).toEqual({ day: 7, month: TEVET, year: 5787 });
  });

  test('dots and dashes are accepted as separators', () => {
    expect(parseDueDateText('17.12.2026')).toMatchObject({ gregorian: '2026-12-17' });
    expect(parseDueDateText('17-12-2026')).toMatchObject({ gregorian: '2026-12-17' });
  });

  test('a note beside a Gregorian date is preserved', () => {
    const result = parseDueDateText('לתשלום 17/12/2026');
    expect(result.outcome).toBe('resolved');
    if (result.outcome !== 'resolved') return;
    expect(result.note).toBe('לתשלום');
  });

  test('a day that does not exist is sent to review, not rolled over', () => {
    const result = parseDueDateText('30/02/2026');
    expect(result).toMatchObject({ outcome: 'needs_review', reason: 'unreadable_date' });
  });
});

describe('parseDueDateText — what must never be guessed', () => {
  test('a hedged Hebrew date is not a date', () => {
    const result = parseDueDateText('בערך ז׳ טבת תשפ״ז');
    expect(result).toMatchObject({ outcome: 'needs_review', reason: 'uncertainty_marker' });
  });

  test('a hedged Gregorian date is not a date either', () => {
    const result = parseDueDateText('estimated 17/12/2026');
    expect(result).toMatchObject({ outcome: 'needs_review', reason: 'uncertainty_marker' });
  });

  test('"בסביבות" hedges just as much as "בערך"', () => {
    expect(parseDueDateText('בסביבות ד׳ שבט תשפ״ז')).toMatchObject({
      outcome: 'needs_review',
      reason: 'uncertainty_marker',
    });
  });

  test('a bare Adar in a leap year asks which Adar', () => {
    // 5787 has two Adars, so "אדר" names neither of them.
    const result = parseDueDateText('ד׳ אדר תשפ״ז');
    expect(result).toMatchObject({ outcome: 'needs_review', reason: 'ambiguous_adar' });
  });

  test('a bare Adar in a plain year is unambiguous', () => {
    // 5786 has one Adar, so "אדר" can only mean that one.
    const result = parseDueDateText('ד׳ אדר תשפ״ו');
    expect(result.outcome).toBe('resolved');
    if (result.outcome !== 'resolved') return;
    expect(result.hebrew).toEqual({ day: 4, month: ADAR_I, year: 5786 });
  });

  test('Adar I named in a plain year is sent to review', () => {
    const result = parseDueDateText('ד׳ אדר א׳ תשפ״ו');
    expect(result).toMatchObject({
      outcome: 'needs_review',
      reason: 'adar_in_non_leap_year',
    });
  });

  test('Adar I named in a leap year is a real date', () => {
    const result = parseDueDateText('ד׳ אדר א׳ תשפ״ז');
    expect(result.outcome).toBe('resolved');
    if (result.outcome !== 'resolved') return;
    expect(result.hebrew).toEqual({ day: 4, month: ADAR_I, year: 5787 });
  });

  test('a day the month does not have that year is sent to review', () => {
    // Kislev has 29 days in 5784; ל׳ is the 30th.
    const result = parseDueDateText('ל׳ כסלו תשפ״ד');
    expect(result).toMatchObject({ outcome: 'needs_review', reason: 'day_not_in_month' });
  });

  test('a month name with no readable day or year is sent to review', () => {
    const result = parseDueDateText('בחודש טבת');
    expect(result).toMatchObject({ outcome: 'needs_review', reason: 'unreadable_date' });
  });
});

describe('parseDueDateText — cells that hold no date', () => {
  test('an empty cell is not a date and not an error', () => {
    expect(parseDueDateText('')).toMatchObject({ outcome: 'no_date', note: null });
  });

  test('a cell of only whitespace is not a date', () => {
    expect(parseDueDateText('   ')).toMatchObject({ outcome: 'no_date', note: null });
  });

  test('a note with no date is kept as a note', () => {
    const result = parseDueDateText('לשלם כשאפשר');
    expect(result.outcome).toBe('no_date');
    expect(result.note).toBe('לשלם כשאפשר');
  });

  /*
   * The words a debt file is full of. A loose month matcher turns each of these
   * into a date; every one of them must come back as plain text.
   */
  test.each([['חוב ישן'], ['תשלום ראשון'], ['הלוואה מהבנק'], ['לתשלום בהקדם']])(
    '"%s" is a note, not a date',
    (text) => {
      const result = parseDueDateText(text);
      expect(result.outcome).toBe('no_date');
      expect(result.note).toBe(text);
    },
  );
});
