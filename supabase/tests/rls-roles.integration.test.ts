/**
 * Roles — who may administer a household, and who may not.
 *
 * The distinction is deliberately narrow. An owner and a member have **exactly
 * the same rights over money**: both record, both approve, both read everything
 * (01-PRODUCT-SPEC.md, the partners are equal). What an owner has is the power
 * to change who is in the household — invite somebody, revoke somebody, promote
 * somebody — and until this suite existed any active member had all of that,
 * which meant a person invited last week could revoke the person who opened the
 * household.
 *
 * The fixture gives Alice household A, which she created, and Bob a membership
 * in it; Carol has household B. So Alice is A's owner and Bob is A's member
 * without either being named here — the opener becomes the owner wherever the
 * membership is inserted from, which is the first thing this file checks.
 *
 * Requires SUPABASE_DB_URL. It never skips: a skipped isolation test reads like
 * a passing one, and 08-TEST-PLAN.md forbids that.
 */

import { beforeAll, describe, expect, test } from 'vitest';

import { asUser, expectRejection, ownerClient, useHouseholdFixture } from './harness';

const { alice, bob, carol, mallory, householdA, householdB } = useHouseholdFixture();

/**
 * A synthetic invitation token, long enough to pass the acceptance function's
 * own length check. It is not a credential: it exists only inside the
 * transaction this suite rolls back.
 */
const INVITE_TOKEN = 'e2e-synthetic-invitation-token-0123456789';

/** The role a person holds, read with owner rights so RLS cannot hide it. */
async function roleOf(householdId: string, profileId: string): Promise<string | null> {
  const { rows } = await ownerClient().query(
    `select role, status from public.household_members
     where household_id = $1 and profile_id = $2`,
    [householdId, profileId],
  );
  const row = rows[0] as { role?: string } | undefined;
  return row?.role ?? null;
}

describe('the person who opens a household is its owner', () => {
  test('without anything naming the role at insert time', async () => {
    // The fixture inserts memberships with no role at all. Alice created
    // household A, so she comes out its owner; Carol likewise for B.
    expect(await roleOf(householdA, alice.id)).toBe('owner');
    expect(await roleOf(householdB, carol.id)).toBe('owner');
  });

  test('and somebody who merely belongs is a member', async () => {
    expect(await roleOf(householdA, bob.id)).toBe('member');
  });

  test('so no household can exist without an owner', async () => {
    const { rows } = await ownerClient().query(
      `select h.id
       from public.households h
       where not exists (
         select 1 from public.household_members hm
         where hm.household_id = h.id and hm.status = 'active' and hm.role = 'owner'
       )`,
    );
    expect(rows, 'a household with no owner could never invite anybody again').toHaveLength(0);
  });
});

describe('inviting is the owner’s', () => {
  test('an owner may create an invitation in their own household', async () => {
    const created = await asUser(
      alice,
      async (c) =>
        (
          await c.query(
            `insert into public.household_invitations
             (household_id, invited_email, token_hash, created_by, expires_at)
           values ($1, $2, $3, $4, now() + interval '7 days')`,
            [householdA, 'e2e-invitee@example.test', Buffer.from('owner-token-hash'), alice.id],
          )
        ).rowCount,
    );
    expect(created).toBe(1);
  });

  test('a member may not, however long they have belonged', async () => {
    const error = await expectRejection(
      bob,
      `insert into public.household_invitations
         (household_id, invited_email, token_hash, created_by, expires_at)
       values ($1, $2, $3, $4, now() + interval '7 days')`,
      [householdA, 'e2e-uninvited@example.test', Buffer.from('member-token-hash'), bob.id],
    );
    expect(error, 'inviting is administration, and Bob is not an owner').not.toBeNull();
  });

  test('and an owner of another household certainly may not', async () => {
    const error = await expectRejection(
      carol,
      `insert into public.household_invitations
         (household_id, invited_email, token_hash, created_by, expires_at)
       values ($1, $2, $3, $4, now() + interval '7 days')`,
      [householdA, 'e2e-stranger@example.test', Buffer.from('cross-token-hash'), carol.id],
    );
    expect(error).not.toBeNull();
  });
});

describe('revoking is the owner’s', () => {
  test('an owner may revoke a member of their own household', async () => {
    const changed = await asUser(
      alice,
      async (c) =>
        (
          await c.query(
            `update public.household_members set status = 'revoked', revoked_at = now()
             where household_id = $1 and profile_id = $2`,
            [householdA, bob.id],
          )
        ).rowCount,
    );
    expect(changed).toBe(1);
  });

  test('a member may not revoke anybody, including the owner', async () => {
    const changed = await asUser(
      bob,
      async (c) =>
        (
          await c.query(
            `update public.household_members set status = 'revoked', revoked_at = now()
             where household_id = $1 and profile_id = $2`,
            [householdA, alice.id],
          )
        ).rowCount,
    );
    expect(changed, 'the member who arrived last cannot remove the person who opened it').toBe(
      0,
    );
  });

  test('nor may a member revoke themselves out of a role they never had', async () => {
    const changed = await asUser(
      bob,
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
});

describe('promotion, and the rule that a household keeps an owner', () => {
  test('an owner may promote a member', async () => {
    // `keep` because the effect is what is being asserted; the per-test
    // savepoint still undoes it before the next test runs.
    const changed = await asUser(
      alice,
      async (c) =>
        (
          await c.query(
            `update public.household_members set role = 'owner'
             where household_id = $1 and profile_id = $2`,
            [householdA, bob.id],
          )
        ).rowCount,
      { keep: true },
    );
    expect(changed).toBe(1);
    expect(await roleOf(householdA, bob.id)).toBe('owner');
  });

  test('a member cannot promote themselves', async () => {
    const changed = await asUser(
      bob,
      async (c) =>
        (
          await c.query(
            `update public.household_members set role = 'owner'
             where household_id = $1 and profile_id = $2`,
            [householdA, bob.id],
          )
        ).rowCount,
    );
    expect(changed).toBe(0);
    expect(await roleOf(householdA, bob.id)).toBe('member');
  });

  test('the last owner cannot demote themselves', async () => {
    const error = await expectRejection(
      alice,
      `update public.household_members set role = 'member'
       where household_id = $1 and profile_id = $2`,
      [householdA, alice.id],
    );
    expect(error, 'a household with no owner could never invite again').not.toBeNull();
    expect(await roleOf(householdA, alice.id)).toBe('owner');
  });

  test('the last owner cannot revoke themselves either', async () => {
    const error = await expectRejection(
      alice,
      `update public.household_members set status = 'revoked', revoked_at = now()
       where household_id = $1 and profile_id = $2`,
      [householdA, alice.id],
    );
    expect(error).not.toBeNull();
  });

  test('but once there are two owners, one of them may step down', async () => {
    await ownerClient().query(
      `update public.household_members set role = 'owner'
       where household_id = $1 and profile_id = $2`,
      [householdA, bob.id],
    );

    const changed = await asUser(
      alice,
      async (c) =>
        (
          await c.query(
            `update public.household_members set role = 'member'
             where household_id = $1 and profile_id = $2`,
            [householdA, alice.id],
          )
        ).rowCount,
    );
    expect(changed).toBe(1);
    expect(await roleOf(householdA, bob.id)).toBe('owner');
  });
});

describe('what an administrative update may never be', () => {
  test('a membership cannot be moved to another household', async () => {
    const error = await expectRejection(
      alice,
      `update public.household_members set household_id = $1
       where household_id = $2 and profile_id = $3`,
      [householdB, householdA, bob.id],
    );
    expect(error, 'moving a membership is granting access somewhere else').not.toBeNull();
  });

  test('a membership cannot be handed to another person', async () => {
    const error = await expectRejection(
      alice,
      `update public.household_members set profile_id = $1
       where household_id = $2 and profile_id = $3`,
      [mallory.id, householdA, bob.id],
    );
    expect(error).not.toBeNull();
  });

  test('a revoked person cannot restore themselves', async () => {
    /*
     * The guarantee that matters, and it belongs to the policy rather than to
     * the trigger: a revoked person is not a member, so no policy matches their
     * update and nothing changes.
     *
     * Re-activation is deliberately not forbidden outright, because
     * `accept_household_invitation` re-activates a revoked membership through
     * `on conflict do update` — inviting somebody back is a legitimate thing an
     * owner does, and a blanket rule here would refuse them at the door.
     */
    await ownerClient().query(
      `update public.household_members set status = 'revoked', revoked_at = now()
       where household_id = $1 and profile_id = $2`,
      [householdA, bob.id],
    );

    const changed = await asUser(
      bob,
      async (c) =>
        (
          await c.query(
            `update public.household_members set status = 'active', revoked_at = null
             where household_id = $1 and profile_id = $2`,
            [householdA, bob.id],
          )
        ).rowCount,
    );
    expect(changed).toBe(0);

    const { rows } = await ownerClient().query(
      'select status from public.household_members where household_id = $1 and profile_id = $2',
      [householdA, bob.id],
    );
    expect(rows[0].status).toBe('revoked');
  });

  test('and an owner may invite them back, which restores the membership', async () => {
    await ownerClient().query(
      `update public.household_members set status = 'revoked', revoked_at = now()
       where household_id = $1 and profile_id = $2`,
      [householdA, bob.id],
    );
    await ownerClient().query(
      `insert into public.household_invitations
         (household_id, invited_email, token_hash, created_by, expires_at)
       values ($1, $2, extensions.digest($3, 'sha256'), $4, now() + interval '7 days')`,
      [householdA, bob.email, INVITE_TOKEN, alice.id],
    );

    await asUser(
      bob,
      async (c) => c.query('select public.accept_household_invitation($1)', [INVITE_TOKEN]),
      { keep: true },
    );

    const { rows } = await ownerClient().query(
      'select status, role from public.household_members where household_id = $1 and profile_id = $2',
      [householdA, bob.id],
    );
    expect(rows[0].status).toBe('active');
    // And still a member: coming back does not come with administrative rights.
    expect(rows[0].role).toBe('member');
  });

  test('and a revoked member is a stranger again', async () => {
    await ownerClient().query(
      `update public.household_members set status = 'revoked', revoked_at = now()
       where household_id = $1 and profile_id = $2`,
      [householdA, bob.id],
    );

    const rows = await asUser(
      bob,
      async (c) =>
        (await c.query('select id from public.households where id = $1', [householdA])).rows,
    );
    expect(rows, 'revocation is what takes the household away, immediately').toHaveLength(0);
  });
});

describe('the paths that write a membership cannot go round the rule', () => {
  test('the document-apply function runs as its caller, so policies still apply', async () => {
    /*
     * `apply_household_changes` can update household_members, and it is the path
     * every screen writes through. Were it SECURITY DEFINER it would run with the
     * migration role's rights and the owner-only policy would protect nothing —
     * a member could revoke the owner through the ordinary save path.
     *
     * Asserted against the catalogue rather than the file, so the thing checked
     * is what the database actually has.
     */
    const { rows } = await ownerClient().query(
      `select p.prosecdef
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'apply_household_changes'`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.prosecdef, 'apply_household_changes must run as its caller').toBe(false);
    }
  });

  test('and so does the one that mints an invitation', async () => {
    const { rows } = await ownerClient().query(
      `select p.prosecdef
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'create_household_invitation'`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.prosecdef, 'minting an invitation must obey the owner-only policy').toBe(
        false,
      );
    }
  });

  test('accepting an invitation makes a member, never an owner', async () => {
    /*
     * The acceptance function is SECURITY DEFINER on purpose — the token is the
     * authorisation, and the invitee is not yet a member of anything. What it
     * must never do is hand out administrative rights: arriving by invitation
     * makes a member, and promotion is a separate, deliberate act.
     */
    await ownerClient().query(
      `insert into public.household_invitations
         (household_id, invited_email, token_hash, created_by, expires_at)
       values ($1, $2, extensions.digest($3, 'sha256'), $4, now() + interval '7 days')`,
      [householdA, mallory.email, INVITE_TOKEN, alice.id],
    );

    await asUser(
      mallory,
      async (c) => c.query('select public.accept_household_invitation($1)', [INVITE_TOKEN]),
      { keep: true },
    );

    expect(await roleOf(householdA, mallory.id)).toBe('member');
  });
});

describe('the file question', () => {
  test('the hosted backend keeps no uploaded file at all', async () => {
    /*
     * "Isolation for every relevant table **and file**" has an answer here that
     * is stronger than a bucket policy: on the database backend there are no
     * files. `TransientUploadArea` hashes what was uploaded, hands back an id
     * and stores nothing; only the rows a person reviewed and approved are
     * written. So there is no object for one household to read out of another's
     * bucket, and no bucket policy that could be wrong.
     *
     * Asserted against the database rather than the source: if somebody adds a
     * bucket later, this fails and the policy question becomes live.
     */
    const { rows } = await ownerClient().query(
      `select count(*)::int as buckets
       from information_schema.tables
       where table_schema = 'storage' and table_name = 'buckets'`,
    );

    if (Number(rows[0]?.buckets ?? 0) === 0) return;

    const { rows: used } = await ownerClient().query(
      'select count(*)::int as n from storage.buckets',
    );
    expect(
      Number(used[0]?.n ?? 0),
      'a bucket exists: uploaded files now need household-scoped storage policies',
    ).toBe(0);
  });

  test('and the metadata about a file is household-scoped like everything else', async () => {
    const rows = await asUser(
      carol,
      async (c) =>
        (
          await c.query('select id from public.import_source_files where household_id = $1', [
            householdA,
          ])
        ).rows,
    );
    expect(rows, 'the row that names a file belongs to one household').toHaveLength(0);
  });
});

describe('a role changes nothing about the money', () => {
  beforeAll(async () => {
    await ownerClient().query(
      `insert into public.financial_accounts
         (household_id, name, kind, scope, opening_balance_minor, opening_balance_direction, opening_balance_date)
       values ($1, 'E2E חשבון', 'bank_account', 'household', 100000, 'inflow', current_date)`,
      [householdA],
    );
  });

  test('a member reads the household’s accounts exactly as an owner does', async () => {
    const asOwner = await asUser(alice, async (c) =>
      (
        await c.query('select id from public.financial_accounts where household_id = $1', [
          householdA,
        ])
      ).rows.map((row) => String(row.id)),
    );
    const asMember = await asUser(bob, async (c) =>
      (
        await c.query('select id from public.financial_accounts where household_id = $1', [
          householdA,
        ])
      ).rows.map((row) => String(row.id)),
    );

    expect(asOwner.length).toBeGreaterThan(0);
    expect(asMember, 'the roles differ about people, never about money').toEqual(asOwner);
  });

  test('and a member may still record one', async () => {
    const created = await asUser(
      bob,
      async (c) =>
        (
          await c.query(
            `insert into public.financial_accounts
               (household_id, name, kind, scope, opening_balance_minor, opening_balance_direction, opening_balance_date)
             values ($1, 'E2E חשבון של שותף', 'bank_account', 'household', 5000, 'inflow', current_date)`,
            [householdA],
          )
        ).rowCount,
    );
    expect(created).toBe(1);
  });
});
