/**
 * Row-level security for the household-operations tables of M9:
 * household_settings, setup_progress, family_tasks, idempotency_keys.
 *
 * None of these is money, and settings are the most dangerous of the lot: a
 * wrong month-start day moves every figure on every screen without any of them
 * looking wrong. So they are scoped exactly as money is.
 */

import { describe, expect, test } from 'vitest';

import {
  asUser,
  expectRejection,
  ownerClient,
  ownerInsert,
  PERMISSION_DENIED,
  rowCountAs,
  rowsAs,
  useHouseholdFixture,
} from './harness';

const ids = { memberAliceA: '', memberCarolB: '', taskA: '', taskB: '' };

const { alice, bob, carol, mallory, householdA, householdB } = useHouseholdFixture(
  async (client, f) => {
    for (const household of [f.householdA, f.householdB]) {
      await client.query('insert into public.household_settings (household_id) values ($1)', [
        household,
      ]);
      await client.query(
        'insert into public.setup_progress (household_id, household_named) values ($1, true)',
        [household],
      );
      await client.query(
        `insert into public.idempotency_keys (household_id, key, operation)
         values ($1, 'op-0123456789', 'approve_batch')`,
        [household],
      );
    }
    const { rows } = await client.query<{ id: string; household_id: string }>(
      `select id, household_id from public.household_members where profile_id = any($1)`,
      [[f.alice.id, f.carol.id]],
    );
    ids.memberAliceA = rows.find((r) => r.household_id === f.householdA)?.id ?? '';
    ids.memberCarolB = rows.find((r) => r.household_id === f.householdB)?.id ?? '';
    ids.taskA = await ownerInsert('family_tasks', {
      household_id: f.householdA,
      title: 'לאשר יתרה',
      assigned_member_id: ids.memberAliceA,
      created_by: f.alice.id,
    });
    ids.taskB = await ownerInsert('family_tasks', {
      household_id: f.householdB,
      title: 'לבדוק חוב',
      created_by: f.carol.id,
    });
  },
);

const TABLES = [
  'household_settings',
  'setup_progress',
  'family_tasks',
  'idempotency_keys',
] as const;

describe('unauthenticated and unaffiliated callers', () => {
  test.each(TABLES)('anon cannot select from %s', async (table) => {
    const error = await expectRejection('anon', `select * from public.${table} limit 1`);
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  test.each(TABLES)('a person in no household sees nothing in %s', async (table) => {
    expect(await rowsAs(mallory, `select * from public.${table}`)).toHaveLength(0);
  });

  test.each(TABLES)('%s: each member reads only their own household', async (table) => {
    const byAlice = (
      await rowsAs<{ household_id: string }>(alice, `select household_id from public.${table}`)
    ).map((r) => r.household_id);
    expect(byAlice).toContain(householdA);
    expect(byAlice).not.toContain(householdB);
    expect(
      await rowsAs(carol, `select household_id from public.${table} where household_id = $1`, [
        householdA,
      ]),
    ).toHaveLength(0);
  });
});

describe('household_settings and setup_progress — one row each, both partners equal', () => {
  test('either partner changes the month boundary; a stranger changes nothing', async () => {
    expect(
      await rowCountAs(
        bob,
        `update public.household_settings set month_start_day = 10 where household_id = $1`,
        [householdA],
      ),
    ).toBe(1);
    expect(
      await rowCountAs(
        carol,
        `update public.household_settings set month_start_day = 10 where household_id = $1`,
        [householdA],
      ),
    ).toBe(0);
  });

  test('the month boundary is capped so February always has the day', async () => {
    const error = await expectRejection(
      alice,
      `update public.household_settings set month_start_day = 29 where household_id = $1`,
      [householdA],
    );
    expect(error?.code).toBe('23514');
  });

  test('a settings row cannot be created for another household', async () => {
    const error = await expectRejection(
      alice,
      `insert into public.household_settings (household_id) values ($1)`,
      [householdB],
    );
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  test('a settings change is audited with the actor and without free text', async () => {
    await asUser(
      bob,
      (client) =>
        client.query(
          `update public.household_settings
             set month_start_day = 5, manual_reserve_floor_minor = 123_456 where household_id = $1`,
          [householdA],
        ),
      { keep: true },
    );

    const { rows } = await ownerClient().query<{
      actor_profile_id: string;
      after_state: Record<string, unknown>;
    }>(
      `select actor_profile_id, after_state from public.audit_events
       where entity_type = 'household_settings' and entity_id = $1 and action = 'update'`,
      [householdA],
    );
    // Inside one transaction every row shares now(), so the update is found by
    // its action rather than by time.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor_profile_id).toBe(bob.id);
    expect(rows[0]?.after_state).toMatchObject({ month_start_day: 5 });
    // The reserve amounts are the family's own figures and stay out of the trail.
    expect(rows[0]?.after_state).not.toHaveProperty('manual_reserve_floor_minor');
  });

  test('setup progress is updated by a partner, not by a stranger, and never deleted', async () => {
    expect(
      await rowCountAs(
        bob,
        `update public.setup_progress set accounts_added = true where household_id = $1`,
        [householdA],
      ),
    ).toBe(1);
    expect(
      await rowCountAs(
        carol,
        `update public.setup_progress set accounts_added = true where household_id = $1`,
        [householdA],
      ),
    ).toBe(0);
    const remove = await expectRejection(
      alice,
      'delete from public.setup_progress where household_id = $1',
      [householdA],
    );
    expect(remove?.code).toBe(PERMISSION_DENIED);
  });
});

describe('family_tasks', () => {
  test('a member creates a task for their household and assigns it to a member of it', async () => {
    expect(
      await rowCountAs(
        alice,
        `insert into public.family_tasks (household_id, title, assigned_member_id, created_by) values ($1, 'משימה', $2, $3)`,
        [householdA, ids.memberAliceA, alice.id],
      ),
    ).toBe(1);
  });

  test('a task cannot be assigned to a member of another household — by the reference trigger, for member and owner alike', async () => {
    const sql = `insert into public.family_tasks (household_id, title, assigned_member_id, created_by) values ($1, 'משימה', $2, $3)`;
    // The BEFORE trigger is SECURITY DEFINER and runs before the policy's WITH
    // CHECK, so it refuses first for a member and for the owner alike.
    for (const actor of [alice, 'owner' as const]) {
      const refused = await expectRejection(actor, sql, [
        householdA,
        ids.memberCarolB,
        alice.id,
      ]);
      expect(refused?.code).toBe('P0001');
      expect(refused?.message).toMatch(/member of the same household/);
    }
  });

  test('a completed task records when; a stranger cannot complete it; nobody deletes', async () => {
    const halfway = await expectRejection(
      bob,
      `update public.family_tasks set status = 'done' where id = $1`,
      [ids.taskA],
    );
    expect(halfway?.code, 'done without completed_at violates the check').toBe('23514');

    expect(
      await rowCountAs(
        bob,
        `update public.family_tasks set status = 'done', completed_at = now() where id = $1`,
        [ids.taskA],
      ),
    ).toBe(1);
    expect(
      await rowCountAs(
        carol,
        `update public.family_tasks set status = 'done', completed_at = now() where id = $1`,
        [ids.taskA],
      ),
    ).toBe(0);
    const remove = await expectRejection(
      alice,
      'delete from public.family_tasks where id = $1',
      [ids.taskA],
    );
    expect(remove?.code).toBe(PERMISSION_DENIED);
  });
});

describe('idempotency_keys — one logical operation, one effect', () => {
  test('a member records a key for their household; the same key twice is refused', async () => {
    const sql = `insert into public.idempotency_keys (household_id, key, operation) values ($1, 'op-abcdefghij', 'clear_check')`;
    expect(await rowCountAs(alice, sql, [householdA])).toBe(1);

    const twice = await expectRejection(
      alice,
      `insert into public.idempotency_keys (household_id, key, operation) values ($1, 'op-0123456789', 'approve_batch')`,
      [householdA],
    );
    expect(twice?.code).toBe('23505');
  });

  test('a key cannot be recorded for another household, and a stranger cannot read or touch it', async () => {
    const abroad = await expectRejection(
      alice,
      `insert into public.idempotency_keys (household_id, key, operation) values ($1, 'op-zzzzzzzzzz', 'x')`,
      [householdB],
    );
    expect(abroad?.code).toBe(PERMISSION_DENIED);

    expect(
      await rowCountAs(
        carol,
        `update public.idempotency_keys set result_record_id = gen_random_uuid() where household_id = $1`,
        [householdA],
      ),
    ).toBe(0);
    const remove = await expectRejection(
      alice,
      'delete from public.idempotency_keys where household_id = $1',
      [householdA],
    );
    expect(remove?.code).toBe(PERMISSION_DENIED);
  });
});
