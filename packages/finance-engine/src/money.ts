import type { Direction } from '@family-finance/contracts';

/**
 * Money arithmetic for the engine.
 *
 * Stored money is a non-negative integer plus a direction (FIN-MONEY-001). That
 * is the right shape for a record — it cannot express "minus five hundred" by
 * accident — but it is the wrong shape for arithmetic, because adding an inflow
 * to an outflow needs a sign somewhere.
 *
 * The resolution used throughout this package: a *signed* integer exists only
 * inside a calculation, produced by `toSigned` and consumed by `toDirected` on
 * the way out. No stored value and no result field is ever a signed amount, and
 * a negative result is surfaced as its own named field (a funding gap, a
 * shortfall) rather than as a minus sign in front of a positive concept.
 */

/** A stored amount: never negative, meaning carried by the direction. */
export interface DirectedAmount {
  readonly amountMinor: number;
  readonly direction: Direction;
}

/** Signed minor units, valid only inside a calculation. */
export type SignedMinor = number;

export class MoneyError extends Error {}

/** Guards the assumption every other function here relies on. */
export function assertStoredAmount(amountMinor: number, label = 'amount'): number {
  if (!Number.isInteger(amountMinor)) {
    throw new MoneyError(
      `${label} must be an integer number of minor units, got ${amountMinor}`,
    );
  }
  if (amountMinor < 0) {
    throw new MoneyError(`${label} must not be negative; direction carries the meaning`);
  }
  return amountMinor;
}

export function assertSigned(value: SignedMinor, label = 'value'): SignedMinor {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} must stay an exact integer, got ${value}`);
  }
  return value;
}

/**
 * Normalises negative zero away.
 *
 * `-0` passes every check a stored amount has to pass — it is an integer and it
 * is not less than zero — so it can travel all the way into a record and a hash
 * while comparing unequal to `0` under `Object.is`. Negating zero is the one
 * place it appears, so it is removed at that point rather than defended against
 * everywhere afterwards.
 */
function normaliseZero(value: number): number {
  return value === 0 ? 0 : value;
}

/** Inflow is positive, outflow is negative. The only place a sign is introduced. */
export function toSigned(amount: DirectedAmount): SignedMinor {
  assertStoredAmount(amount.amountMinor);
  return normaliseZero(
    amount.direction === 'inflow' ? amount.amountMinor : -amount.amountMinor,
  );
}

/** The inverse: a signed working value becomes a storable amount plus direction. */
export function toDirected(value: SignedMinor): DirectedAmount {
  assertSigned(value);
  return value < 0
    ? { amountMinor: normaliseZero(-value), direction: 'outflow' }
    : { amountMinor: normaliseZero(value), direction: 'inflow' };
}

export function sumSigned(values: readonly SignedMinor[]): SignedMinor {
  let total = 0;
  for (const value of values) total = assertSigned(total + assertSigned(value));
  return total;
}

export function sumAmounts(amounts: readonly DirectedAmount[]): SignedMinor {
  return sumSigned(amounts.map(toSigned));
}

/**
 * The `max(0, …)` that appears throughout 02-FINANCIAL-RULES.md.
 *
 * Returned as a pair so the caller cannot lose the negative half: the formula for
 * safe spend clamps at zero, but the shortfall it clamped away is exactly the
 * funding gap the user has to be told about.
 */
export function clampAtZero(value: SignedMinor): {
  readonly resultMinor: number;
  readonly shortfallMinor: number;
} {
  assertSigned(value);
  return value >= 0
    ? { resultMinor: value, shortfallMinor: 0 }
    : { resultMinor: 0, shortfallMinor: -value };
}

/**
 * Half-up rounding to the minor unit, as required by § מוסכמות.
 *
 * "Half up" here means away from zero at exactly .5, which is what a person
 * checking the arithmetic by hand expects: 2.5 → 3 and -2.5 → -3. JavaScript's
 * Math.round does not do this — it rounds -2.5 to -2 — so it is not used.
 */
export function roundHalfUp(value: number): number {
  if (!Number.isFinite(value)) {
    throw new MoneyError(`cannot round a non-finite value: ${value}`);
  }
  const rounded = value < 0 ? -Math.round(-value) : Math.round(value);
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * Applies a basis-point rate to an amount, rounding once at the end.
 *
 * Rates are stored in basis points so no fraction is ever persisted. The division
 * happens in floating point and the result is rounded immediately, which keeps
 * the "no accumulating intermediate rounding" rule: callers combine rounded minor
 * units, never partial fractions.
 */
export function applyBasisPoints(amountMinor: number, rateBp: number): number {
  assertStoredAmount(amountMinor);
  if (!Number.isInteger(rateBp) || rateBp < 0) {
    throw new MoneyError(`rate must be a non-negative integer in basis points, got ${rateBp}`);
  }
  return roundHalfUp((amountMinor * rateBp) / 10_000);
}

/** Smallest of a set, used where a formula takes `min(...)`. */
export function minSigned(values: readonly SignedMinor[]): SignedMinor {
  if (values.length === 0) throw new MoneyError('min of an empty set is undefined');
  return values.reduce((lowest, value) => (assertSigned(value) < lowest ? value : lowest));
}

/** Largest of a set, used where a formula takes `max(...)`. */
export function maxSigned(values: readonly SignedMinor[]): SignedMinor {
  if (values.length === 0) throw new MoneyError('max of an empty set is undefined');
  return values.reduce((highest, value) => (assertSigned(value) > highest ? value : highest));
}
