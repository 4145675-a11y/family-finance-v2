/*
 * Loads SUPABASE_DB_URL from .env.integration.local when it is not already in the
 * environment. The same loader the integration and validation suites use, and it
 * never prints the value — not even its length.
 */
import '../../supabase/tests/load-env';

import { clearLiveState, startLiveServer, writeLiveState } from './live';
import { connectAsOwner, provision, syntheticUser } from './synthetic-user';

/**
 * Two synthetic people, then a server pointed at the real database.
 *
 * Two rather than one because isolation is a claim about a second household
 * existing and not being visible; with one user there is nothing to be isolated
 * from, and the test would pass on an empty database.
 */
export default async function liveSetup(): Promise<void> {
  clearLiveState();
  const people = [syntheticUser('one'), syntheticUser('two')] as const;

  const owner = await connectAsOwner();
  try {
    for (const person of people) await provision(owner, person);
  } finally {
    await owner.end();
  }

  const server = await startLiveServer();
  writeLiveState({ people: [...people], serverPid: server.pid ?? null });
  server.unref();
}
