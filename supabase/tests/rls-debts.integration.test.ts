/**
 * Row-level security for the debt domain of M4: debts, debt_events,
 * debt_rollovers.
 *
 * Debt events are the truth a balance is replayed from, so they are the table
 * where "no UPDATE, no DELETE" matters most. A rollover link changes no balance
 * and must therefore be unable to point at events it does not describe — the
 * validation trigger holds even for the table owner, which is what makes it a
 * rule rather than a policy.
 */

import { describe, expect, test } from 'vitest';

import {
  asUser,
  expectRejection,
  ownerInsert,
  PERMISSION_DENIED,
  rowCountAs,
  rowsAs,
  useHouseholdFixture,
  type PgError,
} from './harness';

const ids = {
  debtA: '',
  debtA2: '',
  debtB: '',
  evA: '',
  evA2: '',
  evB: '',
  evB2: '',
  payA: '',
};

const { alice, bob, carol, mallory, householdA, householdB } = useHouseholdFixture(
  async (_client, f) => {
    const debt = (household: string, name: string, by: string) =>
      ownerInsert('debts', {
        household_id: household,
        kind: 'bank_loan',
        creditor_name: name,
        opened_on: '2026-01-01',
        created_by: by,
      });
    ids.debtA = await debt(f.householdA, 'בנק A', f.alice.id);
    ids.debtA2 = await debt(f.householdA, 'גמ״ח A', f.alice.id);
    ids.debtB = await debt(f.householdB, 'בנק B', f.carol.id);

    const event = (
      household: string,
      debtId: string,
      kind: string,
      amount: number,
      by: string,
    ) =>
      ownerInsert('debt_events', {
        household_id: household,
        debt_id: debtId,
        kind,
        amount_minor: amount,
        occurred_on: '2026-01-01',
        created_by: by,
      });
    ids.evA = await event(f.householdA, ids.debtA, 'opening_balance', 500_000, f.alice.id);
    ids.payA = await event(f.householdA, ids.debtA, 'principal_payment', 100_000, f.alice.id);
    ids.evA2 = await event(f.householdA, ids.debtA2, 'new_principal', 100_000, f.alice.id);
    ids.evB = await event(f.householdB, ids.debtB, 'opening_balance', 70_000, f.carol.id);
    ids.evB2 = await event(f.householdB, ids.debtB, 'new_principal', 70_000, f.carol.id);
  },
);

const TABLES = ['debts', 'debt_events', 'debt_rollovers'] as const;

describe('unauthenticated and unaffiliated callers', () => {
  test.each(TABLES)('anon cannot select from %s', async (table) => {
    const error = await expectRejection('anon', `select * from public.${table} limit 1`);
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  test.each(TABLES)('a person in no household sees nothing in %s', async (table) => {
    expect(await rowsAs(mallory, `select * from public.${table}`)).toHaveLength(0);
  });
});

describe('debts', () => {
  test('each household sees only its own creditors', async () => {
    const byAlice = (await rowsAs<{ id: string }>(alice, 'select id from public.debts')).map(
      (r) => r.id,
    );
    expect(byAlice).toEqual(expect.arrayContaining([ids.debtA, ids.debtA2]));
    expect(byAlice).not.toContain(ids.debtB);

    expect(
      await rowsAs(carol, 'select id from public.debts where id = $1', [ids.debtA]),
    ).toHaveLength(0);
  });

  test('a member records a debt as themselves; a forged creator is refused', async () => {
    const ok = await rowCountAs(
      bob,
      `insert into public.debts (household_id, kind, creditor_name, opened_on, created_by)
       values ($1, 'overdraft', 'בנק', '2026-02-01', $2)`,
      [householdA, bob.id],
    );
    expect(ok).toBe(1);

    const forged = await expectRejection(
      bob,
      `insert into public.debts (household_id, kind, creditor_name, opened_on, created_by)
       values ($1, 'overdraft', 'בנק', '2026-02-01', $2)`,
      [householdA, alice.id],
    );
    expect(forged?.code).toBe(PERMISSION_DENIED);

    const abroad = await expectRejection(
      bob,
      `insert into public.debts (household_id, kind, creditor_name, opened_on, created_by)
       values ($1, 'overdraft', 'בנק', '2026-02-01', $2)`,
      [householdB, bob.id],
    );
    expect(abroad?.code).toBe(PERMISSION_DENIED);
  });

  test('a private debt carries its relationship fields, and only a private debt', async () => {
    const missing = await expectRejection(
      alice,
      `insert into public.debts (household_id, kind, creditor_name, opened_on, created_by)
       values ($1, 'private_person', 'דוד', '2026-02-01', $2)`,
      [householdA, alice.id],
    );
    expect(missing?.code, 'private_person without sensitivity fields').toBe('23514');

    const ok = await rowCountAs(
      alice,
      `insert into public.debts
         (household_id, kind, creditor_name, opened_on, created_by, relationship_sensitivity, partial_payment_allowed)
       values ($1, 'private_person', 'דוד', '2026-02-01', $2, 'high', true)`,
      [householdA, alice.id],
    );
    expect(ok).toBe(1);
  });

  test('a partner settles a debt; a stranger changes nothing; nobody deletes', async () => {
    expect(
      await rowCountAs(bob, `update public.debts set status = 'settled' where id = $1`, [
        ids.debtA,
      ]),
    ).toBe(1);
    expect(
      await rowCountAs(carol, `update public.debts set status = 'settled' where id = $1`, [
        ids.debtA,
      ]),
    ).toBe(0);
    const remove = await expectRejection(alice, `delete from public.debts where id = $1`, [
      ids.debtA,
    ]);
    expect(remove?.code).toBe(PERMISSION_DENIED);
  });
});

describe('debt_events are the truth: appended, never rewritten', () => {
  test('a member appends a repayment to their own debt', async () => {
    const ok = await rowCountAs(
      alice,
      `insert into public.debt_events (household_id, debt_id, kind, amount_minor, occurred_on, created_by)
       values ($1, $2, 'principal_payment', 25_000, '2026-09-01', $3)`,
      [householdA, ids.debtA, alice.id],
    );
    expect(ok).toBe(1);
  });

  test('an event cannot name another household’s debt, even from the caller’s own household', async () => {
    const error = await expectRejection(
      alice,
      `insert into public.debt_events (household_id, debt_id, kind, amount_minor, occurred_on, created_by)
       values ($1, $2, 'principal_payment', 25_000, '2026-09-01', $3)`,
      [householdA, ids.debtB, alice.id],
    );
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  test('a correction must state its direction, and nothing else may', async () => {
    const noDirection = await expectRejection(
      alice,
      `insert into public.debt_events (household_id, debt_id, kind, amount_minor, occurred_on, created_by)
       values ($1, $2, 'balance_correction', 1, '2026-09-01', $3)`,
      [householdA, ids.debtA, alice.id],
    );
    expect(noDirection?.code).toBe('23514');

    const wrongKind = await expectRejection(
      alice,
      `insert into public.debt_events (household_id, debt_id, kind, amount_minor, occurred_on, correction_effect, created_by)
       values ($1, $2, 'principal_payment', 1, '2026-09-01', 'increase', $3)`,
      [householdA, ids.debtA, alice.id],
    );
    expect(wrongKind?.code).toBe('23514');
  });

  test('no member may update or delete an event; a stranger cannot even see it', async () => {
    const update = await expectRejection(
      alice,
      `update public.debt_events set amount_minor = 1 where id = $1`,
      [ids.evA],
    );
    expect(update?.code, 'no UPDATE grant on debt_events').toBe(PERMISSION_DENIED);

    const remove = await expectRejection(
      alice,
      `delete from public.debt_events where id = $1`,
      [ids.evA],
    );
    expect(remove?.code, 'no DELETE grant on debt_events').toBe(PERMISSION_DENIED);

    expect(
      await rowsAs(carol, 'select id from public.debt_events where id = $1', [ids.evA]),
    ).toHaveLength(0);
  });
});

describe('debt_rollovers explain a repayment and change no balance', () => {
  const insertRollover = `insert into public.debt_rollovers
    (household_id, from_debt_id, to_debt_id, repayment_event_id, origination_event_id,
     amount_minor, occurred_on, source, created_by)
    values ($1, $2, $3, $4, $5, $6, '2026-09-01', 'user_confirmed', $7)`;

  test('a member links a principal_payment on one debt to new_principal on another', async () => {
    const ok = await rowCountAs(alice, insertRollover, [
      householdA,
      ids.debtA,
      ids.debtA2,
      ids.payA,
      ids.evA2,
      100_000,
      alice.id,
    ]);
    expect(ok).toBe(1);
  });

  test('the same pair of events cannot be linked twice', async () => {
    const error = await asUser(alice, async (client) => {
      const params = [householdA, ids.debtA, ids.debtA2, ids.payA, ids.evA2, 100_000, alice.id];
      await client.query(insertRollover, params);
      try {
        await client.query(insertRollover, params);
        return null;
      } catch (e) {
        return e as PgError;
      }
    });
    expect(error?.code, 'unique (repayment_event_id, origination_event_id)').toBe('23505');
  });

  test('a link cannot claim more than either event moved', async () => {
    const error = await expectRejection(alice, insertRollover, [
      householdA,
      ids.debtA,
      ids.debtA2,
      ids.payA,
      ids.evA2,
      100_001,
      alice.id,
    ]);
    expect(error?.code).toBe('23514');
  });

  test('a link cannot be funded by anything but a principal_payment', async () => {
    const error = await expectRejection(alice, insertRollover, [
      householdA,
      ids.debtA,
      ids.debtA2,
      ids.evA, // an opening_balance, not a repayment
      ids.evA2,
      1,
      alice.id,
    ]);
    expect(error?.code).toBe('23514');
  });

  test('a link cannot reach into another household, by policy or by trigger', async () => {
    // Alice naming Carol's debt and event. The BEFORE trigger runs as Alice and
    // cannot see Carol's event at all, so it refuses before the policy is even
    // consulted: to her, the row she is pointing at does not exist.
    const byTrigger = await expectRejection(alice, insertRollover, [
      householdA,
      ids.debtA,
      ids.debtB,
      ids.payA,
      ids.evB2,
      1,
      alice.id,
    ]);
    expect(byTrigger?.code).toBe('23503');
    expect(byTrigger?.message).toMatch(/does not exist/);

    // The owner sees everything, so both events resolve and every kind check
    // passes; the household check is the only thing left, and it holds.
    const byHousehold = await expectRejection('owner', insertRollover, [
      householdA,
      ids.debtA,
      ids.debtB,
      ids.payA,
      ids.evB2,
      1,
      alice.id,
    ]);
    expect(byHousehold?.code).toBe(PERMISSION_DENIED);
    expect(byHousehold?.message).toMatch(/cannot span households/);
  });

  test('a proposed link is confirmed by a member, not by a stranger, and never deleted', async () => {
    const id = await ownerInsert('debt_rollovers', {
      household_id: householdA,
      from_debt_id: ids.debtA,
      to_debt_id: ids.debtA2,
      repayment_event_id: ids.payA,
      origination_event_id: ids.evA2,
      amount_minor: 50_000,
      occurred_on: '2026-09-01',
      source: 'system_suggested',
      status: 'proposed',
      confidence_bp: 8000,
      created_by: alice.id,
    });

    const confirm = `update public.debt_rollovers
      set status = 'confirmed', confirmed_at = now(), confirmed_by = $2 where id = $1`;

    expect(await rowCountAs(carol, confirm, [id, carol.id])).toBe(0);
    expect(await rowCountAs(bob, confirm, [id, bob.id])).toBe(1);

    const remove = await expectRejection(
      alice,
      'delete from public.debt_rollovers where id = $1',
      [id],
    );
    expect(remove?.code).toBe(PERMISSION_DENIED);
  });
});

describe('voiding — the one change an append-only money row permits (ADR-0032)', () => {
  test('a member voids a debt event once, changing nothing else; a stranger cannot; nobody un-voids', async () => {
    const id = await ownerInsert('debt_events', {
      household_id: householdA,
      debt_id: ids.debtA,
      kind: 'principal_payment',
      amount_minor: 1_000,
      occurred_on: '2026-09-05',
      created_by: alice.id,
    });

    expect(
      await rowCountAs(carol, 'update public.debt_events set voided_at = now() where id = $1', [
        id,
      ]),
    ).toBe(0);

    const tampered = await expectRejection(
      alice,
      'update public.debt_events set voided_at = now(), amount_minor = 1 where id = $1',
      [id],
    );
    expect(tampered?.code, 'voiding may change nothing but voided_at').toBe(PERMISSION_DENIED);

    const plainEdit = await expectRejection(
      alice,
      'update public.debt_events set amount_minor = 1 where id = $1',
      [id],
    );
    expect(plainEdit?.code, 'an edit that is not a void is refused').toBe(PERMISSION_DENIED);

    await asUser(
      bob,
      (client) =>
        client.query('update public.debt_events set voided_at = now() where id = $1', [id]),
      { keep: true },
    );

    const again = await expectRejection(
      alice,
      'update public.debt_events set voided_at = null where id = $1',
      [id],
    );
    expect(again?.code, 'a voided event cannot change again').toBe(PERMISSION_DENIED);

    // Voided rows are history: the document loader leaves them out.
    const loaded = await rowsAs<{ doc: { debtEvents: { id: string }[] } }>(
      alice,
      'select public.load_household_document($1) as doc',
      [householdA],
    );
    expect(loaded[0]?.doc.debtEvents.map((e) => e.id)).not.toContain(id);
    expect(loaded[0]?.doc.debtEvents.map((e) => e.id)).toContain(ids.evA);
  });
});
