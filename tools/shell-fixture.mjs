/**
 * A household for the built-shell gate to render.
 *
 * The gate has to check a screen with money on it — bidi isolation is a rule
 * about digits, and a screen with no digits proves nothing. So it points the
 * server at a temporary data directory holding this, renders, and deletes it.
 *
 * Written as literal JSON rather than built through the store's own commands,
 * because this is a zero-dependency Node script and the store is TypeScript with
 * bundler-resolved imports (ADR-0018). The cost is that this can drift from the
 * schema; the mitigation is that drift makes the gate fail loudly with a
 * validation error, which is the correct signal rather than a silent pass.
 *
 * Every figure here is invented, and the directory is temporary. It never touches
 * the developer's own `.data`.
 */

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const PROFILE_ID = '22222222-2222-4222-8222-222222222222';
const MEMBER_ID = '33333333-3333-4333-8333-333333333333';
const ACCOUNT_ID = '44444444-4444-4444-8444-444444444444';
const SNAPSHOT_ID = '55555555-5555-4555-8555-555555555555';
const TRANSACTION_ID = '66666666-6666-4666-8666-666666666666';
const CASHFLOW_ID = '77777777-7777-4777-8777-777777777777';

const NOW = '2026-09-06T09:00:00.000Z';

/** @returns {string} the store document, serialised */
export function shellFixtureDocument() {
  const document = {
    formatVersion: 1,
    updatedAt: NOW,
    household: {
      id: HOUSEHOLD_ID,
      name: 'בית לבדיקת תצוגה',
      createdBy: PROFILE_ID,
      createdAt: NOW,
      updatedAt: NOW,
      version: 1,
    },
    settings: {
      currency: 'ILS',
      timeZone: 'Asia/Jerusalem',
      monthStartDay: 1,
      manualReserveFloorMinor: null,
      incidentBufferMinor: null,
      revolvingAvoidanceMinor: null,
      protectedReservesMinor: 0,
      notifications: {
        weeklyFoodGuidance: true,
        balanceFreshnessReminder: true,
        balanceFreshnessDays: 7,
      },
      updatedAt: NOW,
      version: 1,
    },
    setup: {
      householdNamed: true,
      membersAdded: true,
      accountsAdded: true,
      balancesConfirmed: true,
      businessDecided: true,
      debtsRecorded: false,
      recurringIncomeRecorded: true,
      recurringObligationsRecorded: false,
      budgetStarted: false,
      privacyExplained: true,
    },
    profiles: [
      {
        id: PROFILE_ID,
        displayName: 'בודקת',
        locale: 'he-IL',
        timeZone: 'Asia/Jerusalem',
        createdAt: NOW,
        updatedAt: NOW,
        version: 1,
      },
    ],
    members: [
      {
        id: MEMBER_ID,
        householdId: HOUSEHOLD_ID,
        profileId: PROFILE_ID,
        status: 'active',
        invitedBy: null,
        joinedAt: NOW,
        revokedAt: null,
        version: 1,
      },
    ],
    businesses: [],
    accounts: [
      {
        id: ACCOUNT_ID,
        householdId: HOUSEHOLD_ID,
        businessId: null,
        scope: 'household',
        kind: 'bank_account',
        name: 'עובר ושב',
        institution: null,
        currency: 'ILS',
        displaySuffix: null,
        openingBalanceMinor: 1_250_000,
        openingBalanceDirection: 'inflow',
        openingBalanceDate: '2026-09-01',
        closedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
        version: 1,
      },
    ],
    categories: [],
    balanceSnapshots: [
      {
        id: SNAPSHOT_ID,
        householdId: HOUSEHOLD_ID,
        accountId: ACCOUNT_ID,
        balanceMinor: 1_250_000,
        balanceDirection: 'inflow',
        verifiedAt: NOW,
        source: 'manual_entry',
        note: null,
        createdBy: PROFILE_ID,
        createdAt: NOW,
        importBatchId: null,
      },
    ],
    transactions: [
      {
        id: TRANSACTION_ID,
        householdId: HOUSEHOLD_ID,
        accountId: ACCOUNT_ID,
        counterpartAccountId: null,
        scope: 'household',
        kind: 'expense',
        direction: 'outflow',
        amountMinor: 41_230,
        currency: 'ILS',
        status: 'confirmed',
        categoryId: null,
        merchant: 'מכולת',
        transactionDate: '2026-09-02',
        postingDate: null,
        valueDate: null,
        refundsTransactionId: null,
        correctsTransactionId: null,
        note: null,
        createdBy: PROFILE_ID,
        createdAt: NOW,
        updatedAt: NOW,
        version: 1,
        importBatchId: null,
        importProposalId: null,
        sourceFingerprint: null,
      },
    ],
    cashflowItems: [
      {
        id: CASHFLOW_ID,
        householdId: HOUSEHOLD_ID,
        scope: 'household',
        accountId: ACCOUNT_ID,
        direction: 'inflow',
        amountMinor: 1_400_000,
        currency: 'ILS',
        label: 'משכורת',
        categoryId: null,
        certainty: 'certain',
        expectedDate: '2026-09-10',
        dueDate: null,
        essential: false,
        settledTransactionId: null,
        createdBy: PROFILE_ID,
        createdAt: NOW,
        updatedAt: NOW,
        version: 1,
        importBatchId: null,
      },
    ],
    debts: [],
    debtEvents: [],
    rollovers: [],
    budgets: [],
    budgetLines: [],
    tasks: [],
    importBatches: [],
    importProposals: [],
    audit: [],
  };

  return `${JSON.stringify(document, null, 2)}\n`;
}
