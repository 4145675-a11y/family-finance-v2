import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

// @ts-expect-error — a plain ESM helper shared with the gates; no types.
import { nextEnv, resolveNextBin } from '../../tools/next.mjs';

import type { SyntheticUser } from './synthetic-user';

/**
 * The live browser suite's own server, pointed at the real database.
 *
 * Separate from the local suite in every respect that matters: its own port, its
 * own backend, its own state file. What it exists for is the one thing the local
 * suite structurally cannot cover — Supabase Auth, row-level security, and the
 * sign-in screen a person actually meets.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WEB_ROOT = join(ROOT, 'apps', 'web');
const STATE_FILE = join(ROOT, '.e2e-run', 'live.json');

export const LIVE_HOST = '127.0.0.1';
export const LIVE_PORT = 3142;
export const LIVE_BASE_URL = `http://${LIVE_HOST}:${LIVE_PORT}`;
/** `localhost` is the one http origin the configuration treats as secure. */
export const LIVE_APP_ORIGIN = `http://localhost:${LIVE_PORT}`;

export interface LiveState {
  readonly people: readonly SyntheticUser[];
  readonly serverPid: number | null;
}

export function writeLiveState(state: LiveState): void {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export function readLiveState(): LiveState {
  if (!existsSync(STATE_FILE)) {
    throw new Error('no live run state: start the suite through `npm run e2e:live`');
  }
  return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as LiveState;
}

export function readLiveStateIfAny(): LiveState | null {
  return existsSync(STATE_FILE) ? readLiveState() : null;
}

export function clearLiveState(): void {
  rmSync(STATE_FILE, { force: true });
}

/**
 * A public setting, from the environment or the app's own env file.
 *
 * Only the two publishable values are ever read this way, and neither is printed.
 * The service-role key is not read here at all — nothing in this suite needs it.
 */
export function publicSetting(name: string): string {
  const fromEnv = process.env[name];
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
  const file = join(WEB_ROOT, '.env.local');
  if (!existsSync(file)) {
    throw new Error(`${name} is not set and apps/web/.env.local is absent`);
  }
  // The byte-order mark is written as an escape rather than as itself: a raw
  // one is invisible in an editor and reads as stray whitespace to the linter.
  const contents = readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  for (const raw of contents.split(/\r?\n/)) {
    const line = raw.trim();
    const separator = line.indexOf('=');
    if (separator <= 0 || line.slice(0, separator).trim() !== name) continue;
    return line.slice(separator + 1).trim();
  }
  throw new Error(`${name} is not set in the environment or apps/web/.env.local`);
}

let output = '';

export async function startLiveServer(): Promise<ChildProcess> {
  if (!existsSync(join(WEB_ROOT, '.next'))) {
    throw new Error('no build output: run `npm run build` before the live browser suite');
  }

  const child = spawn(
    process.execPath,
    [resolveNextBin(), 'start', '--hostname', LIVE_HOST, '--port', String(LIVE_PORT)],
    {
      cwd: WEB_ROOT,
      env: {
        ...(nextEnv() as NodeJS.ProcessEnv),
        NODE_ENV: 'production',
        FAMILY_FINANCE_DATA_BACKEND: 'supabase',
        FAMILY_FINANCE_APP_ORIGIN: LIVE_APP_ORIGIN,
        NEXT_PUBLIC_SUPABASE_URL: publicSetting('NEXT_PUBLIC_SUPABASE_URL'),
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publicSetting(
          'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
        ),
        NEXT_PUBLIC_DEV_DATA_SOURCE: '',
        PORT: String(LIVE_PORT),
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
    if (child.exitCode !== null) throw new Error(`the server exited: ${redacted()}`);
    try {
      const response = await fetch(`${LIVE_BASE_URL}/api/health`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (response.status > 0) return child;
    } catch {
      await delay(400);
    }
  }
  child.kill('SIGKILL');
  throw new Error(`the live server did not start: ${redacted()}`);
}

/**
 * The server's first lines, with anything that looks like a project URL or a key
 * removed. A diagnostic must never be the thing that leaks a secret.
 */
function redacted(): string {
  const project = process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? '';
  return output
    .split('\n')
    .filter((line) => !line.includes('sb_') && (project === '' || !line.includes(project)))
    .slice(0, 12)
    .join('\n');
}

export function stopByPid(pid: number | null): void {
  if (pid === null) return;
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // Already gone.
  }
}
