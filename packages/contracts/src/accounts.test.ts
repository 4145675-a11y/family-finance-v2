import { randomUUID } from 'node:crypto';

import { describe, expect, test } from 'vitest';

import {
  LIQUID_ACCOUNT_KINDS,
  cashflowItemSchema,
  createTransactionInputSchema,
  financialAccountSchema,
  transactionSchema,
} from './accounts';

const now = '2026-08-22T09:00:00.000Z';

function account(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    householdId: randomUUID(),
    businessId: null,
    scope: 'household',
    kind: 'bank_account',
    name: 'עובר ושב',
    institution: 'בנק',
    currency: 'ILS',
    displaySuffix: '1234',
    openingBalanceMinor: 250_00,
    openingBalanceDirection: 'inflow',
    openingBalanceDate: '2026-08-01',
    closedAt: null,
    createdAt: now,
    updatedAt: now,
    version: 1,
    ...overrides,
  };
}

function transaction(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    householdId: randomUUID(),
    accountId: randomUUID(),
    counterpartAccountId: null,
    scope: 'household',
    kind: 'expense',
    direction: 'outflow',
    amountMinor: 4_990,
    currency: 'ILS',
    status: 'confirmed',
    categoryId: null,
    merchant: 'מכולת',
    transactionDate: '2026-08-20',
    postingDate: null,
    valueDate: null,
    refundsTransactionId: null,
    correctsTransactionId: null,
    note: null,
    createdBy: randomUUID(),
    createdAt: now,
    updatedAt: now,
    version: 1,
    ...overrides,
  };
}

describe('financialAccountSchema', () => {
  test('a valid account parses', () => {
    expect(financialAccountSchema.parse(account()).name).toBe('עובר ושב');
  });

  test('only the last four digits of a card may be stored', () => {
    expect(
      financialAccountSchema.safeParse(account({ displaySuffix: '4580123412341234' })).success,
    ).toBe(false);
  });

  test('a card balance is owed, so the direction must be able to say so', () => {
    const card = financialAccountSchema.parse(
      account({ kind: 'credit_card', openingBalanceDirection: 'outflow' }),
    );
    expect(card.openingBalanceDirection).toBe('outflow');
  });

  test('a credit card is not a liquid account kind', () => {
    expect(LIQUID_ACCOUNT_KINDS).not.toContain('credit_card');
    expect(LIQUID_ACCOUNT_KINDS).toContain('bank_account');
    expect(LIQUID_ACCOUNT_KINDS).toContain('cash_wallet');
  });
});

describe('transactionSchema — transfer and settlement', () => {
  test('a transfer without a counterpart is rejected', () => {
    const result = transactionSchema.safeParse(
      transaction({ kind: 'transfer', counterpartAccountId: null }),
    );
    expect(result.success).toBe(false);
  });

  test('an expense with a counterpart is rejected', () => {
    const result = transactionSchema.safeParse(
      transaction({ kind: 'expense', counterpartAccountId: randomUUID() }),
    );
    expect(result.success).toBe(false);
  });

  test('a transfer to the same account is rejected', () => {
    const accountId = randomUUID();
    const result = transactionSchema.safeParse(
      transaction({ kind: 'transfer', accountId, counterpartAccountId: accountId }),
    );
    expect(result.success).toBe(false);
  });

  test('a settlement is a transfer shape, not an extra expense', () => {
    const settlement = transactionSchema.parse(
      transaction({ kind: 'settlement', counterpartAccountId: randomUUID() }),
    );
    expect(settlement.kind).toBe('settlement');
  });
});

describe('transactionSchema — refunds and corrections', () => {
  test('a refund must name the transaction it reverses', () => {
    expect(
      transactionSchema.safeParse(transaction({ kind: 'refund', refundsTransactionId: null }))
        .success,
    ).toBe(false);
  });

  test('a non-refund may not carry a refund link', () => {
    expect(
      transactionSchema.safeParse(
        transaction({ kind: 'expense', refundsTransactionId: randomUUID() }),
      ).success,
    ).toBe(false);
  });

  test('void is a status, so a cancelled transaction is kept rather than deleted', () => {
    expect(transactionSchema.parse(transaction({ status: 'void' })).status).toBe('void');
  });
});

describe('createTransactionInputSchema — splits', () => {
  const base = {
    householdId: randomUUID(),
    accountId: randomUUID(),
    counterpartAccountId: null,
    scope: 'household' as const,
    kind: 'expense' as const,
    direction: 'outflow' as const,
    amountMinor: 100_00,
    currency: 'ILS',
    categoryId: null,
    merchant: null,
    transactionDate: '2026-08-20',
    note: null,
  };

  test('no splits is allowed', () => {
    expect(createTransactionInputSchema.parse({ ...base, splits: [] }).splits).toEqual([]);
  });

  test('splits that sum to the amount are allowed', () => {
    const parsed = createTransactionInputSchema.parse({
      ...base,
      splits: [
        { categoryId: null, scope: 'household', amountMinor: 60_00, note: null },
        { categoryId: null, scope: 'business', amountMinor: 40_00, note: null },
      ],
    });
    expect(parsed.splits).toHaveLength(2);
  });

  test('splits that sum to less than the amount are rejected', () => {
    const result = createTransactionInputSchema.safeParse({
      ...base,
      splits: [{ categoryId: null, scope: 'household', amountMinor: 99_99, note: null }],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain('sum exactly');
  });

  test('splits that sum to more than the amount are rejected', () => {
    const result = createTransactionInputSchema.safeParse({
      ...base,
      splits: [{ categoryId: null, scope: 'household', amountMinor: 100_01, note: null }],
    });
    expect(result.success).toBe(false);
  });
});

describe('cashflowItemSchema', () => {
  const item = {
    id: randomUUID(),
    householdId: randomUUID(),
    scope: 'household',
    accountId: null,
    direction: 'inflow',
    amountMinor: 8_000_00,
    currency: 'ILS',
    label: 'משכורת',
    categoryId: null,
    certainty: 'certain',
    expectedDate: '2026-09-01',
    dueDate: null,
    essential: false,
    settledTransactionId: null,
    createdBy: randomUUID(),
    createdAt: now,
    updatedAt: now,
    version: 1,
  };

  test('a future item carries certainty and an expected date', () => {
    expect(cashflowItemSchema.parse(item).certainty).toBe('certain');
  });

  test('certainty is constrained to the three defined levels', () => {
    expect(cashflowItemSchema.safeParse({ ...item, certainty: 'guaranteed' }).success).toBe(
      false,
    );
  });

  test('an essential outflow can carry a due date distinct from the expected date', () => {
    const parsed = cashflowItemSchema.parse({
      ...item,
      direction: 'outflow',
      essential: true,
      expectedDate: '2026-09-02',
      dueDate: '2026-09-10',
    });
    expect(parsed.dueDate).toBe('2026-09-10');
    expect(parsed.expectedDate).toBe('2026-09-02');
  });
});
