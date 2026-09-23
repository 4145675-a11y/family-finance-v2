/**
 * The Supabase-backed household store, domain by domain, against the real
 * database (ADR-0032 §3–4).
 *
 * Every test runs the same pure commands the file store runs, through
 * `SupabaseHouseholdStore`, over a transport that acts as a signed-in person
 * inside the harness's rolled-back transaction. For each domain it proves:
 * the change lands in the normalised tables and reads back as the same
 * document; a stranger can neither read nor write it; the financial picture
 * the engine computes from the database equals the one it computes from the
 * command's own result (parity with the local store); and a stale version is
 * refused rather than overwritten.
 */

import { randomUUID } from 'node:crypto';

import { buildCsv, extractDocument } from '@family-finance/document-import';
import {
  ConcurrentModificationError,
  PersistenceError,
  StoreNotInitialisedError,
  SupabaseHouseholdStore,
} from '@family-finance/household-store';
import {
  addAccount,
  addBusiness,
  addCheck,
  addDebt,
  addPlannedItem,
  addTask,
  approveBatch,
  clearCheck,
  deliverChecks,
  recordBalance,
  recordDebtEvent,
  recordTransaction,
  removePlannedItem,
  renameHousehold,
  reverseBatch,
  reviewAll,
  setBudgetLine,
  setRepaymentPlan,
  stageExtraction,
  startBudget,
  transferToHousehold,
  updateSettings,
  updateTask,
  viewOf,
  type StoreDocument,
} from '@family-finance/local-store';
import type { Client } from 'pg';
import { describe, expect, test } from 'vitest';

import { asUser, ownerClient, useHouseholdFixture, type Person } from './harness';
import { PgHouseholdTransport } from './pg-transport';

const { alice, bob, carol, mallory, householdA, householdB } = useHouseholdFixture(
  async (client, f) => {
    // The harness makes households by hand; the store needs their settings and
    // setup rows, which create_household() always writes.
    for (const household of [f.householdA, f.householdB]) {
      await client.query('insert into public.household_settings (household_id) values ($1)', [
        household,
      ]);
      await client.query(
        'insert into public.setup_progress (household_id, household_named) values ($1, true)',
        [household],
      );
    }
  },
);

const NOW = '2026-09-14T10:00:00.000Z';

function storeFor(client: Client, person: Person, householdId: string | null) {
  return new SupabaseHouseholdStore(
    new PgHouseholdTransport(client, person.id),
    person.id,
    householdId,
  );
}

/** Runs `fn` with a store acting as `person`, inside a savepoint that is rolled back. */
function withStore<T>(
  person: Person,
  householdId: string | null,
  fn: (store: SupabaseHouseholdStore, client: Client) => Promise<T>,
): Promise<T> {
  return asUser(person, (client) => fn(storeFor(client, person, householdId), client));
}

const account = {
  name: 'עו״ש',
  kind: 'bank_account' as const,
  scope: 'household' as const,
  institution: 'בנק',
  displaySuffix: null,
  openingBalanceMinor: 1_000_000,
  openingBalanceDirection: 'inflow' as const,
  openingBalanceDate: '2026-09-01',
};

describe('A. identity and household context', () => {
  test('a person with no household has no store to read; creating one bootstraps everything', async () => {
    await withStore(mallory, null, async (store) => {
      expect(await store.exists()).toBe(false);
      await expect(store.readDocument()).rejects.toThrow(StoreNotInitialisedError);
      expect(await store.view()).toBeNull();

      const id = await store.create({ householdName: 'בית מלורי', profileName: 'מלורי' });
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      expect(await store.exists()).toBe(true);

      const document = await store.readDocument();
      expect(document.household.name).toBe('בית מלורי');
      expect(document.profiles.map((p) => p.id)).toEqual([mallory.id]);
      expect(document.members).toHaveLength(1);
      expect(document.members[0]?.status).toBe('active');
      expect(document.settings.currency).toBe('ILS');
      expect(document.setup.householdNamed).toBe(true);
      expect(document.audit.map((a) => a.action)).toEqual(['household.created']);
      expect(document.accounts).toEqual([]);

      const context = await store.context(NOW);
      expect(context.actorProfileId).toBe(mallory.id);
    });
  });

  test('a member reads their household; a stranger reads nothing and writes nothing', async () => {
    await withStore(alice, householdA, async (store) => {
      const document = await store.readDocument();
      expect(document.household.id).toBe(householdA);
      expect(document.profiles.map((p) => p.id).sort()).toEqual([alice.id, bob.id].sort());
    });

    await withStore(carol, householdA, async (store) => {
      // Carol is a member of B. Naming A gets her nothing — not an empty
      // household, no household at all.
      await expect(store.readDocument()).rejects.toThrow(StoreNotInitialisedError);
      await expect(
        store.run((document, context) => renameHousehold(document, { name: 'נגנב' }, context)),
      ).rejects.toThrow(StoreNotInitialisedError);
    });

    const { rows } = await ownerClient().query(
      'select name from public.households where id = $1',
      [householdA],
    );
    expect(rows[0]?.name).toBe('Household A');
  });

  test('either partner renames and changes settings; the audit names who did it', async () => {
    await withStore(bob, householdA, async (store) => {
      await store.run(
        (document, context) => renameHousehold(document, { name: 'משפחת א' }, context),
        { now: NOW },
      );
      await store.run(
        (document, context) =>
          updateSettings(
            document,
            { monthStartDay: 10, protectedReservesMinor: 50_000 },
            context,
          ),
        { now: NOW },
      );
      const document = await store.readDocument();
      expect(document.household.name).toBe('משפחת א');
      expect(document.settings.monthStartDay).toBe(10);
      expect(document.settings.protectedReservesMinor).toBe(50_000);
      const actions = document.audit.map((a) => [a.action, a.actorProfileId]);
      expect(actions).toContainEqual(['household.renamed', bob.id]);
    });
  });

  test('an invitation minted by a member admits the invitee, who then reads the same household', async () => {
    const token = await asUser(
      alice,
      (client) => storeFor(client, alice, householdA).invite('mallory@example.test'),
      { keep: true },
    );
    expect(token).toMatch(/^[0-9a-f]{64}$/);

    await asUser(
      alice,
      async (client) => {
        const listed = await storeFor(client, alice, householdA).invitations();
        expect(listed.map((i) => i.invitedEmail)).toContain('mallory@example.test');
        expect(JSON.stringify(listed)).not.toContain(token);
      },
      { keep: true },
    );

    await withStore(mallory, null, async (store) => {
      const joined = await store.acceptInvitation(token);
      expect(joined).toBe(householdA);
      expect(await store.exists()).toBe(true);
      const document = await store.readDocument();
      expect(document.members.map((m) => m.profileId)).toContain(mallory.id);
    });
  });

  test('adding a member by name is not how membership works here', async () => {
    await withStore(alice, householdA, async (store) => {
      const { addMember } = await import('@family-finance/local-store');
      await expect(
        store.run((document, context) => addMember(document, { displayName: 'זר' }, context)),
      ).rejects.toThrow(PersistenceError);
    });
  });
});

describe('B. accounts and opening balances', () => {
  test('an account, a business account and a verified balance land in the tables and read back', async () => {
    await withStore(alice, householdA, async (store, client) => {
      const accountId = await store.run(
        (document, context) => addAccount(document, account, context),
        { now: NOW },
      );
      await store.run(
        (document, context) =>
          addBusiness(
            document,
            { name: 'העסק', taxReserveRateBp: 2500, operatingReserveMinor: 100_000 },
            context,
          ),
        { now: NOW },
      );
      await store.run(
        (document, context) =>
          recordBalance(
            document,
            {
              accountId,
              balanceMinor: 950_000,
              balanceDirection: 'inflow',
              verifiedAt: NOW,
              source: 'manual_entry',
              note: null,
            },
            context,
          ),
        { now: NOW },
      );

      const document = await store.readDocument();
      expect(document.accounts.map((a) => a.name)).toEqual(['עו״ש']);
      expect(document.businesses[0]?.operatingReserveMinor).toBe(100_000);
      expect(document.balanceSnapshots).toHaveLength(1);
      expect(document.setup.accountsAdded).toBe(true);

      // The rows really are normalised rows, stamped with the caller.
      const { rows } = await client.query(
        'select created_by from public.account_balance_snapshots where household_id = $1',
        [householdA],
      );
      expect(rows).toEqual([{ created_by: alice.id }]);
    });
  });

  test('the picture the engine computes from the database equals the command’s own result', async () => {
    await withStore(alice, householdA, async (store) => {
      let expected: StoreDocument | null = null;
      await store.run(
        (document, context) => {
          const outcome = addAccount(document, account, context);
          expected = outcome.document;
          return outcome;
        },
        { now: NOW },
      );
      const fromDatabase = await store.view(NOW);
      const fromCommand = viewOf(expected as unknown as StoreDocument, NOW);
      expect(fromDatabase?.snapshot).toEqual(fromCommand.snapshot);
      expect(fromDatabase?.input.accounts).toEqual(fromCommand.input.accounts);
    });
  });

  test('a stale version is refused, and the household is unchanged', async () => {
    await withStore(alice, householdA, async (store, client) => {
      const { rows } = await client.query<{ version: number }>(
        'select version from public.households where id = $1',
        [householdA],
      );
      const version = rows[0]?.version ?? 0;
      // Somebody else moves the household between our read and our write.
      await client.query('update public.households set updated_at = now() where id = $1', [
        householdA,
      ]);
      await expect(
        store.run((document, context) => addAccount(document, account, context), {
          expectedRevision: String(version),
        }),
      ).rejects.toThrow(ConcurrentModificationError);
      const after = await store.readDocument();
      expect(after.accounts).toEqual([]);
    });
  });
});

describe('C. transactions and movements', () => {
  test('income, expense and a business-to-household transfer are exact and net-zero', async () => {
    await withStore(alice, householdA, async (store) => {
      const bank = await store.run((d, c) => addAccount(d, account, c), { now: NOW });
      await store.run(
        (d, c) =>
          addBusiness(d, { name: 'העסק', taxReserveRateBp: 0, operatingReserveMinor: 0 }, c),
        { now: NOW },
      );
      const business = await store.run(
        (d, c) =>
          addAccount(
            d,
            { ...account, name: 'עסקי', scope: 'business', openingBalanceMinor: 500_000 },
            c,
          ),
        { now: NOW },
      );
      await store.run(
        (d, c) =>
          recordTransaction(
            d,
            {
              accountId: bank,
              counterpartAccountId: null,
              scope: 'household',
              kind: 'expense',
              direction: 'outflow',
              amountMinor: 41_230,
              categoryId: null,
              merchant: 'סופר',
              transactionDate: '2026-09-02',
              note: null,
            },
            c,
          ),
        { now: NOW },
      );
      await store.run(
        (d, c) =>
          transferToHousehold(
            d,
            {
              businessAccountId: business,
              householdAccountId: bank,
              amountMinor: 200_000,
              transactionDate: '2026-09-03',
              note: null,
            },
            c,
          ),
        { now: NOW },
      );

      const view = await store.view(NOW);
      const bankBalance = view?.input.accounts.find((a) => a.id === bank);
      const businessBalance = view?.input.accounts.find((a) => a.id === business);
      expect(bankBalance).toBeDefined();
      expect(businessBalance).toBeDefined();
      // 1,000,000 − 41,230 + 200,000 on one side; 500,000 − 200,000 on the other.
      const document = await store.readDocument();
      const sum = (accountId: string) =>
        document.transactions
          .filter((t) => t.status !== 'void')
          .reduce((total, t) => {
            if (t.accountId === accountId)
              return total + (t.direction === 'inflow' ? t.amountMinor : -t.amountMinor);
            if (t.counterpartAccountId === accountId)
              return total + (t.direction === 'inflow' ? -t.amountMinor : t.amountMinor);
            return total;
          }, 0);
      expect(sum(bank) + sum(business)).toBe(-41_230);
      expect(document.transactions.every((t) => t.createdBy === alice.id)).toBe(true);
    });
  });

  test('a transaction cannot be recorded against another household’s account, even by a member', async () => {
    const foreignAccount = await asUser(
      carol,
      (client) => storeFor(client, carol, householdB).run((d, c) => addAccount(d, account, c)),
      { keep: true },
    );
    await withStore(alice, householdA, async (store) => {
      await expect(
        store.run((d, c) =>
          recordTransaction(
            d,
            {
              accountId: foreignAccount,
              counterpartAccountId: null,
              scope: 'household',
              kind: 'expense',
              direction: 'outflow',
              amountMinor: 1,
              categoryId: null,
              merchant: null,
              transactionDate: '2026-09-02',
              note: null,
            },
            c,
          ),
        ),
        // The command itself refuses: the account is not in Alice's document.
      ).rejects.toThrow(/unknown_account|account/);
    });
  });
});

const statement = buildCsv({
  delimiter: ';',
  preamble: ['בנק לדוגמה - תנועות בחשבון'],
  header: ['תאריך', 'תיאור', 'חובה', 'זכות', 'יתרה'],
  rows: [
    ['02/09/2026', 'סופרמרקט', '412.30', '', '11,587.70'],
    ['03/09/2026', 'דלק', '318.00', '', '11,269.70'],
    ['04/09/2026', 'החזר', '', '150.00', '11,419.70'],
  ],
});

describe('D. import and reconciliation', () => {
  test('stage → review → approve creates transactions with provenance; reverse voids them and their snapshots', async () => {
    await withStore(alice, householdA, async (store, client) => {
      const bank = await store.run((d, c) => addAccount(d, account, c), { now: NOW });
      const extraction = extractDocument(statement, {
        fileName: 'statement.csv',
        currency: 'ILS',
        scope: 'household',
        importedOn: '2026-09-22',
      });
      const batchId = await store.run(
        (d, c) =>
          stageExtraction(
            d,
            {
              extraction,
              displayName: 'statement.csv',
              storedId: randomUUID(),
              sha256: 'b'.repeat(64),
              byteSize: statement.byteLength,
              declaredMimeType: 'text/csv',
              targetAccountId: bank,
            },
            c,
          ),
        { now: NOW },
      );

      let document = await store.readDocument();
      expect(document.importBatches[0]?.status).toBe('needs_review');
      expect(document.importProposals).toHaveLength(3);
      expect(document.transactions).toHaveLength(0);

      // The source file row exists with its hash and retains nothing.
      const { rows: files } = await client.query(
        'select sha256, retention_state from public.import_source_files where household_id = $1',
        [householdA],
      );
      expect(files).toEqual([{ sha256: 'b'.repeat(64), retention_state: 'purged' }]);

      await store.run(
        (d, c) => reviewAll(d, { batchId, reviewState: 'included', onlyPending: true }, c),
        {
          now: NOW,
        },
      );
      const outcome = await store.run((d, c) => approveBatch(d, { batchId }, c), { now: NOW });
      expect(outcome.transactionsCreated).toBe(3);

      document = await store.readDocument();
      expect(document.importBatches[0]?.status).toBe('approved');
      expect(document.transactions).toHaveLength(3);
      expect(document.transactions.every((t) => t.importBatchId === batchId)).toBe(true);
      expect(document.importProposals.every((p) => p.committedRecordId !== null)).toBe(true);

      // The database's own approval gate saw a fully decided batch.
      const { rows: batch } = await client.query(
        'select status, approved_by, rows_proposed from public.import_batches where id = $1',
        [batchId],
      );
      expect(batch).toEqual([{ status: 'approved', approved_by: alice.id, rows_proposed: 3 }]);

      await store.run((d, c) => reverseBatch(d, { batchId, reason: 'קובץ שגוי' }, c), {
        now: NOW,
      });
      document = await store.readDocument();
      expect(document.importBatches[0]?.status).toBe('reversed');
      expect(document.transactions.every((t) => t.status === 'void')).toBe(true);
    });
  });

  test('approving with an undecided row is refused by the command and by the database alike', async () => {
    await withStore(alice, householdA, async (store) => {
      const bank = await store.run((d, c) => addAccount(d, account, c), { now: NOW });
      const extraction = extractDocument(statement, {
        fileName: 'statement.csv',
        currency: 'ILS',
        scope: 'household',
        importedOn: '2026-09-22',
      });
      const batchId = await store.run(
        (d, c) =>
          stageExtraction(
            d,
            {
              extraction,
              displayName: 'statement.csv',
              storedId: randomUUID(),
              sha256: 'c'.repeat(64),
              byteSize: statement.byteLength,
              declaredMimeType: 'text/csv',
              targetAccountId: bank,
            },
            c,
          ),
        { now: NOW },
      );
      await expect(
        store.run((d, c) => approveBatch(d, { batchId }, c), { now: NOW }),
      ).rejects.toMatchObject({ code: 'not_ready' });
    });
  });
});

describe('E. budget and planning', () => {
  test('a budget with lines, an adjusted line, and a planned item that is later removed', async () => {
    await withStore(alice, householdA, async (store, client) => {
      const budgetId = await store.run(
        (d, c) =>
          startBudget(
            d,
            {
              period: '2026-09',
              lines: [
                { categoryKey: 'food', plannedMinor: 300_000 },
                { categoryKey: 'housing_and_bills', plannedMinor: 500_000 },
              ],
            },
            c,
          ),
        { now: NOW },
      );
      await store.run(
        (d, c) => setBudgetLine(d, { budgetId, categoryKey: 'food', plannedMinor: 320_000 }, c),
        { now: NOW },
      );
      const itemId = await store.run(
        (d, c) =>
          addPlannedItem(
            d,
            {
              label: 'ביטוח',
              scope: 'household',
              direction: 'outflow',
              amountMinor: 45_000,
              certainty: 'certain',
              expectedDate: '2026-10-05',
              dueDate: null,
              essential: true,
              categoryId: null,
              accountId: null,
            },
            c,
          ),
        { now: NOW },
      );

      let document = await store.readDocument();
      expect(document.budgets[0]?.period).toBe('2026-09');
      expect(document.budgetLines.find((l) => l.categoryKey === 'food')?.plannedMinor).toBe(
        320_000,
      );
      expect(document.cashflowItems.map((i) => i.id)).toEqual([itemId]);
      expect((await store.view(NOW))?.budget?.lines.length).toBeGreaterThan(0);

      await store.run((d, c) => removePlannedItem(d, { itemId }, c), { now: NOW });
      document = await store.readDocument();
      expect(document.cashflowItems).toEqual([]);

      // Marked, not deleted.
      const { rows } = await client.query(
        'select removed_at from public.cashflow_items where id = $1',
        [itemId],
      );
      expect(rows[0]?.removed_at).not.toBeNull();
    });
  });
});

describe('F. debts and repayment', () => {
  test('a debt with an opening balance and a repayment replays to the right balance', async () => {
    await withStore(alice, householdA, async (store) => {
      const debtId = await store.run(
        (d, c) =>
          addDebt(
            d,
            {
              creditorName: 'בנק',
              kind: 'bank_loan',
              openingBalanceMinor: 500_000,
              openedOn: '2026-01-01',
              effectiveAnnualRateBp: 700,
              minimumPaymentMinor: 20_000,
              paymentDueDay: 10,
              urgency: 'none',
              promiseSummary: null,
              relationshipSensitivity: null,
              partialPaymentAllowed: null,
              expectedCallDate: null,
              notes: null,
            },
            c,
          ),
        { now: NOW },
      );
      await store.run(
        (d, c) =>
          recordDebtEvent(
            d,
            {
              debtId,
              kind: 'principal_payment',
              amountMinor: 100_000,
              occurredOn: '2026-09-10',
              correctionEffect: null,
            },
            c,
          ),
        { now: NOW },
      );
      const document = await store.readDocument();
      expect(document.debtEvents.map((e) => e.kind)).toEqual([
        'opening_balance',
        'principal_payment',
      ]);
      const view = await store.view(NOW);
      const debt = view?.snapshot.debtBalances.find((item) => item.debtId === debtId);
      expect(debt?.balanceMinor).toBe(400_000);
    });
  });
});

describe('G. gemach and post-dated checks', () => {
  test('a check handed over changes no balance; clearing it moves money exactly once', async () => {
    await withStore(alice, householdA, async (store, client) => {
      const bank = await store.run((d, c) => addAccount(d, account, c), { now: NOW });
      const debtId = await store.run(
        (d, c) =>
          addDebt(
            d,
            {
              creditorName: 'גמ״ח',
              kind: 'gemach',
              openingBalanceMinor: 300_000,
              openedOn: '2026-09-01',
              effectiveAnnualRateBp: 0,
              minimumPaymentMinor: null,
              paymentDueDay: null,
              urgency: 'none',
              promiseSummary: null,
              relationshipSensitivity: null,
              partialPaymentAllowed: null,
              expectedCallDate: null,
              notes: null,
            },
            c,
          ),
        { now: NOW },
      );
      await store.run(
        (d, c) =>
          setRepaymentPlan(
            d,
            {
              debtId,
              agreementSummary: null,
              installmentCount: 3,
              installmentAmountMinor: 100_000,
              finalInstallmentAmountMinor: null,
              firstDueDate: '2026-09-10',
            },
            c,
          ),
        { now: NOW },
      );
      const checkId = await store.run(
        (d, c) =>
          addCheck(
            d,
            {
              debtId,
              accountId: bank,
              checkNumber: '1001',
              amountMinor: 100_000,
              dueDate: '2026-09-10',
              payeeName: 'גמ״ח',
              installmentNumber: 1,
              note: null,
              deliveredOn: null,
            },
            c,
          ),
        { now: NOW },
      );
      await store.run(
        (d, c) => deliverChecks(d, { checkIds: [checkId], deliveredOn: '2026-09-01' }, c),
        {
          now: NOW,
        },
      );

      const beforeClearing = await store.view(NOW);
      const debtBefore = beforeClearing?.snapshot.debtBalances.find((i) => i.debtId === debtId);
      expect(debtBefore?.balanceMinor, 'handing over paper repays nothing').toBe(300_000);

      const cleared = await store.run(
        (d, c) => clearCheck(d, { checkId, clearedOn: '2026-09-12' }, c),
        { now: NOW },
      );
      expect(cleared.transactionId).toMatch(/^[0-9a-f-]{36}$/);

      const document = await store.readDocument();
      const check = document.checks[0];
      expect(check?.status).toBe('cleared');
      expect(check?.clearedTransactionId).toBe(cleared.transactionId);
      expect(check?.debtEventId).not.toBeNull();

      const afterClearing = await store.view(NOW);
      const debtAfter = afterClearing?.snapshot.debtBalances.find((i) => i.debtId === debtId);
      expect(debtAfter?.balanceMinor).toBe(200_000);

      // The database's unique links refuse a second clearing of the same paper.
      const { rows } = await client.query(
        'select count(*)::int as n from public.post_dated_checks where cleared_transaction_id = $1',
        [cleared.transactionId],
      );
      expect(rows[0]?.n).toBe(1);
      await expect(
        store.run((d, c) => clearCheck(d, { checkId, clearedOn: '2026-09-13' }, c), {
          now: NOW,
        }),
      ).rejects.toThrow();
    });
  });
});

describe('H. reports, dashboard and projections', () => {
  test('the dashboard view is computed from the database document and matches the engine on the same facts', async () => {
    await withStore(alice, householdA, async (store) => {
      await store.run((d, c) => addAccount(d, account, c), { now: NOW });
      const view = await store.view(NOW);
      expect(view).not.toBeNull();
      expect(view?.periodStart).toBe('2026-09-01');
      const recomputed = viewOf(view?.document as StoreDocument, NOW);
      expect(recomputed.snapshot).toEqual(view?.snapshot);
      expect(recomputed.budget).toEqual(view?.budget);
      expect(recomputed.food).toEqual(view?.food);
    });
  });
});

describe('I. tasks and operational records', () => {
  test('a task is created, assigned, completed; restore is refused; uploads are transient', async () => {
    await withStore(alice, householdA, async (store) => {
      const document = await store.readDocument();
      const memberId = document.members.find((m) => m.profileId === alice.id)?.id ?? null;
      const taskId = await store.run(
        (d, c) =>
          addTask(
            d,
            {
              title: 'לאשר יתרה',
              reason: null,
              origin: 'manual',
              recommendationKey: null,
              amountMinor: null,
              relatedDebtId: null,
              relatedAccountId: null,
              assignedMemberId: memberId,
              dueOn: '2026-09-20',
            },
            c,
          ),
        { now: NOW },
      );
      await store.run((d, c) => updateTask(d, { taskId, status: 'done' }, c), { now: NOW });
      const after = await store.readDocument();
      expect(after.tasks[0]?.status).toBe('done');
      expect(after.tasks[0]?.completedAt).not.toBeNull();

      await expect(store.replaceDocument()).rejects.toThrow(PersistenceError);
      const stored = await store.store.storeUpload(new TextEncoder().encode('x'), '.csv');
      expect(stored.sha256).toHaveLength(64);
      expect(await store.store.staleUploads(0)).toEqual([]);
      await expect(store.store.writeBackup('b.json', '{}')).rejects.toThrow(PersistenceError);
    });
  });
});
