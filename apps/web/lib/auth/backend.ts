import 'server-only';

import { readDeploymentConfig } from '../config/deployment';

/**
 * Which identity and data backend this process serves.
 *
 * Decided once from the deployment configuration (ADR-0031): the same answer
 * `instrumentation.ts` validated at start-up. `local_json` means the household
 * on this machine behind the passkey lock; `supabase` means Supabase Auth and
 * the database, as one person's session (ADR-0032).
 */
export type Backend = 'local_json' | 'supabase';

export function activeBackend(): Backend {
  return readDeploymentConfig().backend;
}
