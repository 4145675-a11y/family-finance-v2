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
 * Usage: node tools/playwright.mjs <test|install|show-report> [...args]
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

async function main() {
  const args = process.argv.slice(2);
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
