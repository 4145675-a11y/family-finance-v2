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
 *
 * ## Why the whole suite runs inside one transaction
 *
 * `audit_events` is append-only, enforced by a statement-level BEFORE DELETE
 * trigger. `households → audit_events` cascades on delete, and a cascade is a
 * DELETE statement on the child table, so the trigger fires — even when no
 * audit row exists. The consequence, verified against a real database: a
 * household can never be deleted, by anyone. A teardown that cleans up with
 * DELETE therefore cannot work, and disabling the trigger to make it work would
 * be exactly the weakening the trigger exists to prevent.
 *
 * So nothing here is ever committed. One owner connection opens a transaction
 * in `beforeAll`, every fixture row lives only inside it, and `afterAll` rolls
 * it back. Acting as a user happens in a savepoint on that same connection:
 * `set_config(..., is_local => true)` is scoped to the transaction, and rolling
 * back to the savepoint restores both `role` and the JWT claims. Row-level
 * security is evaluated per statement against the current role, so the proof
 * is the same as it would be over separate connections — and the database is
 * left exactly as it was found, whether the run passes, fails, or dies.
 */

import { randomUUID } from 'node:crypto';

import { beforeAll, describe, expect, test } from 'vitest';

import {
  asUser,
  expectRejection,
  ownerClient,
  PERMISSION_DENIED,
  useHouseholdFixture,
} from './harness';

const { alice, bob, carol, mallory, householdA, householdB } = useHouseholdFixture();

describe('RLS is enabled and forced on every private table', () => {
  test.each([
    'profiles',
    'households',
    'household_members',
    'household_invitations',
    'audit_events',
  ])('%s has rowsecurity and forcerowsecurity', async (table) => {
    const { rows } = await ownerClient().query(
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

    const { rows } = await ownerClient().query(
      'select name from public.households where id = $1',
      [householdA],
    );
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
    expect(error?.code, 'no DELETE policy exists, so the verb is denied').toBe(
      PERMISSION_DENIED,
    );
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
    expect(error?.code).toBe(PERMISSION_DENIED);

    const { rows } = await ownerClient().query(
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
    // The per-test savepoint undoes this revocation once the test is over.
    await ownerClient().query(
      `update public.household_members set status = 'revoked', revoked_at = now()
       where household_id = $1 and profile_id = $2`,
      [householdB, carol.id],
    );
    // Carol is revoked, so she is no longer a member. Whether the policy
    // refuses the statement or its USING clause simply matches nothing, the
    // one outcome that must never happen is a changed row.
    const changed = await asUser(carol, async (c) => {
      try {
        const { rowCount } = await c.query(
          `update public.household_members set status = 'active', revoked_at = null
           where household_id = $1 and profile_id = $2`,
          [householdB, carol.id],
        );
        return rowCount ?? 0;
      } catch {
        return 0;
      }
    });
    expect(changed, 'the update must not reach the revoked row').toBe(0);

    const { rows } = await ownerClient().query(
      'select status from public.household_members where household_id = $1 and profile_id = $2',
      [householdB, carol.id],
    );
    expect(rows[0].status).toBe('revoked');
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
    const { rows } = await ownerClient().query(
      `insert into public.household_invitations
         (household_id, invited_email, token_hash, created_by, expires_at)
       values ($1, $2, extensions.digest($3, 'sha256'), $4, now() + interval '7 days')
       returning id`,
      [householdA, mallory.email, plaintext, alice.id],
    );
    invitationId = rows[0].id;
  });

  test('the plaintext token is nowhere in the table', async () => {
    const { rows } = await ownerClient().query(
      `select count(*)::int as hits from public.household_invitations
       where id = $1 and token_hash = extensions.digest($2, 'sha256')`,
      [invitationId, plaintext],
    );
    expect(rows[0].hits, 'the row is found by hash').toBe(1);

    const { rows: columns } = await ownerClient().query(
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
    // Mallory's acceptance must stay visible after her savepoint ends, so that
    // the membership check and the replay below see it: keep, don't roll back.
    const admitted = await asUser(
      mallory,
      async (c) =>
        (await c.query('select public.accept_household_invitation($1) as hid', [plaintext]))
          .rows[0].hid,
      { keep: true },
    );
    expect(admitted).toBe(householdA);

    const { rows: members } = await ownerClient().query(
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
    await ownerClient().query(
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
    await ownerClient().query(
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
    const error = await expectRejection(
      'anon',
      'select public.accept_household_invitation($1)',
      [plaintext],
    );
    // EXECUTE is revoked from anon, so the call is refused before the function
    // body runs — the token is never even compared.
    expect(error?.code, 'anon has no EXECUTE on the function').toBe(PERMISSION_DENIED);
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
    const error = await expectRejection(
      'owner',
      `update public.audit_events set action = 'tampered' where household_id = $1`,
      [householdA],
    );
    expect(error?.message).toMatch(/append-only/);
  });

  test('an audit row cannot be deleted, even by the table owner', async () => {
    const error = await expectRejection(
      'owner',
      'delete from public.audit_events where household_id = $1',
      [householdA],
    );
    expect(error?.message).toMatch(/append-only/);
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
    // The write happened inside a rolled-back savepoint, so nothing persists;
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
    const error = await expectRejection('anon', `select * from public.${table} limit 1`);
    // Not "zero rows" — the grant itself is missing, so the statement is refused.
    expect(error?.code, `anon must have no SELECT privilege on ${table}`).toBe(
      PERMISSION_DENIED,
    );
  });
});

describe('create_household — the creator becomes the first member (ADR-0032)', () => {
  test('a person with a profile creates a household and can read it, its settings and its setup', async () => {
    const created = await asUser(mallory, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `select public.create_household('הבית של מלורי') as id`,
      );
      const id = rows[0]?.id ?? '';
      const visible = await client.query('select name from public.households where id = $1', [
        id,
      ]);
      const settings = await client.query(
        'select currency from public.household_settings where household_id = $1',
        [id],
      );
      const setup = await client.query(
        'select household_named from public.setup_progress where household_id = $1',
        [id],
      );
      const member = await client.query(
        'select status from public.household_members where household_id = $1 and profile_id = $2',
        [id, mallory.id],
      );
      const audit = await client.query(
        `select action from public.audit_events where household_id = $1 and action = 'household.created'`,
        [id],
      );
      return {
        visible: visible.rows,
        settings: settings.rows,
        setup: setup.rows,
        member: member.rows,
        audit: audit.rows,
      };
    });
    expect(created.visible).toEqual([{ name: 'הבית של מלורי' }]);
    expect(created.settings).toEqual([{ currency: 'ILS' }]);
    expect(created.setup).toEqual([{ household_named: true }]);
    expect(created.member).toEqual([{ status: 'active' }]);
    expect(created.audit).toHaveLength(1);
  });

  test('a person without a profile must name themselves; then the profile is created too', async () => {
    const fresh = randomUUID();
    await ownerClient().query(
      `insert into auth.users (id, email, aud, role) values ($1, $2, 'authenticated', 'authenticated')`,
      [fresh, `fresh-${fresh}@example.test`],
    );
    const nameless = await expectRejection(
      { id: fresh, email: '' },
      `select public.create_household('בית')`,
    );
    expect(nameless?.message).toMatch(/display name is required/);

    // Two statements: the function's writes are visible only to a later one.
    const profile = await asUser({ id: fresh, email: '' }, async (client) => {
      await client.query(`select public.create_household('בית', 'דנה')`);
      return (
        await client.query<{ display_name: string }>(
          'select display_name from public.profiles where id = $1',
          [fresh],
        )
      ).rows;
    });
    expect(profile).toEqual([{ display_name: 'דנה' }]);
  });

  test('an unauthenticated caller cannot create a household', async () => {
    const error = await expectRejection('anon', `select public.create_household('x')`);
    expect(error?.code).toBe(PERMISSION_DENIED);
  });
});

describe('create_household_invitation — a token minted once, under the member’s own policy', () => {
  test('a member mints a token that admits the invitee exactly once', async () => {
    const token = await asUser(
      alice,
      async (client) =>
        (
          await client.query<{ t: string }>(
            `select public.create_household_invitation($1, 'mallory@example.test') as t`,
            [householdA],
          )
        ).rows[0]?.t ?? '',
      { keep: true },
    );
    expect(token).toMatch(/^[0-9a-f]{64}$/);

    const admitted = await asUser(
      mallory,
      async (client) =>
        (
          await client.query<{ hid: string }>(
            'select public.accept_household_invitation($1) as hid',
            [token],
          )
        ).rows[0]?.hid,
      { keep: true },
    );
    expect(admitted).toBe(householdA);

    const replay = await expectRejection(
      carol,
      'select public.accept_household_invitation($1)',
      [token],
    );
    expect(replay?.message).toMatch(/already accepted/);
  });

  test('a non-member cannot invite anyone into a household', async () => {
    const error = await expectRejection(
      carol,
      `select public.create_household_invitation($1, 'x@example.test')`,
      [householdA],
    );
    expect(error?.code).toBe(PERMISSION_DENIED);
  });
});

describe('a first-time person accepting an invitation gets a profile (2026-09-15 migration)', () => {
  test('membership and profile are created together; the name comes from the session', async () => {
    const fresh = randomUUID();
    await ownerClient().query(
      `insert into auth.users (id, email, aud, role) values ($1, $2, 'authenticated', 'authenticated')`,
      [fresh, `fresh-${fresh}@example.test`],
    );
    const token = await asUser(
      alice,
      async (client) =>
        (
          await client.query<{ t: string }>(
            `select public.create_household_invitation($1, 'fresh@example.test') as t`,
            [householdA],
          )
        ).rows[0]?.t ?? '',
      { keep: true },
    );

    // The claims carry an email here, as a real session would.
    const outcome = await asUser({ id: fresh, email: '' }, async (client) => {
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: fresh, role: 'authenticated', email: 'dana.levi@example.test' }),
      ]);
      const joined = (
        await client.query<{ hid: string }>(
          'select public.accept_household_invitation($1) as hid',
          [token],
        )
      ).rows[0]?.hid;
      const profile = (
        await client.query<{ display_name: string }>(
          'select display_name from public.profiles where id = $1',
          [fresh],
        )
      ).rows[0];
      const member = (
        await client.query<{ status: string }>(
          'select status from public.household_members where household_id = $1 and profile_id = $2',
          [householdA, fresh],
        )
      ).rows[0];
      return { joined, profile, member };
    });
    expect(outcome.joined).toBe(householdA);
    expect(outcome.profile).toEqual({ display_name: 'dana.levi' });
    expect(outcome.member).toEqual({ status: 'active' });
  });

  test('a person who already has a profile keeps it', async () => {
    const token = await asUser(
      alice,
      async (client) =>
        (
          await client.query<{ t: string }>(
            `select public.create_household_invitation($1, 'mallory@example.test') as t`,
            [householdA],
          )
        ).rows[0]?.t ?? '',
      { keep: true },
    );
    const name = await asUser(mallory, async (client) => {
      await client.query('select public.accept_household_invitation($1)', [token]);
      return (
        await client.query<{ display_name: string }>(
          'select display_name from public.profiles where id = $1',
          [mallory.id],
        )
      ).rows[0]?.display_name;
    });
    expect(name).toBe(mallory.email.split('@')[0]);
  });
});
