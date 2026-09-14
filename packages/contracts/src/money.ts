import { z } from 'zod';

/**
 * Money and time conventions — the primitives every financial contract is built from.
 *
 * 02-FINANCIAL-RULES.md § מוסכמות is the authority for all of it:
 *
 *  - `FIN-MONEY-001`: an amount is a non-negative integer in minor units. Meaning
 *    comes from an explicit direction or kind, never from a sign. A signed amount
 *    alongside a direction gives two sources of truth that can disagree.
 *  - Currency is stored explicitly; ILS is only the default.
 *  - Instants are stored UTC. Calendar dates are business dates in Asia/Jerusalem
 *    and carry no time at all, so a payment due "on the 3rd" cannot drift a day
 *    because of a time zone.
 *  - The five date roles stay separate: transaction, posting, value, due, expected.
 */

/** ISO-4217 alphabetic code. Uppercase only, so `ils` and `ILS` cannot both exist. */
export const currencySchema = z
  .string()
  .length(3)
  .regex(/^[A-Z]{3}$/, 'currency must be an uppercase ISO-4217 code');
export type Currency = z.infer<typeof currencySchema>;

export const DEFAULT_CURRENCY = 'ILS';

/**
 * An amount in minor units (agorot for ILS).
 *
 * Non-negative and integral, with an upper bound below `Number.MAX_SAFE_INTEGER`
 * so that a sum of many rows cannot silently leave exact-integer range. The bound
 * is 10^15 minor units — ten trillion shekels — which no household reaches and no
 * legitimate input approaches.
 */
export const MAX_AMOUNT_MINOR = 1_000_000_000_000_000;

export const amountMinorSchema = z
  .number()
  .int('amount must be an integer number of minor units')
  .nonnegative('amount must not be negative; direction carries the meaning')
  .max(MAX_AMOUNT_MINOR);
export type AmountMinor = z.infer<typeof amountMinorSchema>;

export const moneySchema = z.object({
  amountMinor: amountMinorSchema,
  currency: currencySchema,
});
export type Money = z.infer<typeof moneySchema>;

/** Business date in Asia/Jerusalem, `YYYY-MM-DD`, no time component. */
export const businessDateSchema = z.iso.date();
export type BusinessDate = z.infer<typeof businessDateSchema>;

/** Direction of value movement. The sign lives here and nowhere else. */
export const directionSchema = z.enum(['inflow', 'outflow']);
export type Direction = z.infer<typeof directionSchema>;

/**
 * Scope separation from 02-FINANCIAL-RULES.md § Scopes ותנועות.
 *
 * `consolidated` is deliberately absent from stored rows: it is a view over the
 * other two. A row that claims to be consolidated would be counted twice.
 */
export const recordScopeSchema = z.enum(['household', 'business']);
export type RecordScope = z.infer<typeof recordScopeSchema>;

export const viewScopeSchema = z.enum(['household', 'business', 'consolidated']);
export type ViewScope = z.infer<typeof viewScopeSchema>;

/**
 * Certainty of a future item.
 *
 * 02-FINANCIAL-RULES.md § נזילות מול ודאות: this is not a liquidity statement.
 * Even `certain` money that has not arrived is not cash in hand.
 */
export const certaintySchema = z.enum(['possible', 'probable', 'certain']);
export type Certainty = z.infer<typeof certaintySchema>;

/** Liquidity classification of a sum presented to the user. */
export const availabilitySchema = z.enum(['safe', 'conditional', 'unavailable']);
export type Availability = z.infer<typeof availabilitySchema>;

/** Confidence attached to any derived number shown in the UI (UX-TRUST-001). */
export const confidenceSchema = z.enum(['low', 'medium', 'high']);
export type Confidence = z.infer<typeof confidenceSchema>;
