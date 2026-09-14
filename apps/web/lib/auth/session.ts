import 'server-only';

import { cookies, headers } from 'next/headers';

import { configuredAuthOrigin, requestIsAtAuthOrigin } from './origin';
import {
  AuthError,
  findSessionByHash,
  isProtected,
  logged,
  sessionVerdict,
  touchSession,
  verifiedRecently,
  type AuthSession,
  type AuthState,
  type SessionVerdict,
} from './model';
import { hashToken, mutateAuthState, readAuthState } from './store';

/**
 * The session cookie, and what it is and is not.
 *
 * The cookie holds a random 32-byte token and nothing else — no identity, no
 * claim, nothing signed. The server looks the token's hash up in the
 * authentication file; a cookie that names no live session is simply a locked
 * browser. There is nothing in it to forge, because there is nothing in it to
 * read.
 *
 * `httpOnly` keeps it away from page scripts. `sameSite: 'lax'` keeps it off
 * cross-site requests. `secure` is deliberately *not* set, and that is not an
 * oversight: the application is served over plain http on loopback, and a secure
 * cookie would simply never be sent, producing a lock that can never be opened.
 * The traffic never leaves the machine. This is written down in the threat model
 * rather than left as a silent trade.
 */

const COOKIE_NAME = 'ff_session';

/** How stale `lastSeenAt` may get before a request bothers to write it. */
const TOUCH_INTERVAL_MS = 60 * 1000;

export interface SessionContext {
  readonly state: AuthState;
  readonly session: AuthSession | null;
  readonly verdict: SessionVerdict;
  /** True once at least one passkey exists, so there is something to unlock. */
  readonly locked: boolean;
  /** True when the browser is at the origin where passkeys work. */
  readonly atAuthOrigin: boolean;
  /** True when this session may run a sensitive action without asking again. */
  readonly recentlyVerified: boolean;
}

async function requestHost(): Promise<string | null> {
  const header = await headers();
  return header.get('host');
}

/**
 * Everything a screen needs to know about who is here.
 *
 * Reads. Does not redirect, does not throw — the callers decide what a locked
 * application should look like, and the lock screen itself needs to be able to
 * ask this question without being bounced by its own answer.
 */
export async function sessionContext(now = new Date().toISOString()): Promise<SessionContext> {
  const state = await readAuthState(now);
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;

  const session = token === undefined ? undefined : findSessionByHash(state, hashToken(token));
  const verdict = sessionVerdict(state, session, now);

  return {
    state,
    session: verdict === 'active' && session !== undefined ? session : null,
    verdict,
    locked: isProtected(state),
    atAuthOrigin: requestIsAtAuthOrigin(await requestHost()),
    recentlyVerified:
      verdict === 'active' && session !== undefined ? verifiedRecently(session, now) : false,
  };
}

/**
 * The check the household store calls before it reads or writes anything.
 *
 * Throws rather than redirects, because it runs inside the store and a redirect
 * thrown from there would be caught by the error handling of whichever action
 * happened to be calling. The read path redirects separately, before it gets
 * this far; this is the backstop that makes the lock structural.
 */
export async function assertUnlockedSession(now = new Date().toISOString()): Promise<void> {
  const context = await sessionContext(now);
  if (!context.locked) return;

  if (context.session === null) {
    throw new AuthError(
      context.verdict === 'idle' ? 'session_idle' : 'locked',
      'the application is locked',
    );
  }

  // Activity is what the idle timeout measures, so it is recorded here — at the
  // one place every read and every write passes through — rather than in each
  // screen. Written at most once a minute so that opening a page does not mean
  // rewriting a file.
  const session = context.session;
  if (Date.parse(now) - Date.parse(session.lastSeenAt) > TOUCH_INTERVAL_MS) {
    await mutateAuthState(
      (state, at) => ({
        state: touchSession(state, session.id, at),
        value: undefined,
      }),
      now,
    );
  }
}

/**
 * The same check for a sensitive action: signed in, and verified just now.
 *
 * Restoring a backup and exporting everything are not reads. An unlocked laptop
 * left on a table is not authorisation to do either.
 */
export async function assertRecentlyVerified(
  actionKey: string,
  now = new Date().toISOString(),
): Promise<void> {
  const context = await sessionContext(now);
  if (!context.locked) return;

  if (context.session === null) {
    throw new AuthError('locked', 'the application is locked');
  }
  if (!verifiedRecently(context.session, now)) {
    throw new AuthError('reauthentication_required', `${actionKey} needs Windows Hello again`);
  }
}

export async function setSessionCookie(token: string): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    // Not `secure`: see the note at the top of this file.
    maxAge: 12 * 60 * 60,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

/** Ends the current session, if there is one, and forgets the cookie. */
export async function endCurrentSession(now = new Date().toISOString()): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;

  if (token !== undefined) {
    const tokenHash = hashToken(token);
    await mutateAuthState((state, at) => {
      const session = findSessionByHash(state, tokenHash);
      if (session === undefined) return { state, value: undefined };
      return {
        state: logged(
          {
            ...state,
            sessions: state.sessions.filter((candidate) => candidate.id !== session.id),
          },
          'signed_out',
          at,
        ),
        value: undefined,
      };
    }, now);
  }

  await clearSessionCookie();
}

/** The origin passkeys work at, for the screens that have to name it. */
export function authOriginDescription() {
  return configuredAuthOrigin();
}
