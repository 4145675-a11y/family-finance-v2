/**
 * Expected repayment dates and repayment demands, against a real database.
 *
 * Two questions, and the second is the one only a database can answer.
 *
 * The first is isolation: a demand is a sentence about a family's relationship
 * with a lender, so it must be unreadable and unwritable outside the household
 * it belongs to, by every route including naming another household's debt id.
 *
 * The second is the promise the product makes on the screen — that writing a
 * demand down changes nothing about the loan. Unit tests prove the command
 * returns an untouched document; only this suite can prove that the *function
 * the database actually runs* leaves the row, its events, its status, its closed
 * date and its version exactly as they were, and creates no transaction. That
 * claim is made to a family about a debt they have already repaid, so it is
 * checked against the thing that really writes it.
 *
 * Requires SUPABASE_DB_URL. It never skips.
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

const ids = {
  /** Household A, still owed. */
  openA: '',
  /** Household A, repaid and closed. */
  closedA: '',
  /** Household B, to prove the wall. */
  debtB: '',
  demandA: '',
  demandB: '',
};

const { alice, bob, carol, mallory, householdA, householdB } = useHouseholdFixture(
  async (client, f) => {
    const debt = (household: string, name: string, by: string) =>
      ownerInsert('debts', {
        household_id: household,
        kind: 'private_person',
        creditor_name: name,
        opened_on: '2026-01-01',
        created_by: by,
        relationship_sensitivity: 'low',
        partial_payment_allowed: true,
      });

    ids.openA = await debt(f.householdA, 'משה', f.alice.id);
    ids.closedA = await debt(f.householdA, 'יצחק', f.alice.id);
    ids.debtB = await debt(f.householdB, 'שרה', f.carol.id);

    // The closed one: an opening balance, a repayment, and then settled.
    for (const [kind, amount] of [
      ['opening_balance', 500_000],
      ['principal_payment', 500_000],
    ] as const) {
      await ownerInsert('debt_events', {
        household_id: f.householdA,
        debt_id: ids.closedA,
        kind,
        amount_minor: amount,
        occurred_on: '2026-06-01',
        created_by: f.alice.id,
      });
    }
    await client.query(
      `update public.debts
         set status = 'settled', closed_at = '2026-06-01T09:00:00Z'
       where id = $1`,
      [ids.closedA],
    );

    const demand = (household: string, debtId: string, by: string, on: string) =>
      ownerInsert('debt_repayment_demands', {
        household_id: household,
        debt_id: debtId,
        demanded_on: on,
        created_by: by,
      });
    ids.demandA = await demand(f.householdA, ids.openA, f.alice.id, '2026-08-01');
    ids.demandB = await demand(f.householdB, ids.debtB, f.carol.id, '2026-08-01');
  },
);

/** Everything about a debt that recording a demand must not change. */
async function debtState(debtId: string) {
  const { rows } = await ownerClient().query(
    `select status, closed_at, version, updated_at, repayment_expectation,
            expected_repayment_on, last_demand_at,
            (select count(*) from public.debt_events e where e.debt_id = d.id) as events,
            (select count(*) from public.transactions t where t.household_id = d.household_id)
              as transactions
       from public.debts d where d.id = $1`,
    [debtId],
  );
  return rows[0];
}

describe('a demand belongs to one household and reaches no other', () => {
  test('a member reads their own household’s demands', async () => {
    const rows = await rowsAs(alice, 'select id from public.debt_repayment_demands');
    expect(rows.map((row) => row['id'])).toContain(ids.demandA);
  });

  test('both members of the household read the same ones', async () => {
    const rows = await rowsAs(bob, 'select id from public.debt_repayment_demands');
    expect(rows.map((row) => row['id'])).toContain(ids.demandA);
  });

  test('and never the other household’s', async () => {
    const rows = await rowsAs(alice, 'select id from public.debt_repayment_demands');
    expect(rows.map((row) => row['id'])).not.toContain(ids.demandB);
  });

  test('the other household sees only its own', async () => {
    const rows = await rowsAs(carol, 'select id from public.debt_repayment_demands');
    expect(rows.map((row) => row['id'])).toEqual([ids.demandB]);
  });

  test('a person who belongs to nothing sees none', async () => {
    expect(await rowCountAs(mallory, 'select id from public.debt_repayment_demands')).toBe(0);
  });

  test('an unauthenticated caller cannot reach the table at all', async () => {
    const error = await expectRejection('anon', 'select id from public.debt_repayment_demands');
    expect(error).not.toBeNull();
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  test('naming another household’s debt does not file a demand against it', async () => {
    /*
     * The attack the policy exists for: a member of A supplies B's debt id. It
     * is refused by `app.household_owns_debt`, not by the browser.
     */
    const error = await expectRejection(
      alice,
      `insert into public.debt_repayment_demands
         (household_id, debt_id, demanded_on, created_by)
       values ($1, $2, '2026-09-01', $3)`,
      [householdA, ids.debtB, alice.id],
    );
    expect(error).not.toBeNull();
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  test('nor does claiming to be in the other household', async () => {
    const error = await expectRejection(
      alice,
      `insert into public.debt_repayment_demands
         (household_id, debt_id, demanded_on, created_by)
       values ($1, $2, '2026-09-01', $3)`,
      [householdB, ids.debtB, alice.id],
    );
    expect(error).not.toBeNull();
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  test('a demand cannot be filed in somebody else’s name', async () => {
    const error = await expectRejection(
      alice,
      `insert into public.debt_repayment_demands
         (household_id, debt_id, demanded_on, created_by)
       values ($1, $2, '2026-09-01', $3)`,
      [householdA, ids.openA, bob.id],
    );
    expect(error).not.toBeNull();
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  test('a member may file one properly', async () => {
    const count = await rowCountAs(
      alice,
      `insert into public.debt_repayment_demands
         (household_id, debt_id, demanded_on, requested_deadline, amount_minor, note, created_by)
       values ($1, $2, '2026-09-01', '2026-09-20', 100000, 'ביקש', $3)`,
      [householdA, ids.openA, alice.id],
    );
    expect(count).toBe(1);
  });
});

describe('what was asked, and when, is not editable', () => {
  test('a demand cannot be updated', async () => {
    const error = await expectRejection(
      alice,
      `update public.debt_repayment_demands set note = 'אחרת' where id = $1`,
      [ids.demandA],
    );
    expect(error).not.toBeNull();
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  test('a demand cannot be deleted', async () => {
    const error = await expectRejection(
      alice,
      'delete from public.debt_repayment_demands where id = $1',
      [ids.demandA],
    );
    expect(error).not.toBeNull();
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  test('a deadline before the day it was asked for is refused by the table', async () => {
    const error = await expectRejection(
      alice,
      `insert into public.debt_repayment_demands
         (household_id, debt_id, demanded_on, requested_deadline, created_by)
       values ($1, $2, '2026-09-10', '2026-09-01', $3)`,
      [householdA, ids.openA, alice.id],
    );
    expect(error).not.toBeNull();
  });

  test('a negative amount is refused', async () => {
    const error = await expectRejection(
      alice,
      `insert into public.debt_repayment_demands
         (household_id, debt_id, demanded_on, amount_minor, created_by)
       values ($1, $2, '2026-09-10', -1, $3)`,
      [householdA, ids.openA, alice.id],
    );
    expect(error).not.toBeNull();
  });
});

describe('a demand against a repaid loan leaves the loan alone', () => {
  test('it is accepted', async () => {
    const count = await rowCountAs(
      alice,
      `insert into public.debt_repayment_demands
         (household_id, debt_id, demanded_on, amount_minor, note, created_by)
       values ($1, $2, '2026-09-29', 50000, 'טוען שנשאר חוב', $3)`,
      [householdA, ids.closedA, alice.id],
    );
    expect(count).toBe(1);
  });

  test('and the loan is byte for byte what it was', async () => {
    const before = await debtState(ids.closedA);

    await asUser(
      alice,
      async (client) => {
        await client.query(
          `insert into public.debt_repayment_demands
             (household_id, debt_id, demanded_on, amount_minor, created_by)
           values ($1, $2, '2026-09-29', 50000, $3)`,
          [householdA, ids.closedA, alice.id],
        );
      },
      { keep: true },
    );

    expect(await debtState(ids.closedA)).toEqual(before);
  });

  test('it stays settled, with the date it was settled on', async () => {
    await asUser(
      alice,
      async (client) => {
        await client.query(
          `insert into public.debt_repayment_demands
             (household_id, debt_id, demanded_on, created_by)
           values ($1, $2, '2026-09-29', $3)`,
          [householdA, ids.closedA, alice.id],
        );
      },
      { keep: true },
    );

    const state = await debtState(ids.closedA);
    expect(state?.['status']).toBe('settled');
    expect(state?.['closed_at']).not.toBeNull();
  });

  test('no payment transaction is invented to go with it', async () => {
    const before = await debtState(ids.closedA);

    await asUser(
      alice,
      async (client) => {
        await client.query(
          `insert into public.debt_repayment_demands
             (household_id, debt_id, demanded_on, amount_minor, created_by)
           values ($1, $2, '2026-09-29', 50000, $3)`,
          [householdA, ids.closedA, alice.id],
        );
      },
      { keep: true },
    );

    const after = await debtState(ids.closedA);
    expect(after?.['transactions']).toEqual(before?.['transactions']);
    expect(after?.['events']).toEqual(before?.['events']);
  });

  test('and the balance the engine replays is unmoved', async () => {
    /*
     * Read the way the product reads it: the sum of the events. A demand that
     * had quietly become an event would show up here as a changed number.
     */
    const balance = async () => {
      const { rows } = await ownerClient().query<{ total: string }>(
        `select coalesce(sum(case
                  when kind in ('opening_balance','new_principal','interest_charge','fee_charge')
                    then amount_minor
                  when kind in ('principal_payment','write_off') then -amount_minor
                  else 0 end), 0)::text as total
           from public.debt_events where debt_id = $1`,
        [ids.closedA],
      );
      return rows[0]?.total;
    };

    const before = await balance();
    await asUser(
      alice,
      async (client) => {
        await client.query(
          `insert into public.debt_repayment_demands
             (household_id, debt_id, demanded_on, amount_minor, created_by)
           values ($1, $2, '2026-09-29', 999999, $3)`,
          [householdA, ids.closedA, alice.id],
        );
      },
      { keep: true },
    );

    expect(await balance()).toBe(before);
  });
});

describe('what is expected about repayment', () => {
  test('a member may set a date', async () => {
    const count = await rowCountAs(
      alice,
      `update public.debts
          set repayment_expectation = 'dated', expected_repayment_on = '2027-03-01'
        where id = $1`,
      [ids.openA],
    );
    expect(count).toBe(1);
  });

  test('and may record that no date was agreed', async () => {
    const count = await rowCountAs(
      alice,
      `update public.debts
          set repayment_expectation = 'none', expected_repayment_on = null
        where id = $1`,
      [ids.openA],
    );
    expect(count).toBe(1);
  });

  test('nothing recorded is the state every existing loan is in', async () => {
    const rows = await rowsAs(
      alice,
      'select repayment_expectation, expected_repayment_on from public.debts where id = $1',
      [ids.openA],
    );
    expect(rows[0]?.['repayment_expectation']).toBeNull();
    expect(rows[0]?.['expected_repayment_on']).toBeNull();
  });

  test('a date without a declaration is refused', async () => {
    // The pair cannot say two things. Enforced by the table, so no route in
    // can produce a row that claims a date and denies having one.
    const error = await expectRejection(
      alice,
      `update public.debts set expected_repayment_on = '2027-03-01' where id = $1`,
      [ids.openA],
    );
    expect(error).not.toBeNull();
  });

  test('and a declared date with no date beside it is refused too', async () => {
    const error = await expectRejection(
      alice,
      `update public.debts set repayment_expectation = 'dated' where id = $1`,
      [ids.openA],
    );
    expect(error).not.toBeNull();
  });

  test('"no date agreed" with a date beside it is refused', async () => {
    const error = await expectRejection(
      alice,
      `update public.debts
          set repayment_expectation = 'none', expected_repayment_on = '2027-03-01'
        where id = $1`,
      [ids.openA],
    );
    expect(error).not.toBeNull();
  });

  test('the other household cannot set a date on this loan', async () => {
    const count = await rowCountAs(
      carol,
      `update public.debts
          set repayment_expectation = 'dated', expected_repayment_on = '2027-03-01'
        where id = $1`,
      [ids.openA],
    );
    // No error: the policy makes the row invisible, so the update matches
    // nothing. Which is the same guarantee, stated the way RLS states it.
    expect(count).toBe(0);
  });

  test('a change to it is written to the row-level audit trail', async () => {
    await asUser(
      alice,
      async (client) => {
        await client.query(
          `update public.debts
              set repayment_expectation = 'dated', expected_repayment_on = '2027-03-01'
            where id = $1`,
          [ids.openA],
        );
      },
      { keep: true },
    );

    const { rows } = await ownerClient().query<{ after_state: Record<string, unknown> }>(
      `select after_state from public.audit_events
        where entity_type = 'debts' and entity_id = $1 and action = 'update'
        order by occurred_at desc limit 1`,
      [ids.openA],
    );
    expect(rows[0]?.after_state?.['repayment_expectation']).toBe('dated');
    expect(rows[0]?.after_state?.['expected_repayment_on']).toBe('2027-03-01');
  });
});

describe('the document the application loads carries both', () => {
  test('demands come back under their own key', async () => {
    const rows = await rowsAs<{ doc: Record<string, unknown> }>(
      alice,
      'select public.load_household_document($1) as doc',
      [householdA],
    );
    const demands = rows[0]?.doc['repaymentDemands'] as Record<string, unknown>[];
    expect(Array.isArray(demands)).toBe(true);
    expect(demands.map((demand) => demand['id'])).toContain(ids.demandA);
  });

  test('and only this household’s', async () => {
    const rows = await rowsAs<{ doc: Record<string, unknown> }>(
      alice,
      'select public.load_household_document($1) as doc',
      [householdA],
    );
    const demands = rows[0]?.doc['repaymentDemands'] as Record<string, unknown>[];
    expect(demands.map((demand) => demand['id'])).not.toContain(ids.demandB);
  });

  test('the composed loader still returns every other collection', async () => {
    /*
     * The body moved to `app.load_household_core` and the public function now
     * composes it. A key lost in that move would be a household that silently
     * stopped loading part of itself.
     */
    const rows = await rowsAs<{ doc: Record<string, unknown> }>(
      alice,
      'select public.load_household_document($1) as doc',
      [householdA],
    );
    for (const key of [
      'household',
      'settings',
      'setup',
      'members',
      'profiles',
      'accounts',
      'transactions',
      'debts',
      'debtEvents',
      'rollovers',
      'checks',
      'budgets',
      'tasks',
      'importSourceFiles',
      'importBatches',
      'importProposals',
      'learnedRules',
      'audit',
      'repaymentDemands',
    ]) {
      expect(rows[0]?.doc, key).toHaveProperty(key);
    }
  });

  test('a non-member loading the household gets nothing', async () => {
    const rows = await rowsAs<{ doc: unknown }>(
      mallory,
      'select public.load_household_document($1) as doc',
      [householdA],
    );
    expect(rows[0]?.doc).toBeNull();
  });
});

describe('saving through the function the application calls', () => {
  test('a demand sent as a change set is written', async () => {
    const id = '55555555-5555-4555-8555-555555555555';
    await asUser(
      alice,
      async (client) => {
        const { rows } = await client.query<{ version: string }>(
          `select public.save_household_document($1, $2, $3) ->> 'version' as version`,
          [
            householdA,
            1,
            JSON.stringify({
              repaymentDemands: {
                upsert: [
                  {
                    id,
                    debt_id: ids.openA,
                    demanded_on: '2026-09-29',
                    requested_deadline: '2026-10-10',
                    amount_minor: 75_000,
                    note: 'דרך הפונקציה',
                    created_by: alice.id,
                    created_at: '2026-09-29T10:00:00.000Z',
                  },
                ],
              },
            }),
          ],
        );
        expect(Number(rows[0]?.version)).toBeGreaterThan(0);

        const written = await client.query(
          'select note from public.debt_repayment_demands where id = $1',
          [id],
        );
        expect(written.rows[0]?.['note']).toBe('דרך הפונקציה');
      },
      { keep: true },
    );
  });

  test('sending it twice writes one demand', async () => {
    const id = '66666666-6666-4666-8666-666666666666';
    const changes = JSON.stringify({
      repaymentDemands: {
        upsert: [
          {
            id,
            debt_id: ids.openA,
            demanded_on: '2026-09-29',
            requested_deadline: null,
            amount_minor: null,
            note: 'פעם אחת',
            created_by: alice.id,
            created_at: '2026-09-29T10:00:00.000Z',
          },
        ],
      },
    });

    await asUser(
      alice,
      async (client) => {
        const version = async () => {
          const { rows } = await client.query<{ version: number }>(
            'select version from public.households where id = $1',
            [householdA],
          );
          return rows[0]?.version ?? 0;
        };

        await client.query('select public.save_household_document($1, $2, $3)', [
          householdA,
          await version(),
          changes,
        ]);
        await client.query('select public.save_household_document($1, $2, $3)', [
          householdA,
          await version(),
          changes,
        ]);

        const { rows } = await client.query<{ count: string }>(
          'select count(*)::text as count from public.debt_repayment_demands where id = $1',
          [id],
        );
        expect(rows[0]?.count).toBe('1');
      },
      { keep: true },
    );
  });

  test('an expected repayment date sent as a change set is written', async () => {
    await asUser(
      alice,
      async (client) => {
        const { rows: before } = await client.query<{ version: number }>(
          'select version from public.households where id = $1',
          [householdA],
        );
        await client.query('select public.save_household_document($1, $2, $3)', [
          householdA,
          before[0]?.version,
          JSON.stringify({
            debtRepaymentExpectations: {
              upsert: [
                {
                  id: ids.openA,
                  repayment_expectation: 'dated',
                  expected_repayment_on: '2027-04-01',
                },
              ],
            },
          }),
        ]);

        const { rows } = await client.query(
          'select repayment_expectation, expected_repayment_on from public.debts where id = $1',
          [ids.openA],
        );
        expect(rows[0]?.['repayment_expectation']).toBe('dated');
      },
      { keep: true },
    );
  });

  test('and clearing it reaches the row rather than being ignored as empty', async () => {
    await asUser(
      alice,
      async (client) => {
        const version = async () => {
          const { rows } = await client.query<{ version: number }>(
            'select version from public.households where id = $1',
            [householdA],
          );
          return rows[0]?.version;
        };

        await client.query('select public.save_household_document($1, $2, $3)', [
          householdA,
          await version(),
          JSON.stringify({
            debtRepaymentExpectations: {
              upsert: [
                {
                  id: ids.openA,
                  repayment_expectation: 'none',
                  expected_repayment_on: null,
                },
              ],
            },
          }),
        ]);

        await client.query('select public.save_household_document($1, $2, $3)', [
          householdA,
          await version(),
          JSON.stringify({
            debtRepaymentExpectations: {
              upsert: [
                {
                  id: ids.openA,
                  repayment_expectation: null,
                  expected_repayment_on: null,
                },
              ],
            },
          }),
        ]);

        const { rows } = await client.query(
          'select repayment_expectation, expected_repayment_on from public.debts where id = $1',
          [ids.openA],
        );
        expect(rows[0]?.['repayment_expectation']).toBeNull();
        expect(rows[0]?.['expected_repayment_on']).toBeNull();
      },
      { keep: true },
    );
  });

  test('a change set naming another household’s debt changes nothing', async () => {
    await asUser(
      alice,
      async (client) => {
        const { rows: before } = await client.query<{ version: number }>(
          'select version from public.households where id = $1',
          [householdA],
        );
        await client.query('select public.save_household_document($1, $2, $3)', [
          householdA,
          before[0]?.version,
          JSON.stringify({
            debtRepaymentExpectations: {
              upsert: [
                {
                  id: ids.debtB,
                  repayment_expectation: 'dated',
                  expected_repayment_on: '2027-04-01',
                },
              ],
            },
          }),
        ]);
      },
      { keep: true },
    );

    // The function scopes its update to the household being changed, so B's
    // loan is untouched even though the client asked for it by name.
    const { rows } = await ownerClient().query(
      'select repayment_expectation from public.debts where id = $1',
      [ids.debtB],
    );
    expect(rows[0]?.['repayment_expectation']).toBeNull();
  });

  test('a demand smuggled in for another household lands in neither', async () => {
    const id = '77777777-7777-4777-8777-777777777777';
    await asUser(alice, async (client) => {
      const { rows: before } = await client.query<{ version: number }>(
        'select version from public.households where id = $1',
        [householdA],
      );
      /*
       * Inside its own savepoint. A refused statement aborts the surrounding
       * transaction, and the point of this test is what the table holds
       * *afterwards* — which cannot be read from an aborted one.
       */
      let failed = false;
      await client.query('savepoint smuggle');
      try {
        await client.query('select public.save_household_document($1, $2, $3)', [
          householdA,
          before[0]?.version,
          JSON.stringify({
            repaymentDemands: {
              upsert: [
                {
                  id,
                  debt_id: ids.debtB,
                  demanded_on: '2026-09-29',
                  requested_deadline: null,
                  amount_minor: null,
                  note: null,
                  created_by: alice.id,
                  created_at: '2026-09-29T10:00:00.000Z',
                },
              ],
            },
          }),
        ]);
      } catch {
        failed = true;
        await client.query('rollback to savepoint smuggle');
      }
      await client.query('release savepoint smuggle');
      // Either the policy refuses the statement or it writes nothing; both are
      // the wall. What must not happen is a row against B's loan.
      const { rows } = await client.query<{ count: string }>(
        'select count(*)::text as count from public.debt_repayment_demands where id = $1',
        [id],
      );
      expect(rows[0]?.count).toBe('0');
      expect(failed).toBe(true);
    });
  });
});
