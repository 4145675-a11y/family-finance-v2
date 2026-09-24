import { LOCAL_BASE_URL } from './origins';
import { seedHousehold } from './household';
import { clearRunState, writeRunState } from './run-state';
import { startLocalServer } from './server';

/**
 * One temporary household, then one server pointed at it.
 *
 * The order is the reason this is not Playwright's own `webServer`: that starts
 * before global setup runs, and a server that opens a data directory which does
 * not exist yet gives every test a first-run screen instead of a household.
 */
export default async function globalSetup(): Promise<void> {
  clearRunState();
  const seeded = await seedHousehold();
  const server = await startLocalServer(seeded.dataDirectory);
  writeRunState({
    ...seeded,
    baseURL: LOCAL_BASE_URL,
    serverPid: server.pid ?? null,
  });
  // Detached from this process's lifetime tracking: teardown stops it by pid.
  server.unref();
}
