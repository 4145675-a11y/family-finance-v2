#!/usr/bin/env node
/**
 * The deployed service, checked from outside, without signing in.
 *
 * Read-only by construction: it makes `GET` requests and nothing else. There is
 * no account, no session, no token and no write anywhere in this file, so it can
 * be pointed at production safely and run on a schedule.
 *
 * What it is for: the class of failure that passes every gate and still breaks
 * the product — the database unreachable behind a healthy process, a protected
 * screen serving a page instead of a sign-in redirect, a secret reaching the
 * browser. Each of those has happened to a real deployment, and none of them is
 * visible from a build.
 *
 * What it deliberately does **not** do:
 *
 *   * sign in — an authenticated production check needs a synthetic account in
 *     the production authentication system, which is `npm run e2e:live` against a
 *     configured origin, not this;
 *   * assert a version — `/api/health` does not publish one, so a claim about
 *     *which* commit is live would be invented, so it is stated here rather than
 *     asserted anyway.
 *
 * Usage: node tools/production-smoke.mjs [origin]
 *        FAMILY_FINANCE_SMOKE_ORIGIN=https://… node tools/production-smoke.mjs
 */

import { pathToFileURL } from 'node:url';

export const DEFAULT_ORIGIN = 'https://family-finance-web-l2gp.onrender.com';

/**
 * Which origin to check.
 *
 * An **empty** value counts as absent, and that is not a nicety: a GitHub
 * workflow writes an inputs expression as an empty string on every event that
 * carries no inputs, so a nullish fallback would take that empty string and the
 * check would fail with "the origin must be https, got" — which is exactly what
 * happened on the first triggered run of this workflow.
 *
 * @param {string | undefined} fromArgument
 * @param {string | undefined} fromEnvironment
 * @returns {string}
 */
export function resolveOrigin(fromArgument, fromEnvironment) {
  const given = [fromArgument, fromEnvironment]
    .map((value) => (value ?? '').trim())
    .find((value) => value !== '');
  const chosen = given ?? DEFAULT_ORIGIN;
  // A trailing slash would turn every path into a double slash.
  return chosen.endsWith('/') ? chosen.slice(0, -1) : chosen;
}

const origin = resolveOrigin(process.argv[2], process.env['FAMILY_FINANCE_SMOKE_ORIGIN']);

/** @type {{name: string, ok: boolean, detail: string}[]} */
const checks = [];

function record(name, ok, detail = '') {
  checks.push({ name, ok, detail });
}

/**
 * A GET, with a timeout and without following redirects, so a redirect is
 * observable rather than silently resolved.
 * @param {string} path
 * @param {{redirect?: RequestRedirect}} [options]
 */
async function get(path, options = {}) {
  return fetch(`${origin}${path}`, {
    redirect: options.redirect ?? 'manual',
    headers: { 'user-agent': 'family-finance-production-smoke' },
    signal: AbortSignal.timeout(30_000),
  });
}

/**
 * Anything in a response body that would be a secret reaching the browser.
 *
 * The shapes, not a list of values: this file must not contain a key in order to
 * look for one. `sb_secret_` is Supabase's own prefix for a service-role key, and
 * a `service_role` claim inside a JWT is the other way one arrives.
 */
const SECRET_SHAPES = [
  /sb_secret_[A-Za-z0-9_-]/,
  /"role"\s*:\s*"service_role"/,
  /service_role/,
];

/**
 * The health endpoint, given a chance to wake up.
 *
 * Render's free plan sleeps an idle service, and the request that wakes it can
 * take longer than any sane timeout. Retrying is not leniency about a real
 * failure: every attempt has to succeed on its own terms, and a service that is
 * genuinely down fails all of them. Without this the check would report a
 * scheduled run as broken every time simply because nobody had visited.
 */
async function healthWithWakeUp() {
  let last = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await get('/api/health', { redirect: 'follow' });
    } catch (error) {
      last = error;
    }
  }
  throw last ?? new Error('the health endpoint never answered');
}

async function main() {
  // 1. The process is up, configured, and can reach its data.
  try {
    const response = await healthWithWakeUp();
    record('health answers 200', response.status === 200, `status ${response.status}`);
    const body = /** @type {Record<string, unknown>} */ (await response.json());
    const data = /** @type {Record<string, string>} */ (body['data'] ?? {});
    record('health says ok', body['status'] === 'ok', String(body['status']));
    record(
      'the data layer is ready',
      data['readiness'] === 'ready',
      `readiness ${data['readiness']}`,
    );
    record('the schema is compatible', data['schema'] === 'compatible', String(data['schema']));
    record(
      'the database is reachable',
      data['database'] === 'reachable',
      String(data['database']),
    );
    // A hosted deployment must not be serving from a file on its own disk.
    record(
      'the backend is the database',
      body['backend'] === 'supabase',
      String(body['backend']),
    );
  } catch (error) {
    record('health answers', false, error instanceof Error ? error.message : String(error));
  }

  // 2. The sign-in screen is public, and carries nothing private.
  try {
    const response = await get('/login', { redirect: 'follow' });
    const html = await response.text();
    record(
      'the sign-in screen is served',
      response.status === 200,
      `status ${response.status}`,
    );
    record('it is the sign-in screen', html.includes('כניסה לחשבון'));
    // A public page with money on it would mean a household is leaking.
    record('it carries no money figures', !html.includes('₪'));
    for (const shape of SECRET_SHAPES) {
      record(`no secret of shape ${shape.source} on /login`, !shape.test(html));
    }
  } catch (error) {
    record('the sign-in screen is served', false, String(error));
  }

  // 3. Every money screen refuses an anonymous visitor, by redirecting.
  for (const path of [
    '/',
    '/quick',
    '/debts',
    '/lenders',
    '/upload',
    '/accounts',
    '/approvals',
  ]) {
    try {
      const response = await get(path);
      const location = response.headers.get('location') ?? '';
      const redirected = response.status >= 300 && response.status < 400;
      record(
        `${path} sends an anonymous visitor to sign in`,
        redirected && location.includes('/login'),
        `status ${response.status} → ${location || '(no location)'}`,
      );
    } catch (error) {
      record(`${path} answers`, false, String(error));
    }
  }

  // 4. The installable manifest, because the product is used from a home screen.
  try {
    const response = await get('/manifest.webmanifest', { redirect: 'follow' });
    record('the manifest is served', response.status === 200, `status ${response.status}`);
  } catch (error) {
    record('the manifest is served', false, String(error));
  }

  console.log('Production smoke (read-only)');
  console.log(`  origin: ${origin}`);
  console.log('');
  for (const check of checks) {
    const mark = check.ok ? 'PASS' : 'FAIL';
    console.log(`${mark}  ${check.name}${check.detail === '' ? '' : `  — ${check.detail}`}`);
  }
  console.log('');

  const failed = checks.filter((check) => !check.ok);
  if (failed.length > 0) {
    console.log(`RESULT: FAIL — ${failed.length} of ${checks.length} checks did not hold.`);
    process.exitCode = 1;
    return;
  }
  console.log(`RESULT: PASS — all ${checks.length} checks hold on the deployed service.`);
  console.log('        This is an anonymous check. It does not sign in, and');
  console.log('        /api/health publishes no version, so it says nothing about');
  console.log('        which commit is live.');
}

/*
 * Run only when executed directly.
 *
 * The test imports `resolveOrigin` from this file, and without the guard that
 * import would fire a run against the production service as a side effect — a
 * unit test that reaches the internet is a unit test that fails when the train
 * goes into a tunnel. Same pattern as `tools/next.mjs`.
 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!origin.startsWith('https://')) {
    console.error(`RESULT: FAIL — the origin must be https, got "${origin}"`);
    process.exitCode = 2;
  } else {
    main().catch((error) => {
      console.error(
        'The smoke check itself failed:',
        error instanceof Error ? error.message : error,
      );
      process.exitCode = 2;
    });
  }
}
