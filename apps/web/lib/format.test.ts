import { describe, expect, test } from 'vitest';

import {
  CONFIDENCE_LABEL,
  MODE_LABEL,
  STATUS_LABEL,
  count,
  formatBasisPoints,
  formatBusinessDate,
  formatFreshness,
  formatMoney,
  formatSignedMoney,
  formatWeekday,
  isolate,
  money,
} from './format';

/**
 * The canonical money string.
 *
 * These are the tests that fix what the running product looked like: every figure
 * carried two zeros it did not need, and the Hebrew locale's own currency
 * formatter injected directional marks that rendered as "‏427,500.00 ‏₪".
 */

/** The formatter separates the amount from the symbol with a non-breaking space. */
const NBSP = ' ';

describe('formatMoney — whole amounts carry no agorot', () => {
  test.each([
    [42_750_000, `427,500${NBSP}₪`],
    [350_000, `3,500${NBSP}₪`],
    [15_000, `150${NBSP}₪`],
    [100, `1${NBSP}₪`],
    [0, `0${NBSP}₪`],
  ])('%i minor units renders as %s', (minor, expected) => {
    expect(formatMoney(minor)).toBe(expected);
  });

  test('agorot appear only when they carry information', () => {
    expect(formatMoney(123_456)).toBe(`1,234.56${NBSP}₪`);
    expect(formatMoney(1)).toBe(`0.01${NBSP}₪`);
    expect(formatMoney(150)).toBe(`1.50${NBSP}₪`);
  });

  test('a whole thousand does not gain a decimal point', () => {
    expect(formatMoney(100_000)).not.toContain('.');
  });
});

describe('formatMoney — the string is clean', () => {
  test('carries no right-to-left or left-to-right marks', () => {
    // The `he-IL` currency formatter adds U+200F and U+200E around the number and
    // the symbol. Inside a `<bdi dir="ltr">` those are noise, and they rendered
    // visibly on screen.
    const formatted = formatMoney(42_750_000);
    expect(formatted).not.toContain('‏');
    expect(formatted).not.toContain('‎');
  });

  test('separates the amount from the symbol with a non-breaking space', () => {
    expect(formatMoney(350_000)).toContain(' ₪');
    expect(formatMoney(350_000)).not.toContain(' ₪');
  });

  test('groups thousands', () => {
    expect(formatMoney(100_000_000)).toBe(`1,000,000${NBSP}₪`);
  });

  test('names a currency it has no symbol for rather than dropping it', () => {
    expect(formatMoney(350_000, 'GBP')).toBe('3,500 GBP');
  });

  test('knows the currencies the product actually uses', () => {
    expect(formatMoney(100, 'USD')).toContain('$');
    expect(formatMoney(100, 'EUR')).toContain('€');
  });
});

describe('formatMoney — negatives', () => {
  test('uses a real minus sign, not a hyphen', () => {
    expect(formatMoney(-2_213_000)).toBe(`−22,130${NBSP}₪`);
    expect(formatMoney(-2_213_000)).not.toContain('-');
  });

  test('the minus leads the number', () => {
    expect(formatMoney(-15_000).startsWith('−')).toBe(true);
  });

  test('negative agorot still render', () => {
    expect(formatMoney(-123_456)).toBe(`−1,234.56${NBSP}₪`);
  });

  test('negative zero is just zero', () => {
    expect(formatMoney(-0)).toBe(`0${NBSP}₪`);
  });
});

describe('formatMoney — refuses anything that is not integer minor units', () => {
  test('rejects a float, because a float on a screen means a float upstream', () => {
    expect(() => formatMoney(12.5)).toThrow();
  });

  test('rejects a non-finite amount', () => {
    expect(() => formatMoney(Number.NaN)).toThrow();
    expect(() => formatMoney(Number.POSITIVE_INFINITY)).toThrow();
  });
});

describe('formatSignedMoney', () => {
  test('a fall carries a minus', () => {
    expect(formatSignedMoney(-15_000)).toBe(`−150${NBSP}₪`);
  });

  test('a rise carries a plus', () => {
    expect(formatSignedMoney(15_000)).toBe(`+150${NBSP}₪`);
  });

  test('no change carries neither', () => {
    expect(formatSignedMoney(0)).toBe(`0${NBSP}₪`);
  });

  test('the magnitude is formatted the same way as any other amount', () => {
    expect(formatSignedMoney(-42_750_000)).toContain('427,500');
    expect(formatSignedMoney(-42_750_000)).not.toContain('.00');
  });
});

describe('bidi isolation', () => {
  test('isolate wraps a run in first-strong and pop marks', () => {
    expect(isolate('x')).toBe('⁨x⁩');
  });

  test('money inside a sentence is isolated', () => {
    const inside = money(350_000);
    expect(inside.startsWith('⁨')).toBe(true);
    expect(inside.endsWith('⁩')).toBe(true);
    expect(inside).toContain('3,500');
  });

  test('a count inside a sentence is isolated and grouped', () => {
    expect(count(1_234)).toBe('⁨1,234⁩');
  });

  test('the isolate wraps the whole run, symbol included', () => {
    const inside = money(-15_000);
    const inner = inside.slice(1, -1);
    expect(inner).toBe(`−150${NBSP}₪`);
  });
});

describe('formatBasisPoints', () => {
  test('a whole percentage carries no decimal', () => {
    expect(formatBasisPoints(1_600)).toBe('16%');
  });

  test('a fractional one carries a single digit', () => {
    expect(formatBasisPoints(1_250)).toBe('12.5%');
  });

  test('zero is a real rate and renders as such', () => {
    expect(formatBasisPoints(0)).toBe('0%');
  });
});

describe('dates', () => {
  test('a business date renders as a Hebrew day and month', () => {
    expect(formatBusinessDate('2026-08-15')).toContain('15');
    expect(formatBusinessDate('2026-08-15')).toContain('אוגוסט');
  });

  test('the day does not shift across a time zone', () => {
    expect(formatBusinessDate('2026-01-01')).toContain('1');
    expect(formatBusinessDate('2026-12-31')).toContain('31');
  });

  test('a weekday already includes the word "יום"', () => {
    // A caller that prefixes its own produced "עד יום יום שבת" on a live screen.
    expect(formatWeekday('2026-08-15')).toBe('יום שבת');
  });

  test('both reject something that is not a date', () => {
    expect(() => formatBusinessDate('nonsense')).toThrow();
    expect(() => formatWeekday('nonsense')).toThrow();
  });
});

describe('formatFreshness', () => {
  test('never verified is said plainly, not as "0 days"', () => {
    expect(formatFreshness(null)).toBe('לא אומת מעולם');
  });

  test('today and yesterday read naturally', () => {
    expect(formatFreshness(0)).toBe('עודכן היום');
    expect(formatFreshness(1)).toBe('עודכן אתמול');
  });

  test('older ages count the days', () => {
    expect(formatFreshness(6)).toContain('6');
  });
});

describe('labels', () => {
  test('every operating mode has a Hebrew label', () => {
    for (const mode of [
      'emergency',
      'stabilization',
      'stop_new_debt',
      'repayment',
      'buffer_building',
      'growth',
    ]) {
      expect(MODE_LABEL[mode]).toBeTruthy();
    }
  });

  test('every decision status has a Hebrew label', () => {
    for (const status of ['safe', 'conditional', 'not_safe', 'insufficient_data']) {
      expect(STATUS_LABEL[status]).toBeTruthy();
    }
  });

  test('every confidence level has a Hebrew label', () => {
    for (const level of ['low', 'medium', 'high'] as const) {
      expect(CONFIDENCE_LABEL[level]).toBeTruthy();
    }
  });
});
