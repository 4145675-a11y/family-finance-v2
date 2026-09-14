/**
 * Row-level security, behaviourally, for the financial tables of M3:
 * businesses, financial_accounts, account_balance_snapshots, categories,
 * transactions, transaction_splits, cashflow_items.
 *
 * Every table gets the same four questions per verb — a member of the household
 * may, a member of another household may not, nobody unauthenticated may, and a
 * reference to another household's row is refused even though the foreign key
 * itself would accept it. Plus the rules specific to money: nothing here is
 * deleted except a split, a reconciliation snapshot is never edited, and the
 * audit trigger writes a reduced image stamped with the real actor.
 */

import { randomUUID } from 'node:crypto';

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
  bizA: '',
  bizB: '',
  accA: '',
  accA2: '',
  accB: '',
  catA: '',
  catB: '',
  txA: '',
  txB: '',
  cfA: '',
  cfB: '',
};

const { alice, bob, carol, mallory, householdA, householdB } = useHouseholdFixture(
  async (_client, f) => {
    ids.bizA = await ownerInsert('businesses', {
      household_id: f.householdA,
      name: 'העסק של A',
    });
    ids.bizB = await ownerInsert('businesses', {
      household_id: f.householdB,
      name: 'העסק של B',
    });
    for (const [key, household, name] of [
      ['accA', f.householdA, 'עו״ש A'],
      ['accA2', f.householdA, 'מזומן A'],
      ['accB', f.householdB, 'עו״ש B'],
    ] as const) {
      ids[key] = await ownerInsert('financial_accounts', {
        household_id: household,
        scope: 'household',
        kind: key === 'accA2' ? 'cash_wallet' : 'bank_account',
        name,
        opening_balance_minor: 100_000,
        opening_balance_direction: 'inflow',
        opening_balance_date: '2026-01-01',
      });
    }
    ids.catA = await ownerInsert('categories', {
      household_id: f.householdA,
      name: 'מזון',
      scope: 'household',
    });
    ids.catB = await ownerInsert('categories', {
      household_id: f.householdB,
      name: 'מזון',
      scope: 'household',
    });
    ids.txA = await ownerInsert('transactions', {
      household_id: f.householdA,
      account_id: ids.accA,
      scope: 'household',
      kind: 'expense',
      direction: 'outflow',
      amount_minor: 4_500,
      status: 'confirmed',
      category_id: ids.catA,
      transaction_date: '2026-09-01',
      created_by: f.alice.id,
    });
    ids.txB = await ownerInsert('transactions', {
      household_id: f.householdB,
      account_id: ids.accB,
      scope: 'household',
      kind: 'expense',
      direction: 'outflow',
      amount_minor: 9_900,
      status: 'confirmed',
      transaction_date: '2026-09-01',
      created_by: f.carol.id,
    });
    ids.cfA = await ownerInsert('cashflow_items', {
      household_id: f.householdA,
      scope: 'household',
      direction: 'outflow',
      amount_minor: 120_000,
      label: 'שכר דירה',
      certainty: 'certain',
      expected_date: '2026-10-01',
      created_by: f.alice.id,
    });
    ids.cfB = await ownerInsert('cashflow_items', {
      household_id: f.householdB,
      scope: 'household',
      direction: 'inflow',
      amount_minor: 800_000,
      label: 'משכורת',
      certainty: 'probable',
      expected_date: '2026-10-01',
      created_by: f.carol.id,
    });
  },
);

const TABLES = [
  'businesses',
  'financial_accounts',
  'account_balance_snapshots',
  'categories',
  'transactions',
  'transaction_splits',
  'cashflow_items',
] as const;

describe('unauthenticated callers reach no financial table', () => {
  test.each(TABLES)('anon cannot select from %s', async (table) => {
    const error = await expectRejection('anon', `select * from public.${table} limit 1`);
    expect(error?.code, `anon must have no SELECT privilege on ${table}`).toBe(
      PERMISSION_DENIED,
    );
  });

  test.each(TABLES)('a person in no household sees nothing in %s', async (table) => {
    const rows = await rowsAs(mallory, `select * from public.${table}`);
    expect(rows).toHaveLength(0);
  });
});

describe('every financial table is scoped to the household', () => {
  test.each([
    ['businesses', () => ids.bizA, () => ids.bizB],
    ['financial_accounts', () => ids.accA, () => ids.accB],
    ['categories', () => ids.catA, () => ids.catB],
    ['transactions', () => ids.txA, () => ids.txB],
    ['cashflow_items', () => ids.cfA, () => ids.cfB],
  ] as const)(
    '%s: each member sees their own rows and not the other household’s',
    async (table, own, other) => {
      const seenByAlice = (
        await rowsAs<{ id: string }>(alice, `select id from public.${table}`)
      ).map((r) => r.id);
      expect(seenByAlice).toContain(own());
      expect(seenByAlice).not.toContain(other());

      const seenByCarol = (
        await rowsAs<{ id: string }>(carol, `select id from public.${table}`)
      ).map((r) => r.id);
      expect(seenByCarol).toContain(other());
      expect(seenByCarol).not.toContain(own());

      // Naming the id directly changes nothing: the row does not exist for Carol.
      const direct = await rowsAs(carol, `select id from public.${table} where id = $1`, [
        own(),
      ]);
      expect(direct).toHaveLength(0);
    },
  );

  test('both partners of a household read the same rows', async () => {
    const byAlice = await rowsAs<{ id: string }>(
      alice,
      'select id from public.transactions order by id',
    );
    const byBob = await rowsAs<{ id: string }>(
      bob,
      'select id from public.transactions order by id',
    );
    expect(byBob).toEqual(byAlice);
    expect(byAlice.map((r) => r.id)).toContain(ids.txA);
  });
});

describe('businesses and accounts', () => {
  test('a member adds a business to their own household', async () => {
    const changed = await rowCountAs(
      alice,
      `insert into public.businesses (household_id, name) values ($1, 'עסק חדש')`,
      [householdA],
    );
    expect(changed).toBe(1);
  });

  test('a member cannot add a business to another household', async () => {
    const error = await expectRejection(
      alice,
      `insert into public.businesses (household_id, name) values ($1, 'פלישה')`,
      [householdB],
    );
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  test('a business-scoped account must name a business of the same household', async () => {
    const ownBusiness = await rowCountAs(
      alice,
      `insert into public.financial_accounts
         (household_id, business_id, scope, kind, name, opening_balance_minor, opening_balance_direction, opening_balance_date)
       values ($1, $2, 'business', 'bank_account', 'עו״ש עסקי', 0, 'inflow', '2026-01-01')`,
      [householdA, ids.bizA],
    );
    expect(ownBusiness).toBe(1);

    // The foreign key would accept household B's business; the policy must not.
    const foreign = await expectRejection(
      alice,
      `insert into public.financial_accounts
         (household_id, business_id, scope, kind, name, opening_balance_minor, opening_balance_direction, opening_balance_date)
       values ($1, $2, 'business', 'bank_account', 'עו״ש עסקי', 0, 'inflow', '2026-01-01')`,
      [householdA, ids.bizB],
    );
    expect(foreign?.code, 'business_id from another household is refused by policy').toBe(
      PERMISSION_DENIED,
    );

    // And the scope rule is a table constraint, not a policy.
    const mismatch = await expectRejection(
      alice,
      `insert into public.financial_accounts
         (household_id, scope, kind, name, opening_balance_minor, opening_balance_direction, opening_balance_date)
       values ($1, 'business', 'bank_account', 'ללא עסק', 0, 'inflow', '2026-01-01')`,
      [householdA],
    );
    expect(mismatch?.code, 'business scope without a business violates the check').toBe(
      '23514',
    );
  });

  test('a partner may close an account; a stranger’s update touches nothing', async () => {
    const byBob = await rowCountAs(
      bob,
      `update public.financial_accounts set closed_at = now() where id = $1`,
      [ids.accA],
    );
    expect(byBob).toBe(1);

    const byCarol = await rowCountAs(
      carol,
      `update public.financial_accounts set closed_at = now() where id = $1`,
      [ids.accA],
    );
    expect(byCarol).toBe(0);
  });

  test('an account cannot be moved to another household', async () => {
    const error = await expectRejection(
      alice,
      `update public.financial_accounts set household_id = $1 where id = $2`,
      [householdB, ids.accA],
    );
    expect(error?.code, 'WITH CHECK refuses the new household').toBe(PERMISSION_DENIED);
  });

  test.each(['businesses', 'financial_accounts', 'categories'] as const)(
    'nobody may delete from %s',
    async (table) => {
      const error = await expectRejection(
        alice,
        `delete from public.${table} where household_id = $1`,
        [householdA],
      );
      expect(error?.code, 'no DELETE grant exists').toBe(PERMISSION_DENIED);
    },
  );
});

describe('account_balance_snapshots are append-only', () => {
  test('a member records a verified balance on their own account, as themselves', async () => {
    const changed = await rowCountAs(
      alice,
      `insert into public.account_balance_snapshots
         (household_id, account_id, balance_minor, balance_direction, verified_at, source, created_by)
       values ($1, $2, 95_000, 'inflow', now(), 'manual_entry', $3)`,
      [householdA, ids.accA, alice.id],
    );
    expect(changed).toBe(1);
  });

  test('the actor cannot be forged', async () => {
    const error = await expectRejection(
      alice,
      `insert into public.account_balance_snapshots
         (household_id, account_id, balance_minor, balance_direction, verified_at, source, created_by)
       values ($1, $2, 95_000, 'inflow', now(), 'manual_entry', $3)`,
      [householdA, ids.accA, bob.id],
    );
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  test('a snapshot cannot name another household’s account', async () => {
    const error = await expectRejection(
      alice,
      `insert into public.account_balance_snapshots
         (household_id, account_id, balance_minor, balance_direction, verified_at, source, created_by)
       values ($1, $2, 1, 'inflow', now(), 'manual_entry', $3)`,
      [householdA, ids.accB, alice.id],
    );
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  test('a snapshot is never edited or removed by a member', async () => {
    const snapshotId = await ownerInsert('account_balance_snapshots', {
      household_id: householdA,
      account_id: ids.accA,
      balance_minor: 1,
      balance_direction: 'inflow',
      verified_at: '2026-09-01T00:00:00Z',
      source: 'manual_entry',
      created_by: alice.id,
    });
    const update = await expectRejection(
      alice,
      `update public.account_balance_snapshots set balance_minor = 2 where id = $1`,
      [snapshotId],
    );
    expect(update?.code, 'no UPDATE grant').toBe(PERMISSION_DENIED);

    const remove = await expectRejection(
      alice,
      `delete from public.account_balance_snapshots where id = $1`,
      [snapshotId],
    );
    expect(remove?.code, 'no DELETE grant').toBe(PERMISSION_DENIED);
  });
});

describe('transactions', () => {
  test('a member records an expense as themselves on their own account', async () => {
    const changed = await rowCountAs(
      alice,
      `insert into public.transactions
         (household_id, account_id, scope, kind, direction, amount_minor, status, category_id, transaction_date, created_by)
       values ($1, $2, 'household', 'expense', 'outflow', 1_234, 'confirmed', $3, '2026-09-02', $4)`,
      [householdA, ids.accA, ids.catA, alice.id],
    );
    expect(changed).toBe(1);
  });

  test('a transfer between two own accounts is accepted; one leg abroad is not', async () => {
    const own = await rowCountAs(
      alice,
      `insert into public.transactions
         (household_id, account_id, counterpart_account_id, scope, kind, direction, amount_minor, status, transaction_date, created_by)
       values ($1, $2, $3, 'household', 'transfer', 'outflow', 500, 'confirmed', '2026-09-02', $4)`,
      [householdA, ids.accA, ids.accA2, alice.id],
    );
    expect(own).toBe(1);

    const abroad = await expectRejection(
      alice,
      `insert into public.transactions
         (household_id, account_id, counterpart_account_id, scope, kind, direction, amount_minor, status, transaction_date, created_by)
       values ($1, $2, $3, 'household', 'transfer', 'outflow', 500, 'confirmed', '2026-09-02', $4)`,
      [householdA, ids.accA, ids.accB, alice.id],
    );
    expect(abroad?.code, 'counterpart in another household is refused').toBe(PERMISSION_DENIED);
  });

  test.each([
    ['account_id', () => ids.accB],
    ['category_id', () => ids.catB],
    ['refunds_transaction_id', () => ids.txB],
  ] as const)(
    'a reference through %s to another household is refused',
    async (column, foreign) => {
      const kind = column === 'refunds_transaction_id' ? 'refund' : 'expense';
      const direction = kind === 'refund' ? 'inflow' : 'outflow';
      const account = column === 'account_id' ? foreign() : ids.accA;
      const category = column === 'category_id' ? foreign() : null;
      const refunds = column === 'refunds_transaction_id' ? foreign() : null;
      const error = await expectRejection(
        alice,
        `insert into public.transactions
         (household_id, account_id, scope, kind, direction, amount_minor, status, category_id, refunds_transaction_id, transaction_date, created_by)
       values ($1, $2, 'household', $3, $4, 10, 'confirmed', $5, $6, '2026-09-02', $7)`,
        [householdA, account, kind, direction, category, refunds, alice.id],
      );
      expect(error?.code).toBe(PERMISSION_DENIED);
    },
  );

  test('created_by must be the caller', async () => {
    const error = await expectRejection(
      alice,
      `insert into public.transactions
         (household_id, account_id, scope, kind, direction, amount_minor, status, transaction_date, created_by)
       values ($1, $2, 'household', 'expense', 'outflow', 10, 'confirmed', '2026-09-02', $3)`,
      [householdA, ids.accA, bob.id],
    );
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  test('either partner voids; a stranger’s void matches nothing; a delete is impossible', async () => {
    const byBob = await rowCountAs(
      bob,
      `update public.transactions set status = 'void' where id = $1`,
      [ids.txA],
    );
    expect(byBob).toBe(1);

    const byCarol = await rowCountAs(
      carol,
      `update public.transactions set status = 'void' where id = $1`,
      [ids.txA],
    );
    expect(byCarol).toBe(0);

    const remove = await expectRejection(
      alice,
      `delete from public.transactions where id = $1`,
      [ids.txA],
    );
    expect(remove?.code, 'money is voided, never deleted').toBe(PERMISSION_DENIED);
  });

  test('an update cannot re-point a transaction at another household’s account', async () => {
    const error = await expectRejection(
      alice,
      `update public.transactions set account_id = $1 where id = $2`,
      [ids.accB, ids.txA],
    );
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  test('the audit trigger stamps the real actor and keeps a reduced image', async () => {
    // transactions carry no automatic audit trigger; financial_accounts does,
    // and the pattern is the same: actor from the session, free text excluded.
    const accountId = randomUUID();
    await asUser(
      alice,
      (client) =>
        client.query(
          `insert into public.financial_accounts
             (id, household_id, scope, kind, name, institution, opening_balance_minor, opening_balance_direction, opening_balance_date)
           values ($1, $2, 'household', 'bank_account', 'שם פרטי מאוד', 'בנק סודי', 10, 'inflow', '2026-01-01')`,
          [accountId, householdA],
        ),
      { keep: true },
    );
    const { rows } = await ownerClient().query<{
      actor_profile_id: string;
      action: string;
      after_state: Record<string, unknown>;
    }>(
      `select actor_profile_id, action, after_state from public.audit_events
       where entity_type = 'financial_accounts' and entity_id = $1`,
      [accountId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor_profile_id).toBe(alice.id);
    expect(rows[0]?.action).toBe('insert');
    expect(rows[0]?.after_state).toMatchObject({ id: accountId, kind: 'bank_account' });
    expect(rows[0]?.after_state).not.toHaveProperty('name');
    expect(rows[0]?.after_state).not.toHaveProperty('institution');
  });
});

describe('transaction_splits — the one thing a member may delete', () => {
  test('splits must sum to the transaction, judged at the end of the statement set', async () => {
    const error = await asUser(alice, async (client) => {
      await client.query(
        `insert into public.transaction_splits (household_id, transaction_id, category_id, scope, amount_minor)
         values ($1, $2, $3, 'household', 1_000)`,
        [householdA, ids.txA, ids.catA],
      );
      try {
        // The constraint is deferred to commit; forcing it now is what a commit would do.
        await client.query('set constraints all immediate');
        return null;
      } catch (e) {
        return e as Error & { code?: string };
      }
    });
    expect(error?.code, 'a partial split set violates the sum invariant').toBe('23514');
  });

  test('a complete split set is accepted, and a member may remove their own splits', async () => {
    const splitId = randomUUID();
    await asUser(
      alice,
      async (client) => {
        await client.query(
          `insert into public.transaction_splits (id, household_id, transaction_id, category_id, scope, amount_minor)
           values ($1, $2, $3, $4, 'household', 4_500)`,
          [splitId, householdA, ids.txA, ids.catA],
        );
        await client.query('set constraints all immediate');
      },
      { keep: true },
    );

    const byCarol = await rowCountAs(
      carol,
      `delete from public.transaction_splits where id = $1`,
      [splitId],
    );
    expect(byCarol, 'a stranger’s delete matches nothing').toBe(0);

    const byBob = await rowCountAs(bob, `delete from public.transaction_splits where id = $1`, [
      splitId,
    ]);
    expect(byBob).toBe(1);
  });

  test('a split cannot attach to another household’s transaction or category', async () => {
    const foreignTransaction = await expectRejection(
      alice,
      `insert into public.transaction_splits (household_id, transaction_id, scope, amount_minor)
       values ($1, $2, 'household', 9_900)`,
      [householdA, ids.txB],
    );
    expect(foreignTransaction?.code).toBe(PERMISSION_DENIED);

    const foreignCategory = await expectRejection(
      alice,
      `insert into public.transaction_splits (household_id, transaction_id, category_id, scope, amount_minor)
       values ($1, $2, $3, 'household', 4_500)`,
      [householdA, ids.txA, ids.catB],
    );
    expect(foreignCategory?.code).toBe(PERMISSION_DENIED);
  });
});

describe('cashflow_items', () => {
  test('a member plans an item for their household; the actor is the caller', async () => {
    const ok = await rowCountAs(
      alice,
      `insert into public.cashflow_items
         (household_id, scope, account_id, direction, amount_minor, label, certainty, expected_date, created_by)
       values ($1, 'household', $2, 'outflow', 50_000, 'ביטוח', 'certain', '2026-10-05', $3)`,
      [householdA, ids.accA, alice.id],
    );
    expect(ok).toBe(1);

    const forged = await expectRejection(
      alice,
      `insert into public.cashflow_items
         (household_id, scope, direction, amount_minor, label, certainty, expected_date, created_by)
       values ($1, 'household', 'outflow', 50_000, 'ביטוח', 'certain', '2026-10-05', $2)`,
      [householdA, carol.id],
    );
    expect(forged?.code).toBe(PERMISSION_DENIED);
  });

  test('an item cannot settle against another household’s transaction', async () => {
    const error = await expectRejection(
      alice,
      `update public.cashflow_items set settled_transaction_id = $1 where id = $2`,
      [ids.txB, ids.cfA],
    );
    expect(error?.code).toBe(PERMISSION_DENIED);

    const own = await rowCountAs(
      alice,
      `update public.cashflow_items set settled_transaction_id = $1 where id = $2`,
      [ids.txA, ids.cfA],
    );
    expect(own).toBe(1);
  });

  test('a stranger changes nothing and nobody deletes', async () => {
    const byCarol = await rowCountAs(
      carol,
      `update public.cashflow_items set amount_minor = 1 where id = $1`,
      [ids.cfA],
    );
    expect(byCarol).toBe(0);

    const remove = await expectRejection(
      alice,
      `delete from public.cashflow_items where id = $1`,
      [ids.cfA],
    );
    expect(remove?.code).toBe(PERMISSION_DENIED);
  });
});

describe('voiding a balance snapshot (ADR-0032)', () => {
  test('only voided_at may change, once, by a member', async () => {
    const id = await ownerInsert('account_balance_snapshots', {
      household_id: householdA,
      account_id: ids.accA,
      balance_minor: 5,
      balance_direction: 'inflow',
      verified_at: '2026-09-01T00:00:00Z',
      source: 'statement',
      created_by: alice.id,
    });
    expect(
      await rowCountAs(
        carol,
        'update public.account_balance_snapshots set voided_at = now() where id = $1',
        [id],
      ),
    ).toBe(0);
    const tampered = await expectRejection(
      alice,
      'update public.account_balance_snapshots set voided_at = now(), balance_minor = 6 where id = $1',
      [id],
    );
    expect(tampered?.code).toBe(PERMISSION_DENIED);
    expect(
      await rowCountAs(
        alice,
        'update public.account_balance_snapshots set voided_at = now() where id = $1',
        [id],
      ),
    ).toBe(1);
  });

  test('a removed planned item stays for history and is not loaded', async () => {
    await asUser(
      alice,
      (client) =>
        client.query('update public.cashflow_items set removed_at = now() where id = $1', [
          ids.cfA,
        ]),
      { keep: true },
    );
    const loaded = await rowsAs<{ doc: { cashflowItems: { id: string }[] } }>(
      alice,
      'select public.load_household_document($1) as doc',
      [householdA],
    );
    expect(loaded[0]?.doc.cashflowItems.map((c) => c.id)).not.toContain(ids.cfA);
    const { rows } = await ownerClient().query(
      'select removed_at from public.cashflow_items where id = $1',
      [ids.cfA],
    );
    expect(rows[0]?.removed_at).not.toBeNull();
  });
});
