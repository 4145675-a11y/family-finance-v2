import 'server-only';

import {
  SupabaseHouseholdStore,
  SupabaseHouseholdTransport,
  type HouseholdStorePort,
} from '@family-finance/household-store';
import { HouseholdStore, resolveStorePaths } from '@family-finance/local-store';
import { cache } from 'react';

import { activeBackend } from '../auth/backend';
import { assertUnlocked } from '../auth/guard';
import { AuthError } from '../auth/model';
import { currentUser } from '../auth/supabase';
import { createClient } from '../supabase/server';
import { findProjectRoot } from '../project-root';

/**
 * The application's single door to the household's data.
 *
 * `server-only` is the first line for a reason: this module reaches the
 * filesystem or the database, and 05-ARCHITECTURE-DATA.md keeps data access
 * out of client components. Importing it from a `'use client'` file is a build
 * error rather than a runtime surprise.
 *
 * Which store stands behind the door is decided by the deployment
 * configuration and by nothing else (ADR-0031, ADR-0032):
 *
 *   * `local_json` — the file on this machine, one instance per process, with
 *     the passkey lock checked at every method. The shape the product has
 *     shipped as since M7.
 *   * `supabase` — the database, as the signed-in person, one instance per
 *     request. No session means no store: the caller gets an `AuthError`, and
 *     nothing falls back to a file. A process configured for the database
 *     never constructs the file store at all.
 *
 * Callers `await householdStore()` and use the port; none of them knows which
 * one they got.
 */

let fileStore: HouseholdStore | null = null;

function localStore(): HouseholdStore {
  if (fileStore === null) {
    fileStore = new HouseholdStore(resolveStorePaths(findProjectRoot()), assertUnlocked);
  }
  return fileStore;
}

/**
 * One store per request for the database backend. `cache` from React scopes
 * the memo to the current server request, so a page and the actions it calls
 * share one instance and one signed-in identity.
 */
const supabaseStore = cache(async (): Promise<HouseholdStorePort> => {
  const user = await currentUser();
  if (user === null) throw new AuthError('not_signed_in', 'no signed-in person');
  const client = await createClient();
  return new SupabaseHouseholdStore(
    new SupabaseHouseholdTransport(client, user.id),
    user.id,
    null,
  );
});

export async function householdStore(): Promise<HouseholdStorePort> {
  return activeBackend() === 'supabase' ? supabaseStore() : localStore();
}

/**
 * The Supabase store with its extra surface (invitations), when that is the
 * backend. Callers that need it check the backend first; asking for it under
 * the file backend is a programming error and says so.
 */
export async function supabaseHouseholdStore(): Promise<SupabaseHouseholdStore> {
  if (activeBackend() !== 'supabase') {
    throw new Error('invitations exist only with the database backend');
  }
  return (await supabaseStore()) as SupabaseHouseholdStore;
}

/** Where the data lives, for the screen that explains what is stored and where. Local backend only. */
export function dataDirectory(): string | null {
  return activeBackend() === 'supabase' ? null : localStore().paths.root;
}

export { findProjectRoot };
