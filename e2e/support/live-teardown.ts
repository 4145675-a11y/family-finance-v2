/*
 * Loads SUPABASE_DB_URL from .env.integration.local when it is not already in the
 * environment. The same loader the integration and validation suites use, and it
 * never prints the value — not even its length.
 */
import '../../supabase/tests/load-env';

import { clearLiveState, readLiveStateIfAny, stopByPid } from './live';
import { connectAsOwner, remainingRows, removeSynthetic } from './synthetic-user';

/**
 * The synthetic people removed from the real database, and the removal verified.
 *
 * Counting afterwards is the part that matters. "We ran a delete" is not evidence;
 * zero rows left is. If anything remains this throws, which fails the run — the
 * right outcome, because a synthetic account left behind in a production
 * authentication system is exactly what must never be shrugged off.
 */
export default async function liveTeardown(): Promise<void> {
  const state = readLiveStateIfAny();
  if (state === null) return;

  stopByPid(state.serverPid);

  const owner = await connectAsOwner();
  try {
    await removeSynthetic(owner, state.people);
    const left = await remainingRows(owner, state.people);
    if (left !== 0) {
      throw new Error(`cleanup left ${left} row(s) belonging to the synthetic E2E users`);
    }
  } finally {
    await owner.end();
    clearLiveState();
  }
}
