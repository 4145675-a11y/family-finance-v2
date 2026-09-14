import 'server-only';

import { HouseholdStore, resolveStorePaths } from '@family-finance/local-store';

import { findProjectRoot } from '../project-root';
import { assertUnlocked } from '../auth/guard';

/**
 * The application's single door to the household's data.
 *
 * `server-only` is the first line for a reason: this module reaches the
 * filesystem, and 05-ARCHITECTURE-DATA.md keeps data access out of client
 * components. Importing it from a `'use client'` file is a build error rather
 * than a runtime surprise.
 *
 * There is exactly one store instance per process, because the store serialises
 * its own writes and two instances would each think they were alone.
 *
 * The instance carries the lock. Once a passkey is enrolled, reading or writing
 * the household's truth requires an unlocked session — and it requires it here,
 * at the door, rather than at each of the forty places that walk through it. A
 * screen or an action added later inherits the check by construction instead of
 * by the author having remembered it.
 */

let instance: HouseholdStore | null = null;

export function householdStore(): HouseholdStore {
  if (instance === null) {
    instance = new HouseholdStore(resolveStorePaths(findProjectRoot()), assertUnlocked);
  }
  return instance;
}

/** Where the data lives, for the screen that explains what is stored and where. */
export function dataDirectory(): string {
  return householdStore().paths.root;
}

export { findProjectRoot };
