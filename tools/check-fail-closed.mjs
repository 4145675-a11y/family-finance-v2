#!/usr/bin/env node
/**
 * Fail-closed gate — proves a misconfigured production server refuses to run.
 *
 * The most dangerous outcome of moving this application online is not a crash.
 * It is a production server that starts, looks healthy, answers requests, and is
 * quietly reading a family's money from a JSON file on an ephemeral disk with no
 * row-level security behind it. Every existing gate would pass on such a server.
 *
 * `lib/config/deployment.ts` has unit tests for the rules. Those prove the
 * function returns the right answer. This proves the *process* acts on it: the
 * built server is started with real environment variables and the gate asserts
 * it exits rather than listens.
 *
 * Three cases, and the third matters as much as the first two — a gate that only
 * ever asserts refusal would pass just as well if the server refused everything.
 *
 *   A. hosted origin + local JSON store -> must exit non-zero, must not listen
 *   B. production + supabase, no URL    -> must exit non-zero, must not listen
 *   B2. production + supabase, no origin -> must exit non-zero, must not listen
 *   C. production + complete config     -> must listen; /api/health must name the
 *                                          backend and, with no database behind
 *                                          the placeholder URL, say not_ready
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
 * Requires a completed build. Run `npm run build` first.
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

/** How long a server gets to either listen or give up. */
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
 * Starts the built server and reports what it did.
 *
 * @param {Record<string, string>} env
 * @returns {Promise<{ listened: boolean; exitCode: number | null; output: string }>}
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

  const deadline = Date.now() + STARTUP_BUDGET_MS;
  let listened = false;

  while (Date.now() < deadline) {
    if (exited) break;
    try {
      const response = await fetch(`http://${HOST}:${PORT}/api/health`, {
        // The health route probes the database (up to a few seconds against a
        // host that does not exist) before it answers.
        signal: AbortSignal.timeout(9_000),
      });
      // Any answer at all means it is listening; the body is checked by the caller.
      output += `\n[gate] /api/health -> ${response.status} ${await response.text()}`;
      listened = true;
      break;
    } catch {
      // Not up yet, or never will be. The loop decides which.
      await delay(400);
    }
  }

  if (!exited) {
    child.kill('SIGTERM');
    // Give it a moment to go quietly before insisting.
    await delay(600);
    if (!exited) child.kill('SIGKILL');
  }

  return { listened, exitCode, output };
}

/** @type {{ name: string; ok: boolean; detail: string }[]} */
const results = [];

/** @param {string} name @param {boolean} ok @param {string} detail */
function record(name, ok, detail) {
  results.push({ name, ok, detail });
}

async function main() {
  if (!existsSync(BUILD_DIR)) {
    console.error('Fail-closed gate could not run: no build found. Run `npm run build` first.');
    process.exitCode = 2;
    return;
  }

  console.log('Fail-closed startup gate');
  console.log(`  server: http://${HOST}:${PORT} (from the production build)\n`);

  // --- A. a hosted deployment must refuse the local JSON store -------------
  {
    const { listened, exitCode, output } = await startServer({
      ...VALID,
      FAMILY_FINANCE_DATA_BACKEND: 'local_json',
    });
    const refused = !listened && exitCode !== 0;
    record(
      'a server on a hosted origin configured for the local JSON store refuses to start',
      refused,
      refused ? `exited ${exitCode}` : `listened=${listened} exit=${exitCode}`,
    );
    record(
      'and says why, naming the setting',
      output.includes('FAMILY_FINANCE_DATA_BACKEND') || output.includes('local JSON store'),
      'startup output names the setting at fault',
    );
    record(
      'without printing any value',
      !output.includes('sb_publishable_0000000000000000000000'),
      'no configured value appears in the output',
    );
  }

  // --- B. production must refuse an incomplete backend ---------------------
  {
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
    const { listened, exitCode } = await startServer({
      ...VALID,
      NEXT_PUBLIC_SUPABASE_URL: '',
    });
    const refused = !listened && exitCode !== 0;
    record(
      'a production server with no database URL refuses to start',
      refused,
      refused ? `exited ${exitCode}` : `listened=${listened} exit=${exitCode}`,
    );
  }

  // --- B2. a hosted deployment must state where the family reaches it ------
  // Cookie security and every auth redirect derive from the origin. Left
  // unset, the developer default (localhost) would quietly stand in for it on
  // a server (PROD-ORIGIN-001). Empty rather than deleted, as in B.
  {
    const { listened, exitCode, output } = await startServer({
      ...VALID,
      FAMILY_FINANCE_APP_ORIGIN: '',
    });
    const refused = !listened && exitCode !== 0;
    record(
      'a production server with no stated origin refuses to start',
      refused,
      refused ? `exited ${exitCode}` : `listened=${listened} exit=${exitCode}`,
    );
    record(
      'and names the origin setting',
      output.includes('FAMILY_FINANCE_APP_ORIGIN'),
      'startup output names FAMILY_FINANCE_APP_ORIGIN',
    );
  }

  // --- C. a correct production configuration must actually run -------------
  // Without this the gate would pass just as well if the server refused
  // everything, which is not fail-closed but simply broken.
  {
    const { listened, output } = await startServer(VALID);
    record(
      'a correctly configured production server starts',
      listened,
      listened ? 'listening' : 'never listened',
    );
    record(
      'and reports its backend as supabase',
      output.includes('"backend":"supabase"'),
      'health endpoint names the backend',
    );
    record(
      'and the health endpoint reveals nothing financial',
      !/household|balance|shekel|₪|transaction|debt/i.test(output.split('[gate]')[1] ?? ''),
      'health response carries no financial vocabulary',
    );

    // The placeholder URL has no database behind it. A ready answer here would
    // mean readiness is being assumed rather than checked (PROD-HEALTH-002).
    const health = output.split('[gate] /api/health -> ')[1] ?? '';
    record(
      'and reports the data layer as not ready when the database cannot be reached',
      health.startsWith('503') &&
        health.includes('"readiness":"not_ready"') &&
        health.includes('"database":"unreachable"') &&
        health.includes('"configuration":"present"'),
      'health names configuration present, database unreachable, not ready',
    );
    record(
      'without naming the project or host',
      !health.includes('exampleprojectref') && !health.includes('supabase.co'),
      'no host or project reference in the health body',
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
