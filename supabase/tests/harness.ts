/**
 * The shared harness for every integration suite that runs against the real
 * database.
 *
 * One owner connection, one transaction, rolled back at the end — nothing a
 * suite does is ever committed, so the database is left as it was found even
 * when a test fails or the process dies. Acting as a person happens inside a
 * savepoint on that same connection, where `set_config(..., is_local => true)`
 * sets the role and the JWT claims and `rollback to savepoint` restores both.
 * Row-level security is evaluated per statement against the current role, so
 * the proof is the same as over separate connections.
 *
 * Why not delete in a teardown: `audit_events` is append-only through
 * statement-level triggers that fire on cascades too, so a household, profile
 * or auth user can never be deleted (see docs/checkpoints/milestone-2.md).
 * Rollback is the only cleanup that cannot leave anything behind.
 *
 * The connection string comes from `SUPABASE_DB_URL` (loaded by load-env.ts).
 * Nothing here ever prints it.
 */

import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';

const DB_URL = process.env.SUPABASE_DB_URL;

if (!DB_URL) {
  throw new Error(
    [
      'SUPABASE_DB_URL is not set, so household isolation cannot be verified.',
      '',
      'This suite proves that one family cannot read or modify another family’s',
      'data. It is not optional and it does not skip.',
      '',
      'Provide a connection string locally (never in chat, never committed):',
      '  1. Supabase Studio → Project Settings → Database → Connection string (URI)',
      '  2. Put it in .env.integration.local at the repository root:',
      '       SUPABASE_DB_URL=postgresql://postgres:...@...:5432/postgres',
      '  3. Run: npm run integration',
      '',
      '.env.integration.local is git-ignored.',
    ].join('\n'),
  );
}

/** A person in the fixture: an auth user plus their profile. */
export interface Person {
  readonly id: string;
  readonly email: string;
}

/** Who a statement runs as: a signed-in person, the anonymous role, or the table owner. */
export type Actor = Person | 'anon' | 'owner';

export type PgError = Error & { code?: string };

export interface Fixture {
  /** Household A: Alice and Bob. */
  readonly alice: Person;
  readonly bob: Person;
  /** Household B: Carol alone. */
  readonly carol: Person;
  /** Belongs to nothing. */
  readonly mallory: Person;
  readonly householdA: string;
  readonly householdB: string;
}

function person(name: string): Person {
  return { id: randomUUID(), email: `${name}-${randomUUID()}@example.test` };
}

/** The connection every suite shares. Owner rights, one transaction, rolled back. */
let admin: Client | null = null;
let transactionOpen = false;

export function ownerClient(): Client {
  if (admin === null) throw new Error('the harness has not connected yet');
  return admin;
}

/** Switches the current transaction to act as `actor` until the enclosing savepoint ends. */
async function impersonate(actor: Actor): Promise<void> {
  if (actor === 'owner') return;
  const client = ownerClient();
  const role = actor === 'anon' ? 'anon' : 'authenticated';
  const claims =
    actor === 'anon' ? '' : JSON.stringify({ sub: actor.id, role: 'authenticated' });
  await client.query("select set_config('role', $1, true)", [role]);
  await client.query("select set_config('request.jwt.claims', $1, true)", [claims]);
}

/**
 * Returns to the owner. Needed after a released savepoint: a local setting made
 * inside a subtransaction survives its release and would otherwise leak into
 * every later statement of the test.
 */
async function backToOwner(): Promise<void> {
  const client = ownerClient();
  await client.query("select set_config('role', 'none', true)");
  await client.query("select set_config('request.jwt.claims', '', true)");
}

/**
 * Runs a callback as the given actor inside a savepoint.
 *
 * By default the savepoint is rolled back, so nothing the callback did — not a
 * write, not a failed statement — survives it. With `keep: true` the savepoint
 * is released instead and the writes stay visible for the rest of the test.
 */
export async function asUser<T>(
  actor: Actor,
  run: (client: Client) => Promise<T>,
  { keep = false }: { keep?: boolean } = {},
): Promise<T> {
  const client = ownerClient();
  await client.query('savepoint impersonation');
  let result: T;
  try {
    await impersonate(actor);
    result = await run(client);
  } catch (error) {
    await client.query('rollback to savepoint impersonation');
    await client.query('release savepoint impersonation');
    await backToOwner();
    throw error;
  }
  if (keep) {
    await client.query('release savepoint impersonation');
  } else {
    await client.query('rollback to savepoint impersonation');
    await client.query('release savepoint impersonation');
  }
  await backToOwner();
  return result;
}

/** Runs a statement as the actor and returns the error it raised, or null if it succeeded. */
export async function expectRejection(
  actor: Actor,
  sql: string,
  params: unknown[] = [],
): Promise<PgError | null> {
  return asUser(actor, async (client) => {
    try {
      await client.query(sql, params);
      return null;
    } catch (error) {
      return error as PgError;
    }
  });
}

/** Runs a statement as the actor and returns the rows it produced. */
export async function rowsAs<T extends Record<string, unknown> = Record<string, unknown>>(
  actor: Actor,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return asUser(actor, async (client) => (await client.query<T>(sql, params)).rows);
}

/** Runs a statement as the actor and returns how many rows it touched. */
export async function rowCountAs(
  actor: Actor,
  sql: string,
  params: unknown[] = [],
): Promise<number> {
  return asUser(actor, async (client) => (await client.query(sql, params)).rowCount ?? 0);
}

/**
 * Registers the shared lifecycle for a suite and returns its fixture.
 *
 * `seed` runs as the owner inside the transaction, after the people and
 * households exist, so a suite can add the rows its tables need.
 */
export function useHouseholdFixture(
  seed: (client: Client, fixture: Fixture) => Promise<void> = async () => undefined,
): Fixture {
  const fixture: Fixture = {
    alice: person('alice'),
    bob: person('bob'),
    carol: person('carol'),
    mallory: person('mallory'),
    householdA: randomUUID(),
    householdB: randomUUID(),
  };

  beforeAll(async () => {
    admin = new Client({ connectionString: DB_URL });
    await admin.connect();
    await admin.query('begin');
    transactionOpen = true;

    for (const p of [fixture.alice, fixture.bob, fixture.carol, fixture.mallory]) {
      await admin.query(
        `insert into auth.users (id, email, aud, role)
         values ($1, $2, 'authenticated', 'authenticated')
         on conflict (id) do nothing`,
        [p.id, p.email],
      );
      await admin.query(
        `insert into public.profiles (id, display_name)
         values ($1, $2)
         on conflict (id) do nothing`,
        [p.id, p.email.split('@')[0]],
      );
    }

    await admin.query(
      `insert into public.households (id, name, created_by) values ($1, $2, $3), ($4, $5, $6)`,
      [
        fixture.householdA,
        'Household A',
        fixture.alice.id,
        fixture.householdB,
        'Household B',
        fixture.carol.id,
      ],
    );
    await admin.query(
      `insert into public.household_members (household_id, profile_id)
       values ($1, $2), ($1, $3), ($4, $5)`,
      [
        fixture.householdA,
        fixture.alice.id,
        fixture.bob.id,
        fixture.householdB,
        fixture.carol.id,
      ],
    );
    await admin.query(
      `insert into public.audit_events (household_id, actor_profile_id, action, entity_type)
       values ($1, $2, 'household.created', 'households'), ($3, $4, 'household.created', 'households')`,
      [fixture.householdA, fixture.alice.id, fixture.householdB, fixture.carol.id],
    );

    await seed(admin, fixture);
  }, 60_000);

  afterAll(async () => {
    if (admin === null) return;
    // The fixture was never committed. Rolling back is the whole teardown.
    if (transactionOpen) await admin.query('rollback');
    transactionOpen = false;
    await admin.end();
    admin = null;
  }, 60_000);

  // Each test starts from the pristine fixture and cannot poison the next one.
  beforeEach(async () => {
    await ownerClient().query('savepoint test_case');
  });

  afterEach(async () => {
    const client = ownerClient();
    await client.query('rollback to savepoint test_case');
    await client.query('release savepoint test_case');
  });

  return fixture;
}

/** Inserts a row as the owner and returns its id. Fixture helper. */
export async function ownerInsert(
  table: string,
  columns: Record<string, unknown>,
): Promise<string> {
  const keys = Object.keys(columns);
  const placeholders = keys.map((_, i) => `$${i + 1}`);
  const { rows } = await ownerClient().query<{ id: string }>(
    `insert into public.${table} (${keys.join(', ')}) values (${placeholders.join(', ')}) returning id`,
    keys.map((k) => columns[k]),
  );
  const row = rows[0];
  if (row === undefined) throw new Error(`insert into ${table} returned no row`);
  return row.id;
}

/** SQLSTATE for "permission denied" — the code a missing grant or a failed policy raises. */
export const PERMISSION_DENIED = '42501';
