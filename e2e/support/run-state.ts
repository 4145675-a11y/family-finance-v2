import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { SeededHousehold } from './household';

/**
 * Where one run's facts are written so its parts can find each other.
 *
 * Playwright loads the config, the global setup, each worker and the global
 * teardown in **separate processes**. A module-level variable does not survive
 * that, so the ids the seed generated have to be written down somewhere both a
 * spec and the teardown can read.
 *
 * A file under `.e2e-run/` rather than an environment variable, because the seed
 * produces several ids and because teardown must still find the directory after
 * a crash — an inherited variable would be gone with the process that failed.
 *
 * The directory is git-ignored and removed at the end of the run. It holds
 * identifiers of synthetic records and nothing else: no credentials, no cookies,
 * no household figures.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const STATE_FILE = join(ROOT, '.e2e-run', 'state.json');

export interface RunState extends SeededHousehold {
  /** The origin the local server is serving on. */
  readonly baseURL: string;
  /** The server this run started, so teardown can stop it from another process. */
  readonly serverPid: number | null;
  /** The second server, configured the way the deployment is today: no reader. */
  readonly plainServerPid: number | null;
}

export function writeRunState(state: RunState): void {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

/** The current run's facts. Throws rather than guessing when there are none. */
export function readRunState(): RunState {
  if (!existsSync(STATE_FILE)) {
    throw new Error(
      'no E2E run state: the suite must be started through `npm run e2e`, which seeds the household first',
    );
  }
  return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as RunState;
}

/** The run's facts, or null when setup never got as far as writing them. */
export function readRunStateIfAny(): RunState | null {
  return existsSync(STATE_FILE) ? readRunState() : null;
}

export function clearRunState(): void {
  rmSync(dirname(STATE_FILE), { recursive: true, force: true });
}
