#!/usr/bin/env node
/**
 * Builds supabase/manual/apply-all.sql from the migration files.
 *
 * The bundle exists because applying five files by hand produced operational
 * mistakes: the SQL Editor retained previous content and two migrations ran as
 * one. One file, pasted once, removes that class of error.
 *
 * The bundle is generated rather than hand-maintained so it cannot drift from
 * the migrations. Every migration is embedded verbatim between markers, and
 * tools/manual-sql.test.mjs reconstructs the sources from the bundle to prove
 * that nothing was added, dropped or reordered.
 *
 * Atomicity: every statement in the migrations is transactional DDL — there is
 * no CREATE INDEX CONCURRENTLY, VACUUM or CREATE DATABASE — so the whole set is
 * wrapped in one BEGIN/COMMIT. A failure at any point rolls the entire bundle
 * back, leaving no half-applied schema.
 *
 * Usage:
 *   node tools/build-manual-bundle.mjs           write the bundle
 *   node tools/build-manual-bundle.mjs --check   fail if the file is out of date
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const MIGRATIONS_DIR = join(REPO_ROOT, 'supabase', 'migrations');
const MANUAL_DIR = join(REPO_ROOT, 'supabase', 'manual');
export const BUNDLE_PATH = join(MANUAL_DIR, 'apply-all.sql');

/** Marker lines that delimit each embedded migration. */
export const beginMarker = (name) => `-- >>> BEGIN MIGRATION: ${name}`;
export const endMarker = (name) => `-- <<< END MIGRATION: ${name}`;

/** @returns {{name: string, sql: string}[]} in application order */
export function readMigrations() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS_DIR, name), 'utf8') }));
}

/** @param {{name: string, sql: string}[]} migrations */
export function renderBundle(migrations) {
  const header = [
    '-- Every migration in this repository, in one atomic transaction.',
    '--',
    '-- GENERATED FILE. Do not edit.',
    '--   source: supabase/migrations/*.sql',
    '--   regenerate: npm run db:build',
    '--   verified by: tools/manual-sql.test.mjs',
    '--',
    `-- Contains ${migrations.length} migrations, in filename order:`,
    ...migrations.map((m, i) => `--   ${i + 1}. ${m.name}`),
    '--',
    '-- Safe to run more than once: every trigger and policy is dropped before it is',
    '-- created, and every enum is created under an existence check (ADR-0015). Running',
    '-- this over a partially applied schema produces the same result as a clean run.',
    '--',
    '-- Atomic: if any statement fails, COMMIT is never reached and the entire',
    '-- transaction rolls back. There is no partially applied state.',
    '--',
    '-- Paste into an EMPTY SQL Editor window and run once.',
    '',
    'begin;',
    '',
  ].join('\n');

  const body = migrations
    .map(({ name, sql }) => [beginMarker(name), sql.trimEnd(), endMarker(name), ''].join('\n'))
    .join('\n');

  const footer = ['commit;', ''].join('\n');

  return `${header}\n${body}\n${footer}`;
}

function main() {
  const check = process.argv.includes('--check');
  const migrations = readMigrations();

  if (migrations.length === 0) {
    console.error('No migrations found in supabase/migrations.');
    process.exitCode = 2;
    return;
  }

  const rendered = renderBundle(migrations);

  if (check) {
    if (!existsSync(BUNDLE_PATH)) {
      console.error('Bundle is missing. Run: npm run db:build');
      process.exitCode = 1;
      return;
    }
    const onDisk = readFileSync(BUNDLE_PATH, 'utf8');
    if (onDisk !== rendered) {
      console.error('Bundle is out of date with supabase/migrations.');
      console.error('Run: npm run db:build');
      process.exitCode = 1;
      return;
    }
    console.log(`Bundle is current (${migrations.length} migrations).`);
    return;
  }

  if (!existsSync(MANUAL_DIR)) mkdirSync(MANUAL_DIR, { recursive: true });
  writeFileSync(BUNDLE_PATH, rendered, 'utf8');
  console.log(`Wrote supabase/manual/apply-all.sql (${migrations.length} migrations).`);
}

// Run only when executed directly; the tests import the helpers instead.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
