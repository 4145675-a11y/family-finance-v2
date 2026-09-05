import { z } from 'zod';

import { timestampSchema, versionSchema } from './identity';
import { amountMinorSchema, currencySchema } from './money';

/**
 * Household settings — the few decisions that change how every number is read.
 *
 * Kept small on purpose. Each field here is one the engine actually consumes; a
 * preference with no effect on a calculation or a screen has no business being
 * asked of a family during setup (03-UX-SPEC.md § הגדרה ראשונית).
 *
 * The reserve floor components come straight from 02-FINANCIAL-RULES.md
 * § רזרבה מינימלית, which forbids "three to six months" as a first rule and makes
 * the floor the highest of four named components. Three of them are entered here;
 * the fourth — essential needs until the next certain income — is derived, never
 * typed, because a household cannot be asked to compute it.
 */

export const monthStartDaySchema = z.number().int().min(1).max(28);

/** Local-only notification preferences. Nothing is sent anywhere. */
export const notificationPreferencesSchema = z.object({
  /** Show the weekly food guidance prominently on the home screen. */
  weeklyFoodGuidance: z.boolean(),
  /** Show a reminder when balances have not been confirmed for a while. */
  balanceFreshnessReminder: z.boolean(),
  /** How many days of silence before that reminder appears. */
  balanceFreshnessDays: z.number().int().min(1).max(90),
});
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;

export const householdSettingsSchema = z.object({
  currency: currencySchema,
  timeZone: z.string().min(1).max(60),
  /**
   * The day the family's financial month begins. Most households use 1; a
   * household paid on the 10th often thinks in months that start then.
   */
  monthStartDay: monthStartDaySchema,
  /** A floor the family set themselves. Null when they have not. */
  manualReserveFloorMinor: amountMinorSchema.nullable(),
  /** What one plausible mishap would cost. Null when not yet decided. */
  incidentBufferMinor: amountMinorSchema.nullable(),
  /** What it takes to stop using the overdraft or the revolving card again. */
  revolvingAvoidanceMinor: amountMinorSchema.nullable(),
  /** Money already earmarked: a deposit held, a fund for a known bill. */
  protectedReservesMinor: amountMinorSchema,
  notifications: notificationPreferencesSchema,
  updatedAt: timestampSchema,
  version: versionSchema,
});
export type HouseholdSettings = z.infer<typeof householdSettingsSchema>;

/**
 * How far through first-time setup the household is.
 *
 * Setup never blocks: a family can enter one account and start using the product.
 * These flags drive a completeness meter, not a gate (03-UX-SPEC.md asks for
 * save-and-continue, not a wizard that must be finished).
 */
export const setupProgressSchema = z.object({
  householdNamed: z.boolean(),
  membersAdded: z.boolean(),
  accountsAdded: z.boolean(),
  balancesConfirmed: z.boolean(),
  businessDecided: z.boolean(),
  debtsRecorded: z.boolean(),
  recurringIncomeRecorded: z.boolean(),
  recurringObligationsRecorded: z.boolean(),
  budgetStarted: z.boolean(),
  /** Set once the family has seen what the product does and does not store. */
  privacyExplained: z.boolean(),
});
export type SetupProgress = z.infer<typeof setupProgressSchema>;

export const setupStepKeys = [
  'householdNamed',
  'membersAdded',
  'accountsAdded',
  'balancesConfirmed',
  'businessDecided',
  'debtsRecorded',
  'recurringIncomeRecorded',
  'recurringObligationsRecorded',
  'budgetStarted',
  'privacyExplained',
] as const satisfies readonly (keyof SetupProgress)[];

export type SetupStepKey = (typeof setupStepKeys)[number];
