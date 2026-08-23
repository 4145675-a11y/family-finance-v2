import type { BudgetInput, EngineInput, FoodWeekInput } from '@family-finance/finance-engine';

/**
 * Which data source the dashboard is reading, and whether it is allowed to.
 *
 * The application has no verified database yet — Milestone 2's migrations have
 * never been applied — so the only way to see the product working locally is a
 * development fixture. CLAUDE.md permits exactly one shape for that: an adapter,
 * in dev or test only, behind a feature flag that is off by default, failing
 * closed. This module is that gate, and it is deliberately the only place that
 * decides.
 *
 * Fail closed means: in a production build the fixture is unreachable no matter
 * what the environment says, and when no source is available the dashboard shows
 * that it has no data rather than showing numbers from nowhere. A screen full of
 * invented figures that looks real is the single most dangerous thing this
 * project could ship.
 */

export type DataSourceKind = 'none' | 'development_fixture';

export interface DataSourceDescriptor {
  readonly kind: DataSourceKind;
  /** Shown to the viewer. A fixture must never be silently indistinguishable. */
  readonly label: string;
  readonly isRealData: boolean;
  /** Why the source is what it is, in the user's language. */
  readonly reason: string;
}

export interface EnvironmentFacts {
  readonly nodeEnv: string | undefined;
  readonly flag: string | undefined;
}

export const DEV_DATA_FLAG = 'NEXT_PUBLIC_DEV_DATA_SOURCE';

/** The single literal that switches the fixture on. Anything else is off. */
const FLAG_ON = 'on';

/**
 * Decides the active source from the environment.
 *
 * Two conditions, both required, in this order:
 *
 *  1. The build is not production. This is checked first and cannot be overridden
 *     by the flag, so a production deployment with a stray environment variable
 *     still serves no fixture.
 *  2. The flag is set to exactly `on`. Not "true", not "1", not any truthy
 *     string — a single literal, so the switch cannot be flipped by accident.
 */
export function resolveDataSource(env: EnvironmentFacts): DataSourceDescriptor {
  if (env.nodeEnv === 'production') {
    return {
      kind: 'none',
      label: 'אין מקור נתונים',
      isRealData: false,
      reason: 'זו סביבת ייצור. נתוני הדגמה חסומים בה לחלוטין, וחיבור למסד האמת טרם אומת.',
    };
  }

  if (env.flag !== FLAG_ON) {
    return {
      kind: 'none',
      label: 'אין מקור נתונים',
      isRealData: false,
      reason: `מקור נתוני הפיתוח כבוי. הפעלה: ${DEV_DATA_FLAG}=${FLAG_ON} בסביבת פיתוח בלבד.`,
    };
  }

  return {
    kind: 'development_fixture',
    label: 'נתוני הדגמה לפיתוח',
    isRealData: false,
    reason:
      'המסך מוצג על נתוני הדגמה מומצאים, כדי לבדוק את המנוע והתצוגה לפני שיש מסד מאומת. אלה אינם הכספים שלכם.',
  };
}

/** Reads the current process environment. Kept apart so the rule above is testable. */
export function currentEnvironment(): EnvironmentFacts {
  return {
    nodeEnv: process.env.NODE_ENV,
    // Referenced as a complete literal: Next only inlines NEXT_PUBLIC_* when it
    // can see the whole expression at build time.
    flag: process.env.NEXT_PUBLIC_DEV_DATA_SOURCE,
  };
}

export interface DashboardSource {
  readonly descriptor: DataSourceDescriptor;
  /** All null whenever the descriptor says there is no source. */
  readonly input: EngineInput | null;
  readonly budget: BudgetInput | null;
  readonly food: FoodWeekInput | null;
}

/**
 * Loads the engine input for the active source.
 *
 * The fixture module is imported dynamically and only after the gate has said
 * yes, so a production bundle never pulls the fixture in at all.
 */
export async function loadDashboardSource(
  env: EnvironmentFacts = currentEnvironment(),
): Promise<DashboardSource> {
  const descriptor = resolveDataSource(env);

  if (descriptor.kind !== 'development_fixture') {
    return { descriptor, input: null, budget: null, food: null };
  }

  const { demoHouseholdInput, demoBudgetInput, demoFoodInput } =
    await import('./fixtures/demo-household');
  // One instant for all three, so the screens never disagree about what day it is.
  const asOf = new Date().toISOString();
  return {
    descriptor,
    input: demoHouseholdInput(asOf),
    budget: demoBudgetInput(asOf),
    food: demoFoodInput(asOf),
  };
}
