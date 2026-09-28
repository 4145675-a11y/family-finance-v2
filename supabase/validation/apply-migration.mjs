/**
 * Applies one migration, checks the invariants it promises, and only then commits.
 *
 * The repository's normal path is the manual bundle: the owner pastes
 * `supabase/manual/apply-all.sql` into the SQL editor (ADR-0019). This exists for
 * the case that bundle cannot cover — running a single new migration against the
 * database the integration suite uses, so the suite can prove the policies before
 * anyone is asked to apply anything by hand.
 *
 * Two properties make it safe to run:
 *
 *   1. **One transaction.** The migration and the checks share it. A failed check
 *      rolls the migration back, so the database is either fully migrated or
 *      exactly as it was.
 *   2. **It never prints the connection string**, not even its host or its
 *      length. Everything it reports is a count.
 *
 * Usage: node supabase/validation/apply-migration.mjs <migration-file>
 */
import { existsSync, readFileSync } from 'node:fs';
import { argv, env, exit } from 'node:process';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

/**
 * The same file the integration suite reads, parsed the same way.
 *
 * Two rules, both borrowed from `supabase/tests/load-env.ts`: a value already in
 * the environment wins, and nothing is ever printed — not the value, not a
 * prefix, not its length. A connection string carries the database password.
 */
function loadConnectionString() {
  if (env.SUPABASE_DB_URL) return env.SUPABASE_DB_URL;
  const local = fileURLToPath(new URL('../../.env.integration.local', import.meta.url));
  if (!existsSync(local)) return undefined;
  for (const raw of readFileSync(local, 'utf8').split(/\r?\n/)) {
    const line = raw.trim().replace(/^export\s+/, '');
    if (line === '' || line.startsWith('#')) continue;
    const at = line.indexOf('=');
    if (at < 0) continue;
    if (line.slice(0, at).trim() !== 'SUPABASE_DB_URL') continue;
    const value = line.slice(at + 1).trim();
    const quoted = /^(['"])(.*)\1$/u.exec(value);
    return quoted === null ? value : (quoted[2] ?? '');
  }
  return undefined;
}

const file = argv[2];
if (file === undefined) {
  console.error('usage: node supabase/validation/apply-migration.mjs <migration-file>');
  exit(2);
}

const url = loadConnectionString();
if (!url) {
  console.error('SUPABASE_DB_URL is not set. Nothing was attempted.');
  exit(2);
}

/**
 * What must be true once this migration has run.
 *
 * Each one returns a count that has to be zero. They are written as questions
 * about the schema rather than about any household's contents, so nothing here
 * reads a family's data.
 */
const INVARIANTS = [
  {
    says: 'every household has an active owner',
    sql: `select count(*)::int as wrong
          from public.households h
          where not exists (
            select 1 from public.household_members hm
            where hm.household_id = h.id and hm.status = 'active' and hm.role = 'owner'
          )`,
  },
  {
    says: 'no household has lost its members',
    sql: `select count(*)::int as wrong
          from public.households h
          where not exists (
            select 1 from public.household_members hm
            where hm.household_id = h.id and hm.status = 'active'
          )`,
  },
  {
    says: 'the owner-only policies are in place',
    sql: `select (3 - count(*))::int as wrong
          from pg_policies
          where schemaname = 'public'
            and policyname in (
              'household_members_administer',
              'household_invitations_insert_owner',
              'household_invitations_revoke_owner'
            )`,
  },
];

const client = new pg.Client({ connectionString: url });
await client.connect();

try {
  await client.query('begin');
  await client.query(readFileSync(file, 'utf8'));

  let failed = false;
  for (const invariant of INVARIANTS) {
    const { rows } = await client.query(invariant.sql);
    const wrong = Number(rows[0]?.wrong ?? -1);
    const ok = wrong === 0;
    if (!ok) failed = true;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${invariant.says}${ok ? '' : ` — ${wrong} wrong`}`);
  }

  if (failed) {
    await client.query('rollback');
    console.error('\nRESULT: FAIL — rolled back. The database is as it was.');
    exit(1);
  }

  await client.query('commit');
  console.log('\nRESULT: PASS — applied and committed.');
} catch (error) {
  await client.query('rollback').catch(() => undefined);
  // The message can name a relation or a constraint; it never carries the URL.
  console.error('\nRESULT: FAIL — rolled back.');
  console.error(error instanceof Error ? error.message : String(error));
  exit(1);
} finally {
  await client.end();
}
