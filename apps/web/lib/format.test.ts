import { describe, expect, test } from 'vitest';

import {
  CONFIDENCE_LABEL,
  MODE_LABEL,
  STATUS_LABEL,
  formatBasisPoints,
  formatBusinessDate,
  formatFreshness,
  formatMoney,
  formatSignedMoney,
} from './format';

describe('formatMoney', () => {
  test('renders minor units as shekels and agorot', () => {
    expect(formatMoney(123_45)).toContain('123.45');
  });

  test('always shows two fraction digits, so a round figure is not ambiguous', () => {
    expect(formatMoney(100_00)).toContain('100.00');
  });

  test('includes the currency', () => {
    expect(formatMoney(100_00)).toContain('₪');
  });

  test('does not round: every agora survives', () => {
    expect(formatMoney(1)).toContain('0.01');
    expect(formatMoney(999_99)).toContain('999.99');
  });

  test('handles large household figures', () => {
    expect(formatMoney(139_500_000)).toContain('1,395,000.00');
  });

  test('refuses a non-finite amount rather than printing nonsense', () => {
    expect(() => formatMoney(Number.NaN)).toThrow();
  });
});

describe('formatSignedMoney', () => {
  test('a fall carries a minus sign', () => {
    expect(formatSignedMoney(-100_00).startsWith('−')).toBe(true);
  });

  test('a rise carries a plus sign', () => {
    expect(formatSignedMoney(100_00).startsWith('+')).toBe(true);
  });

  test('no change carries neither', () => {
    const formatted = formatSignedMoney(0);
    expect(formatted.startsWith('+')).toBe(false);
    expect(formatted.startsWith('−')).toBe(false);
  });

  test('the magnitude is formatted the same way as any other amount', () => {
    expect(formatSignedMoney(-1_234_56)).toContain('1,234.56');
  });
});

describe('formatBasisPoints', () => {
  test('1250 basis points is 12.5%', () => {
    expect(formatBasisPoints(1_250)).toContain('12.5');
  });

  test('zero is a real rate and renders as such', () => {
    expect(formatBasisPoints(0)).toContain('0');
  });
});

describe('formatBusinessDate', () => {
  test('renders a Hebrew day and month', () => {
    expect(formatBusinessDate('2026-08-15')).toContain('15');
    expect(formatBusinessDate('2026-08-15')).toContain('אוגוסט');
  });

  test('does not shift the day across a time zone', () => {
    expect(formatBusinessDate('2026-01-01')).toContain('1');
    expect(formatBusinessDate('2026-12-31')).toContain('31');
  });

  test('rejects something that is not a business date', () => {
    expect(() => formatBusinessDate('nonsense')).toThrow();
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
