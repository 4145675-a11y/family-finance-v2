#!/usr/bin/env node
/**
 * Playwright launcher.
 *
 * One job: make the browser binaries live **inside the project**. Playwright's
 * default is a per-user cache under the home directory, which the safety
 * boundary in CLAUDE.md puts out of bounds — the same reason `tools/next.mjs`
 * exists for telemetry. Setting the variable in an npm script is not portable
 * across Windows and POSIX, so it is set here instead, and it overrides an
 * inherited value rather than deferring to it.
 *
 * Zero dependencies beyond Node built-ins, matching the rest of tools/.
 *
 * It also understands one flag of its own, `--live-origin=<url>`, which it strips
 * and turns into an environment variable. An npm script cannot set one portably —
 * the same reason this file exists at all — and the live suite needs to be able to
 * drive the deployed service as well as a local one.
 *
 * Usage: node tools/playwright.mjs <test|install|show-report> [...args]
 *        node tools/playwright.mjs test --config playwright.live.config.ts --live-origin=https://…
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The variable Playwright reads to decide where browsers live. */
export const BROWSERS_ENV_VAR = 'PLAYWRIGHT_BROWSERS_PATH';

/** Absolute path to the project-local browser directory. Git-ignored. */
export function browsersPath() {
  return fileURLToPath(new URL('../.playwright-browsers/', import.meta.url));
}

/**
 * The environment a Playwright process must run with.
 * @param {NodeJS.ProcessEnv} [baseEnv]
 * @returns {NodeJS.ProcessEnv}
 */
export function playwrightEnv(baseEnv = process.env) {
  return { ...baseEnv, [BROWSERS_ENV_VAR]: browsersPath() };
}

/** Absolute path to the Playwright CLI entry point. */
export function resolvePlaywrightBin() {
  const require = createRequire(import.meta.url);
  return require.resolve('@playwright/test/cli');
}

/**
 * Runs the Playwright CLI, inheriting stdio, and resolves with its exit code.
 * @param {string[]} args
 * @returns {Promise<number>}
 */
export function runPlaywright(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [resolvePlaywrightBin(), ...args], {
      stdio: 'inherit',
      env: playwrightEnv(),
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (signal) {
        reject(new Error(`playwright ${args.join(' ')} terminated by signal ${signal}`));
        return;
      }
      resolve(code ?? 0);
    });
  });
}

/** The variable the live suite reads to decide which origin it drives. */
export const LIVE_ORIGIN_ENV_VAR = 'FAMILY_FINANCE_LIVE_ORIGIN';

/**
 * Pulls `--live-origin=<url>` out of the arguments and into the environment.
 * @param {string[]} args
 * @returns {string[]} the arguments Playwright should see
 */
export function extractLiveOrigin(args) {
  const kept = [];
  for (const arg of args) {
    if (arg.startsWith('--live-origin=')) {
      const given = arg.slice('--live-origin='.length);
      const origin = given.endsWith('/') ? given.slice(0, -1) : given;
      if (!origin.startsWith('https://') && !origin.startsWith('http://localhost')) {
        throw new Error(`--live-origin must be https, or http://localhost: got ${origin}`);
      }
      process.env[LIVE_ORIGIN_ENV_VAR] = origin;
      continue;
    }
    kept.push(arg);
  }
  return kept;
}

async function main() {
  const args = extractLiveOrigin(process.argv.slice(2));
  if (args.length === 0) {
    console.error('Usage: node tools/playwright.mjs <test|install|show-report> [...args]');
    process.exitCode = 2;
    return;
  }
  process.exitCode = await runPlaywright(args);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('Failed to run Playwright:', error instanceof Error ? error.message : error);
    process.exitCode = 2;
  });
}
