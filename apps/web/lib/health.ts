import 'server-only';

import { createClient } from '@supabase/supabase-js';

import { deploymentProblems, readDeploymentConfig } from './config/deployment';

/**
 * What the health endpoint reports about the data layer (PROD-HEALTH-002).
 *
 * Five answers an operator needs, and nothing a stranger could use: no host,
 * no project reference, no identifier, no database error text. The probe runs
 * as the anonymous role with the publishable key only, and it asks a question
 * whose refusal is the proof — `load_household_document()` grants EXECUTE to
 * `authenticated` alone, so:
 *
 *   * "permission denied" (42501) means the database answered and the function
 *     is there: reachable, and the schema this build expects is applied;
 *   * "function not found" (PGRST202) means the database answered but the
 *     production data layer has not been migrated: reachable, incompatible;
 *   * anything else means the database did not answer.
 *
 * No row can come back from that call under any outcome.
 */
export interface DataLayerHealth {
  readonly configuration: 'present' | 'missing';
  /**
   * Whether the publishable key was accepted by the project the URL names. A
   * key from another project is refused by the gateway before any SQL runs —
   * the "wrong project" a deployment must never quietly talk to.
   */
  readonly credentials: 'accepted' | 'rejected' | 'unknown' | 'not_applicable';
  readonly authenticatedDataSource: 'available' | 'unavailable' | 'not_applicable';
  readonly database: 'reachable' | 'unreachable' | 'not_applicable';
  readonly schema: 'compatible' | 'incompatible' | 'unknown' | 'not_applicable';
  readonly readiness: 'ready' | 'not_ready';
}

export interface HealthReport {
  readonly status: 'ok' | 'not_ready' | 'misconfigured';
  readonly backend?: 'local_json' | 'supabase';
  readonly environment?: string;
  readonly aiEnabled?: boolean;
  readonly problems?: readonly string[];
  readonly data: DataLayerHealth;
}

/** The nil UUID: a household that cannot exist, for a call that must return nothing. */
const NIL_HOUSEHOLD = '00000000-0000-0000-0000-000000000000';

const PROBE_TIMEOUT_MS = 4_000;

/** The two functions the application depends on. Both must be present. */
const REQUIRED_FUNCTIONS = ['load_household_document', 'apply_household_changes'] as const;

export type Probe = (
  fn: (typeof REQUIRED_FUNCTIONS)[number],
) => Promise<'denied' | 'missing' | 'rejected' | 'unreachable'>;

/** Probes through PostgREST as anon. Exported for the route; replaceable for tests. */
export function postgrestProbe(url: string, publishableKey: string): Probe {
  const client = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) }),
    },
  });
  return async (fn) => {
    try {
      const args =
        fn === 'load_household_document'
          ? { p_household_id: NIL_HOUSEHOLD }
          : { p_household_id: NIL_HOUSEHOLD, p_expected_version: 0, p_changes: {} };
      const { error } = await client.rpc(fn, args);
      if (error === null) return 'denied'; // cannot happen for anon; treated as answered
      if (error.code === '42501' || error.code === '28000') return 'denied';
      if (error.code === 'PGRST202') return 'missing';
      // The gateway answered instead of the database: this key does not belong
      // to the project the URL names.
      if (/invalid api key|api key/i.test(error.message ?? '')) return 'rejected';
      // PostgREST answered with something else (e.g. 401 on the API key):
      // the database is not usable as configured.
      return 'unreachable';
    } catch {
      return 'unreachable';
    }
  };
}

export async function dataLayerHealth(
  config: ReturnType<typeof readDeploymentConfig>,
  probe: Probe,
  env: NodeJS.ProcessEnv = process.env,
): Promise<DataLayerHealth> {
  if (config.backend !== 'supabase') {
    return {
      configuration: 'present',
      credentials: 'not_applicable',
      authenticatedDataSource: 'not_applicable',
      database: 'not_applicable',
      schema: 'not_applicable',
      readiness: 'ready',
    };
  }

  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';
  if (url === '' || key === '') {
    return {
      configuration: 'missing',
      credentials: 'unknown',
      authenticatedDataSource: 'unavailable',
      database: 'unreachable',
      schema: 'unknown',
      readiness: 'not_ready',
    };
  }

  const outcomes = await Promise.all(REQUIRED_FUNCTIONS.map((fn) => probe(fn)));
  const unreachable = outcomes.some((o) => o === 'unreachable');
  const rejected = outcomes.some((o) => o === 'rejected');
  const missing = outcomes.some((o) => o === 'missing');
  const database = unreachable ? 'unreachable' : 'reachable';
  const credentials = unreachable ? 'unknown' : rejected ? 'rejected' : 'accepted';
  const schema = unreachable || rejected ? 'unknown' : missing ? 'incompatible' : 'compatible';
  const available =
    database === 'reachable' && credentials === 'accepted' && schema === 'compatible';

  return {
    configuration: 'present',
    credentials,
    authenticatedDataSource: available ? 'available' : 'unavailable',
    database,
    schema,
    readiness: available ? 'ready' : 'not_ready',
  };
}

export async function healthReport(
  env: NodeJS.ProcessEnv = process.env,
  probeFactory: (url: string, key: string) => Probe = postgrestProbe,
): Promise<{ report: HealthReport; httpStatus: number }> {
  const problems = deploymentProblems(env);
  if (problems.length > 0) {
    return {
      httpStatus: 503,
      report: {
        status: 'misconfigured',
        // Variable names only. `deploymentProblems` never includes a value.
        problems,
        data: {
          configuration: 'missing',
          credentials: 'unknown',
          authenticatedDataSource: 'unavailable',
          database: 'unreachable',
          schema: 'unknown',
          readiness: 'not_ready',
        },
      },
    };
  }

  const config = readDeploymentConfig(env);
  const probe =
    config.backend === 'supabase'
      ? probeFactory(
          env.NEXT_PUBLIC_SUPABASE_URL ?? '',
          env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '',
        )
      : async () => 'denied' as const;
  const data = await dataLayerHealth(config, probe, env);
  const ready = data.readiness === 'ready';

  return {
    httpStatus: ready ? 200 : 503,
    report: {
      status: ready ? 'ok' : 'not_ready',
      // Deliberately coarse. Enough to confirm the right build is running with
      // the right backend, and nothing that describes a household.
      backend: config.backend,
      environment: config.nodeEnv,
      aiEnabled: config.aiEnabled,
      data,
    },
  };
}
