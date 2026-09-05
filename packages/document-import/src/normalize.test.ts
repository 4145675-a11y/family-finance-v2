import { describe, expect, test } from 'vitest';

import {
  cleanDescription,
  inferDateOrder,
  parseAmount,
  parseDate,
  parseDateCandidate,
  resolveDate,
} from './normalize';

/**
 * These are the tests that stop a wrong number reaching the engine.
 *
 * A parser that is 99% right about money is not 99% useful; it is a source of
 * figures nobody can trust. So the cases below are the exact shapes real Israeli
 * statements use, including the ones that look like typos and are not.
 */

describe('money arrives as exact minor units', () => {
  test.each([
    ['1,234.56', 123_456],
    ['1234.56', 123_456],
    ['1.234,56', 123_456],
    ['1 234,56', 123_456],
    ['₪1,234.56', 123_456],
    ['1,234.56 ₪', 123_456],
    ['1,234.56 ש"ח', 123_456],
    ['150', 15_000],
    ['0.05', 5],
    ['0,5', 50],
    ['3,500', 350_000],
    ['12,345,678.90', 1_234_567_890],
  ])('%s is %i minor units', (text, expected) => {
    expect(parseAmount(text)?.amountMinor).toBe(expected);
  });

  test('no float ever touches the conversion', () => {
    // 1234.56 * 100 is 123456.00000000001 in binary floating point. If the parser
    // multiplied, this assertion would fail on the integer check.
    const parsed = parseAmount('1234.56');
    expect(Number.isInteger(parsed?.amountMinor)).toBe(true);
    expect(parsed?.amountMinor).toBe(123_456);
  });

  test('a long run of awkward values all stay integral', () => {
    for (let agorot = 0; agorot < 500; agorot += 1) {
      const text = `${Math.floor(agorot / 100)}.${String(agorot % 100).padStart(2, '0')}`;
      expect(parseAmount(text)?.amountMinor).toBe(agorot);
    }
  });

  test.each([
    ['-1,234.00', 123_400],
    ['−1,234.00', 123_400],
    ['(1,234.00)', 123_400],
    ['1,234.00-', 123_400],
  ])('%s is negative', (text, expected) => {
    const parsed = parseAmount(text);
    expect(parsed?.negative).toBe(true);
    expect(parsed?.amountMinor).toBe(expected);
  });

  test('a positive figure is not marked negative', () => {
    expect(parseAmount('1,234.00')?.negative).toBe(false);
    expect(parseAmount('+1,234.00')?.negative).toBe(false);
  });

  test('more precision than agorot is rounded half up and reported', () => {
    expect(parseAmount('1,234.5650')).toMatchObject({ amountMinor: 123_457, rounded: true });
    expect(parseAmount('1,234.5640')).toMatchObject({ amountMinor: 123_456, rounded: true });
  });

  test('a single dot before three digits is grouping, and says it is unsure', () => {
    const parsed = parseAmount('1.500');
    expect(parsed?.amountMinor).toBe(150_000);
    expect(parsed?.ambiguousSeparator).toBe(true);
  });

  test('a leading zero settles it: 0.005 is five agorot rounded, not five shekels', () => {
    expect(parseAmount('0.005')).toMatchObject({ amountMinor: 1, rounded: true });
    expect(parseAmount('0.004')).toMatchObject({ amountMinor: 0, rounded: true });
  });

  test('a comma before three digits is thousands and is not flagged', () => {
    const parsed = parseAmount('1,500');
    expect(parsed?.amountMinor).toBe(150_000);
    expect(parsed?.ambiguousSeparator).toBe(false);
  });

  test.each(['', '   ', 'תיאור', 'סה"כ', '-', 'n/a', '₪'])('%s is not a number', (text) => {
    expect(parseAmount(text)).toBeNull();
  });

  test('an implausibly large figure is refused rather than truncated', () => {
    expect(parseAmount('99,999,999,999,999,999.00')).toBeNull();
  });
});

describe('dates are read from the column, not from one value', () => {
  test('an unambiguous day settles the whole column', () => {
    const decision = inferDateOrder(['03/04/2026', '15/04/2026', '02/05/2026']);
    expect(decision).toEqual({ order: 'day_first', certain: true });
    expect(resolveDate(parseDateCandidate('03/04/2026')!, decision.order)).toBe('2026-04-03');
  });

  test('an American column is detected too', () => {
    const decision = inferDateOrder(['04/03/2026', '04/15/2026']);
    expect(decision).toEqual({ order: 'month_first', certain: true });
    expect(resolveDate(parseDateCandidate('04/03/2026')!, decision.order)).toBe('2026-04-03');
  });

  test('a column that cannot be settled says so', () => {
    expect(inferDateOrder(['03/04/2026', '05/06/2026'])).toEqual({
      order: 'day_first',
      certain: false,
    });
  });

  test.each([
    ['2026-09-03', '2026-09-03'],
    ['03.09.2026', '2026-09-03'],
    ['3/9/26', '2026-09-03'],
    ['15 באוגוסט 2026', '2026-08-15'],
    ['15 Aug 2026', '2026-08-15'],
  ])('%s reads as %s', (text, expected) => {
    expect(parseDate(text)).toBe(expected);
  });

  test('an impossible date is rejected rather than shifted', () => {
    expect(parseDate('31/02/2026')).toBeNull();
    expect(parseDate('32/01/2026')).toBeNull();
  });

  test('two-digit years land in the right century', () => {
    expect(parseDate('01/01/26')).toBe('2026-01-01');
    expect(parseDate('01/01/98')).toBe('1998-01-01');
  });

  test('a value that is not a date at all returns nothing', () => {
    expect(parseDateCandidate('סופרמרקט')).toBeNull();
    expect(parseDateCandidate('')).toBeNull();
  });
});

describe('descriptions are cleaned without being rewritten', () => {
  test('direction marks and repeated spaces go, letters stay', () => {
    expect(cleanDescription('  סופר   מרקט  ')).toBe('סופר מרקט');
  });

  test('a very long description is bounded', () => {
    expect(cleanDescription('א'.repeat(500))).toHaveLength(300);
  });
});
