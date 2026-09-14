#!/usr/bin/env node
/**
 * Env-file gate — no environment file may reach the repository or the build.
 *
 * Written because the fail-closed gate found this the hard way. A check that
 * removed `NEXT_PUBLIC_SUPABASE_URL` from a spawned server's environment had no
 * effect: Next loads `apps/web/.env.local` at startup and put it back. The
 * check was wrong, but what it revealed is not — **a file on disk silently
 * supplies configuration, and wins over the absence of a variable.**
 *
 * On Render that is a hole rather than a convenience. An `.env` file baked into
 * a deployment would override the platform's own secret management with values
 * nobody is watching, would survive rotation, and would sit inside the build
 * output where it can be read by anything that can read the image.
 *
 * So: none tracked by git, and none inside `.next`. `.env.example` is the one
 * exception, because it holds names and no values — that is what it is for.
 *
 * Exit codes: 0 = clean, 1 = a file was found, 2 = gate could not run.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const BUILD_DIR = join(REPO_ROOT, 'apps', 'web', '.next');

/** Holds names, never values. The whole point of the file. */
const ALLOWED = new Set(['.env.example']);

/** @param {string} name */
function isEnvFile(name) {
  return name === '.env' || name.startsWith('.env.');
}

/** Files git is tracking. A tracked env file is one commit from being published. */
function trackedEnvFiles() {
  const output = execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' });
  return output
    .split('\n')
    .filter(Boolean)
    .filter((path) => {
      const name = path.slice(path.lastIndexOf('/') + 1);
      return isEnvFile(name) && !ALLOWED.has(name);
    });
}

/**
 * Env files inside the build output.
 *
 * @param {string} directory
 * @returns {string[]}
 */
function envFilesUnder(directory) {
  if (!existsSync(directory)) return [];

  /** @type {string[]} */
  const found = [];
  /** @type {string[]} */
  const queue = [directory];

  while (queue.length > 0) {
    const current = queue.pop();
    if (current === undefined) break;

    for (const entry of readdirSync(current)) {
      const path = join(current, entry);
      let info;
      try {
        info = statSync(path);
      } catch {
        // A file that vanished mid-scan is not evidence of anything.
        continue;
      }
      if (info.isDirectory()) {
        queue.push(path);
        continue;
      }
      if (isEnvFile(entry) && !ALLOWED.has(entry)) found.push(relative(REPO_ROOT, path));
    }
  }

  return found;
}

function main() {
  console.log('Env-file gate');

  const tracked = trackedEnvFiles();
  const built = envFilesUnder(BUILD_DIR);

  console.log(`  tracked by git:   ${tracked.length}`);
  console.log(`  inside the build: ${built.length}`);
  console.log(`  allowed:          ${[...ALLOWED].join(', ')}`);
  console.log('');

  if (tracked.length === 0 && built.length === 0) {
    console.log('RESULT: PASS — no environment file is tracked or bundled.');
    return;
  }

  for (const path of tracked) console.log(`  FAIL  tracked by git: ${path}`);
  for (const path of built) console.log(`  FAIL  inside the build output: ${path}`);
  console.log('');
  console.log('RESULT: FAIL — an environment file would travel with this deployment.');
  process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error('Env-file gate could not run:', error instanceof Error ? error.message : error);
  process.exitCode = 2;
}
