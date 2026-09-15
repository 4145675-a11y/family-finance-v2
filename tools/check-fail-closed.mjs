#!/usr/bin/env node
/**
 * Fail-closed gate — proves a misconfigured production server serves nothing.
 *
 * The most dangerous outcome of moving this application online is not a crash.
 * It is a production server that starts, looks healthy, answers requests, and is
 * quietly reading a family's money from a JSON file on an ephemeral disk with no
 * row-level security behind it. Every existing gate would pass on such a server.
 *
 * `lib/config/deployment.ts` has unit tests for the rules. Those prove the
 * function returns the right answer. This proves the *process* acts on it: the
 * built server is started with real environment variables and the gate asserts
 * what it answers.
 *
 * What "refuses" means here (ADR-0034): the process runs, and every request it
 * receives is a refusal. `/api/health` answers 503 `misconfigured` naming the
 * settings at fault and nothing else; every other path — a page, an export, an
 * auth link — answers 503 with a plain-text notice and none of the
 * application's markup. A host's health check fails on such a process and the
 * deploy is not promoted. Until the Hosting hotfix the gate asserted a process
 * exit instead; `process.exit` in instrumentation.ts is a Node API in a file
 * the build also compiles for the Edge runtime, and it failed the first real
 * deployment. A thrown startup error was measured too: Next keeps listening
 * and answers 500 to everything, health included, which is neither a refusal
 * nor a diagnosis.
 *
 * Five cases, and the last matters as much as the first four — a gate that only
 * ever asserts refusal would pass just as well if the server refused everything.
 *
 *   A. hosted origin + local JSON store  -> every request 503; health names the setting
 *   B. production + supabase, no URL     -> every request 503; health names the setting
 *   B2. production + supabase, no origin -> every request 503; health names the setting
 *   D. production + supabase, a value    -> every request 503; health names the setting;
 *      pasted into the origin slot         what was pasted appears nowhere — not in
 *                                           the log, not in the public health body
 *   C. production + complete config      -> the application answers; /api/health
 *                                           names the backend and, with no database
 *                                           behind the placeholder URL, says not_ready
 *
 * Case A is keyed on the origin rather than on NODE_ENV, because that is where
 * the risk actually is. A copy running on the household's own machine at
 * localhost may use the JSON store — that is the shape the product shipped as —
 * and the shell gate exercises exactly that. What must never run is a *hosted*
 * service reading a file.
 *
 * The values used in case C are placeholders, and are public by design: a
 * Supabase URL and a publishable key are not secrets. No secret is read, written
 * or printed anywhere in this file.
 *
 * Requires a completed build. Run `npm run build` (or `npm run check:build`) first.
 *
 * Exit codes: 0 = fails closed correctly, 1 = a rule did not hold, 2 = gate could not run.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

import { resolveNextBin, nextEnv } from './next.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB_ROOT = join(REPO_ROOT, 'apps', 'web');
const BUILD_DIR = join(WEB_ROOT, '.next');

/** Away from `npm run dev` (3100) and the shell gate (3131). */
const PORT = 3132;
const HOST = '127.0.0.1';

/** How long a server gets to either answer or give up. */
const STARTUP_BUDGET_MS = 25_000;

/**
 * A complete, valid production environment.
 *
 * Placeholders in the shapes Supabase issues; neither is a credential.
 * Nothing here connects to anything — the health route reads configuration
 * and returns.
 */
const VALID = {
  NODE_ENV: 'production',
  FAMILY_FINANCE_DATA_BACKEND: 'supabase',
  FAMILY_FINANCE_APP_ORIGIN: 'https://finance.example.com',
  NEXT_PUBLIC_SUPABASE_URL: 'https://exampleprojectrefabc.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_0000000000000000000000',
};

/**
 * A value that belongs in no slot. Case D puts it where a key gets pasted by
 * mistake — the origin — and every refusal case asserts it is never repeated.
 * Not a credential and not shaped like one; the assertion is about echoing.
 */
const PASTED = 'pasted-by-mistake-0000';

/**
 * The paths a misconfigured process must refuse: a page, the export route, an
 * auth link, and a path that does not exist (a 404 page is still the
 * application rendering).
 */
const APPLICATION_PATHS = [
  '/',
  '/accounts',
  '/api/export/backup.json',
  '/auth/callback',
  '/nothing-here',
];

/**
 * @typedef {{ status: number; contentType: string; body: string }} Answer
 */

/**
 * Starts the built server and reports what it answered.
 *
 * @param {Record<string, string>} env
 * @returns {Promise<{ listened: boolean; exitCode: number | null; output: string; health: Answer | null; answers: Record<string, Answer> }>}
 */
async function startServer(env) {
  const child = spawn(
    process.execPath,
    [resolveNextBin(), 'start', '--hostname', HOST, '--port', String(PORT)],
    {
      cwd: WEB_ROOT,
      env: { ...nextEnv(), ...env, PORT: String(PORT) },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  let output = '';
  child.stdout.on('data', (chunk) => {
    output += String(chunk);
  });
  child.stderr.on('data', (chunk) => {
    output += String(chunk);
  });

  /** @type {number | null} */
  let exitCode = null;
  let exited = false;
  child.on('exit', (code) => {
    exited = true;
    exitCode = code;
  });

  /** @param {string} path @returns {Promise<Answer>} */
  const ask = async (path) => {
    const response = await fetch(`http://${HOST}:${PORT}${path}`, {
      redirect: 'manual',
      // The health route probes the database (up to a few seconds against a
      // host that does not exist) before it answers.
      signal: AbortSignal.timeout(9_000),
    });
    return {
      status: response.status,
      contentType: response.headers.get('content-type') ?? '',
      body: await response.text(),
    };
  };

  const deadline = Date.now() + STARTUP_BUDGET_MS;
  let listened = false;
  /** @type {Answer | null} */
  let health = null;
  /** @type {Record<string, Answer>} */
  const answers = {};

  while (Date.now() < deadline) {
    if (exited) break;
    try {
      health = await ask('/api/health');
      output += `\n[gate] /api/health -> ${health.status} ${health.body}`;
      listened = true;
      break;
    } catch {
      // Not up yet, or never will be. The loop decides which.
      await delay(400);
    }
  }

  if (listened) {
    // Startup is announced once; give the announcement a moment to be flushed
    // so the log assertions read what the process actually printed.
    await delay(300);
    for (const path of APPLICATION_PATHS) {
      try {
        answers[path] = await ask(path);
      } catch (error) {
        answers[path] = {
          status: 0,
          contentType: '',
          body: error instanceof Error ? error.message : String(error),
        };
      }
    }
  }

  if (!exited) {
    child.kill('SIGTERM');
    // Give it a moment to go quietly before insisting.
    await delay(600);
    if (!exited) child.kill('SIGKILL');
  }

  return { listened, exitCode, output, health, answers };
}

/** @type {{ name: string; ok: boolean; detail: string }[]} */
const results = [];

/** @param {string} name @param {boolean} ok @param {string} detail */
function record(name, ok, detail) {
  results.push({ name, ok, detail });
}

/**
 * The assertions every refusal case shares.
 *
 * @param {string} label
 * @param {Awaited<ReturnType<typeof startServer>>} run
 * @param {string} settingName the variable the health report must name
 */
function assertRefused(label, run, settingName) {
  const { listened, health, answers, output } = run;
  record(
    `${label}: the process runs and answers`,
    listened && health !== null,
    listened ? 'listening' : `never answered (exit=${run.exitCode})`,
  );
  const misconfigured =
    health !== null &&
    health.status === 503 &&
    health.body.includes('"status":"misconfigured"');
  record(
    `${label}: /api/health is 503 misconfigured and names the setting`,
    misconfigured && (health?.body.includes(settingName) ?? false),
    health === null ? 'no health answer' : `${health.status} ${health.body.slice(0, 160)}`,
  );
  const refusals = Object.entries(answers);
  const allRefused =
    refusals.length === APPLICATION_PATHS.length &&
    refusals.every(
      ([, answer]) =>
        answer.status === 503 &&
        answer.contentType.startsWith('text/plain') &&
        !answer.body.includes('<html') &&
        !answer.body.includes('<!DOCTYPE'),
    );
  record(
    `${label}: every application path answers 503 text, never the application`,
    allRefused,
    refusals.map(([path, answer]) => `${path} -> ${answer.status}`).join(', '),
  );
  record(
    `${label}: the refusal is announced in the log by setting name`,
    output.includes('refusing to serve') && output.includes(settingName),
    'startup output names the setting at fault',
  );
  const everything =
    output + (health?.body ?? '') + refusals.map(([, answer]) => answer.body).join('');
  record(
    `${label}: without printing any value`,
    !everything.includes('sb_publishable_0000000000000000000000') &&
      !everything.includes('exampleprojectref') &&
      !everything.includes(PASTED),
    'no configured value, host, project reference or pasted value appears anywhere',
  );
}

async function main() {
  if (!existsSync(BUILD_DIR)) {
    console.error('Fail-closed gate could not run: no build found. Run `npm run build` first.');
    process.exitCode = 2;
    return;
  }

  console.log('Fail-closed gate');
  console.log(`  server: http://${HOST}:${PORT} (from the production build)\n`);

  // --- A. a hosted deployment must refuse the local JSON store -------------
  assertRefused(
    'hosted origin + local JSON store',
    await startServer({ ...VALID, FAMILY_FINANCE_DATA_BACKEND: 'local_json' }),
    'FAMILY_FINANCE_DATA_BACKEND',
  );

  // --- B. production must refuse an incomplete backend ---------------------
  /*
   * Set to empty rather than deleted, and that distinction is the finding.
   *
   * Deleting it did nothing: Next loads `apps/web/.env.local` at startup and
   * re-supplied the value, so the first version of this check was asserting
   * something it could not actually create — and reported a failure that was
   * really the gate's own mistake.
   *
   * A variable already present in the environment wins over the file, so an
   * explicit empty string is how the absence is expressed. The configuration
   * reader treats empty and missing alike, for exactly this reason.
   *
   * Worth stating for the deployment itself: a stray `.env` file inside a
   * container image would supply production configuration just as silently.
   * `.gitignore` keeps them out of the repository and `check-no-env-files`
   * keeps them out of the build.
   */
  assertRefused(
    'production + supabase, no URL',
    await startServer({ ...VALID, NEXT_PUBLIC_SUPABASE_URL: '' }),
    'NEXT_PUBLIC_SUPABASE_URL',
  );

  // --- B2. a hosted deployment must state where the family reaches it ------
  // Cookie security and every auth redirect derive from the origin. Left
  // unset, the developer default (localhost) would quietly stand in for it on
  // a server (PROD-ORIGIN-001). Empty rather than deleted, as in B.
  assertRefused(
    'production + supabase, no origin',
    await startServer({ ...VALID, FAMILY_FINANCE_APP_ORIGIN: '' }),
    'FAMILY_FINANCE_APP_ORIGIN',
  );

  // --- D. a value in the wrong slot is refused, and never repeated ---------
  // The origin slot is the one a key gets pasted into by mistake. The process
  // must refuse — what is there is not an origin — and neither the log nor the
  // public health body may repeat it. Naming the slot is the whole diagnosis.
  assertRefused(
    'production + supabase, a value pasted into the origin slot',
    await startServer({ ...VALID, FAMILY_FINANCE_APP_ORIGIN: PASTED }),
    'FAMILY_FINANCE_APP_ORIGIN',
  );

  // --- C. a correct production configuration must actually run -------------
  // Without this the gate would pass just as well if the server refused
  // everything, which is not fail-closed but simply broken.
  {
    const { listened, output, health, answers } = await startServer(VALID);
    record(
      'a correctly configured production server starts',
      listened,
      listened ? 'listening' : 'never listened',
    );
    record(
      'and announces itself once, as supabase',
      output.includes('[family-finance] starting:') && output.includes('backend=supabase'),
      'startup line names the backend',
    );
    record(
      'and reports its backend as supabase',
      health?.body.includes('"backend":"supabase"') ?? false,
      'health endpoint names the backend',
    );
    record(
      'and the health endpoint reveals nothing financial',
      !/household|balance|shekel|₪|transaction|debt/i.test(health?.body ?? ''),
      'health response carries no financial vocabulary',
    );

    // The placeholder URL has no database behind it. A ready answer here would
    // mean readiness is being assumed rather than checked (PROD-HEALTH-002).
    const body = health?.body ?? '';
    record(
      'and reports the data layer as not ready when the database cannot be reached',
      health?.status === 503 &&
        body.includes('"readiness":"not_ready"') &&
        body.includes('"database":"unreachable"') &&
        body.includes('"configuration":"present"'),
      'health names configuration present, database unreachable, not ready',
    );
    record(
      'without naming the project or host',
      !body.includes('exampleprojectref') && !body.includes('supabase.co'),
      'no host or project reference in the health body',
    );
    // The application itself answers — a sign-in redirect, not a refusal.
    const home = answers['/'];
    record(
      'and the application answers requests rather than refusing them',
      home !== undefined && home.status !== 503 && home.status < 500,
      home === undefined ? 'no answer for /' : `/ -> ${home.status}`,
    );
  }

  for (const { name, ok, detail } of results) {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
    if (!ok) console.log(`        ${detail}`);
  }

  const failed = results.filter((result) => !result.ok);
  console.log('');
  if (failed.length > 0) {
    console.log(`RESULT: FAIL — ${failed.length} of ${results.length} checks did not hold.`);
    process.exitCode = 1;
    return;
  }
  console.log(`RESULT: PASS — the server fails closed on all ${results.length} checks.`);
}

main().catch((error) => {
  console.error(
    'Fail-closed gate could not run:',
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 2;
});
