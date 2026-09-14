import { describe, expect, test } from 'vitest';

import {
  MAX_AMOUNT_MINOR,
  amountMinorSchema,
  businessDateSchema,
  currencySchema,
  moneySchema,
  recordScopeSchema,
  viewScopeSchema,
} from './money';

describe('amountMinorSchema — FIN-MONEY-001', () => {
  test('accepts zero and whole minor units', () => {
    expect(amountMinorSchema.parse(0)).toBe(0);
    expect(amountMinorSchema.parse(123_45)).toBe(12_345);
  });

  test('rejects a negative amount, because direction carries the sign', () => {
    const result = amountMinorSchema.safeParse(-1);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain('direction');
  });

  test('rejects a fractional amount, because agorot are the smallest unit', () => {
    expect(amountMinorSchema.safeParse(10.5).success).toBe(false);
  });

  test('rejects an amount beyond the safe-integer working range', () => {
    expect(amountMinorSchema.safeParse(MAX_AMOUNT_MINOR + 1).success).toBe(false);
  });

  test('the ceiling stays inside exact integer arithmetic', () => {
    // Summing a household's rows must not silently lose precision, so the ceiling
    // has to leave room below Number.MAX_SAFE_INTEGER for aggregation.
    expect(MAX_AMOUNT_MINOR * 8).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });
});

describe('currencySchema', () => {
  test('accepts an uppercase ISO-4217 code', () => {
    expect(currencySchema.parse('ILS')).toBe('ILS');
  });

  test('rejects lowercase, so one currency cannot be stored under two spellings', () => {
    expect(currencySchema.safeParse('ils').success).toBe(false);
  });

  test('rejects a symbol', () => {
    expect(currencySchema.safeParse('₪').success).toBe(false);
  });
});

describe('moneySchema', () => {
  test('an amount is meaningless without its currency', () => {
    expect(moneySchema.safeParse({ amountMinor: 100 }).success).toBe(false);
  });

  test('a valid pair parses', () => {
    expect(moneySchema.parse({ amountMinor: 100, currency: 'ILS' })).toEqual({
      amountMinor: 100,
      currency: 'ILS',
    });
  });
});

describe('businessDateSchema', () => {
  test('accepts a calendar date with no time component', () => {
    expect(businessDateSchema.parse('2026-08-22')).toBe('2026-08-22');
  });

  test('rejects an instant, so a due date cannot drift across a time zone', () => {
    expect(businessDateSchema.safeParse('2026-08-22T00:00:00Z').success).toBe(false);
  });

  test('rejects a day that does not exist', () => {
    expect(businessDateSchema.safeParse('2026-02-30').success).toBe(false);
  });
});

describe('scopes', () => {
  test('a stored row is household or business, never consolidated', () => {
    expect(recordScopeSchema.safeParse('consolidated').success).toBe(false);
  });

  test('the view scope adds consolidated, which is derived rather than stored', () => {
    expect(viewScopeSchema.parse('consolidated')).toBe('consolidated');
  });
});
