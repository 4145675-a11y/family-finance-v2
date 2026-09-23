import {
  addDebt,
  emptyDocument,
  recordDebtEvent,
  type StoreDocument,
} from '@family-finance/local-store';
import { describe, expect, test } from 'vitest';

import { changesBetween, type HouseholdChanges } from './document-mapping';
import { SupabaseHouseholdTransport } from './supabase-transport';

/**
 * What happens when the code is ahead of the database.
 *
 * A deployment carries new code the moment `main` builds; a migration reaches
 * the database only when the owner applies it. Between those two moments the
 * application calls functions that do not exist yet, and the regression these
 * tests exist for was exactly that: every write in the product answered "the
 * database is unavailable", which was both untrue and unactionable.
 *
 * The rule being pinned down: **records still save, and anything that genuinely
 * cannot be saved says so precisely.**
 */

const NOW = '2026-09-23T10:00:00.000Z';
const ALICE = '11111111-1111-4111-8111-111111111111';
const HOUSEHOLD = '22222222-2222-4222-8222-222222222222';

/** PostgREST's answer when the schema cache has no such function. */
const MISSING_FUNCTION = { code: 'PGRST202', message: 'Could not find the function' };

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

/**
 * A supabase-js stand-in that answers each RPC from a table of outcomes.
 *
 * Deliberately at the client boundary rather than the transport's: the thing
 * under test is how the transport reacts to what PostgREST actually returns, so
 * the fake has to be the thing that returns it.
 */
function clientWith(outcomes: Record<string, { data?: unknown; error?: unknown }>) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const client = {
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      const outcome = outcomes[fn] ?? { error: MISSING_FUNCTION };
      return Promise.resolve({ data: outcome.data ?? null, error: outcome.error ?? null });
    },
  };
  return { client, calls };
}

function transportOver(outcomes: Record<string, { data?: unknown; error?: unknown }>) {
  const { client, calls } = clientWith(outcomes);
  // The transport only ever uses `rpc` and `from`; this test exercises `apply`.
  const transport = new SupabaseHouseholdTransport(
    client as unknown as ConstructorParameters<typeof SupabaseHouseholdTransport>[0],
    ALICE,
  );
  return { transport, calls };
}

const RECORD_CHANGES: HouseholdChanges = { debtEvents: { upsert: [{ id: 'e1' }] } };

describe('a database that has the newer function', () => {
  test('the write goes through it, and the older one is not called', async () => {
    const { transport, calls } = transportOver({
      apply_household_document: { data: { version: 7 } },
    });

    await expect(transport.apply(HOUSEHOLD, 6, RECORD_CHANGES)).resolves.toBe(7);
    expect(calls.map((call) => call.fn)).toEqual(['apply_household_document']);
  });
});

describe('a database that does not have it yet', () => {
  test('financial records still save, through the older function', async () => {
    const { transport, calls } = transportOver({
      apply_household_document: { error: MISSING_FUNCTION },
      apply_household_changes: { data: { version: 7 } },
    });

    await expect(transport.apply(HOUSEHOLD, 6, RECORD_CHANGES)).resolves.toBe(7);
    expect(calls.map((call) => call.fn)).toEqual([
      'apply_household_document',
      'apply_household_changes',
    ]);
  });

  test('the fallback sends the same change set, unaltered', async () => {
    const { transport, calls } = transportOver({
      apply_household_document: { error: MISSING_FUNCTION },
      apply_household_changes: { data: { version: 7 } },
    });

    await transport.apply(HOUSEHOLD, 6, RECORD_CHANGES);
    expect(calls[1]?.args).toEqual({
      p_household_id: HOUSEHOLD,
      p_expected_version: 6,
      p_changes: RECORD_CHANGES,
    });
  });

  test('a classification rule is refused precisely, not dropped', async () => {
    /*
     * The old function cannot carry rules. Letting the write succeed without
     * them would tell a family their correction was remembered and leave it
     * forgotten — a false success, which is worse than a refusal.
     */
    const { transport, calls } = transportOver({
      apply_household_document: { error: MISSING_FUNCTION },
      apply_household_changes: { data: { version: 7 } },
    });

    await expect(
      transport.apply(HOUSEHOLD, 6, { learnedRules: { upsert: [{ id: 'r1' }], gone: [] } }),
    ).rejects.toMatchObject({ failure: 'schema_outdated' });

    // And nothing was written at all.
    expect(calls.map((call) => call.fn)).toEqual(['apply_household_document']);
  });
});

describe('a write that genuinely fails', () => {
  test('a real error from the newer function is reported, never retried as legacy', async () => {
    const { transport, calls } = transportOver({
      apply_household_document: { error: { code: '42501', message: 'permission denied' } },
      apply_household_changes: { data: { version: 99 } },
    });

    await expect(transport.apply(HOUSEHOLD, 6, RECORD_CHANGES)).rejects.toMatchObject({
      failure: 'permission_denied',
    });
    expect(calls.map((call) => call.fn)).toEqual(['apply_household_document']);
  });

  test('a failure in the fallback is reported too', async () => {
    const { transport } = transportOver({
      apply_household_document: { error: MISSING_FUNCTION },
      apply_household_changes: { error: { code: '40001', message: 'conflict' } },
    });

    await expect(transport.apply(HOUSEHOLD, 6, RECORD_CHANGES)).rejects.toMatchObject({
      failure: 'version_conflict',
    });
  });

  test('a write that returns no version is a failure, not a silent success', async () => {
    const { transport } = transportOver({
      apply_household_document: { data: {} },
    });
    await expect(transport.apply(HOUSEHOLD, 6, RECORD_CHANGES)).rejects.toMatchObject({
      failure: 'unavailable',
    });
  });
});

describe('a manual lender payment is recorded once', () => {
  const base = seed();
  const context = { actorProfileId: ALICE, now: NOW };
  const opened = addDebt(
    base,
    {
      creditorName: 'גמח אור החיים',
      kind: 'gemach',
      openingBalanceMinor: 500_000,
      openedOn: '2026-09-01',
      effectiveAnnualRateBp: null,
      minimumPaymentMinor: null,
      paymentDueDay: null,
      urgency: 'none',
      promiseSummary: null,
      relationshipSensitivity: null,
      partialPaymentAllowed: null,
      expectedCallDate: null,
      notes: null,
    },
    context,
  );
  const debtId = opened.value;
  const KEY = '33333333-3333-4333-8333-333333333333';

  test('the payment becomes exactly one debt event', () => {
    const paid = recordDebtEvent(
      opened.document,
      {
        debtId,
        kind: 'principal_payment',
        amountMinor: 100_000,
        occurredOn: '2026-09-20',
        correctionEffect: null,
        idempotencyKey: KEY,
      },
      context,
    );

    const payments = paid.document.debtEvents.filter(
      (event) => event.kind === 'principal_payment',
    );
    expect(payments).toHaveLength(1);
    expect(payments[0]?.id).toBe(KEY);
    expect(payments[0]?.amountMinor).toBe(100_000);
  });

  test('and the change set sends that one row', () => {
    const paid = recordDebtEvent(
      opened.document,
      {
        debtId,
        kind: 'principal_payment',
        amountMinor: 100_000,
        occurredOn: '2026-09-20',
        correctionEffect: null,
        idempotencyKey: KEY,
      },
      context,
    );
    const changes = changesBetween(opened.document, paid.document, ALICE);
    const sent = changes['debtEvents'] as { upsert: Record<string, unknown>[] };
    expect(sent.upsert).toHaveLength(1);
    expect(sent.upsert[0]?.['id']).toBe(KEY);
    expect(sent.upsert[0]?.['kind']).toBe('principal_payment');
  });

  test('submitting the same form twice records it once', () => {
    const first = recordDebtEvent(
      opened.document,
      {
        debtId,
        kind: 'principal_payment',
        amountMinor: 100_000,
        occurredOn: '2026-09-20',
        correctionEffect: null,
        idempotencyKey: KEY,
      },
      context,
    );
    const second = recordDebtEvent(
      first.document,
      {
        debtId,
        kind: 'principal_payment',
        amountMinor: 100_000,
        occurredOn: '2026-09-20',
        correctionEffect: null,
        idempotencyKey: KEY,
      },
      context,
    );

    expect(
      second.document.debtEvents.filter((event) => event.kind === 'principal_payment'),
    ).toHaveLength(1);
    // The second call changes nothing, so nothing is sent to the database.
    expect(changesBetween(first.document, second.document, ALICE)).toEqual({});
  });

  test('two genuinely different payments are two events', () => {
    const first = recordDebtEvent(
      opened.document,
      {
        debtId,
        kind: 'principal_payment',
        amountMinor: 100_000,
        occurredOn: '2026-09-20',
        correctionEffect: null,
        idempotencyKey: KEY,
      },
      context,
    );
    const second = recordDebtEvent(
      first.document,
      {
        debtId,
        kind: 'principal_payment',
        amountMinor: 50_000,
        occurredOn: '2026-09-21',
        correctionEffect: null,
        idempotencyKey: '44444444-4444-4444-8444-444444444444',
      },
      context,
    );

    expect(
      second.document.debtEvents.filter((event) => event.kind === 'principal_payment'),
    ).toHaveLength(2);
  });

  test('a caller that means "another one" still gets another one', () => {
    // The import pipeline supplies no key, and two identical rows in a file are
    // two real events.
    const first = recordDebtEvent(
      opened.document,
      {
        debtId,
        kind: 'principal_payment',
        amountMinor: 100_000,
        occurredOn: '2026-09-20',
        correctionEffect: null,
      },
      context,
    );
    const second = recordDebtEvent(
      first.document,
      {
        debtId,
        kind: 'principal_payment',
        amountMinor: 100_000,
        occurredOn: '2026-09-20',
        correctionEffect: null,
      },
      context,
    );
    expect(
      second.document.debtEvents.filter((event) => event.kind === 'principal_payment'),
    ).toHaveLength(2);
  });
});
