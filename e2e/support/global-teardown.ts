import { removeHousehold } from './household';
import { clearRunState, readRunStateIfAny } from './run-state';
import { stopServerByPid } from './server';

/**
 * The server stopped, the temporary household removed.
 *
 * Playwright runs this after the suite whether it passed or failed, which is the
 * property that matters: a failing run must not leave a directory of synthetic
 * financial records — or a server holding it open — behind on the machine.
 *
 * It deletes exactly the directory this run created. There is no pattern match,
 * no sweep of the temp directory and no "clean up old runs": a cleanup that
 * searches is a cleanup that can find the wrong thing.
 */
export default async function globalTeardown(): Promise<void> {
  try {
    // Absent when setup failed before it got this far: nothing was created,
    // so there is nothing to remove and that is not an error.
    const state = readRunStateIfAny();
    if (state !== null) {
      stopServerByPid(state.serverPid);
      stopServerByPid(state.plainServerPid);
      removeHousehold(state.dataDirectory);
    }
  } finally {
    clearRunState();
  }
}
