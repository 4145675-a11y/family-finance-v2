#!/usr/bin/env node
/**
 * Next.js launcher.
 *
 * Every local Next command goes through here so that `NEXT_TELEMETRY_DISABLED=1` is set
 * the same way on Windows, macOS, Linux and CI. npm scripts cannot set an environment
 * variable portably, `next telemetry disable` writes a user-level file outside the
 * project root (forbidden by the safety boundary in CLAUDE.md), and a committed `.env`
 * would carve an exception into the rule that keeps env files out of the repository.
 *
 * Zero dependencies: Node built-ins only, matching the rest of tools/.
 *
 * Usage: node tools/next.mjs <dev|build|start> [...args]
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

/** The variable Next reads to skip telemetry collection. */
export const TELEMETRY_ENV_VAR = 'NEXT_TELEMETRY_DISABLED';

/**
 * Returns the environment a Next process must run with.
 * Telemetry is forced off and cannot be re-enabled by an inherited value.
 * @param {NodeJS.ProcessEnv} [baseEnv]
 * @returns {NodeJS.ProcessEnv}
 */
export function nextEnv(baseEnv = process.env) {
  return { ...baseEnv, [TELEMETRY_ENV_VAR]: '1' };
}

/** Absolute path to the Next CLI entry point. */
export function resolveNextBin() {
  const require = createRequire(import.meta.url);
  return require.resolve('next/dist/bin/next');
}

/**
 * Runs the Next CLI, inheriting stdio, and resolves with its exit code.
 * @param {string[]} args
 * @returns {Promise<number>}
 */
export function runNext(args) {
  return new Promise((resolve, reject) => {
    // Spawning `node <bin>` rather than the shell shim avoids .cmd/.ps1 resolution
    // differences between Windows and POSIX.
    const child = spawn(process.execPath, [resolveNextBin(), ...args], {
      stdio: 'inherit',
      env: nextEnv(),
    });

    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (signal) {
        reject(new Error(`next ${args.join(' ')} terminated by signal ${signal}`));
        return;
      }
      resolve(code ?? 0);
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: node tools/next.mjs <dev|build|start> [...args]');
    process.exitCode = 2;
    return;
  }
  process.exitCode = await runNext(args);
}

// Run only when executed directly; the test suite imports the helpers instead.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('Failed to run Next:', error instanceof Error ? error.message : error);
    process.exitCode = 2;
  });
}
