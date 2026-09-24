import { randomBytes, randomUUID } from 'node:crypto';

import { Client } from 'pg';

/**
 * One synthetic person in the real authentication system, and its removal.
 *
 * This is the same mechanism `supabase/validation/production-path.validation.ts`
 * has used since the Production Data Layer milestone, for the same reason: there
 * is no way to test Supabase Auth without a user in Supabase Auth, and the safe
 * version of that is a user this file creates, uses and deletes.
 *
 * Three properties hold it together:
 *
 *   1. **The identity is generated here.** The address is `e2e-<uuid>@example.test`
 *      — a reserved TLD that cannot receive mail — and the password is random
 *      bytes that exist in this process and, as a bcrypt hash, in the database.
 *      Neither is printed, committed or logged.
 *   2. **Nothing is shared with a real account.** The user is new, owns nothing,
 *      and is never invited into anybody's household.
 *   3. **Cleanup is by id.** Every delete names the identifiers this run created.
 *      There is no pattern match over the users table and no "remove old test
 *      accounts" sweep: a cleanup that searches is a cleanup that can find the
 *      wrong row.
 *
 * It needs `SUPABASE_DB_URL`, which is the owner connection. If it is absent the
 * suite **fails** rather than skipping: a green run that quietly tested nothing is
 * the outcome `CLAUDE.md` forbids above all others.
 */

export interface SyntheticUser {
  readonly id: string;
  readonly email: string;
  /** Generated here, used here, never printed. */
  readonly password: string;
}

export function syntheticUser(label: string): SyntheticUser {
  return {
    id: randomUUID(),
    email: `e2e-${label}-${randomUUID()}@example.test`,
    password: `E2E-${randomBytes(18).toString('base64url')}`,
  };
}

export function ownerConnectionString(): string {
  const url = process.env['SUPABASE_DB_URL'];
  if (url === undefined || url.trim() === '') {
    throw new Error(
      'SUPABASE_DB_URL is required for the live browser suite. Put it in .env.integration.local ' +
        'or supply it from CI secrets. The value is never printed.',
    );
  }
  return url;
}

export async function connectAsOwner(): Promise<Client> {
  const client = new Client({ connectionString: ownerConnectionString() });
  await client.connect();
  return client;
}

/**
 * Creates a confirmed email user, the way Supabase's own seeds do.
 *
 * The password crosses into the database only as a bcrypt hash; the plaintext
 * never leaves this process.
 */
export async function provision(owner: Client, person: SyntheticUser): Promise<void> {
  await owner.query(
    `insert into auth.users
       (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token,
        recovery_token, email_change_token_new, email_change)
     values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2,
             extensions.crypt($3, extensions.gen_salt('bf')), now(),
             '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
             '', '', '', '')`,
    [person.id, person.email, person.password],
  );
  await owner.query(
    `insert into auth.identities
       (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
     values (gen_random_uuid(), $1, $2,
             jsonb_build_object('sub', $2::text, 'email', $3::text, 'email_verified', true),
             'email', now(), now(), now())`,
    [person.id, person.id, person.email],
  );
}

/**
 * Removes exactly what this run created, in one transaction.
 *
 * The audit trail is append-only by trigger, which is what makes these rows
 * undeletable in normal operation. The guards are paused for the duration of this
 * transaction only, re-enabled before the commit, and **proven live again** — if
 * the proof fails the transaction rolls back, so a failed cleanup cannot leave the
 * append-only guarantee switched off.
 */
export async function removeSynthetic(
  owner: Client,
  people: readonly SyntheticUser[],
): Promise<void> {
  const ids = people.map((person) => person.id);
  if (ids.length === 0) return;

  await owner.query('begin');
  try {
    // Households found by membership rather than assumed, so nothing is orphaned.
    const { rows } = await owner.query<{ household_id: string }>(
      'select distinct household_id from public.household_members where profile_id = any($1)',
      [ids],
    );
    const households = rows.map((row) => row.household_id);

    await owner.query(
      'alter table public.audit_events disable trigger audit_events_block_delete',
    );
    await owner.query(
      'alter table public.audit_events disable trigger audit_events_block_update',
    );

    if (households.length > 0) {
      await owner.query('delete from public.audit_events where household_id = any($1)', [
        households,
      ]);
      // Every household-scoped table cascades from households.
      await owner.query('delete from public.households where id = any($1)', [households]);
    }
    await owner.query('delete from public.profiles where id = any($1)', [ids]);
    await owner.query('delete from auth.one_time_tokens where user_id = any($1)', [ids]);
    await owner.query('delete from auth.identities where user_id = any($1)', [ids]);
    await owner.query('delete from auth.users where id = any($1)', [ids]);

    await owner.query(
      'alter table public.audit_events enable trigger audit_events_block_update',
    );
    await owner.query(
      'alter table public.audit_events enable trigger audit_events_block_delete',
    );

    const { rows: guards } = await owner.query<{ n: number }>(
      `select count(*)::int as n from pg_trigger
       where tgrelid = 'public.audit_events'::regclass and not tgisinternal and tgenabled = 'O'`,
    );
    if (guards[0]?.n !== 2) throw new Error('the audit guards are not both enabled again');

    await owner.query('savepoint guard');
    let live = false;
    try {
      await owner.query('delete from public.audit_events where false');
    } catch (error) {
      live = (error as { code?: string }).code === '42501';
    }
    await owner.query('rollback to savepoint guard');
    if (!live) throw new Error('the append-only guard did not fire after cleanup');

    await owner.query('commit');
  } catch (error) {
    await owner.query('rollback').catch(() => undefined);
    throw error;
  }
}

/** How many rows the synthetic people still own. Zero is the only acceptable answer. */
export async function remainingRows(
  owner: Client,
  people: readonly SyntheticUser[],
): Promise<number> {
  const ids = people.map((person) => person.id);
  const { rows } = await owner.query<{ n: number }>(
    `select
       (select count(*) from auth.users where id = any($1))
       + (select count(*) from public.profiles where id = any($1))
       + (select count(*) from public.household_members where profile_id = any($1))
       as n`,
    [ids],
  );
  return Number(rows[0]?.n ?? -1);
}
