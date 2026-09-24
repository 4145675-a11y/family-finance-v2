import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

// @ts-expect-error — a plain ESM helper shared with the gates; no types.
import { nextEnv, resolveNextBin } from '../../tools/next.mjs';

import { LOCAL_APP_ORIGIN, LOCAL_HOST, LOCAL_PORT } from './origins';

/**
 * The application under test: the **built** server, started here.
 *
 * Playwright can start a server itself, but it does so before `globalSetup`
 * runs, and this suite has to create a household before the server opens a
 * document. Owning the lifecycle keeps that order explicit and matches how
 * `check:shell` and the production-path validation already do it.
 *
 * `next start` and not `next dev`: a dev server compiles on demand, reports
 * different errors, and is not what a family runs. A test that only passes
 * against the development build is not evidence about the product.
 */

const WEB_ROOT = fileURLToPath(new URL('../../apps/web/', import.meta.url));

let output = '';

/** The first lines the server printed. Diagnostics for a failed start only. */
export function serverOutput(): string {
  return output.split('\n').slice(0, 20).join('\n');
}

export async function startLocalServer(dataDirectory: string): Promise<ChildProcess> {
  if (!existsSync(join(WEB_ROOT, '.next'))) {
    throw new Error('no build output: run `npm run build` before the browser suite');
  }

  const child = spawn(
    process.execPath,
    [resolveNextBin(), 'start', '--hostname', LOCAL_HOST, '--port', String(LOCAL_PORT)],
    {
      cwd: WEB_ROOT,
      env: {
        ...(nextEnv() as NodeJS.ProcessEnv),
        NODE_ENV: 'production',
        /*
         * The file-backed store, pointed at this run's temporary directory. Both
         * variables together are what keeps the suite away from the machine's
         * own `.data`; either one alone would not.
         */
        FAMILY_FINANCE_DATA_BACKEND: 'local_json',
        FAMILY_FINANCE_DATA_DIR: dataDirectory,
        FAMILY_FINANCE_APP_ORIGIN: LOCAL_APP_ORIGIN,
        // No database settings reach this process at all, so a mistake in a
        // spec cannot read or write the hosted household.
        NEXT_PUBLIC_SUPABASE_URL: '',
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '',
        NEXT_PUBLIC_DEV_DATA_SOURCE: '',
        PORT: String(LOCAL_PORT),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  child.stdout?.on('data', (chunk) => {
    output += String(chunk);
  });
  child.stderr?.on('data', (chunk) => {
    output += String(chunk);
  });

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`the server exited before answering:\n${serverOutput()}`);
    }
    try {
      const response = await fetch(`http://${LOCAL_HOST}:${LOCAL_PORT}/api/health`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (response.status > 0) return child;
    } catch {
      await delay(400);
    }
  }

  child.kill('SIGKILL');
  throw new Error(`the server did not start within 60 seconds:\n${serverOutput()}`);
}

export async function stopServer(child: ChildProcess | null): Promise<void> {
  if (child === null) return;
  child.kill('SIGTERM');
  await delay(800);
  if (child.exitCode === null) child.kill('SIGKILL');
}

/**
 * Stops a server this process did not start, by the pid written at setup.
 *
 * Global teardown runs in its own process, so the `ChildProcess` handle is gone
 * by then. Killing by pid is the only thing left — and it is narrow: the pid was
 * recorded by this run's own setup, and a pid that has already exited simply
 * throws `ESRCH`, which is the expected outcome and not an error.
 */
export function stopServerByPid(pid: number | null): void {
  if (pid === null) return;
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // Already gone. Nothing to stop.
  }
}
