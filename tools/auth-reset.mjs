#!/usr/bin/env node
/**
 * Turns the lock off from the machine itself.
 *
 * This is the recovery route, and it is deliberately the only one. There is no
 * bypass code, no master password and no "forgot my passkey" link, because every
 * one of those is a second way in that is weaker than the first — and a lock
 * whose recovery is weaker than the lock is worth exactly what the recovery is
 * worth.
 *
 * What it needs instead is the thing a remote attacker does not have: the ability
 * to run a command in this project directory on this computer. That is the same
 * access that would let somebody read `.data/household.json` directly, so this
 * gives away nothing that was being protected. The security page says so in as
 * many words rather than implying the files are sealed.
 *
 * It cannot run in production by accident:
 *
 *   - it is a command line script, not a route. Nothing the browser can reach
 *     leads here, so no request can trigger it;
 *   - with `NODE_ENV=production` it refuses unless `--i-am-at-the-machine` is
 *     passed as well, so an operator has to say what they are doing;
 *   - it removes credentials and sessions only, and never touches
 *     `household.json`. A person locked out does not also lose their money.
 *
 * Usage: npm run auth:reset
 */

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The data directory, resolved the same way the application resolves it. */
function dataRoot() {
  const configured = process.env['FAMILY_FINANCE_DATA_DIR'];
  return configured === undefined || configured.trim() === ''
    ? join(PROJECT_ROOT, '.data')
    : resolve(configured);
}

async function main() {
  const args = process.argv.slice(2);
  const acknowledged = args.includes('--i-am-at-the-machine');

  if (process.env['NODE_ENV'] === 'production' && !acknowledged) {
    console.error(
      'Refusing to reset the lock with NODE_ENV=production.\n' +
        'If this really is what you want, run it again with --i-am-at-the-machine.',
    );
    process.exitCode = 2;
    return;
  }

  const authFile = join(dataRoot(), 'auth.json');

  if (!existsSync(authFile)) {
    console.log('There is no sign-in file here, so the application is already open.');
    console.log(`Looked in: ${authFile}`);
    return;
  }

  let state;
  try {
    state = JSON.parse(await readFile(authFile, 'utf8'));
  } catch {
    console.error(`The sign-in file could not be read: ${authFile}`);
    console.error('Delete it by hand to open the application. No financial data is in it.');
    process.exitCode = 1;
    return;
  }

  const removed = Array.isArray(state.credentials) ? state.credentials.length : 0;
  const now = new Date().toISOString();

  // Rewritten rather than deleted, so the reset itself is recorded. A lock that
  // can be removed without leaving a trace is a lock nobody can audit.
  const reset = {
    ...state,
    updatedAt: now,
    credentials: [],
    challenges: [],
    sessions: [],
    log: [
      ...(Array.isArray(state.log) ? state.log : []),
      {
        id: crypto.randomUUID(),
        at: now,
        event: 'recovery_reset',
        credentialId: null,
        reason: `removed_${removed}`,
      },
    ].slice(-1000),
  };

  await writeFile(authFile, `${JSON.stringify(reset, null, 2)}\n`, 'utf8');

  console.log(`Removed ${removed} passkey${removed === 1 ? '' : 's'} and every open session.`);
  console.log('The application now opens without asking.');
  console.log('Your financial data was not touched: household.json is unchanged.');
  console.log('Set a new passkey up at /security when you are ready.');
}

main().catch((error) => {
  console.error('The reset did not complete:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
