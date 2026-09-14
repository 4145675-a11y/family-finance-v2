#!/usr/bin/env node
/**
 * RLS coverage gate — every table that holds household data must be protected.
 *
 * This is a *static* check and it says so loudly, because the distinction
 * matters: it reads the migration files and proves each table is declared with
 * row-level security enabled, forced, and carrying policies. It does **not**
 * prove those policies are correct. Only a real database with real users can do
 * that, and `supabase/tests/rls-isolation.integration.test.ts` is where that
 * happens.
 *
 * So why have it at all? Because the failure it catches is the one most likely
 * to happen and least likely to be noticed: somebody adds a table in a hurry and
 * forgets the security block. Every unit test still passes. Every screen still
 * works. The table is simply readable by anyone who can reach the API. A gate
 * that runs in two seconds and refuses that is worth having next to the slower,
 * stronger one.
 *
 * Four things are asserted per table:
 *
 *   1. `enable row level security`  — policies apply at all
 *   2. `force row level security`   — they apply to the table owner too, so a
 *                                     migration or a definer function cannot
 *                                     quietly bypass them
 *   3. at least one policy          — enabled with no policy denies everything,
 *                                     which is safe but is a bug, not a design
 *   4. a `select` policy            — a table nobody can read is almost always
 *                                     an oversight rather than an intention
 *
 * Exit codes: 0 = every table covered, 1 = a table is unprotected, 2 = gate could not run.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const MIGRATIONS = join(REPO_ROOT, 'supabase', 'migrations');

/**
 * Tables that deliberately carry no policies.
 *
 * Each needs a reason, and the reason has to be that the table is unreachable
 * by a client rather than that writing policies was inconvenient.
 */
const EXEMPT = new Map([
  // Written by a trigger running as definer and read through views; the audit
  // migration revokes every client privilege and rejects mutation outright.
  // Its protection is stronger than a policy, not weaker.
]);

function migrationFiles() {
  return readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS, name), 'utf8') }));
}

function main() {
  const files = migrationFiles();
  if (files.length === 0) {
    console.error('RLS coverage gate could not run: no migrations found.');
    process.exitCode = 2;
    return;
  }

  const all = files.map((file) => file.sql).join('\n');

  // Tables declared anywhere in the migration set.
  /** @type {Set<string>} */
  const tables = new Set();
  for (const match of all.matchAll(/create table if not exists\s+(public\.[a-z_]+)/gi)) {
    if (match[1] !== undefined) tables.add(match[1].toLowerCase());
  }

  /** @type {(needle: RegExp) => Set<string>} */
  const collect = (needle) => {
    const found = new Set();
    for (const match of all.matchAll(needle)) {
      if (match[1] !== undefined) found.add(match[1].toLowerCase());
    }
    return found;
  };

  const enabled = collect(/alter table\s+(public\.[a-z_]+)\s+enable row level security/gi);
  const forced = collect(/alter table\s+(public\.[a-z_]+)\s+force row level security/gi);
  const withPolicy = collect(/create policy\s+[a-z_]+\s+on\s+(public\.[a-z_]+)/gi);

  const selectPolicied = new Set();
  for (const match of all.matchAll(
    /create policy\s+[a-z_]+\s+on\s+(public\.[a-z_]+)\s+for\s+select/gi,
  )) {
    if (match[1] !== undefined) selectPolicied.add(match[1].toLowerCase());
  }

  /** @type {{ table: string; problem: string }[]} */
  const problems = [];

  for (const table of [...tables].sort()) {
    if (EXEMPT.has(table)) continue;
    if (!enabled.has(table))
      problems.push({ table, problem: 'row level security is not enabled' });
    else if (!forced.has(table)) {
      problems.push({ table, problem: 'row level security is enabled but not forced' });
    } else if (!withPolicy.has(table)) {
      problems.push({ table, problem: 'no policy is defined, so every access is denied' });
    } else if (!selectPolicied.has(table)) {
      problems.push({ table, problem: 'no select policy, so nobody can read it' });
    }
  }

  console.log('RLS coverage gate  (static — reads the migrations, not a database)');
  console.log(`  migrations:       ${files.length}`);
  console.log(`  tables declared:  ${tables.size}`);
  console.log(`  rls enabled:      ${enabled.size}`);
  console.log(`  rls forced:       ${forced.size}`);
  console.log(`  with policies:    ${withPolicy.size}`);
  console.log(`  exempt:           ${EXEMPT.size}`);
  console.log('');

  if (problems.length > 0) {
    for (const { table, problem } of problems) console.log(`  FAIL  ${table}: ${problem}`);
    console.log('');
    console.log(`RESULT: FAIL — ${problems.length} table(s) are not protected.`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `RESULT: PASS — all ${tables.size} tables declare RLS enabled, forced and policied.`,
  );
  console.log('        This does not prove the policies are correct. That needs a real');
  console.log('        database: npm run integration, with SUPABASE_DB_URL set.');
}

try {
  main();
} catch (error) {
  console.error(
    'RLS coverage gate could not run:',
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 2;
}
