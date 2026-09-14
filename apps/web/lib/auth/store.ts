import 'server-only';

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';

import { resolveStorePaths, type StorePaths } from '@family-finance/local-store';

import { findProjectRoot } from '../project-root';
import { activeBackend } from './backend';
import { configuredAuthOrigin } from './origin';
import { AuthError, authStateSchema, emptyAuthState, type AuthState } from './model';

/**
 * The authentication file, and the rules for touching it.
 *
 * Written the same way the household document is — to a staging file, then
 * renamed over the live one — because the same failure applies: a power cut
 * halfway through enrolling a passkey must leave the previous state, not an
 * unreadable file that locks the family out of their own money.
 *
 * Every mutation runs through one promise chain. Two ceremonies finishing at the
 * same moment would otherwise both read the same state and one would silently
 * lose, which for a challenge store means a consumed challenge coming back to
 * life.
 *
 * On POSIX the file is given mode 0600. On Windows that call does nothing useful
 * and the file is protected by the user's profile permissions instead; the
 * limitation is stated in the threat model rather than papered over.
 */

let queue: Promise<unknown> = Promise.resolve();
let cachedPaths: StorePaths | null = null;

/**
 * The data directory, resolved without going through the household store.
 *
 * Authentication guards the store, so it cannot import it. Both modules resolve
 * the same directory from the same function, which is the one fact they share.
 */
function paths(): StorePaths {
  // The one place the authentication file's path is resolved, and therefore
  // the one place to refuse it. A process serving the database backend has no
  // local sessions, no local passkeys and no business opening this file — and
  // a page that forgot to branch on the backend fails here, closed, rather than
  // quietly reading a file that means nothing to it (ADR-0032 §6).
  if (activeBackend() === 'supabase') {
    throw new AuthError(
      'unsupported_backend',
      'the local authentication file is not used with the database backend',
    );
  }
  if (cachedPaths === null) cachedPaths = resolveStorePaths(findProjectRoot());
  return cachedPaths;
}

const authPath = (): string => paths().auth;
const stagingPath = (): string => paths().authStaging;

/** SHA-256 of a session token, hex. The token itself is never stored. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** A new session token: 32 bytes from the system CSPRNG, base64url. */
export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Constant-time comparison of two hex digests. */
export function digestsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

async function writeState(state: AuthState): Promise<void> {
  await mkdir(paths().root, { recursive: true });

  const serialised = `${JSON.stringify(state, null, 2)}\n`;
  await writeFile(stagingPath(), serialised, { encoding: 'utf8', mode: 0o600 });
  try {
    await chmod(stagingPath(), 0o600);
  } catch {
    // Windows has no POSIX mode bits. The file is protected by the profile's
    // access control instead, which is what the threat model says.
  }
  await rename(stagingPath(), authPath());
}

/**
 * Reads the state, or produces an empty one.
 *
 * A missing file is the normal state of a fresh installation and means "nothing
 * is protected yet", which is different from a corrupt file. A file that exists
 * but does not parse is refused loudly: silently replacing it with an empty one
 * would turn a damaged authentication file into an unlocked application.
 */
export async function readAuthState(now = new Date().toISOString()): Promise<AuthState> {
  const origin = configuredAuthOrigin();

  let raw: string;
  try {
    raw = await readFile(authPath(), 'utf8');
  } catch {
    return emptyAuthState(origin.origin, origin.rpId, now);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AuthError(
      'auth_file_unreadable',
      'the sign-in file on this machine is damaged and was not replaced',
    );
  }

  const result = authStateSchema.safeParse(parsed);
  if (!result.success) {
    throw new AuthError(
      'auth_file_unreadable',
      'the sign-in file on this machine does not have the expected shape',
    );
  }

  return result.data;
}

/**
 * Applies a change to the authentication state.
 *
 * The mutation is a pure function of the state, so it is validated before
 * anything is written and a throw leaves the file exactly as it was.
 */
export async function mutateAuthState<T>(
  change: (state: AuthState, now: string) => { state: AuthState; value: T },
  now = new Date().toISOString(),
): Promise<T> {
  const run = queue.then(async () => {
    const current = await readAuthState(now);
    const outcome = change(current, now);
    const validated = authStateSchema.parse({ ...outcome.state, updatedAt: now });
    await writeState(validated);
    return outcome.value;
  });

  // The chain must continue whether or not this link succeeded, or one failed
  // mutation would stop every later write.
  queue = run.then(
    () => undefined,
    () => undefined,
  );

  return run;
}

/** Where the authentication file lives, for the screen that explains what is stored. */
export function authFilePath(): string {
  return authPath();
}
