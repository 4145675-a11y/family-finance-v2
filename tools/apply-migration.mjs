#!/usr/bin/env node
/**
 * Applies one or more migration files to the database named by
 * `SUPABASE_DB_URL`, each inside its own transaction.
 *
 * Written for the forward migrations of the production data layer, where the
 * documented alternatives (pasting into Studio, the Supabase CLI, psql) either
 * need a tool that is not installed here or a human at a keyboard. This does
 * exactly what `psql -v ON_ERROR_STOP=1 -f file` would do, and nothing more:
 * no schema tracking, no ordering decisions, no retries. A file that fails
 * rolls back completely and the tool exits non-zero.
 *
 * The connection string is read from the environment, or from
 * `.env.integration.local` when the environment does not have it. It is never
 * printed, hashed, measured or echoed, and it is never placed on a command
 * line. Output is the file name, the file's SHA-256, and the outcome.
 *
 * Usage: node tools/apply-migration.mjs supabase/migrations/<file>.sql [...]
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const MIGRATIONS_DIR = resolve(REPO_ROOT, 'supabase', 'migrations');
const ENV_FILE = resolve(REPO_ROOT, '.env.integration.local');

/** Minimal KEY=VALUE reader, identical in spirit to supabase/tests/load-env.ts. Prints nothing. */
function connectionString() {
  const fromEnvironment = process.env.SUPABASE_DB_URL;
  if (fromEnvironment !== undefined && fromEnvironment !== '') return fromEnvironment;
  if (!existsSync(ENV_FILE)) return undefined;
  for (const rawLine of readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^export\s+/, '');
    if (line === '' || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    if (line.slice(0, separator).trim() !== 'SUPABASE_DB_URL') continue;
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return undefined;
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: node tools/apply-migration.mjs supabase/migrations/<file>.sql [...]');
  process.exit(2);
}

for (const file of files) {
  const absolute = resolve(REPO_ROOT, file);
  const inside = relative(MIGRATIONS_DIR, absolute);
  if (inside.startsWith('..') || inside.includes(sep) || !inside.endsWith('.sql')) {
    console.error(
      `refusing ${file}: only files directly under supabase/migrations are applied.`,
    );
    process.exit(2);
  }
  if (!existsSync(absolute)) {
    console.error(`refusing ${file}: not found.`);
    process.exit(2);
  }
}

const url = connectionString();
if (url === undefined) {
  console.error(
    'SUPABASE_DB_URL is not set and .env.integration.local does not provide it. Nothing was applied.',
  );
  process.exit(2);
}

const client = new pg.Client({ connectionString: url });
let exitCode = 0;
try {
  await client.connect();
  for (const file of files) {
    const absolute = resolve(REPO_ROOT, file);
    const sql = readFileSync(absolute, 'utf8');
    const digest = createHash('sha256').update(sql).digest('hex');
    console.log(`${basename(absolute)}  sha256=${digest}`);
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('commit');
      console.log('  applied');
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      // The error names the statement or object that failed; it never carries
      // the connection string.
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  FAILED and rolled back: ${message}`);
      exitCode = 1;
      break;
    }
  }
} catch (error) {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : 'unknown';
  console.error(`could not connect (code=${String(code)}). Nothing was applied.`);
  exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}

process.exit(exitCode);
