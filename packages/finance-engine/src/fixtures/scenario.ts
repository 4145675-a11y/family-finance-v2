import type {
  AccountPosition,
  DebtEventRecord,
  DebtRecord,
  EngineInput,
  PlannedItem,
} from '../types';

/**
 * Scenario builders for the engine's tests.
 *
 * Deliberately under `fixtures/` and deliberately not exported from the package
 * index: nothing that ships to a screen may reach these. They exist so a test can
 * state the one fact it is about — "a household with no reserve", "a debt repaid
 * with borrowed money" — instead of restating forty fields each time.
 *
 * Values are invented and anonymous. 08-TEST-PLAN.md forbids fixtures built from
 * real household data.
 */

export const REFERENCE_INSTANT = '2026-08-10T09:00:00.000Z';

export function account(overrides: Partial<AccountPosition> = {}): AccountPosition {
  return {
    id: 'account-1',
    name: 'עובר ושב',
    scope: 'household',
    kind: 'bank_account',
    balance: { amountMinor: 500_000, direction: 'inflow' },
    verifiedAt: '2026-08-09T06:00:00.000Z',
    ...overrides,
  };
}

export function planned(overrides: Partial<PlannedItem> = {}): PlannedItem {
  return {
    id: 'item-1',
    label: 'פריט',
    scope: 'household',
    direction: 'outflow',
    amountMinor: 100_000,
    certainty: 'certain',
    expectedDate: '2026-08-20',
    dueDate: null,
    essential: false,
    ...overrides,
  };
}

export function debt(overrides: Partial<DebtRecord> = {}): DebtRecord {
  return {
    id: 'debt-1',
    creditorName: 'בנק',
    kind: 'bank_loan',
    status: 'active',
    minimumPaymentMinor: 120_000,
    paymentDueDay: 10,
    effectiveAnnualRateBp: 1_250,
    urgency: 'none',
    expectedCallDate: null,
    ...overrides,
  };
}

export function debtEvent(overrides: Partial<DebtEventRecord> = {}): DebtEventRecord {
  return {
    id: 'event-1',
    debtId: 'debt-1',
    kind: 'opening_balance',
    amountMinor: 1_000_000,
    occurredOn: '2026-01-01',
    correctionEffect: null,
    ...overrides,
  };
}

/**
 * A solvent household with one account, one salary and one essential bill.
 *
 * Every test starts from something that works and breaks exactly one thing, so a
 * failure names the cause instead of the whole scenario.
 */
export function baseInput(overrides: Partial<EngineInput> = {}): EngineInput {
  return {
    asOf: REFERENCE_INSTANT,
    timeZone: 'Asia/Jerusalem',
    currency: 'ILS',
    accounts: [account()],
    plannedItems: [
      planned({
        id: 'salary',
        label: 'משכורת',
        direction: 'inflow',
        amountMinor: 1_200_000,
        certainty: 'certain',
        expectedDate: '2026-08-28',
      }),
      planned({
        id: 'rent',
        label: 'שכר דירה',
        direction: 'outflow',
        amountMinor: 600_000,
        essential: true,
        expectedDate: '2026-08-15',
        dueDate: '2026-08-15',
      }),
    ],
    debts: [debt()],
    debtEvents: [debtEvent()],
    rollovers: [],
    checks: [],
    reserve: {
      manualFloorMinor: 200_000,
      incidentBufferMinor: null,
      revolvingAvoidanceMinor: null,
      protectedReservesMinor: 0,
    },
    business: null,
    approvedSafeTransferMinor: 0,
    debtBaseline: {
      asOf: '2026-08-01',
      consumerDebtMinor: 1_000_000,
      totalDebtMinor: 1_000_000,
    },
    dataQuality: {
      unclassifiedCashMinor: 0,
      pendingApprovalCount: 0,
      recentTransactionCount: 40,
      transactionsMissingClassificationCount: 0,
      unresolvedReconciliationGapMinor: 0,
    },
    ...overrides,
  };
}
