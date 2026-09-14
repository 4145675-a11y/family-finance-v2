/**
 * Row-level security for the gemach and import tables of M9: repayment_plans,
 * post_dated_checks, import_source_files, import_batches, import_proposals.
 *
 * Two invariants live here that no policy can express and the triggers must:
 * a check's debt, account and replacement all belong to the same household —
 * proven even for the owner, who bypasses RLS — and a batch cannot become
 * approved while a row is still pending. Silence is not consent, in the
 * database too.
 */

import { randomUUID } from 'node:crypto';

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
  debtB: '',
  accA: '',
  accB: '',
  planA: '',
  checkA: '',
  checkB: '',
  fileA: '',
  fileB: '',
  batchA: '',
  batchB: '',
  proposalA: '',
  proposalB: '',
};

const { alice, bob, carol, mallory, householdA, householdB } = useHouseholdFixture(
  async (_client, f) => {
    for (const [side, household, by] of [
      ['A', f.householdA, f.alice.id],
      ['B', f.householdB, f.carol.id],
    ] as const) {
      const debtId = await ownerInsert('debts', {
        household_id: household,
        kind: 'gemach',
        creditor_name: `גמ״ח ${side}`,
        opened_on: '2026-01-01',
        created_by: by,
      });
      const accountId = await ownerInsert('financial_accounts', {
        household_id: household,
        scope: 'household',
        kind: 'bank_account',
        name: `עו״ש ${side}`,
        opening_balance_minor: 0,
        opening_balance_direction: 'inflow',
        opening_balance_date: '2026-01-01',
      });
      const checkId = await ownerInsert('post_dated_checks', {
        household_id: household,
        debt_id: debtId,
        account_id: accountId,
        amount_minor: 100_000,
        due_date: '2026-10-10',
        payee_name: `גמ״ח ${side}`,
        created_by: by,
      });
      const fileId = await ownerInsert('import_source_files', {
        household_id: household,
        display_name: 'statement.csv',
        storage_path: `${household}/${randomUUID()}.csv`,
        kind: 'csv',
        byte_size: 1234,
        sha256: 'a'.repeat(64),
        uploaded_by: by,
      });
      const batchId = await ownerInsert('import_batches', {
        household_id: household,
        source_file_id: fileId,
        status: 'needs_review',
        created_by: by,
      });
      const proposalId = await ownerInsert('import_proposals', {
        household_id: household,
        batch_id: batchId,
        kind: 'transaction',
        raw: JSON.stringify([{ header: 'סכום', value: '12.50' }]),
        proposed: JSON.stringify({ kind: 'transaction', amountMinor: 1250 }),
      });
      if (side === 'A') {
        ids.debtA = debtId;
        ids.accA = accountId;
        ids.checkA = checkId;
        ids.fileA = fileId;
        ids.batchA = batchId;
        ids.proposalA = proposalId;
        ids.planA = await ownerInsert('repayment_plans', {
          household_id: household,
          debt_id: debtId,
          installment_count: 10,
          installment_amount_minor: 100_000,
          first_due_date: '2026-10-10',
          created_by: by,
        });
      } else {
        ids.debtB = debtId;
        ids.accB = accountId;
        ids.checkB = checkId;
        ids.fileB = fileId;
        ids.batchB = batchId;
        ids.proposalB = proposalId;
      }
    }
  },
);

const TABLES = [
  'repayment_plans',
  'post_dated_checks',
  'import_source_files',
  'import_batches',
  'import_proposals',
] as const;

describe('unauthenticated and unaffiliated callers', () => {
  test.each(TABLES)('anon cannot select from %s', async (table) => {
    const error = await expectRejection('anon', `select * from public.${table} limit 1`);
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  test.each(TABLES)('a person in no household sees nothing in %s', async (table) => {
    expect(await rowsAs(mallory, `select * from public.${table}`)).toHaveLength(0);
  });

  test.each([
    ['post_dated_checks', () => ids.checkA, () => ids.checkB],
    ['import_source_files', () => ids.fileA, () => ids.fileB],
    ['import_batches', () => ids.batchA, () => ids.batchB],
    ['import_proposals', () => ids.proposalA, () => ids.proposalB],
  ] as const)(
    '%s: a member sees their own rows and not the other household’s',
    async (table, own, other) => {
      const byAlice = (
        await rowsAs<{ id: string }>(alice, `select id from public.${table}`)
      ).map((r) => r.id);
      expect(byAlice).toContain(own());
      expect(byAlice).not.toContain(other());
      expect(
        await rowsAs(carol, `select id from public.${table} where id = $1`, [own()]),
      ).toHaveLength(0);
    },
  );
});

describe('repayment_plans — one agreement per debt, in the same household', () => {
  test('a second plan for the same debt is refused', async () => {
    const error = await expectRejection(
      alice,
      `insert into public.repayment_plans (household_id, debt_id, installment_count, installment_amount_minor, first_due_date, created_by)
       values ($1, $2, 5, 1, '2026-11-01', $3)`,
      [householdA, ids.debtA, alice.id],
    );
    expect(error?.code).toBe('23505');
  });

  test('a plan cannot describe another household’s debt — by the reference trigger, for member and owner alike', async () => {
    const sql = `insert into public.repayment_plans (household_id, debt_id, installment_count, installment_amount_minor, first_due_date, created_by)
       values ($1, $2, 5, 1, '2026-11-01', $3)`;
    // The BEFORE trigger is SECURITY DEFINER and runs before the policy's WITH
    // CHECK, so it is the lock that speaks first — for a member and for the
    // owner alike. The policy remains behind it as the second lock.
    for (const actor of [alice, 'owner' as const]) {
      const refused = await expectRejection(actor, sql, [householdA, ids.debtB, alice.id]);
      expect(refused?.code).toBe('P0001');
      expect(refused?.message).toMatch(/same household as its debt/);
    }
  });

  test('a partner edits the agreement; a stranger cannot; nobody deletes', async () => {
    expect(
      await rowCountAs(
        bob,
        `update public.repayment_plans set installment_count = 12 where id = $1`,
        [ids.planA],
      ),
    ).toBe(1);
    expect(
      await rowCountAs(
        carol,
        `update public.repayment_plans set installment_count = 12 where id = $1`,
        [ids.planA],
      ),
    ).toBe(0);
    const remove = await expectRejection(
      alice,
      'delete from public.repayment_plans where id = $1',
      [ids.planA],
    );
    expect(remove?.code).toBe(PERMISSION_DENIED);
  });
});

describe('post_dated_checks — handing over paper moves no money', () => {
  const insertCheck = `insert into public.post_dated_checks
    (household_id, debt_id, account_id, amount_minor, due_date, payee_name, created_by)
    values ($1, $2, $3, 50_000, '2026-11-10', 'גמ״ח', $4)`;

  test('a member writes a check on their own account for their own debt', async () => {
    expect(
      await rowCountAs(alice, insertCheck, [householdA, ids.debtA, ids.accA, alice.id]),
    ).toBe(1);
  });

  test.each([
    ['debt', () => [householdA, ids.debtB, ids.accA]],
    ['account', () => [householdA, ids.debtA, ids.accB]],
  ] as const)(
    'a check naming another household’s %s is refused by the reference trigger, for member and owner alike',
    async (_what, params) => {
      // Trigger first (SECURITY DEFINER, BEFORE INSERT), policy behind it.
      for (const actor of [alice, 'owner' as const]) {
        const refused = await expectRejection(actor, insertCheck, [...params(), alice.id]);
        expect(refused?.code).toBe('P0001');
        expect(refused?.message).toMatch(/same household/);
      }
    },
  );

  test('a check may point at money only when it has cleared, and each link is unique', async () => {
    const transactionId = await ownerInsert('transactions', {
      household_id: householdA,
      account_id: ids.accA,
      scope: 'household',
      kind: 'expense',
      direction: 'outflow',
      amount_minor: 100_000,
      status: 'confirmed',
      transaction_date: '2026-10-10',
      created_by: alice.id,
    });

    const notCleared = await expectRejection(
      alice,
      `update public.post_dated_checks set cleared_transaction_id = $1 where id = $2`,
      [transactionId, ids.checkA],
    );
    expect(notCleared?.code, 'a link on an uncleared check violates the check constraint').toBe(
      '23514',
    );

    const cleared = await rowCountAs(
      alice,
      `update public.post_dated_checks
         set status = 'cleared', cleared_on = '2026-10-10', delivered_on = '2026-09-15', cleared_transaction_id = $1
       where id = $2`,
      [transactionId, ids.checkA],
    );
    expect(cleared).toBe(1);
  });

  test('a cleared check needs its date; a returned or cancelled check needs a reason', async () => {
    const noDate = await expectRejection(
      alice,
      `update public.post_dated_checks set status = 'cleared', delivered_on = '2026-09-15' where id = $1`,
      [ids.checkA],
    );
    expect(noDate?.code).toBe('23514');

    const noReason = await expectRejection(
      alice,
      `update public.post_dated_checks set status = 'cancelled' where id = $1`,
      [ids.checkA],
    );
    expect(noReason?.code).toBe('23514');

    const cancelled = await rowCountAs(
      alice,
      `update public.post_dated_checks set status = 'cancelled', resolution_reason = 'הוסכם' where id = $1`,
      [ids.checkA],
    );
    expect(cancelled).toBe(1);
  });

  test('a stranger changes nothing and nobody deletes', async () => {
    expect(
      await rowCountAs(carol, `update public.post_dated_checks set note = 'x' where id = $1`, [
        ids.checkA,
      ]),
    ).toBe(0);
    const remove = await expectRejection(
      alice,
      'delete from public.post_dated_checks where id = $1',
      [ids.checkA],
    );
    expect(remove?.code).toBe(PERMISSION_DENIED);
  });
});

describe('import files, batches and proposals', () => {
  test('a member registers an upload for their household and not for another', async () => {
    const insertFile = `insert into public.import_source_files
      (household_id, display_name, storage_path, kind, byte_size, sha256, uploaded_by)
      values ($1, 'x.csv', $2, 'csv', 10, $3, $4)`;
    expect(
      await rowCountAs(alice, insertFile, [householdA, randomUUID(), 'b'.repeat(64), alice.id]),
    ).toBe(1);
    const abroad = await expectRejection(alice, insertFile, [
      householdB,
      randomUUID(),
      'c'.repeat(64),
      alice.id,
    ]);
    expect(abroad?.code).toBe(PERMISSION_DENIED);
  });

  test('a batch must belong to a file of the same household', async () => {
    const sql = `insert into public.import_batches (household_id, source_file_id, created_by) values ($1, $2, $3)`;
    expect(await rowCountAs(alice, sql, [householdA, ids.fileA, alice.id])).toBe(1);

    for (const actor of [alice, 'owner' as const]) {
      const refused = await expectRejection(actor, sql, [householdA, ids.fileB, alice.id]);
      expect(refused?.code).toBe('P0001');
      expect(refused?.message).toMatch(/file belonging to the same household/);
    }
  });

  test('a proposal must belong to a batch of the same household, and cannot target a foreign account', async () => {
    const sql = `insert into public.import_proposals (household_id, batch_id, kind, raw, proposed, target_account_id)
      values ($1, $2, 'transaction', '[]'::jsonb, '{}'::jsonb, $3)`;
    expect(await rowCountAs(alice, sql, [householdA, ids.batchA, ids.accA])).toBe(1);

    const foreignBatch = await expectRejection(alice, sql, [householdA, ids.batchB, null]);
    expect(foreignBatch?.code).toBe('P0001');
    expect(foreignBatch?.message).toMatch(/same household as its batch/);

    const foreignAccount = await expectRejection(alice, sql, [
      householdA,
      ids.batchA,
      ids.accB,
    ]);
    expect(foreignAccount?.code).toBe('P0001');
    expect(foreignAccount?.message).toMatch(/account belonging to the same household/);
  });

  test('silence is not consent: a batch with a pending row cannot be approved', async () => {
    const approve = `update public.import_batches
      set status = 'approved', approved_at = now(), approved_by = $2 where id = $1`;

    const pending = await expectRejection(alice, approve, [ids.batchA, alice.id]);
    expect(pending?.message).toMatch(/undecided row/);

    // Decide the row, then the approval goes through — and a stranger's does not.
    const decided = await asUser(alice, async (client) => {
      await client.query(
        `update public.import_proposals set review_state = 'included' where id = $1`,
        [ids.proposalA],
      );
      return (await client.query(approve, [ids.batchA, alice.id])).rowCount;
    });
    expect(decided).toBe(1);

    expect(await rowCountAs(carol, approve, [ids.batchA, carol.id])).toBe(0);
  });

  test('a batch where every row was excluded has nothing to approve', async () => {
    const error = await asUser(alice, async (client) => {
      await client.query(
        `update public.import_proposals set review_state = 'excluded' where id = $1`,
        [ids.proposalA],
      );
      try {
        await client.query(
          `update public.import_batches set status = 'approved', approved_at = now(), approved_by = $2 where id = $1`,
          [ids.batchA, alice.id],
        );
        return null;
      } catch (e) {
        return e as PgError;
      }
    });
    expect(error?.message).toMatch(/nothing to approve/);
  });

  test('a proposal that was not included cannot claim to have created a record', async () => {
    const error = await expectRejection(
      alice,
      `update public.import_proposals set committed_record_id = $1 where id = $2`,
      [randomUUID(), ids.proposalA],
    );
    expect(error?.code).toBe('23514');
  });

  test.each(TABLES)('nobody may delete from %s', async (table) => {
    const error = await expectRejection(
      alice,
      `delete from public.${table} where household_id = $1`,
      [householdA],
    );
    expect(error?.code).toBe(PERMISSION_DENIED);
  });
});
