#!/usr/bin/env node
/**
 * Production-build gate — the build Render runs, with its diagnostics as failures.
 *
 * The first Render deployment failed in `npm run build` on a line every local
 * and CI build had been printing as a *warning*:
 *
 *   apps/web/instrumentation.ts:51:5
 *   A Node.js API is used (process.exit at line 51) which is not supported in
 *   the Edge Runtime
 *   Ecmascript file had an error
 *
 * Two things were different on Render. `NODE_ENV=production` was set in the
 * environment — under it the same build prints "Ecmascript file had an error"
 * after the warning, and on Linux exits non-zero — and nobody was reading
 * warnings. A gate that lets a warning through is a gate that lets this
 * through.
 *
 * So this runs the real build (`tools/next.mjs build`, telemetry off) with
 * `NODE_ENV=production` exactly as the host sets it, streams the output so a
 * CI log still shows it, and fails on any Turbopack diagnostic — warning or
 * error — or on a non-zero exit. The `.next` output it leaves behind is the
 * same build the other gates run against.
 *
 * Exit codes: 0 = clean build, 1 = build failed or reported a diagnostic,
 * 2 = gate could not run.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { nextEnv, resolveNextBin } from './next.mjs';

const WEB_ROOT = fileURLToPath(new URL('../apps/web/', import.meta.url));

/**
 * Lines the build must not print. Each is a Next/Turbopack diagnostic that a
 * host may treat as fatal even where a local build exits 0.
 */
export const DIAGNOSTICS = [
  /Turbopack build encountered \d+ (warning|error)/,
  /Ecmascript file had an error/,
  /not supported in the Edge Runtime/,
  /Failed to compile/,
  /⚠ .*[Ww]arning/,
];

/**
 * @param {string} output
 * @returns {string[]} the diagnostic lines found, in order
 */
export function findDiagnostics(output) {
  const found = [];
  for (const line of output.split(/\r?\n/)) {
    if (DIAGNOSTICS.some((pattern) => pattern.test(line))) found.push(line.trim());
  }
  return found;
}

/**
 * Runs the production build the way the host runs it.
 * @returns {Promise<{ exitCode: number | null; output: string }>}
 */
function build() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [resolveNextBin(), 'build'], {
      cwd: WEB_ROOT,
      env: { ...nextEnv(), NODE_ENV: 'production' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk);
      output += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
      output += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ exitCode: code, output }));
  });
}

async function main() {
  console.log('Production-build gate (NODE_ENV=production, diagnostics are failures)\n');
  const { exitCode, output } = await build();
  const diagnostics = findDiagnostics(output);

  console.log('');
  if (exitCode !== 0) {
    console.log(`RESULT: FAIL — the build exited ${exitCode}.`);
    process.exitCode = 1;
    return;
  }
  if (diagnostics.length > 0) {
    console.log('RESULT: FAIL — the build reported diagnostics a host may treat as fatal:');
    for (const line of diagnostics) console.log(`  ${line}`);
    process.exitCode = 1;
    return;
  }
  console.log('RESULT: PASS — the production build is clean: no warning, no error, exit 0.');
}

// Run only when executed directly; the test imports the matcher instead.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(
      'Production-build gate could not run:',
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 2;
  });
}
