import type { BudgetInput, EngineInput, FoodWeekInput } from '@family-finance/finance-engine';

/**
 * Which data source the screens are reading, and whether they are allowed to.
 *
 * There are three answers now, and the order between them is the whole point.
 *
 *  1. The household's own store, once they have set one up. Real data, and the
 *     normal case.
 *  2. A development fixture, only in a development build and only behind a flag
 *     that is off by default — the one shape CLAUDE.md permits for invented
 *     figures in a development build.
 *  3. Nothing, which is a real answer: the screens say they have no data rather
 *     than showing numbers from nowhere.
 *
 * The real store always wins. A developer with the fixture flag on who then sets
 * up a household sees their own figures, because a flag quietly overriding a
 * family's actual money is the worst failure this module could have.
 *
 * Fail closed still holds: in a production build the fixture is unreachable no
 * matter what the environment says.
 */

export type DataSourceKind = 'none' | 'local_store' | 'supabase' | 'development_fixture';

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
  /** Whether the household has been set up on this machine. */
  readonly hasLocalStore: boolean;
  /**
   * Where this deployment keeps financial truth.
   *
   * Defaults to the local store so every existing caller and test keeps its
   * meaning; a production deployment states `supabase` and the rule below stops
   * a file on disk from being served as a family's money.
   */
  readonly backend?: 'local_json' | 'supabase' | undefined;
  /**
   * With the database backend: whether the request carries a signed-in person
   * and whether that person has a household. Both are decided by the
   * application from the session, never assumed. Absent means "no".
   */
  readonly authenticated?: boolean | undefined;
  readonly hasSupabaseHousehold?: boolean | undefined;
}

export const DEV_DATA_FLAG = 'NEXT_PUBLIC_DEV_DATA_SOURCE';

/** The single literal that switches the fixture on. Anything else is off. */
const FLAG_ON = 'on';

export function resolveDataSource(env: EnvironmentFacts): DataSourceDescriptor {
  /*
   * A file on disk is never the answer when the deployment says otherwise.
   *
   * This check comes before the local store, and that ordering is the whole
   * point. A production container that happens to contain a `.data` directory —
   * left by a build step, a mounted volume, a copied image — would otherwise
   * serve it as the household's truth: no row-level security, no durability,
   * and a disk the host may discard between deploys.
   *
   * `readDeploymentConfig` refuses to let such a process start at all. This is
   * the second lock on the same door, for the case where the process was started
   * before the configuration changed under it.
   */
  if (env.backend === 'supabase') {
    // A file on disk is never the answer; neither is the fixture. The only
    // real source is the database, as a signed-in person with a household —
    // and anything short of that is 'none', with the reason named
    // (PROD-PARTIAL-FAILCLOSED-001).
    if (env.hasLocalStore) {
      return {
        kind: 'none',
        label: 'אין מקור נתונים',
        isRealData: false,
        reason: 'ההתקנה הזו מוגדרת לעבוד מול מסד הנתונים, ולכן קובץ מקומי לא ישמש כמקור אמת.',
      };
    }
    if (env.authenticated !== true) {
      return {
        kind: 'none',
        label: 'אין מקור נתונים',
        isRealData: false,
        reason: 'צריך להיכנס לחשבון כדי לראות את הנתונים של משק הבית.',
      };
    }
    if (env.hasSupabaseHousehold !== true) {
      return {
        kind: 'none',
        label: 'אין מקור נתונים',
        isRealData: false,
        reason: 'עוד לא הוקם משק בית לחשבון הזה. אפשר להתחיל בהגדרה, או להצטרף דרך הזמנה.',
      };
    }
    return {
      kind: 'supabase',
      label: 'הנתונים שלכם',
      isRealData: true,
      reason: 'המספרים כאן מגיעים ממה שהזנתם ואישרתם, ונשמרים במסד הנתונים של משק הבית.',
    };
  }

  if (env.hasLocalStore) {
    return {
      kind: 'local_store',
      label: 'הנתונים שלכם',
      isRealData: true,
      reason: 'המספרים כאן מגיעים ממה שהזנתם ואישרתם, ונשמרים על המחשב הזה בלבד.',
    };
  }

  if (env.nodeEnv === 'production') {
    return {
      kind: 'none',
      label: 'אין מקור נתונים',
      isRealData: false,
      reason: 'עוד לא הוקם כאן משק בית. אפשר להתחיל בהגדרה, וכל מה שתזינו יישמר במחשב הזה.',
    };
  }

  if (env.flag !== FLAG_ON) {
    return {
      kind: 'none',
      label: 'אין מקור נתונים',
      isRealData: false,
      reason: 'עוד לא הוקם כאן משק בית. אפשר להתחיל בהגדרה, וכל מה שתזינו יישמר במחשב הזה.',
    };
  }

  return {
    kind: 'development_fixture',
    label: 'נתוני הדגמה לפיתוח',
    isRealData: false,
    reason:
      'המסך מוצג על נתוני הדגמה מומצאים, כדי לבדוק את המנוע והתצוגה. אלה אינם הכספים שלכם.',
  };
}

/** Reads the current process environment. Kept apart so the rule above is testable. */
export function currentEnvironment(
  hasLocalStore: boolean,
  session: { authenticated: boolean; hasSupabaseHousehold: boolean } = {
    authenticated: false,
    hasSupabaseHousehold: false,
  },
): EnvironmentFacts {
  return {
    authenticated: session.authenticated,
    hasSupabaseHousehold: session.hasSupabaseHousehold,
    nodeEnv: process.env.NODE_ENV,
    // Referenced as a complete literal: Next only inlines NEXT_PUBLIC_* when it
    // can see the whole expression at build time.
    flag: process.env.NEXT_PUBLIC_DEV_DATA_SOURCE,
    hasLocalStore,
    backend: process.env.FAMILY_FINANCE_DATA_BACKEND === 'supabase' ? 'supabase' : 'local_json',
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
  env: EnvironmentFacts = currentEnvironment(false),
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
