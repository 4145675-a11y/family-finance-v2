import 'server-only';

import { createClient } from '../supabase/server';
import { AuthError } from './model';

/**
 * Production identity: Supabase Auth, email and password (ADR-0032 §1).
 *
 * Everything here runs on the server against the session carried in the
 * request's cookies. The browser never receives a key beyond the publishable
 * one, and nothing here ever holds a password after the sign-in call returns.
 *
 * Two questions are answered, and only two: who is signed in, and how recently
 * did they prove it with their password. The second is what 07-SECURITY's
 * "recent-auth" means without a passkey: the JWT's `amr` claim records each
 * authentication event with its time, so "verified in the last ten minutes"
 * is read from a token the auth server signed rather than from a cookie this
 * application could be talked into writing.
 */

export interface SignedInUser {
  readonly id: string;
  readonly email: string | null;
}

/** How long a password entry counts as recent, in milliseconds. 07-SECURITY: ten minutes by default. */
export const RECENT_AUTH_WINDOW_MS = 10 * 60 * 1000;

/**
 * The signed-in person, or null.
 *
 * `getUser()` asks the auth server rather than trusting the cookie's JWT on
 * its own, so a revoked session is null here even if its token has not
 * expired.
 */
export async function currentUser(): Promise<SignedInUser | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || data.user === null) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}

/** Like `currentUser`, but a missing session is an error the caller can name. */
export async function requireUser(): Promise<SignedInUser> {
  const user = await currentUser();
  if (user === null) throw new AuthError('not_signed_in', 'no signed-in person');
  return user;
}

interface AmrEntry {
  readonly method?: unknown;
  readonly timestamp?: unknown;
}

/**
 * True when the current session's most recent password authentication is
 * within the window. Read from verified claims; a session with no `amr`
 * (older tokens, other methods) is not recent — fail closed.
 */
export async function recentlyAuthenticated(
  now = Date.now(),
  windowMs = RECENT_AUTH_WINDOW_MS,
): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data) return false;
  const amr = (data.claims as { amr?: unknown }).amr;
  if (!Array.isArray(amr)) return false;
  return amr.some((entry: AmrEntry) => {
    if (entry.method !== 'password' || typeof entry.timestamp !== 'number') return false;
    return now - entry.timestamp * 1000 <= windowMs;
  });
}

export type SignInFailure = 'invalid_credentials' | 'unavailable';

/**
 * Signs in with email and password. The session cookies are written by the
 * ssr client. The failure is reduced to two cases: the auth server's own
 * message is not forwarded, because it can distinguish "no such user" from
 * "wrong password" and that distinction is an enumeration oracle.
 */
export async function signInWithPassword(
  email: string,
  password: string,
): Promise<{ ok: true } | { ok: false; failure: SignInFailure }> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error === null) return { ok: true };
  return { ok: false, failure: error.status === 400 ? 'invalid_credentials' : 'unavailable' };
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
}
