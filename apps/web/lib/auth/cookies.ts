/**
 * The attributes every session cookie carries (PROD-COOKIE-001).
 *
 * `@supabase/ssr` sets a path, SameSite=Lax and a long lifetime, and nothing
 * else. Two attributes are ours to decide, and both are decided from the
 * origin rather than from the environment name:
 *
 *   * `secure` — on every https origin the cookie must never travel over
 *     plain http. The one http origin this product accepts, `http://localhost`,
 *     is the one place a Secure cookie would not be sent at all.
 *   * `httpOnly` — the browser never reads the session itself: every read and
 *     write happens on the server, so a script on the page has no business
 *     seeing the token. On by default; the browser client is not used.
 *
 * Kept as a pure function so the server client, the proxy and the tests agree.
 */
export interface SessionCookieOptions {
  readonly path: '/';
  readonly sameSite: 'lax';
  readonly httpOnly: true;
  readonly secure: boolean;
}

export function sessionCookieOptions(appOrigin: string | undefined): SessionCookieOptions {
  const secure =
    appOrigin === undefined || appOrigin === '' ? true : appOrigin.startsWith('https://');
  return { path: '/', sameSite: 'lax', httpOnly: true, secure };
}
