/**
 * Row-level security for the budget tables of M6b: budgets, budget_lines,
 * budget_changes.
 *
 * A budget is a plan and holds no money, but it decides what "over budget"
 * means for a family — so it is scoped exactly like money is, and a change to
 * it is a proposal with a name against it until a partner approves it.
 */

import { describe, expect, test } from 'vitest';

import {
  expectRejection,
  ownerInsert,
  PERMISSION_DENIED,
  rowCountAs,
  rowsAs,
  useHouseholdFixture,
} from './harness';

const ids = { catA1: '', catA2: '', catB: '', budgetA: '', budgetB: '', lineA: '', lineB: '' };

const { alice, bob, carol, mallory, householdA, householdB } = useHouseholdFixture(
  async (_client, f) => {
    const category = (household: string, name: string) =>
      ownerInsert('categories', { household_id: household, name, scope: 'household' });
    ids.catA1 = await category(f.householdA, 'מזון');
    ids.catA2 = await category(f.householdA, 'דיור');
    ids.catB = await category(f.householdB, 'מזון');

    ids.budgetA = await ownerInsert('budgets', {
      household_id: f.householdA,
      period: '2026-09',
      status: 'active',
      created_by: f.alice.id,
    });
    ids.budgetB = await ownerInsert('budgets', {
      household_id: f.householdB,
      period: '2026-09',
      status: 'active',
      created_by: f.carol.id,
    });
    ids.lineA = await ownerInsert('budget_lines', {
      household_id: f.householdA,
      budget_id: ids.budgetA,
      category_id: ids.catA1,
      category_key: 'food',
      planned_minor: 300_000,
      weekly_guidance: true,
    });
    ids.lineB = await ownerInsert('budget_lines', {
      household_id: f.householdB,
      budget_id: ids.budgetB,
      category_id: ids.catB,
      category_key: 'food',
      planned_minor: 250_000,
    });
  },
);

const TABLES = ['budgets', 'budget_lines', 'budget_changes'] as const;

describe('unauthenticated and unaffiliated callers', () => {
  test.each(TABLES)('anon cannot select from %s', async (table) => {
    const error = await expectRejection('anon', `select * from public.${table} limit 1`);
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  test.each(TABLES)('a person in no household sees nothing in %s', async (table) => {
    expect(await rowsAs(mallory, `select * from public.${table}`)).toHaveLength(0);
  });
});

describe('budgets', () => {
  test('each household reads only its own plan', async () => {
    const byAlice = (await rowsAs<{ id: string }>(alice, 'select id from public.budgets')).map(
      (r) => r.id,
    );
    expect(byAlice).toContain(ids.budgetA);
    expect(byAlice).not.toContain(ids.budgetB);
    expect(
      await rowsAs(carol, 'select id from public.budget_lines where id = $1', [ids.lineA]),
    ).toHaveLength(0);
  });

  test('a member starts a month as themselves; one plan per month', async () => {
    const ok = await rowCountAs(
      bob,
      `insert into public.budgets (household_id, period, created_by) values ($1, '2026-10', $2)`,
      [householdA, bob.id],
    );
    expect(ok).toBe(1);

    const forged = await expectRejection(
      bob,
      `insert into public.budgets (household_id, period, created_by) values ($1, '2026-11', $2)`,
      [householdA, alice.id],
    );
    expect(forged?.code).toBe(PERMISSION_DENIED);

    const duplicate = await expectRejection(
      bob,
      `insert into public.budgets (household_id, period, created_by) values ($1, '2026-09', $2)`,
      [householdA, bob.id],
    );
    expect(duplicate?.code, 'unique (household_id, period)').toBe('23505');

    const abroad = await expectRejection(
      bob,
      `insert into public.budgets (household_id, period, created_by) values ($1, '2026-10', $2)`,
      [householdB, bob.id],
    );
    expect(abroad?.code).toBe(PERMISSION_DENIED);
  });

  test('a partner archives; a stranger changes nothing; nobody deletes', async () => {
    expect(
      await rowCountAs(bob, `update public.budgets set status = 'archived' where id = $1`, [
        ids.budgetA,
      ]),
    ).toBe(1);
    expect(
      await rowCountAs(carol, `update public.budgets set status = 'archived' where id = $1`, [
        ids.budgetA,
      ]),
    ).toBe(0);
    const remove = await expectRejection(alice, 'delete from public.budgets where id = $1', [
      ids.budgetA,
    ]);
    expect(remove?.code).toBe(PERMISSION_DENIED);
  });
});

describe('budget_lines', () => {
  const insertLine = `insert into public.budget_lines
    (household_id, budget_id, category_id, category_key, planned_minor)
    values ($1, $2, $3, 'housing_and_bills', 400_000)`;

  test('a member plans a category of their own budget', async () => {
    expect(await rowCountAs(alice, insertLine, [householdA, ids.budgetA, ids.catA2])).toBe(1);
  });

  test('a line cannot attach to another household’s budget or category', async () => {
    const foreignBudget = await expectRejection(alice, insertLine, [
      householdA,
      ids.budgetB,
      ids.catA2,
    ]);
    expect(foreignBudget?.code).toBe(PERMISSION_DENIED);

    const foreignCategory = await expectRejection(alice, insertLine, [
      householdA,
      ids.budgetA,
      ids.catB,
    ]);
    expect(foreignCategory?.code).toBe(PERMISSION_DENIED);
  });

  test('one line per category per budget', async () => {
    const error = await expectRejection(
      alice,
      `insert into public.budget_lines (household_id, budget_id, category_id, category_key, planned_minor)
       values ($1, $2, $3, 'food', 1)`,
      [householdA, ids.budgetA, ids.catA1],
    );
    expect(error?.code).toBe('23505');
  });

  test('either partner adjusts a planned amount; a stranger cannot; deletion is impossible', async () => {
    expect(
      await rowCountAs(bob, `update public.budget_lines set planned_minor = 1 where id = $1`, [
        ids.lineA,
      ]),
    ).toBe(1);
    expect(
      await rowCountAs(
        carol,
        `update public.budget_lines set planned_minor = 1 where id = $1`,
        [ids.lineA],
      ),
    ).toBe(0);
    const remove = await expectRejection(
      alice,
      'delete from public.budget_lines where id = $1',
      [ids.lineA],
    );
    expect(remove?.code).toBe(PERMISSION_DENIED);
  });
});

describe('budget_changes — a proposal until a partner approves it', () => {
  const propose = `insert into public.budget_changes
    (household_id, budget_id, from_category_id, to_category_id, amount_minor, proposed_by)
    values ($1, $2, $3, $4, $5, $6)`;

  test('a member proposes moving planned money between two of their categories', async () => {
    expect(
      await rowCountAs(alice, propose, [
        householdA,
        ids.budgetA,
        ids.catA2,
        ids.catA1,
        10_000,
        alice.id,
      ]),
    ).toBe(1);
  });

  test('the proposer is the caller, the categories are the household’s, and the amount is positive', async () => {
    const forged = await expectRejection(alice, propose, [
      householdA,
      ids.budgetA,
      ids.catA2,
      ids.catA1,
      10_000,
      bob.id,
    ]);
    expect(forged?.code).toBe(PERMISSION_DENIED);

    const foreign = await expectRejection(alice, propose, [
      householdA,
      ids.budgetA,
      ids.catA2,
      ids.catB,
      10_000,
      alice.id,
    ]);
    expect(foreign?.code).toBe(PERMISSION_DENIED);

    const zero = await expectRejection(alice, propose, [
      householdA,
      ids.budgetA,
      ids.catA2,
      ids.catA1,
      0,
      alice.id,
    ]);
    expect(zero?.code).toBe('23514');

    const same = await expectRejection(alice, propose, [
      householdA,
      ids.budgetA,
      ids.catA1,
      ids.catA1,
      1,
      alice.id,
    ]);
    expect(same?.code).toBe('23514');
  });

  test('the other partner approves it; a stranger cannot; an approval records who and when', async () => {
    const id = await ownerInsert('budget_changes', {
      household_id: householdA,
      budget_id: ids.budgetA,
      from_category_id: ids.catA2,
      to_category_id: ids.catA1,
      amount_minor: 5_000,
      proposed_by: alice.id,
    });
    const approve = `update public.budget_changes
      set status = 'approved', approved_at = now(), approved_by = $2 where id = $1`;

    expect(await rowCountAs(carol, approve, [id, carol.id])).toBe(0);

    const halfway = await expectRejection(
      bob,
      `update public.budget_changes set status = 'approved' where id = $1`,
      [id],
    );
    expect(halfway?.code, 'approved without approved_at violates the check').toBe('23514');

    expect(await rowCountAs(bob, approve, [id, bob.id])).toBe(1);

    const remove = await expectRejection(
      alice,
      'delete from public.budget_changes where id = $1',
      [id],
    );
    expect(remove?.code, 'a rejected or approved proposal stays as history').toBe(
      PERMISSION_DENIED,
    );
  });
});
