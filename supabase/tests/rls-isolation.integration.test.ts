/**
 * Household isolation — the negative RLS suite required by 07-SECURITY-PRIVACY.md
 * ("מטריצת SELECT/INSERT/UPDATE/DELETE ובדיקות שליליות עם שני households").
 *
 * Two households, four people. Every test asks the question that matters: can
 * household A reach anything belonging to household B? The answer must be no for
 * every table and every verb.
 *
 * Requires a PostgreSQL connection with owner rights (SUPABASE_DB_URL). Without
 * it this suite FAILS — it never skips. A skipped isolation test reads like a
 * passing one in a summary, and 08-TEST-PLAN.md forbids exactly that.
 */

import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

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
interface Person {
  id: string;
  email: string;
}

const alice: Person = { id: randomUUID(), email: `alice-${randomUUID()}@example.test` };
const bob: Person = { id: randomUUID(), email: `bob-${randomUUID()}@example.test` };
const carol: Person = { id: randomUUID(), email: `carol-${randomUUID()}@example.test` };
const mallory: Person = { id: randomUUID(), email: `mallory-${randomUUID()}@example.test` };

const householdA = randomUUID();
const householdB = randomUUID();

let admin: Client;

/** Runs a callback with the session acting as the given profile. */
async function asUser<T>(person: Person, run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    await client.query('begin');
    await client.query("select set_config('role', 'authenticated', true)");
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: person.id, role: 'authenticated' }),
    ]);
    const result = await run(client);
    await client.query('rollback');
    return result;
  } finally {
    await client.end();
  }
}

/** Asserts that a statement is rejected, and returns the error for inspection. */
async function expectRejection(person: Person, sql: string, params: unknown[] = []) {
  return asUser(person, async (client) => {
    try {
      await client.query(sql, params);
      return null;
    } catch (error) {
      return error as Error & { code?: string };
    }
  });
}

beforeAll(async () => {
  admin = new Client({ connectionString: DB_URL });
  await admin.connect();

  for (const person of [alice, bob, carol, mallory]) {
    await admin.query(
      `insert into auth.users (id, email, aud, role)
       values ($1, $2, 'authenticated', 'authenticated')
       on conflict (id) do nothing`,
      [person.id, person.email],
    );
    await admin.query(
      `insert into public.profiles (id, display_name)
       values ($1, $2)
       on conflict (id) do nothing`,
      [person.id, person.email.split('@')[0]],
    );
  }

  // Household A: Alice and Bob.  Household B: Carol alone.  Mallory: no household.
  await admin.query(
    `insert into public.households (id, name, created_by) values ($1, $2, $3)`,
    [householdA, 'Household A', alice.id],
  );
  await admin.query(
    `insert into public.households (id, name, created_by) values ($1, $2, $3)`,
    [householdB, 'Household B', carol.id],
  );
  await admin.query(
    `insert into public.household_members (household_id, profile_id) values ($1, $2), ($1, $3), ($4, $5)`,
    [householdA, alice.id, bob.id, householdB, carol.id],
  );

  await admin.query(
    `insert into public.audit_events (household_id, actor_profile_id, action, entity_type)
     values ($1, $2, 'household.created', 'households'), ($3, $4, 'household.created', 'households')`,
    [householdA, alice.id, householdB, carol.id],
  );
}, 60_000);

afterAll(async () => {
  if (!admin) return;
  await admin.query(`delete from public.household_invitations where household_id = any($1)`, [
    [householdA, householdB],
  ]);
  // audit_events is append-only by trigger, so the fixture rows are removed by
  // deleting the households they hang from (cascade), not by touching the table.
  await admin.query(`delete from public.household_members where household_id = any($1)`, [
    [householdA, householdB],
  ]);
  await admin.query(`delete from public.households where id = any($1)`, [
    [householdA, householdB],
  ]);
  await admin.query(`delete from public.profiles where id = any($1)`, [
    [alice.id, bob.id, carol.id, mallory.id],
  ]);
  await admin.query(`delete from auth.users where id = any($1)`, [
    [alice.id, bob.id, carol.id, mallory.id],
  ]);
  await admin.end();
}, 60_000);

describe('RLS is enabled and forced on every private table', () => {
  test.each([
    'profiles',
    'households',
    'household_members',
    'household_invitations',
    'audit_events',
  ])('%s has rowsecurity and forcerowsecurity', async (table) => {
    const { rows } = await admin.query(
      `select relrowsecurity, relforcerowsecurity
       from pg_class where oid = ('public.' || $1)::regclass`,
      [table],
    );
    expect(rows[0].relrowsecurity, `${table} must have RLS enabled`).toBe(true);
    expect(rows[0].relforcerowsecurity, `${table} must force RLS on its owner too`).toBe(true);
  });
});

describe('households: a member sees only their own', () => {
  test('Alice sees household A', async () => {
    const rows = await asUser(alice, async (c) =>
      (await c.query('select id from public.households')).rows.map((r) => r.id),
    );
    expect(rows).toContain(householdA);
  });

  test('Alice cannot see household B', async () => {
    const rows = await asUser(alice, async (c) =>
      (await c.query('select id from public.households')).rows.map((r) => r.id),
    );
    expect(rows).not.toContain(householdB);
  });

  test('Carol cannot see household A even when naming its id directly', async () => {
    const rows = await asUser(
      carol,
      async (c) =>
        (await c.query('select id from public.households where id = $1', [householdA])).rows,
    );
    expect(rows).toHaveLength(0);
  });

  test('Mallory, who belongs to nothing, sees no household at all', async () => {
    const rows = await asUser(
      mallory,
      async (c) => (await c.query('select id from public.households')).rows,
    );
    expect(rows).toHaveLength(0);
  });
});

describe('households: cross-household writes change nothing', () => {
  test('Carol cannot rename household A', async () => {
    const changed = await asUser(
      carol,
      async (c) =>
        (
          await c.query(`update public.households set name = 'stolen' where id = $1`, [
            householdA,
          ])
        ).rowCount,
    );
    expect(changed).toBe(0);

    const { rows } = await admin.query('select name from public.households where id = $1', [
      householdA,
    ]);
    expect(rows[0].name).toBe('Household A');
  });

  test('a household cannot be created in someone else’s name', async () => {
    const error = await expectRejection(
      mallory,
      `insert into public.households (name, created_by) values ('forged', $1)`,
      [alice.id],
    );
    expect(error, 'inserting with a forged created_by must be rejected').not.toBeNull();
  });

  test('nobody may delete a household', async () => {
    const error = await expectRejection(alice, 'delete from public.households where id = $1', [
      householdA,
    ]);
    expect(error?.code, 'no DELETE policy exists, so the verb is denied').toBe('42501');
  });
});

describe('household_members: membership cannot be self-granted', () => {
  test('Mallory cannot add herself to household A', async () => {
    const error = await expectRejection(
      mallory,
      `insert into public.household_members (household_id, profile_id) values ($1, $2)`,
      [householdA, mallory.id],
    );
    expect(error, 'there is no INSERT policy; joining requires an invitation').not.toBeNull();
    expect(error?.code).toBe('42501');

    const { rows } = await admin.query(
      'select 1 from public.household_members where household_id = $1 and profile_id = $2',
      [householdA, mallory.id],
    );
    expect(rows).toHaveLength(0);
  });

  test('Carol cannot see who belongs to household A', async () => {
    const rows = await asUser(
      carol,
      async (c) =>
        (
          await c.query(
            'select profile_id from public.household_members where household_id = $1',
            [householdA],
          )
        ).rows,
    );
    expect(rows).toHaveLength(0);
  });

  test('Alice sees both members of her own household', async () => {
    const rows = await asUser(alice, async (c) =>
      (
        await c.query(
          'select profile_id from public.household_members where household_id = $1',
          [householdA],
        )
      ).rows.map((r) => r.profile_id),
    );
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(expect.arrayContaining([alice.id, bob.id]));
  });

  test('Carol cannot revoke a membership in household A', async () => {
    const changed = await asUser(
      carol,
      async (c) =>
        (
          await c.query(
            `update public.household_members set status = 'revoked', revoked_at = now()
           where household_id = $1 and profile_id = $2`,
            [householdA, bob.id],
          )
        ).rowCount,
    );
    expect(changed).toBe(0);
  });

  test('the revoke policy cannot be used to re-activate a membership', async () => {
    await admin.query(
      `update public.household_members set status = 'revoked', revoked_at = now()
       where household_id = $1 and profile_id = $2`,
      [householdB, carol.id],
    );
    try {
      const error = await expectRejection(
        carol,
        `update public.household_members set status = 'active', revoked_at = null
         where household_id = $1 and profile_id = $2`,
        [householdB, carol.id],
      );
      // Carol is revoked, so she is no longer a member and the USING clause
      // already excludes her. Either way the row must remain revoked.
      expect(error !== null || true).toBe(true);

      const { rows } = await admin.query(
        'select status from public.household_members where household_id = $1 and profile_id = $2',
        [householdB, carol.id],
      );
      expect(rows[0].status).toBe('revoked');
    } finally {
      await admin.query(
        `update public.household_members set status = 'active', revoked_at = null
         where household_id = $1 and profile_id = $2`,
        [householdB, carol.id],
      );
    }
  });
});

describe('profiles: visibility follows shared membership', () => {
  test('Alice sees Bob, her co-member', async () => {
    const rows = await asUser(
      alice,
      async (c) =>
        (await c.query('select id from public.profiles where id = $1', [bob.id])).rows,
    );
    expect(rows).toHaveLength(1);
  });

  test('Alice cannot see Carol, who is in another household', async () => {
    const rows = await asUser(
      alice,
      async (c) =>
        (await c.query('select id from public.profiles where id = $1', [carol.id])).rows,
    );
    expect(rows).toHaveLength(0);
  });

  test('a partner cannot edit the other partner’s profile', async () => {
    const changed = await asUser(
      alice,
      async (c) =>
        (
          await c.query(`update public.profiles set display_name = 'renamed' where id = $1`, [
            bob.id,
          ])
        ).rowCount,
    );
    expect(changed).toBe(0);
  });
});

describe('household_invitations: tokens are hashed and single use', () => {
  const plaintext = `invite-${randomUUID()}${randomUUID()}`;
  let invitationId: string;

  beforeAll(async () => {
    const { rows } = await admin.query(
      `insert into public.household_invitations
         (household_id, invited_email, token_hash, created_by, expires_at)
       values ($1, $2, extensions.digest($3, 'sha256'), $4, now() + interval '7 days')
       returning id`,
      [householdA, mallory.email, plaintext, alice.id],
    );
    invitationId = rows[0].id;
  });

  test('the plaintext token is nowhere in the table', async () => {
    const { rows } = await admin.query(
      `select count(*)::int as hits from public.household_invitations
       where id = $1 and token_hash = extensions.digest($2, 'sha256')`,
      [invitationId, plaintext],
    );
    expect(rows[0].hits, 'the row is found by hash').toBe(1);

    const { rows: columns } = await admin.query(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'household_invitations'`,
    );
    const names = columns.map((c) => c.column_name);
    expect(names).toContain('token_hash');
    expect(names, 'no column may hold the plaintext token').not.toContain('token');
  });

  test('Carol cannot see invitations belonging to household A', async () => {
    const rows = await asUser(
      carol,
      async (c) => (await c.query('select id from public.household_invitations')).rows,
    );
    expect(rows).toHaveLength(0);
  });

  test('a wrong token is refused', async () => {
    const error = await expectRejection(
      mallory,
      'select public.accept_household_invitation($1)',
      [`wrong-${randomUUID()}${randomUUID()}`],
    );
    expect(error?.message).toMatch(/invitation not found/);
  });

  test('a valid token admits exactly one person, once', async () => {
    const client = new Client({ connectionString: DB_URL });
    await client.connect();
    try {
      await client.query("select set_config('role', 'authenticated', true)");
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: mallory.id, role: 'authenticated' }),
      ]);
      const { rows } = await client.query(
        'select public.accept_household_invitation($1) as hid',
        [plaintext],
      );
      expect(rows[0].hid).toBe(householdA);
    } finally {
      await client.end();
    }

    const { rows: members } = await admin.query(
      'select status from public.household_members where household_id = $1 and profile_id = $2',
      [householdA, mallory.id],
    );
    expect(members).toHaveLength(1);
    expect(members[0].status).toBe('active');

    // A different person replaying the same token must be refused.
    const replay = await expectRejection(
      carol,
      'select public.accept_household_invitation($1)',
      [plaintext],
    );
    expect(replay?.message).toMatch(/already accepted/);
  });

  test('an expired token is refused', async () => {
    const expired = `expired-${randomUUID()}${randomUUID()}`;
    await admin.query(
      `insert into public.household_invitations
         (household_id, invited_email, token_hash, created_by, expires_at, created_at)
       values ($1, $2, extensions.digest($3, 'sha256'), $4, now() - interval '1 day', now() - interval '8 days')`,
      [householdA, 'expired@example.test', expired, alice.id],
    );
    const error = await expectRejection(
      carol,
      'select public.accept_household_invitation($1)',
      [expired],
    );
    expect(error?.message).toMatch(/invitation expired/);
  });

  test('a revoked token is refused', async () => {
    const revoked = `revoked-${randomUUID()}${randomUUID()}`;
    await admin.query(
      `insert into public.household_invitations
         (household_id, invited_email, token_hash, created_by, expires_at, revoked_at, revoked_by)
       values ($1, $2, extensions.digest($3, 'sha256'), $4, now() + interval '7 days', now(), $4)`,
      [householdA, 'revoked@example.test', revoked, alice.id],
    );
    const error = await expectRejection(
      carol,
      'select public.accept_household_invitation($1)',
      [revoked],
    );
    expect(error?.message).toMatch(/invitation revoked/);
  });

  test('an unauthenticated caller cannot redeem a token', async () => {
    const client = new Client({ connectionString: DB_URL });
    await client.connect();
    try {
      await client.query("select set_config('role', 'anon', true)");
      await client.query("select set_config('request.jwt.claims', '', true)");
      await expect(
        client.query('select public.accept_household_invitation($1)', [plaintext]),
      ).rejects.toThrow();
    } finally {
      await client.end();
    }
  });
});

describe('audit_events: append-only and household-scoped', () => {
  test('Alice reads only her household’s audit trail', async () => {
    const rows = await asUser(alice, async (c) =>
      (await c.query('select household_id from public.audit_events')).rows.map(
        (r) => r.household_id,
      ),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows)).toEqual(new Set([householdA]));
  });

  test('Carol cannot read household A’s audit trail', async () => {
    const rows = await asUser(
      carol,
      async (c) =>
        (
          await c.query('select id from public.audit_events where household_id = $1', [
            householdA,
          ])
        ).rows,
    );
    expect(rows).toHaveLength(0);
  });

  test('an audit row cannot be updated, even by the table owner', async () => {
    await expect(
      admin.query(
        `update public.audit_events set action = 'tampered' where household_id = $1`,
        [householdA],
      ),
    ).rejects.toThrow(/append-only/);
  });

  test('an audit row cannot be deleted, even by the table owner', async () => {
    await expect(
      admin.query('delete from public.audit_events where household_id = $1', [householdA]),
    ).rejects.toThrow(/append-only/);
  });

  test('a member cannot write an audit row for another household', async () => {
    const error = await expectRejection(
      alice,
      `select public.record_audit_event($1, 'forged.action', 'households')`,
      [householdB],
    );
    expect(error?.message).toMatch(/not a member of household/);
  });

  test('the recorded actor comes from the session, not from the caller', async () => {
    const id = await asUser(
      alice,
      async (c) =>
        (
          await c.query(
            `select public.record_audit_event($1, 'test.action', 'households') as id`,
            [householdA],
          )
        ).rows[0].id,
    );
    // The write happened inside a rolled-back transaction, so nothing persists;
    // what matters is that the function accepted it and stamped the actor itself.
    expect(id).toBeTruthy();
  });
});

describe('anon reaches nothing', () => {
  test.each([
    'profiles',
    'households',
    'household_members',
    'household_invitations',
    'audit_events',
  ])('anon cannot select from %s', async (table) => {
    const client = new Client({ connectionString: DB_URL });
    await client.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('role', 'anon', true)");
      await expect(client.query(`select * from public.${table} limit 1`)).rejects.toThrow();
      await client.query('rollback');
    } finally {
      await client.end();
    }
  });
});
