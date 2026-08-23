import { randomUUID } from 'node:crypto';

import { describe, expect, test } from 'vitest';

import {
  CONSUMER_DEBT_KINDS,
  DEBT_EVENT_BALANCE_EFFECT,
  debtEventSchema,
  debtRolloverSchema,
  debtSchema,
} from './debt';

const now = '2026-08-22T09:00:00.000Z';

function debt(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    householdId: randomUUID(),
    kind: 'bank_loan',
    creditorName: 'בנק',
    currency: 'ILS',
    status: 'active',
    effectiveAnnualRateBp: 1_250,
    minimumPaymentMinor: 1_200_00,
    paymentDueDay: 10,
    urgency: 'none',
    promiseSummary: null,
    relationshipSensitivity: null,
    partialPaymentAllowed: null,
    lastDemandAt: null,
    lastConversationAt: null,
    expectedCallDate: null,
    notes: null,
    openedOn: '2025-01-15',
    closedAt: null,
    createdBy: randomUUID(),
    createdAt: now,
    updatedAt: now,
    version: 1,
    ...overrides,
  };
}

function privateDebt(overrides: Record<string, unknown> = {}) {
  return debt({
    kind: 'private_person',
    creditorName: 'משה',
    effectiveAnnualRateBp: null,
    minimumPaymentMinor: null,
    paymentDueDay: null,
    relationshipSensitivity: 'high',
    partialPaymentAllowed: true,
    promiseSummary: 'סיכמנו להחזיר כשיהיה',
    ...overrides,
  });
}

describe('debtSchema', () => {
  test('an institutional debt parses', () => {
    expect(debtSchema.parse(debt()).kind).toBe('bank_loan');
  });

  test('a private debt carries the relationship fields', () => {
    const parsed = debtSchema.parse(privateDebt());
    expect(parsed.relationshipSensitivity).toBe('high');
    expect(parsed.partialPaymentAllowed).toBe(true);
  });

  test('a private debt without relationship fields is rejected', () => {
    expect(debtSchema.safeParse(privateDebt({ relationshipSensitivity: null })).success).toBe(
      false,
    );
  });

  test('an institutional debt may not carry relationship fields', () => {
    expect(debtSchema.safeParse(debt({ relationshipSensitivity: 'low' })).success).toBe(false);
  });

  test('an unknown interest rate is null and never zero', () => {
    const parsed = debtSchema.parse(debt({ effectiveAnnualRateBp: null }));
    expect(parsed.effectiveAnnualRateBp).toBeNull();
    expect(parsed.effectiveAnnualRateBp).not.toBe(0);
  });

  test('mortgage is excluded from the consumer debt kinds', () => {
    expect(CONSUMER_DEBT_KINDS).not.toContain('mortgage');
    expect(CONSUMER_DEBT_KINDS).toContain('private_person');
  });
});

describe('DEBT_EVENT_BALANCE_EFFECT', () => {
  test('paying interest does not reduce the balance', () => {
    expect(DEBT_EVENT_BALANCE_EFFECT.interest_paid).toBe('none');
    expect(DEBT_EVENT_BALANCE_EFFECT.fee_paid).toBe('none');
  });

  test('only a principal payment or a write-off reduces the balance', () => {
    const reducing = Object.entries(DEBT_EVENT_BALANCE_EFFECT)
      .filter(([, effect]) => effect === 'decrease')
      .map(([kind]) => kind)
      .sort();
    expect(reducing).toEqual(['principal_payment', 'write_off']);
  });

  test('charged interest and fees increase the balance', () => {
    expect(DEBT_EVENT_BALANCE_EFFECT.interest_charge).toBe('increase');
    expect(DEBT_EVENT_BALANCE_EFFECT.fee_charge).toBe('increase');
  });
});

describe('debtEventSchema', () => {
  const event = {
    id: randomUUID(),
    householdId: randomUUID(),
    debtId: randomUUID(),
    kind: 'principal_payment',
    amountMinor: 5_000_00,
    currency: 'ILS',
    occurredOn: '2026-08-20',
    correctionEffect: null,
    transactionId: null,
    note: null,
    createdBy: randomUUID(),
    createdAt: now,
  };

  test('a principal payment parses without a correction direction', () => {
    expect(debtEventSchema.parse(event).kind).toBe('principal_payment');
  });

  test('a correction must state its direction', () => {
    expect(
      debtEventSchema.safeParse({
        ...event,
        kind: 'balance_correction',
        correctionEffect: null,
      }).success,
    ).toBe(false);
  });

  test('a non-correction may not state a direction, so effects cannot contradict', () => {
    expect(debtEventSchema.safeParse({ ...event, correctionEffect: 'decrease' }).success).toBe(
      false,
    );
  });

  test('a correction with a direction parses', () => {
    const parsed = debtEventSchema.parse({
      ...event,
      kind: 'balance_correction',
      correctionEffect: 'decrease',
    });
    expect(parsed.correctionEffect).toBe('decrease');
  });
});

describe('debtRolloverSchema', () => {
  const link = {
    id: randomUUID(),
    householdId: randomUUID(),
    fromDebtId: randomUUID(),
    toDebtId: randomUUID(),
    repaymentEventId: randomUUID(),
    originationEventId: randomUUID(),
    amountMinor: 5_000_00,
    occurredOn: '2026-08-20',
    source: 'user_confirmed',
    status: 'confirmed',
    confidenceBp: null,
    notes: null,
    confirmedBy: randomUUID(),
    confirmedAt: now,
    createdBy: randomUUID(),
    createdAt: now,
    updatedAt: now,
    version: 1,
  };

  test('a confirmed link parses', () => {
    expect(debtRolloverSchema.parse(link).status).toBe('confirmed');
  });

  test('a debt cannot roll over into itself', () => {
    const same = randomUUID();
    expect(
      debtRolloverSchema.safeParse({ ...link, fromDebtId: same, toDebtId: same }).success,
    ).toBe(false);
  });

  test('a system suggestion must state its confidence', () => {
    expect(
      debtRolloverSchema.safeParse({
        ...link,
        source: 'system_suggested',
        status: 'proposed',
        confirmedBy: null,
        confirmedAt: null,
        confidenceBp: null,
      }).success,
    ).toBe(false);
  });

  test('a proposed link is not confirmed and records no confirmer', () => {
    const proposed = debtRolloverSchema.parse({
      ...link,
      source: 'system_suggested',
      status: 'proposed',
      confidenceBp: 8_200,
      confirmedBy: null,
      confirmedAt: null,
    });
    expect(proposed.status).toBe('proposed');
    expect(proposed.confirmedAt).toBeNull();
  });

  test('a link claiming confirmed status without a timestamp is rejected', () => {
    expect(debtRolloverSchema.safeParse({ ...link, confirmedAt: null }).success).toBe(false);
  });
});
