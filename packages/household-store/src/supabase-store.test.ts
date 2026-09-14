import {
  addAccount,
  addMember,
  addPlannedItem,
  emptyDocument,
  recordTransaction,
  removePlannedItem,
  renameHousehold,
  updateSettings,
  type StoreDocument,
} from '@family-finance/local-store';
import { describe, expect, test } from 'vitest';

import {
  changesBetween,
  type HouseholdChanges,
  type LoadedHousehold,
} from './document-mapping';
import {
  ConcurrentModificationError,
  PersistenceError,
  StoreNotInitialisedError,
} from './port';
import { rowToSnake } from './rows';
import { SupabaseHouseholdStore } from './supabase-store';
import { TransportError, type HouseholdTransport } from './transport';

/**
 * The store over a transport that keeps one household in memory — the same
 * shape the database returns, without a database. What these prove is the
 * contract between the store and the SQL functions: which changes are sent,
 * which are refused before anything is sent, and how failures come back.
 * The real-database behaviour is proven in supabase/tests/store.integration.test.ts.
 */

const NOW = '2026-09-14T10:00:00.000Z';
const ALICE = '11111111-1111-4111-8111-111111111111';
const HOUSEHOLD = '22222222-2222-4222-8222-222222222222';

function seed(): StoreDocument {
  return emptyDocument({
    householdId: HOUSEHOLD,
    householdName: 'הבית',
    profileId: ALICE,
    profileName: 'אליס',
    now: NOW,
    currency: 'ILS',
    timeZone: 'Asia/Jerusalem',
  });
}

/** Turns a document into what load_household_document() would return for it. */
function loadedFrom(document: StoreDocument): LoadedHousehold {
  const { notifications, ...settings } = document.settings;
  const rows = (items: readonly Record<string, unknown>[]) => items.map((r) => rowToSnake(r));
  return {
    household: rowToSnake({ ...document.household }),
    settings: rowToSnake({
      household_id: document.household.id,
      ...settings,
      ...notifications,
    }),
    setup: rowToSnake({ household_id: document.household.id, ...document.setup }),
    members: rows(document.members),
    profiles: rows(document.profiles),
    invitations: [],
    businesses: rows(document.businesses),
    accounts: rows(document.accounts),
    categories: rows(document.categories),
    balanceSnapshots: rows(document.balanceSnapshots),
    transactions: rows(document.transactions),
    cashflowItems: rows(document.cashflowItems),
    debts: rows(document.debts),
    debtEvents: rows(document.debtEvents),
    rollovers: rows(document.rollovers),
    checks: rows(document.checks),
    repaymentPlans: rows(document.repaymentPlans),
    budgets: rows(document.budgets),
    budgetLines: rows(document.budgetLines),
    tasks: rows(document.tasks),
    importSourceFiles: [],
    importBatches: [],
    importProposals: [],
    audit: rows(document.audit),
  };
}

class MemoryTransport implements HouseholdTransport {
  readonly applied: { expectedVersion: number; changes: HouseholdChanges }[] = [];
  version = 1;
  memberOf: string[] = [HOUSEHOLD];

  constructor(private document: StoreDocument | null) {}

  async memberships() {
    return this.memberOf.map((householdId) => ({ householdId, joinedAt: NOW }));
  }

  async load(householdId: string) {
    if (this.document === null || householdId !== this.document.household.id) return null;
    if (!this.memberOf.includes(householdId)) return null;
    const loaded = loadedFrom(this.document);
    return { ...loaded, household: { ...loaded.household, version: this.version } };
  }

  async apply(_householdId: string, expectedVersion: number, changes: HouseholdChanges) {
    if (expectedVersion !== this.version) {
      throw new TransportError('version_conflict', 'moved');
    }
    this.applied.push({ expectedVersion, changes });
    this.version += 1;
    return this.version;
  }

  async createHousehold() {
    this.document = seed();
    this.memberOf = [HOUSEHOLD];
    return HOUSEHOLD;
  }

  async createInvitation() {
    return 'a'.repeat(64);
  }

  async acceptInvitation() {
    return HOUSEHOLD;
  }
}

function storeWith(document: StoreDocument | null) {
  const transport = new MemoryTransport(document);
  return { transport, store: new SupabaseHouseholdStore(transport, ALICE, null) };
}

describe('reading', () => {
  test('a person with no membership has no store, and says so by name', async () => {
    const { store, transport } = storeWith(null);
    transport.memberOf = [];
    expect(await store.exists()).toBe(false);
    expect(await store.readDocumentOrNull()).toBeNull();
    await expect(store.readDocument()).rejects.toThrow(StoreNotInitialisedError);
  });

  test('the loaded household is validated with the document schema', async () => {
    const { store, transport } = storeWith(seed());
    const document = await store.readDocument();
    expect(document.household.id).toBe(HOUSEHOLD);
    expect(document.settings.notifications.balanceFreshnessDays).toBe(7);

    // A row the engine could not accept is refused whole, not half-loaded.
    transport.load = async () => {
      const loaded = loadedFrom(seed());
      return {
        ...loaded,
        household: { ...loaded.household, version: 1 },
        settings: { ...loaded.settings, month_start_day: 40 },
      };
    };
    await expect(store.readDocument()).rejects.toThrow(PersistenceError);
  });

  test('the actor of every command is the signed-in person', async () => {
    const { store } = storeWith(seed());
    expect((await store.context(NOW)).actorProfileId).toBe(ALICE);
  });
});

describe('writing sends exactly the difference', () => {
  test('a new account is an upsert of one row, with the setup flag and the audit entry', async () => {
    const { store, transport } = storeWith(seed());
    await store.run(
      (d, c) =>
        addAccount(
          d,
          {
            name: 'עו״ש',
            kind: 'bank_account',
            scope: 'household',
            institution: null,
            displaySuffix: null,
            openingBalanceMinor: 1_000,
            openingBalanceDirection: 'inflow',
            openingBalanceDate: '2026-09-01',
          },
          c,
        ),
      { now: NOW },
    );
    const [applied] = transport.applied;
    expect(applied?.expectedVersion).toBe(1);
    const changes = applied?.changes ?? {};
    expect(Object.keys(changes).sort()).toEqual(['accounts', 'audit', 'setup']);
    const accounts = changes['accounts'] as { upsert: Record<string, unknown>[] };
    expect(accounts.upsert).toHaveLength(1);
    expect(accounts.upsert[0]).toMatchObject({ name: 'עו״ש', opening_balance_minor: 1_000 });
    expect(accounts.upsert[0]).not.toHaveProperty('openingBalanceMinor');
    const audit = changes['audit'] as { action: string }[];
    expect(audit.map((a) => a.action)).toEqual(['account.added']);
  });

  test('a command that changes nothing sends nothing', async () => {
    const { store, transport } = storeWith(seed());
    await store.run((d) => ({ document: d, value: undefined }));
    expect(transport.applied).toHaveLength(0);
  });

  test('settings are flattened onto the row the database keeps', async () => {
    const { store, transport } = storeWith(seed());
    await store.run(
      (d, c) => updateSettings(d, { monthStartDay: 10, weeklyFoodGuidance: false }, c),
      { now: NOW },
    );
    const settings = transport.applied[0]?.changes['settings'] as Record<string, unknown>;
    expect(settings).toMatchObject({ month_start_day: 10, weekly_food_guidance: false });
    expect(settings).not.toHaveProperty('notifications');
  });

  test('a renamed household is one field', async () => {
    const { store, transport } = storeWith(seed());
    await store.run((d, c) => renameHousehold(d, { name: 'בית חדש' }, c), { now: NOW });
    expect(transport.applied[0]?.changes['household']).toEqual({ name: 'בית חדש' });
  });

  test('a removed planned item is a mark, not a deletion', async () => {
    const withItem = addPlannedItem(
      seed(),
      {
        label: 'ביטוח',
        scope: 'household',
        direction: 'outflow',
        amountMinor: 100,
        certainty: 'certain',
        expectedDate: '2026-10-01',
        dueDate: null,
        essential: false,
        categoryId: null,
        accountId: null,
      },
      { actorProfileId: ALICE, now: NOW },
    );
    const { store, transport } = storeWith(withItem.document);
    await store.run((d, c) => removePlannedItem(d, { itemId: withItem.value }, c), {
      now: NOW,
    });
    const items = transport.applied[0]?.changes['cashflowItems'] as { remove: string[] };
    expect(items.remove).toEqual([withItem.value]);
  });

  test('adding a member by name is refused before anything is sent', async () => {
    const { store, transport } = storeWith(seed());
    await expect(
      store.run((d, c) => addMember(d, { displayName: 'זר' }, c), { now: NOW }),
    ).rejects.toThrow(PersistenceError);
    expect(transport.applied).toHaveLength(0);
  });

  test('a household that moved since it was read is a conflict, not an overwrite', async () => {
    const { store, transport } = storeWith(seed());
    transport.version = 2;
    transport.load = async function (this: MemoryTransport, id: string) {
      const loaded = await MemoryTransport.prototype.load.call(this, id);
      return loaded === null
        ? null
        : { ...loaded, household: { ...loaded.household, version: 1 } };
    };
    await expect(
      store.run((d, c) => renameHousehold(d, { name: 'x' }, c), { now: NOW }),
    ).rejects.toThrow(ConcurrentModificationError);
  });

  test('a stale expectedRevision from the caller is refused too', async () => {
    const { store } = storeWith(seed());
    await expect(
      store.run((d, c) => renameHousehold(d, { name: 'x' }, c), { expectedRevision: '7' }),
    ).rejects.toThrow(ConcurrentModificationError);
  });
});

describe('invitations on a store that has not read anything yet', () => {
  test('the household is resolved from the membership before inviting', async () => {
    // A per-request store starts without a household id; the invitation
    // action may be its first call. Found by the live validation.
    const { store } = storeWith(seed());
    expect(await store.invite('bob@example.test')).toHaveLength(64);
    expect(await store.invitations()).toEqual([]);
  });

  test('a person with no membership cannot invite anybody', async () => {
    const { store, transport } = storeWith(null);
    transport.memberOf = [];
    await expect(store.invite('x@example.test')).rejects.toThrow(StoreNotInitialisedError);
  });
});

describe('what the store refuses to do here', () => {
  test('restore, and writing a backup to the server', async () => {
    const { store } = storeWith(seed());
    await expect(store.replaceDocument()).rejects.toThrow(PersistenceError);
    await expect(store.store.writeBackup('x', '{}')).rejects.toThrow(PersistenceError);
  });

  test('uploads are hashed and never kept', async () => {
    const { store } = storeWith(seed());
    const stored = await store.store.storeUpload(new TextEncoder().encode('abc'), '.csv');
    expect(stored.sha256).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(await store.store.staleUploads(0)).toEqual([]);
  });

  test('creating a second household for the same person is refused', async () => {
    const { store } = storeWith(seed());
    await expect(store.create({ householdName: 'שני', profileName: 'א' })).rejects.toThrow(
      PersistenceError,
    );
  });
});

describe('changesBetween on its own', () => {
  test('a disappearing row of a collection with no mark is refused', () => {
    const before = seed();
    const after = { ...before, profiles: [] };
    expect(() => changesBetween(before, after, ALICE)).toThrow(PersistenceError);
  });

  test('a new transaction carries the caller as creator and snake_case columns', () => {
    const withAccount = addAccount(
      seed(),
      {
        name: 'עו״ש',
        kind: 'bank_account',
        scope: 'household',
        institution: null,
        displaySuffix: null,
        openingBalanceMinor: 0,
        openingBalanceDirection: 'inflow',
        openingBalanceDate: '2026-09-01',
      },
      { actorProfileId: ALICE, now: NOW },
    );
    const withTx = recordTransaction(
      withAccount.document,
      {
        accountId: withAccount.value,
        counterpartAccountId: null,
        scope: 'household',
        kind: 'expense',
        direction: 'outflow',
        amountMinor: 500,
        categoryId: null,
        merchant: 'x',
        transactionDate: '2026-09-02',
        note: null,
      },
      { actorProfileId: ALICE, now: NOW },
    );
    const changes = changesBetween(withAccount.document, withTx.document, ALICE);
    const tx = (changes['transactions'] as { upsert: Record<string, unknown>[] }).upsert[0];
    expect(tx).toMatchObject({
      created_by: ALICE,
      amount_minor: 500,
      transaction_date: '2026-09-02',
    });
    expect(changes).not.toHaveProperty('accounts');
  });
});
