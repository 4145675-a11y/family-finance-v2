import { describe, expect, test } from 'vitest';

import { daysInHebrewMonth, hebrewToGregorian, isHebrewLeapYear } from './calendar';
import { annualRuleFrom, resolveAnnualHebrewDate } from './recurrence';

const KISLEV = 9;
const TEVET = 10;
const ADAR_I = 12;
const ADAR_II = 13;

describe('an annual Hebrew due date in an ordinary year', () => {
  test('lands on the same Hebrew day and a different civil day each year', () => {
    const rule = annualRuleFrom({ day: 7, month: TEVET, year: 5787 });

    const first = resolveAnnualHebrewDate(rule, 5787);
    const second = resolveAnnualHebrewDate(rule, 5788);
    expect(first.outcome).toBe('resolved');
    expect(second.outcome).toBe('resolved');
    if (first.outcome !== 'resolved' || second.outcome !== 'resolved') return;

    expect(first.hebrew).toEqual({ day: 7, month: TEVET, year: 5787 });
    expect(second.hebrew).toEqual({ day: 7, month: TEVET, year: 5788 });
    expect(first.gregorian).toBe('2026-12-17');
    // The same Hebrew day, a different civil day: that is the point of the rule.
    expect(second.gregorian).not.toBe(first.gregorian);
    expect(second.gregorian).toBe(hebrewToGregorian(second.hebrew));
  });

  test('a rule keeps only the day and the month, not the year it came from', () => {
    expect(annualRuleFrom({ day: 7, month: TEVET, year: 5787 })).toEqual({
      day: 7,
      month: TEVET,
    });
  });
});

describe('Adar, which is not the same month every year', () => {
  test('a rule made in a plain year asks which Adar when the year has two', () => {
    expect(isHebrewLeapYear(5786)).toBe(false);
    expect(isHebrewLeapYear(5787)).toBe(true);
    const rule = annualRuleFrom({ day: 4, month: ADAR_I, year: 5786 });

    const result = resolveAnnualHebrewDate(rule, 5787);
    expect(result.outcome).toBe('needs_choice');
    if (result.outcome !== 'needs_choice') return;
    expect(result.ambiguity).toBe('adar_splits_in_leap_year');
    expect(result.options.map((o) => o.choice)).toEqual(['adar_i', 'adar_ii']);
    // Both options are real dates the household can compare before deciding.
    expect(result.options[0]?.hebrew.month).toBe(ADAR_I);
    expect(result.options[1]?.hebrew.month).toBe(ADAR_II);
    expect(result.options[0]?.gregorian).not.toBe(result.options[1]?.gregorian);
  });

  test('once the household has chosen, the same question is not asked again', () => {
    const rule = annualRuleFrom({ day: 4, month: ADAR_I, year: 5786 });

    const first = resolveAnnualHebrewDate(rule, 5787, { adar: 'adar_i' });
    const second = resolveAnnualHebrewDate(rule, 5787, { adar: 'adar_ii' });
    expect(first.outcome).toBe('resolved');
    expect(second.outcome).toBe('resolved');
    if (first.outcome !== 'resolved' || second.outcome !== 'resolved') return;
    expect(first.hebrew.month).toBe(ADAR_I);
    expect(second.hebrew.month).toBe(ADAR_II);
    expect(first.gregorian).not.toBe(second.gregorian);
  });

  test('an Adar II rule is confirmed before it moves into a single Adar', () => {
    const rule = annualRuleFrom({ day: 4, month: ADAR_II, year: 5787 });

    const result = resolveAnnualHebrewDate(rule, 5786);
    expect(result.outcome).toBe('needs_choice');
    if (result.outcome !== 'needs_choice') return;
    expect(result.ambiguity).toBe('adar_merges_in_plain_year');
    expect(result.options[0]?.hebrew.month).toBe(ADAR_I);
  });

  test('an Adar rule in another plain year needs no question', () => {
    const rule = annualRuleFrom({ day: 4, month: ADAR_I, year: 5786 });
    const result = resolveAnnualHebrewDate(rule, 5788);
    expect(isHebrewLeapYear(5788)).toBe(false);
    expect(result.outcome).toBe('resolved');
    if (result.outcome !== 'resolved') return;
    expect(result.hebrew).toEqual({ day: 4, month: ADAR_I, year: 5788 });
  });
});

describe('a day the year does not contain', () => {
  test('a rule on the thirtieth asks what to do when the month is short', () => {
    expect(daysInHebrewMonth(KISLEV, 5786)).toBe(30);
    expect(daysInHebrewMonth(KISLEV, 5784)).toBe(29);
    const rule = annualRuleFrom({ day: 30, month: KISLEV, year: 5786 });

    const result = resolveAnnualHebrewDate(rule, 5784);
    expect(result.outcome).toBe('needs_choice');
    if (result.outcome !== 'needs_choice') return;
    expect(result.ambiguity).toBe('day_missing_in_year');
    expect(result.options.map((o) => o.choice)).toEqual([
      'last_day_of_month',
      'first_day_of_next_month',
    ]);
  });

  test('the last day of the month is one answer', () => {
    const rule = annualRuleFrom({ day: 30, month: KISLEV, year: 5786 });
    const result = resolveAnnualHebrewDate(rule, 5784, { missingDay: 'last_day_of_month' });
    expect(result.outcome).toBe('resolved');
    if (result.outcome !== 'resolved') return;
    expect(result.hebrew).toEqual({ day: 29, month: KISLEV, year: 5784 });
  });

  test('the first of the next month is the other', () => {
    const rule = annualRuleFrom({ day: 30, month: KISLEV, year: 5786 });
    const result = resolveAnnualHebrewDate(rule, 5784, {
      missingDay: 'first_day_of_next_month',
    });
    expect(result.outcome).toBe('resolved');
    if (result.outcome !== 'resolved') return;
    expect(result.hebrew).toEqual({ day: 1, month: TEVET, year: 5784 });
  });

  test('a year where the month is long needs no question at all', () => {
    const rule = annualRuleFrom({ day: 30, month: KISLEV, year: 5786 });
    const result = resolveAnnualHebrewDate(rule, 5787);
    expect(daysInHebrewMonth(KISLEV, 5787)).toBe(30);
    expect(result.outcome).toBe('resolved');
    if (result.outcome !== 'resolved') return;
    expect(result.hebrew).toEqual({ day: 30, month: KISLEV, year: 5787 });
  });
});

describe('every resolved occurrence is a real date', () => {
  test('ten consecutive years of a Tevet rule all convert', () => {
    const rule = annualRuleFrom({ day: 7, month: TEVET, year: 5787 });
    const seen = new Set<string>();
    for (let year = 5785; year < 5795; year += 1) {
      const result = resolveAnnualHebrewDate(rule, year);
      expect(result.outcome).toBe('resolved');
      if (result.outcome !== 'resolved') continue;
      // Converting the answer independently proves it is a day that exists.
      expect(hebrewToGregorian(result.hebrew)).toBe(result.gregorian);
      seen.add(result.gregorian);
    }
    expect(seen.size).toBe(10);
  });
});
