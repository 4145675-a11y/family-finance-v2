/**
 * The platform owner — an administrative identity that is not a financial one.
 *
 * One person decides which families exist. That is a real power and it needs a
 * real boundary, so this suite asks both halves of the question:
 *
 *   * can anybody who is not the platform owner create or approve a household —
 *     no, and not by any route, including the one the product itself uses;
 *   * can the platform owner read a household's money — no, and the fact that
 *     they can staff it makes that the more important half.
 *
 * `mallory` is promoted to platform owner inside the fixture's transaction, so
 * the appointment is undone with everything else. Nothing here is committed.
 *
 * Requires SUPABASE_DB_URL. It never skips.
 */

import { beforeAll, describe, expect, test } from 'vitest';

import { asUser, expectRejection, ownerClient, useHouseholdFixture } from './harness';

const { alice, bob, carol, mallory, householdA, householdB } = useHouseholdFixture();

/** Long enough for the acceptance function's own length check. Synthetic. */
const OWNER_TOKEN = 'e2e-synthetic-first-owner-token-0123456789';

/** Makes mallory the platform owner for this transaction only. */
beforeAll(async () => {
  await ownerClient().query(
    'insert into public.platform_admins (profile_id, note) values ($1, $2) on conflict do nothing',
    [mallory.id, 'synthetic platform owner for the integration suite'],
  );
});

/** Turns household requests on or off, as the platform owner would. */
async function setRequestsEnabled(enabled: boolean): Promise<void> {
  await ownerClient().query(
    'update public.platform_settings set household_requests_enabled = $1',
    [enabled],
  );
}

describe('creating a household is not something a person may do for themselves', () => {
  test('an ordinary member is refused', async () => {
    const error = await expectRejection(alice, `select public.create_household($1, $2)`, [
      'E2E בית שלא ייווצר',
      'אליס',
    ]);
    expect(error, 'self-service creation is closed').not.toBeNull();
    expect(error?.message).toMatch(/platform owner/u);
  });

  test('so is a person who belongs to nothing at all', async () => {
    const error = await expectRejection(carol, `select public.create_household($1, $2)`, [
      'E2E בית של זר',
      'קרול',
    ]);
    expect(error).not.toBeNull();
  });

  test('and the administrative creation function refuses them too', async () => {
    const error = await expectRejection(
      alice,
      `select * from public.admin_create_household_with_owner($1, $2)`,
      ['E2E בית', 'someone@example.test'],
    );
    expect(error, 'the second door is locked as well as the first').not.toBeNull();
  });

  test('nor can they insert a household row directly', async () => {
    // The policy has always required created_by to be the caller; what it never
    // did was ask whether the caller may create one at all. Both hold now.
    const error = await expectRejection(
      alice,
      `insert into public.households (name, created_by) values ($1, $2)`,
      ['E2E בית ישיר', alice.id],
    );
    expect(error).not.toBeNull();
  });
});

describe('only the platform owner creates one, and appoints its first owner', () => {
  test('creation returns a household and a single-use token', async () => {
    const row = await asUser(
      mallory,
      async (c) =>
        (
          await c.query(`select * from public.admin_create_household_with_owner($1, $2)`, [
            'E2E משפחה חדשה',
            'first-owner@example.test',
          ])
        ).rows[0],
    );
    expect(row.household_id).toBeTruthy();
    expect(String(row.token).length).toBeGreaterThanOrEqual(32);
  });

  test('the household is created empty, so the platform owner is not in it', async () => {
    const created = await asUser(
      mallory,
      async (c) =>
        (
          await c.query(`select * from public.admin_create_household_with_owner($1, $2)`, [
            'E2E משפחה ריקה',
            'first-owner@example.test',
          ])
        ).rows[0],
      { keep: true },
    );

    const { rows } = await ownerClient().query(
      'select count(*)::int as n from public.household_members where household_id = $1',
      [created.household_id],
    );
    expect(rows[0].n, 'creating a household must not make the creator a member of it').toBe(0);
  });

  test('and whoever redeems the invitation becomes its owner', async () => {
    const created = await asUser(
      mallory,
      async (c) =>
        (
          await c.query(
            `select * from public.admin_create_household_with_owner($1, $2, interval '7 days')`,
            ['E2E משפחה עם בעלים', carol.email],
          )
        ).rows[0],
      { keep: true },
    );

    // Carol is in no household of her own making; she redeems what she was sent.
    await asUser(
      carol,
      async (c) =>
        c.query('select public.accept_household_invitation($1)', [String(created.token)]),
      { keep: true },
    );

    const { rows } = await ownerClient().query(
      `select role, status from public.household_members
       where household_id = $1 and profile_id = $2`,
      [created.household_id, carol.id],
    );
    expect(rows[0].status).toBe('active');
    expect(rows[0].role, 'the first person into an empty household is its owner').toBe('owner');
  });
});

describe('an invitation admits one person, once, to one household', () => {
  let token = '';
  let created = '';

  beforeAll(async () => {
    const row = (
      await ownerClient().query(
        `insert into public.households (name, created_by) values ($1, $2) returning id`,
        ['E2E משפחה לבדיקת אסימון', mallory.id],
      )
    ).rows[0];
    created = String(row.id);
    await ownerClient().query(
      `insert into public.household_invitations
         (household_id, invited_email, token_hash, created_by, expires_at)
       values ($1, $2, extensions.digest($3, 'sha256'), $4, now() + interval '7 days')`,
      [created, carol.email, OWNER_TOKEN, mallory.id],
    );
    token = OWNER_TOKEN;
  });

  test('a second person cannot reuse a redeemed token', async () => {
    await asUser(
      carol,
      async (c) => c.query('select public.accept_household_invitation($1)', [token]),
      {
        keep: true,
      },
    );

    const error = await expectRejection(bob, 'select public.accept_household_invitation($1)', [
      token,
    ]);
    expect(error, 'a token admits exactly one person').not.toBeNull();
  });

  test('a token cannot be pointed at a different household', async () => {
    /*
     * The token names its household through the row it hashes to; a person
     * supplies only the token. The only way to "choose" a household would be to
     * edit the invitation, and no policy permits that.
     */
    const changed = await asUser(
      carol,
      async (c) =>
        (
          await c.query(
            `update public.household_invitations set household_id = $1
             where token_hash = extensions.digest($2, 'sha256')`,
            [householdA, token],
          )
        ).rowCount,
    );
    expect(changed, 'no policy lets an invitee edit an invitation').toBe(0);

    const { rows } = await ownerClient().query(
      `select household_id from public.household_invitations
       where token_hash = extensions.digest($1, 'sha256')`,
      [token],
    );
    expect(String(rows[0].household_id)).toBe(created);
  });

  test('and an invitee cannot mint one for themselves', async () => {
    const error = await expectRejection(
      carol,
      `insert into public.household_invitations
         (household_id, invited_email, token_hash, created_by, expires_at)
       values ($1, $2, extensions.digest($3, 'sha256'), $4, now() + interval '7 days')`,
      [householdA, carol.email, 'self-minted-token-abcdefghijklmnop', carol.id],
    );
    expect(error).not.toBeNull();
  });
});

describe('a household owner administers their own household and no other', () => {
  test('they may invite inside it', async () => {
    const created = await asUser(
      alice,
      async (c) =>
        (
          await c.query('select public.create_household_invitation($1, $2)', [
            householdA,
            'new-member@example.test',
          ])
        ).rowCount,
    );
    expect(created).toBe(1);
  });

  test('but not into somebody else’s', async () => {
    const error = await expectRejection(
      alice,
      'select public.create_household_invitation($1, $2)',
      [householdB, 'new-member@example.test'],
    );
    expect(error, 'an owner is an owner of one household').not.toBeNull();
  });

  test('they cannot create a household', async () => {
    const error = await expectRejection(alice, 'select public.create_household($1, $2)', [
      'E2E בית של בעלים',
      'אליס',
    ]);
    expect(error).not.toBeNull();
  });

  test('they cannot approve a request', async () => {
    const request = (
      await ownerClient().query(
        `insert into public.household_requests (requested_by, household_name)
         values ($1, $2) returning id`,
        [bob.id, 'E2E בקשה'],
      )
    ).rows[0];

    const error = await expectRejection(
      alice,
      'select * from public.approve_household_request($1)',
      [request.id],
    );
    expect(error).not.toBeNull();
  });

  test('and they cannot disable a household, not even their own', async () => {
    const error = await expectRejection(
      alice,
      'select public.admin_set_household_disabled($1, true)',
      [householdA],
    );
    expect(error).not.toBeNull();
  });

  test('a plain member administers nothing', async () => {
    const error = await expectRejection(
      bob,
      'select public.create_household_invitation($1, $2)',
      [householdA, 'someone@example.test'],
    );
    expect(error, 'inviting belongs to the owner').not.toBeNull();
  });
});

describe('asking for a household', () => {
  test('is refused while requests are closed', async () => {
    await setRequestsEnabled(false);
    const error = await expectRejection(carol, 'select public.request_household($1)', [
      'E2E בקשה סגורה',
    ]);
    expect(error, 'closed means closed').not.toBeNull();
    expect(error?.message).toMatch(/closed/u);
  });

  test('and nothing is created by asking, even when it is open', async () => {
    await setRequestsEnabled(true);
    const before = (
      await ownerClient().query('select count(*)::int as n from public.households')
    ).rows[0].n;

    await asUser(
      carol,
      async (c) => c.query('select public.request_household($1)', ['E2E בקשה']),
      {
        keep: true,
      },
    );

    const after = (
      await ownerClient().query('select count(*)::int as n from public.households')
    ).rows[0].n;
    expect(after, 'a request is a question, not a household').toBe(before);
  });

  test('a person sees their own request and nobody else’s', async () => {
    await setRequestsEnabled(true);
    await asUser(
      carol,
      async (c) => c.query('select public.request_household($1)', ['E2E בקשה']),
      {
        keep: true,
      },
    );

    const mine = await asUser(
      carol,
      async (c) => (await c.query('select id from public.household_requests')).rows.length,
    );
    const theirs = await asUser(
      alice,
      async (c) => (await c.query('select id from public.household_requests')).rows.length,
    );
    expect(mine).toBeGreaterThan(0);
    expect(theirs, 'a request is not public reading').toBe(0);
  });

  test('and only the platform owner may approve one', async () => {
    await setRequestsEnabled(true);
    const request = await asUser(
      carol,
      async (c) =>
        (await c.query('select public.request_household($1) as id', ['E2E בקשה לאישור']))
          .rows[0],
      { keep: true },
    );

    const refused = await expectRejection(
      alice,
      'select * from public.approve_household_request($1)',
      [request.id],
    );
    expect(refused).not.toBeNull();

    const approved = await asUser(
      mallory,
      async (c) =>
        (await c.query('select * from public.approve_household_request($1)', [request.id]))
          .rows[0],
      { keep: true },
    );
    expect(approved.household_id).toBeTruthy();
    expect(String(approved.token).length).toBeGreaterThanOrEqual(32);

    const { rows } = await ownerClient().query(
      'select status, household_id from public.household_requests where id = $1',
      [request.id],
    );
    expect(rows[0].status).toBe('approved');
    expect(String(rows[0].household_id)).toBe(String(approved.household_id));
  });

  test('turning requests off is something only the platform owner can do', async () => {
    const changed = await asUser(
      alice,
      async (c) =>
        (
          await c.query(
            'update public.platform_settings set household_requests_enabled = false',
          )
        ).rowCount,
    );
    expect(changed).toBe(0);
  });
});

describe('the question the navigation asks', () => {
  test('answers true for the platform owner', async () => {
    const answer = await asUser(
      mallory,
      async (c) => (await c.query('select public.is_platform_owner() as yes')).rows[0],
    );
    expect(answer.yes).toBe(true);
  });

  test('and false for an ordinary member, an owner of a household, and a stranger', async () => {
    for (const person of [alice, bob, carol]) {
      const answer = await asUser(
        person,
        async (c) => (await c.query('select public.is_platform_owner() as yes')).rows[0],
      );
      expect(answer.yes, person.id).toBe(false);
    }
  });

  test('and it tells them nothing about who is', async () => {
    // The wrapper answers about the caller only. The list of administrators is
    // not readable through the API by anybody.
    const rows = await asUser(
      alice,
      async (c) => (await c.query('select profile_id from public.platform_admins')).rows,
    );
    expect(rows).toHaveLength(0);
  });
});

describe('the platform owner is not a financial identity', () => {
  beforeAll(async () => {
    await ownerClient().query(
      `insert into public.financial_accounts
         (household_id, name, kind, scope, opening_balance_minor, opening_balance_direction, opening_balance_date)
       values ($1, 'E2E חשבון פרטי', 'bank_account', 'household', 250000, 'inflow', current_date)`,
      [householdA],
    );
  });

  test('they read no account of a household they do not belong to', async () => {
    const rows = await asUser(
      mallory,
      async (c) =>
        (
          await c.query('select id from public.financial_accounts where household_id = $1', [
            householdA,
          ])
        ).rows,
    );
    expect(rows, 'staffing a household is not reading it').toHaveLength(0);
  });

  test('they read no transaction, no debt and no balance either', async () => {
    for (const table of ['transactions', 'debts', 'account_balance_snapshots']) {
      const rows = await asUser(
        mallory,
        async (c) =>
          (await c.query(`select 1 from public.${table} where household_id = $1`, [householdA]))
            .rows,
      );
      expect(rows, `${table} must be invisible to a platform owner`).toHaveLength(0);
    }
  });

  test('and the overview they do get carries counts, never money', async () => {
    const rows = await asUser(
      mallory,
      async (c) => (await c.query('select * from public.admin_household_overview()')).rows,
    );
    expect(rows.length).toBeGreaterThan(0);
    const columns = Object.keys(rows[0] as Record<string, unknown>);
    expect(columns).toEqual(
      expect.arrayContaining(['household_id', 'name', 'member_count', 'pending_invites']),
    );
    for (const column of columns) {
      expect(column, 'no figure of money belongs in an administrative view').not.toMatch(
        /minor|amount|balance|total/u,
      );
    }
  });

  test('and nobody else gets that overview at all', async () => {
    const rows = await asUser(
      alice,
      async (c) => (await c.query('select * from public.admin_household_overview()')).rows,
    );
    expect(rows, 'the list of households is the platform owner’s alone').toHaveLength(0);
  });
});

describe('disabling a household takes it away from its members', () => {
  test('its own owner stops seeing it', async () => {
    const before = await asUser(
      alice,
      async (c) =>
        (await c.query('select id from public.households where id = $1', [householdA])).rows,
    );
    expect(before).toHaveLength(1);

    await asUser(
      mallory,
      async (c) =>
        c.query('select public.admin_set_household_disabled($1, true)', [householdA]),
      { keep: true },
    );

    const after = await asUser(
      alice,
      async (c) =>
        (await c.query('select id from public.households where id = $1', [householdA])).rows,
    );
    expect(after, 'membership itself stops answering, so every policy does').toHaveLength(0);
  });

  test('and so does its money, through the same one change', async () => {
    await asUser(
      mallory,
      async (c) =>
        c.query('select public.admin_set_household_disabled($1, true)', [householdA]),
      { keep: true },
    );

    const rows = await asUser(
      alice,
      async (c) =>
        (
          await c.query('select id from public.financial_accounts where household_id = $1', [
            householdA,
          ])
        ).rows,
    );
    expect(rows).toHaveLength(0);
  });

  test('turning it back on restores exactly what was there', async () => {
    await asUser(
      mallory,
      async (c) =>
        c.query('select public.admin_set_household_disabled($1, true)', [householdA]),
      { keep: true },
    );
    await asUser(
      mallory,
      async (c) =>
        c.query('select public.admin_set_household_disabled($1, false)', [householdA]),
      { keep: true },
    );

    const rows = await asUser(
      alice,
      async (c) =>
        (await c.query('select id from public.households where id = $1', [householdA])).rows,
    );
    expect(rows).toHaveLength(1);
  });
});

describe('two households still cannot reach each other', () => {
  test('the isolation this all sits on is unchanged', async () => {
    // The whole point of adding an administrative role is that it changes
    // nothing about the boundary between families.
    const seen = await asUser(
      carol,
      async (c) =>
        (await c.query('select id from public.households where id = $1', [householdA])).rows,
    );
    expect(seen).toHaveLength(0);

    const changed = await asUser(
      carol,
      async (c) =>
        (
          await c.query('update public.households set name = $1 where id = $2', [
            'נחטף',
            householdA,
          ])
        ).rowCount,
    );
    expect(changed).toBe(0);
  });
});
