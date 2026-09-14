#!/usr/bin/env node
/**
 * Read-only: reports whether the database holds any household data, any
 * synthetic test identity, and whether every table still has RLS enabled and
 * forced with the audit guards live.
 *
 * Run after any integration phase. Prints counts and booleans only — never a
 * row, never an identifier, never the connection string (read from the
 * environment or `.env.integration.local`, exactly as apply-migration.mjs does).
 *
 * Exit code: 0 when the database is clean and guarded, 1 otherwise, 2 when it
 * could not run.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const ENV_FILE = resolve(REPO_ROOT, '.env.integration.local');

function connectionString() {
  const fromEnvironment = process.env.SUPABASE_DB_URL;
  if (fromEnvironment !== undefined && fromEnvironment !== '') return fromEnvironment;
  if (!existsSync(ENV_FILE)) return undefined;
  for (const rawLine of readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^export\s+/, '');
    if (line === '' || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0 || line.slice(0, separator).trim() !== 'SUPABASE_DB_URL') continue;
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

const url = connectionString();
if (url === undefined) {
  console.error('SUPABASE_DB_URL is not available. Nothing was checked.');
  process.exit(2);
}

const client = new pg.Client({ connectionString: url });
let clean = true;
/** @param {string} label @param {number | boolean} value @param {boolean} ok */
function report(label, value, ok) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(44)} ${String(value)}`);
  if (!ok) clean = false;
}

try {
  await client.connect();
  const count = async (/** @type {string} */ sql) =>
    Number((await client.query(sql)).rows[0]?.n ?? 0);

  report('households', await count('select count(*)::int as n from public.households'), true);
  report('profiles', await count('select count(*)::int as n from public.profiles'), true);
  const synthetic = await count(
    `select count(*)::int as n from auth.users where email like '%@example.test'`,
  );
  report('synthetic auth users (@example.test)', synthetic, synthetic === 0);
  const households = await count('select count(*)::int as n from public.households');
  report(
    'audit_events',
    await count('select count(*)::int as n from public.audit_events'),
    true,
  );
  report('database holds no household', households, households === 0);

  const { rows: rls } = await client.query(
    `select count(*)::int as tables,
            count(*) filter (where c.relrowsecurity and c.relforcerowsecurity)::int as forced
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'`,
  );
  report('public tables', rls[0].tables, true);
  report('tables with RLS enabled and forced', rls[0].forced, rls[0].forced === rls[0].tables);

  const { rows: guards } = await client.query(
    `select tgname, tgenabled from pg_trigger
     where tgrelid = 'public.audit_events'::regclass and not tgisinternal`,
  );
  const live = guards.filter((g) => g.tgenabled === 'O').length;
  report('audit guards enabled', `${live}/${guards.length}`, guards.length === 2 && live === 2);

  const voidGuards = await count(
    `select count(*)::int as n from pg_trigger
     where tgname in ('account_balance_snapshots_only_void', 'debt_events_only_void') and tgenabled = 'O'`,
  );
  report('void-only guards enabled', `${voidGuards}/2`, voidGuards === 2);
} catch (error) {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : 'unknown';
  console.error(`could not check (code=${String(code)}).`);
  process.exit(2);
} finally {
  await client.end().catch(() => undefined);
}

console.log(clean ? 'RESULT: PASS — clean and guarded.' : 'RESULT: FAIL — see above.');
process.exit(clean ? 0 : 1);
