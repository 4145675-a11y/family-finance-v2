import { describe, expect, test } from 'vitest';

import {
  MoneyError,
  applyBasisPoints,
  clampAtZero,
  maxSigned,
  minSigned,
  roundHalfUp,
  sumAmounts,
  toDirected,
  toSigned,
} from './money';

describe('directed and signed amounts', () => {
  test('an inflow is positive and an outflow is negative', () => {
    expect(toSigned({ amountMinor: 500, direction: 'inflow' })).toBe(500);
    expect(toSigned({ amountMinor: 500, direction: 'outflow' })).toBe(-500);
  });

  test('converting back never produces a negative stored amount', () => {
    expect(toDirected(-500)).toEqual({ amountMinor: 500, direction: 'outflow' });
    expect(toDirected(500)).toEqual({ amountMinor: 500, direction: 'inflow' });
  });

  test('zero is stored as an inflow of zero, not as negative zero', () => {
    const zero = toDirected(0);
    expect(zero.amountMinor).toBe(0);
    expect(Object.is(zero.amountMinor, -0)).toBe(false);
  });

  test('an outflow of zero does not become negative zero on the way through', () => {
    // Found by the property suite: negating zero produced -0, which passes every
    // check a stored amount has to pass yet compares unequal to 0 under Object.is,
    // so it could reach a record and an input hash.
    const signed = toSigned({ amountMinor: 0, direction: 'outflow' });
    expect(Object.is(signed, -0)).toBe(false);
    expect(Object.is(toDirected(signed).amountMinor, -0)).toBe(false);
  });

  test('a negative stored amount is rejected at the boundary', () => {
    expect(() => toSigned({ amountMinor: -1, direction: 'inflow' })).toThrow(MoneyError);
  });

  test('a fractional stored amount is rejected', () => {
    expect(() => toSigned({ amountMinor: 10.5, direction: 'inflow' })).toThrow(MoneyError);
  });

  test('mixed directions sum to their net', () => {
    expect(
      sumAmounts([
        { amountMinor: 1_000, direction: 'inflow' },
        { amountMinor: 250, direction: 'outflow' },
        { amountMinor: 250, direction: 'outflow' },
      ]),
    ).toBe(500);
  });
});

describe('clampAtZero', () => {
  test('a positive value passes through with no shortfall', () => {
    expect(clampAtZero(1_200)).toEqual({ resultMinor: 1_200, shortfallMinor: 0 });
  });

  test('a negative value becomes zero and keeps the shortfall', () => {
    expect(clampAtZero(-1_200)).toEqual({ resultMinor: 0, shortfallMinor: 1_200 });
  });

  test('the shortfall is never lost, which is the point of returning a pair', () => {
    const { resultMinor, shortfallMinor } = clampAtZero(-7);
    expect(resultMinor).toBe(0);
    expect(shortfallMinor).toBeGreaterThan(0);
  });
});

describe('roundHalfUp', () => {
  test('rounds a half away from zero in both directions', () => {
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundHalfUp(-2.5)).toBe(-3);
  });

  test('differs from Math.round on negative halves, which is why it exists', () => {
    expect(Math.round(-2.5)).toBe(-2);
    expect(roundHalfUp(-2.5)).toBe(-3);
  });

  test('leaves whole numbers alone', () => {
    expect(roundHalfUp(4)).toBe(4);
    expect(roundHalfUp(-4)).toBe(-4);
  });

  test('never returns negative zero', () => {
    expect(Object.is(roundHalfUp(-0.4), -0)).toBe(false);
    expect(roundHalfUp(-0.4)).toBe(0);
  });

  test('refuses a non-finite value rather than producing a number', () => {
    expect(() => roundHalfUp(Number.NaN)).toThrow(MoneyError);
    expect(() => roundHalfUp(Number.POSITIVE_INFINITY)).toThrow(MoneyError);
  });
});

describe('applyBasisPoints', () => {
  test('25% of 1,000.00 is 250.00', () => {
    expect(applyBasisPoints(100_000, 2_500)).toBe(25_000);
  });

  test('rounds once, half up, at the end', () => {
    // 1 minor unit at 50% is exactly 0.5, which rounds up to 1.
    expect(applyBasisPoints(1, 5_000)).toBe(1);
    expect(applyBasisPoints(3, 5_000)).toBe(2);
  });

  test('a zero rate contributes nothing', () => {
    expect(applyBasisPoints(999_999, 0)).toBe(0);
  });

  test('a negative rate is rejected rather than quietly inverted', () => {
    expect(() => applyBasisPoints(100, -100)).toThrow(MoneyError);
  });
});

describe('min and max', () => {
  test('pick the extremes including negatives', () => {
    expect(minSigned([5, -3, 10])).toBe(-3);
    expect(maxSigned([5, -3, 10])).toBe(10);
  });

  test('refuse an empty set instead of inventing an answer', () => {
    expect(() => minSigned([])).toThrow(MoneyError);
    expect(() => maxSigned([])).toThrow(MoneyError);
  });
});
