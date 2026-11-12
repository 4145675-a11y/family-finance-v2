/**
 * Feedback from inside the product (ADR-0047) — who may write it, and who may read it.
 *
 * The table is meant to be the least interesting one in the schema to an
 * attacker: a member may send a note and do nothing else with it, and the only
 * reader is the platform owner. This suite proves each half against the real
 * database, including the routes the product itself never takes — a direct
 * INSERT, an UPDATE of somebody else's status, a note signed with another
 * family's household.
 *
 * The migration is applied inside the fixture's own transaction, so the suite
 * proves the file in this commit whether or not the database has had it yet,
 * and leaves nothing behind either way: every migration is idempotent
 * (ADR-0015) and the transaction is rolled back at the end.
 *
 * `mallory` is promoted to platform owner inside that transaction too.
 *
 * Requires SUPABASE_DB_URL. It never skips.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import { asUser, expectRejection, ownerClient, rowsAs, useHouseholdFixture } from './harness';

const MIGRATION = fileURLToPath(
  new URL('../migrations/20261112090000_in_product_feedback.sql', import.meta.url),
);

const { alice, bob, carol, mallory, householdA, householdB } = useHouseholdFixture(
  async (client, fixture) => {
    await client.query(readFileSync(MIGRATION, 'utf8'));
    await client.query(
      'insert into public.platform_admins (profile_id, note) values ($1, $2) on conflict do nothing',
      [fixture.mallory.id, 'synthetic platform owner for the integration suite'],
    );
  },
);

const SUBMIT = `select public.submit_feedback(
  $1::public.feedback_kind, $2::public.feedback_urgency, $3, $4::jsonb, $5,
  $6, $7, $8, $9::public.feedback_device, $10, $11, $12
) as reference`;

/** The arguments the server sends for an ordinary note. */
function note(overrides: Partial<Record<string, unknown>> = {}): unknown[] {
  const value = {
    kind: 'design',
    urgency: 'normal',
    body: 'E2E הכותרת צפופה',
    mark: JSON.stringify({ type: 'page' }),
    route: '/lenders/[id]',
    width: 1280,
    height: 800,
    scrollY: 0,
    device: 'desktop',
    commit: 'a409669',
    branch: 'main',
    schemaVersion: 1,
    ...overrides,
  };
  return [
    value.kind,
    value.urgency,
    value.body,
    value.mark,
    value.route,
    value.width,
    value.height,
    value.scrollY,
    value.device,
    value.commit,
    value.branch,
    value.schemaVersion,
  ];
}

/** Sends a note as `actor` and keeps it for the rest of the test. */
async function send(actor: typeof alice, overrides: Partial<Record<string, unknown>> = {}) {
  return asUser(
    actor,
    async (c) => String((await c.query(SUBMIT, note(overrides))).rows[0].reference),
    { keep: true },
  );
}

describe('a member sends a note', () => {
  test('and gets back a reference in the readable shape', async () => {
    const reference = await send(alice);
    expect(reference).toMatch(/^fb-\d{8}-\d{6}-[0-9a-f]{6}$/u);
  });

  test('the server, not the caller, decides the author, the household and the status', async () => {
    const reference = await send(bob);
    const { rows } = await ownerClient().query(
      'select author_id, household_id, status from public.feedback where reference = $1',
      [reference],
    );
    expect(rows[0]).toEqual({ author_id: bob.id, household_id: householdA, status: 'new' });
  });

  test('a person in no household has nowhere to send from', async () => {
    const error = await expectRejection(mallory, SUBMIT, note());
    expect(error, 'mallory belongs to nothing').not.toBeNull();
    expect(error?.code).toBe('42501');
  });

  test('a member of a disabled household cannot send', async () => {
    await ownerClient().query(
      'update public.households set disabled_at = now() where id = $1',
      [householdB],
    );
    const error = await expectRejection(carol, SUBMIT, note());
    expect(error).not.toBeNull();
  });

  test('a revoked member cannot send', async () => {
    await ownerClient().query(
      `update public.household_members set status = 'revoked', revoked_at = now()
       where household_id = $1 and profile_id = $2`,
      [householdA, bob.id],
    );
    const error = await expectRejection(bob, SUBMIT, note());
    expect(error).not.toBeNull();
  });

  test('the anonymous role cannot send at all', async () => {
    const error = await expectRejection('anon', SUBMIT, note());
    expect(error).not.toBeNull();
  });

  test('the eleventh note in an hour is refused', async () => {
    for (let index = 0; index < 10; index += 1) await send(carol);
    const error = await expectRejection(carol, SUBMIT, note());
    expect(error?.message).toMatch(/limit/u);
    // The limit is the person's, not the household's or the server's.
    await expect(send(alice)).resolves.toMatch(/^fb-/u);
  });
});

describe('the table refuses what the white list would never send', () => {
  test.each([
    ['a route with an identifier in it', { route: '/lenders/0b6a1c2e-5f0d' }],
    ['a route in Hebrew', { route: '/מלווים' }],
    ['an empty note', { body: '   ' }],
    ['a note that is too long', { body: 'א'.repeat(2001) }],
    ['a mark that is not an object', { mark: JSON.stringify(['page']) }],
    ['a mark of an unknown kind', { mark: JSON.stringify({ type: 'screenshot' }) }],
    ['a commit that is not one', { commit: 'main; drop table' }],
  ])('%s', async (_label, overrides) => {
    const error = await expectRejection(alice, SUBMIT, note(overrides));
    expect(error).not.toBeNull();
  });
});

describe('nobody but the platform owner reads', () => {
  test('the author cannot read their own note', async () => {
    await send(alice);
    const rows = await rowsAs(alice, 'select * from public.feedback');
    expect(rows).toHaveLength(0);
  });

  test('nor can their partner in the same household', async () => {
    await send(alice);
    const rows = await rowsAs(bob, 'select * from public.feedback');
    expect(rows).toHaveLength(0);
  });

  test('nor another family', async () => {
    await send(alice);
    expect(await rowsAs(carol, 'select * from public.feedback')).toHaveLength(0);
  });

  test('the review function returns nothing to a member', async () => {
    await send(alice);
    expect(await rowsAs(alice, 'select * from public.admin_feedback_list()')).toHaveLength(0);
  });

  test('the platform owner sees the note and the family name, and no author', async () => {
    const reference = await send(alice);
    const rows = await rowsAs(mallory, 'select * from public.admin_feedback_list()');
    const row = rows.find((candidate) => candidate['reference'] === reference);
    expect(row?.['household_name']).toBe('Household A');
    expect(Object.keys(row ?? {})).not.toContain('author_id');
    expect(Object.keys(row ?? {})).not.toContain('household_id');
  });

  test('the review returns no financial column', async () => {
    await send(alice);
    const rows = await rowsAs(mallory, 'select * from public.admin_feedback_list()');
    expect(rows.length).toBeGreaterThan(0);
    for (const column of Object.keys(rows[0] ?? {})) {
      expect(column, 'a feedback row carries no money').not.toMatch(/amount|balance|minor/u);
    }
  });
});

describe('nobody writes around the function', () => {
  test('a member cannot insert directly, even in their own name', async () => {
    const error = await expectRejection(
      alice,
      `insert into public.feedback (reference, household_id, author_id, kind, urgency, body,
         mark, route, viewport_width, viewport_height, scroll_y, device, schema_version)
       values ('fb-20261112-000000-abcdef', $1, $2, 'design', 'normal', 'x',
         '{"type":"page"}', '/', 1, 1, 0, 'desktop', 1)`,
      [householdA, alice.id],
    );
    expect(error).not.toBeNull();
  });

  test('nor into another family', async () => {
    const error = await expectRejection(
      alice,
      `insert into public.feedback (reference, household_id, author_id, kind, urgency, body,
         mark, route, viewport_width, viewport_height, scroll_y, device, schema_version)
       values ('fb-20261112-000000-abcdef', $1, $2, 'design', 'normal', 'x',
         '{"type":"page"}', '/', 1, 1, 0, 'desktop', 1)`,
      [householdB, carol.id],
    );
    expect(error).not.toBeNull();
  });

  test('a member cannot change a status, by table or by function', async () => {
    const reference = await send(alice);
    const direct = await expectRejection(
      alice,
      `update public.feedback set status = 'done' where reference = $1`,
      [reference],
    );
    expect(direct).not.toBeNull();
    const viaFunction = await expectRejection(
      alice,
      `select public.admin_set_feedback_status($1, 'done')`,
      [reference],
    );
    expect(viaFunction?.code).toBe('42501');
    const { rows } = await ownerClient().query(
      'select status from public.feedback where reference = $1',
      [reference],
    );
    expect(rows[0].status).toBe('new');
  });

  test('a member cannot delete, by table or by function', async () => {
    const reference = await send(alice);
    expect(
      await expectRejection(alice, 'delete from public.feedback where reference = $1', [
        reference,
      ]),
    ).not.toBeNull();
    expect(
      (await expectRejection(alice, 'select public.admin_delete_feedback($1)', [reference]))
        ?.code,
    ).toBe('42501');
  });
});

describe('the platform owner decides', () => {
  test('sets a status, and records who and when', async () => {
    const reference = await send(alice);
    await asUser(
      mallory,
      async (c) =>
        c.query(`select public.admin_set_feedback_status($1, 'approved')`, [reference]),
      { keep: true },
    );
    const { rows } = await ownerClient().query(
      'select status, status_changed_by, status_changed_at from public.feedback where reference = $1',
      [reference],
    );
    expect(rows[0].status).toBe('approved');
    expect(rows[0].status_changed_by).toBe(mallory.id);
    expect(rows[0].status_changed_at).not.toBeNull();
  });

  test('deletes a note', async () => {
    const reference = await send(alice);
    await asUser(
      mallory,
      async (c) => c.query('select public.admin_delete_feedback($1)', [reference]),
      {
        keep: true,
      },
    );
    const { rows } = await ownerClient().query(
      'select count(*)::int as n from public.feedback where reference = $1',
      [reference],
    );
    expect(rows[0].n).toBe(0);
  });

  test('an unknown reference is said out loud, not ignored', async () => {
    const error = await expectRejection(
      mallory,
      `select public.admin_set_feedback_status('fb-20000101-000000-000000', 'done')`,
    );
    expect(error?.code).toBe('P0002');
  });
});
