import { createTransactionInputSchema } from '@family-finance/contracts';
import fc from 'fast-check';
import { beforeAll, describe, expect, test } from 'vitest';

import { debtPeriodMetrics, debtTotals, debtTrend, replayDebtBalances } from './debt';
import { account, baseInput, debt, debtEvent, planned } from './fixtures/scenario';
import { projectDailyBalance } from './forecast';
import { safeHouseholdSpend } from './household';
import {
  applyBasisPoints,
  clampAtZero,
  roundHalfUp,
  sumAmounts,
  toDirected,
  toSigned,
} from './money';
import type { DebtEventRecord } from './types';
import { allocateWaterfall, noClaims, type WaterfallClaims } from './waterfall';

/**
 * The invariants from 02-FINANCIAL-RULES.md § אינווריאנטים, as properties.
 *
 * A unit test proves a rule for the example its author thought of. These prove it
 * for every value fast-check can find inside the stated range, which is the only
 * way to catch the class of bug where a formula is correct at 5,000 and wrong at
 * 5,001. 08-TEST-PLAN.md requires both layers for any calculation.
 *
 * The run is seeded, so a counterexample found on one machine reproduces on
 * every other one.
 */

const SEED = 20260823;
const RUNS = 300;

beforeAll(() => {
  fc.configureGlobal({ seed: SEED, numRuns: RUNS });
});

/** Amounts stay well inside the aggregation-safe range from the money contract. */
const amount = fc.integer({ min: 0, max: 100_000_000 });
const smallAmount = fc.integer({ min: 0, max: 5_000_000 });
const today = '2026-08-10';

describe('money conventions (FIN-MONEY-001)', () => {
  test('a stored amount survives the round trip through a signed value', () => {
    fc.assert(
      fc.property(
        amount,
        fc.constantFrom('inflow' as const, 'outflow' as const),
        (value, direction) => {
          const stored = { amountMinor: value, direction };
          const back = toDirected(toSigned(stored));
          // Zero has one representation, so a stored outflow of zero reads back as
          // an inflow of zero. Every non-zero amount keeps its direction exactly.
          expect(back.amountMinor).toBe(value);
          if (value !== 0) expect(back.direction).toBe(direction);
        },
      ),
    );
  });

  test('a stored amount is never negative, whatever the direction', () => {
    fc.assert(
      fc.property(fc.integer({ min: -100_000_000, max: 100_000_000 }), (value) => {
        expect(toDirected(value).amountMinor).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  test('clamping at zero loses nothing: result minus shortfall is the input', () => {
    fc.assert(
      fc.property(fc.integer({ min: -100_000_000, max: 100_000_000 }), (value) => {
        const { resultMinor, shortfallMinor } = clampAtZero(value);
        expect(resultMinor - shortfallMinor).toBe(value);
        expect(resultMinor).toBeGreaterThanOrEqual(0);
        expect(shortfallMinor).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  test('rounding half up returns an integer no further than half a unit away', () => {
    fc.assert(
      fc.property(fc.double({ min: -1_000_000, max: 1_000_000, noNaN: true }), (value) => {
        const rounded = roundHalfUp(value);
        expect(Number.isInteger(rounded)).toBe(true);
        expect(Math.abs(rounded - value)).toBeLessThanOrEqual(0.5);
      }),
    );
  });

  test('applying a rate never decreases as the amount grows', () => {
    fc.assert(
      fc.property(amount, amount, fc.integer({ min: 0, max: 10_000 }), (a, b, rateBp) => {
        const [low, high] = a <= b ? [a, b] : [b, a];
        expect(applyBasisPoints(high, rateBp)).toBeGreaterThanOrEqual(
          applyBasisPoints(low, rateBp),
        );
      }),
    );
  });
});

describe('a transfer does not change consolidated equity', () => {
  test('the two legs of any transfer sum to zero', () => {
    fc.assert(
      fc.property(amount, (value) => {
        expect(
          sumAmounts([
            { amountMinor: value, direction: 'outflow' },
            { amountMinor: value, direction: 'inflow' },
          ]),
        ).toBe(0);
      }),
    );
  });

  test('moving cash between two household accounts leaves liquidity unchanged', () => {
    fc.assert(
      fc.property(smallAmount, smallAmount, (start, moved) => {
        const transferred = Math.min(moved, start);
        const before = baseInput({
          accounts: [
            account({ id: 'a', balance: { amountMinor: start, direction: 'inflow' } }),
            account({ id: 'b', balance: { amountMinor: 0, direction: 'inflow' } }),
          ],
        });
        const after = baseInput({
          accounts: [
            account({
              id: 'a',
              balance: { amountMinor: start - transferred, direction: 'inflow' },
            }),
            account({ id: 'b', balance: { amountMinor: transferred, direction: 'inflow' } }),
          ],
        });
        expect(safeHouseholdSpend(after, today).resultMinor).toBe(
          safeHouseholdSpend(before, today).resultMinor,
        );
      }),
    );
  });
});

describe('splits equal their source', () => {
  test('any set of splits that does not sum to the amount is rejected', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        (total, wrongPart) => {
          fc.pre(wrongPart !== total);
          const result = createTransactionInputSchema.safeParse({
            householdId: '00000000-0000-4000-8000-000000000001',
            accountId: '00000000-0000-4000-8000-000000000002',
            counterpartAccountId: null,
            scope: 'household',
            kind: 'expense',
            direction: 'outflow',
            amountMinor: total,
            currency: 'ILS',
            categoryId: null,
            merchant: null,
            transactionDate: '2026-08-20',
            note: null,
            splits: [
              { categoryId: null, scope: 'household', amountMinor: wrongPart, note: null },
            ],
          });
          expect(result.success).toBe(false);
        },
      ),
    );
  });
});

describe('debt balances are replayed, never assumed', () => {
  const eventArb = fc.record({
    kind: fc.constantFrom(
      'opening_balance' as const,
      'new_principal' as const,
      'principal_payment' as const,
      'interest_charge' as const,
      'interest_paid' as const,
      'fee_paid' as const,
    ),
    amountMinor: smallAmount,
    occurredOn: fc.constantFrom('2026-08-02', '2026-08-05', '2026-08-08'),
  });

  function toEvents(
    raw: readonly { kind: DebtEventRecord['kind']; amountMinor: number; occurredOn: string }[],
  ) {
    return raw.map((item, index) => debtEvent({ id: `e-${index}`, ...item }));
  }

  test('replay does not depend on the order events are supplied in', () => {
    fc.assert(
      fc.property(fc.array(eventArb, { maxLength: 12 }), (raw) => {
        const events = toEvents(raw);
        const forward = replayDebtBalances(events, today);
        const reversed = replayDebtBalances([...events].reverse(), today);
        expect(reversed.get('debt-1') ?? 0).toBe(forward.get('debt-1') ?? 0);
      }),
    );
  });

  test('paying interest or a fee never reduces the balance', () => {
    fc.assert(
      fc.property(smallAmount, smallAmount, (opening, paid) => {
        const withoutPayment = replayDebtBalances(
          [debtEvent({ id: 'open', amountMinor: opening })],
          today,
        );
        const withPayment = replayDebtBalances(
          [
            debtEvent({ id: 'open', amountMinor: opening }),
            debtEvent({
              id: 'interest',
              kind: 'interest_paid',
              amountMinor: paid,
              occurredOn: '2026-08-05',
            }),
            debtEvent({
              id: 'fee',
              kind: 'fee_paid',
              amountMinor: paid,
              occurredOn: '2026-08-05',
            }),
          ],
          today,
        );
        expect(withPayment.get('debt-1')).toBe(withoutPayment.get('debt-1'));
      }),
    );
  });

  test('a balance is never negative, however much was repaid', () => {
    fc.assert(
      fc.property(smallAmount, smallAmount, (opening, repaid) => {
        const balances = replayDebtBalances(
          [
            debtEvent({ id: 'open', amountMinor: opening }),
            debtEvent({
              id: 'repay',
              kind: 'principal_payment',
              amountMinor: repaid,
              occurredOn: '2026-08-05',
            }),
          ],
          today,
        );
        expect(balances.get('debt-1')).toBeGreaterThanOrEqual(0);
      }),
    );
  });
});

describe('a rollover explains a repayment without changing it', () => {
  const debts = [
    debt({ id: 'moshe', kind: 'private_person' }),
    debt({ id: 'israel', kind: 'private_person' }),
  ];

  function eventsFor(repaid: number, borrowed: number) {
    return [
      debtEvent({ id: 'open', debtId: 'moshe', amountMinor: repaid, occurredOn: '2026-08-01' }),
      debtEvent({
        id: 'repay',
        debtId: 'moshe',
        kind: 'principal_payment',
        amountMinor: repaid,
        occurredOn: '2026-08-05',
      }),
      debtEvent({
        id: 'borrow',
        debtId: 'israel',
        kind: 'new_principal',
        amountMinor: borrowed,
        occurredOn: '2026-08-05',
      }),
    ];
  }

  test('repaying with borrowed money of the same size leaves the total unchanged', () => {
    fc.assert(
      fc.property(smallAmount, (value) => {
        const balances = replayDebtBalances(eventsFor(value, value), today);
        const totals = debtTotals(debts, balances);
        const trend = debtTrend(
          { asOf: '2026-08-01', consumerDebtMinor: value, totalDebtMinor: value },
          totals,
        );
        expect(trend.netConsumerChangeMinor).toBe(0);
        expect(trend.consumerDirection).toBe('flat');
      }),
    );
  });

  test('the reduction that counts is exactly the part income funded', () => {
    fc.assert(
      fc.property(smallAmount, smallAmount, (repaid, borrowedRaw) => {
        const borrowed = Math.min(borrowedRaw, repaid);
        const metrics = debtPeriodMetrics(
          eventsFor(repaid, borrowed),
          [
            {
              id: 'link',
              fromDebtId: 'moshe',
              toDebtId: 'israel',
              amountMinor: borrowed,
              occurredOn: '2026-08-05',
              status: 'confirmed',
            },
          ],
          '2026-08-01',
          today,
        );
        expect(metrics.incomeFundedPrincipalReductionMinor).toBe(repaid - borrowed);
      }),
    );
  });

  test('the link itself moves no balance', () => {
    fc.assert(
      fc.property(smallAmount, (value) => {
        const events = eventsFor(value, value);
        const withoutLink = replayDebtBalances(events, today);
        const totals = debtTotals(debts, withoutLink);
        const metricsWithLink = debtPeriodMetrics(
          events,
          [
            {
              id: 'link',
              fromDebtId: 'moshe',
              toDebtId: 'israel',
              amountMinor: value,
              occurredOn: '2026-08-05',
              status: 'confirmed',
            },
          ],
          '2026-08-01',
          today,
        );
        const totalsAgain = debtTotals(debts, replayDebtBalances(events, today));
        expect(totalsAgain).toEqual(totals);
        expect(metricsWithLink.rolloverFundedRepaymentMinor).toBeLessThanOrEqual(
          metricsWithLink.grossPrincipalRepaidMinor,
        );
      }),
    );
  });
});

describe('the allocation waterfall (FIN-WATERFALL-001)', () => {
  const claimsArb: fc.Arbitrary<WaterfallClaims> = fc
    .array(smallAmount, { minLength: 10, maxLength: 10 })
    .map((values) => {
      const keys = Object.keys(noClaims()) as (keyof WaterfallClaims)[];
      const claims = { ...noClaims() };
      keys.forEach((key, index) => {
        claims[key] = values[index] ?? 0;
      });
      return claims;
    });

  test('never allocates more than is available', () => {
    fc.assert(
      fc.property(smallAmount, claimsArb, (available, claims) => {
        const result = allocateWaterfall(available, claims);
        const allocated = result.allocations.reduce(
          (total, allocation) => total + allocation.allocatedMinor,
          0,
        );
        expect(allocated).toBeLessThanOrEqual(available);
        expect(allocated + result.remainingMinor).toBe(available);
      }),
    );
  });

  test('no step receives more than it claimed', () => {
    fc.assert(
      fc.property(smallAmount, claimsArb, (available, claims) => {
        for (const allocation of allocateWaterfall(available, claims).allocations) {
          expect(allocation.allocatedMinor).toBeLessThanOrEqual(allocation.claimedMinor);
          expect(allocation.allocatedMinor + allocation.unfundedMinor).toBe(
            allocation.claimedMinor,
          );
        }
      }),
    );
  });

  test('once a step is short, no later step receives anything', () => {
    fc.assert(
      fc.property(smallAmount, claimsArb, (available, claims) => {
        const { allocations } = allocateWaterfall(available, claims);
        const firstShort = allocations.findIndex((allocation) => allocation.unfundedMinor > 0);
        if (firstShort === -1) return;
        for (const later of allocations.slice(firstShort + 1)) {
          expect(later.allocatedMinor).toBe(0);
        }
      }),
    );
  });

  test('accelerated repayment is allowed only when steps 1-5 are whole', () => {
    fc.assert(
      fc.property(smallAmount, claimsArb, (available, claims) => {
        const result = allocateWaterfall(available, claims);
        const firstFive = result.allocations.filter((allocation) => allocation.step <= 5);
        const allFunded = firstFive.every((allocation) => allocation.unfundedMinor === 0);
        expect(result.acceleratedRepaymentAllowed).toBe(allFunded);
      }),
    );
  });
});

describe('safe spend never counts what is not there', () => {
  test('the result is never negative and the gap is never hidden', () => {
    fc.assert(
      fc.property(smallAmount, smallAmount, (cash, need) => {
        const result = safeHouseholdSpend(
          baseInput({
            accounts: [account({ balance: { amountMinor: cash, direction: 'inflow' } })],
            plannedItems: [
              planned({
                id: 'need',
                direction: 'outflow',
                amountMinor: need,
                essential: true,
                expectedDate: '2026-08-15',
                dueDate: '2026-08-15',
              }),
            ],
          }),
          today,
        );
        expect(result.resultMinor).toBeGreaterThanOrEqual(0);
        expect(result.fundingGapMinor).toBeGreaterThanOrEqual(0);
        // Exactly one of them can be positive: a household either has room or a gap.
        expect(result.resultMinor === 0 || result.fundingGapMinor === 0).toBe(true);
      }),
    );
  });

  test('uncertain income never raises the safe figure', () => {
    fc.assert(
      fc.property(
        smallAmount,
        fc.constantFrom('probable' as const, 'possible' as const),
        (value, certainty) => {
          const withoutIt = safeHouseholdSpend(baseInput(), today);
          const withIt = safeHouseholdSpend(
            baseInput({
              plannedItems: [
                ...baseInput().plannedItems,
                planned({
                  id: 'uncertain',
                  direction: 'inflow',
                  amountMinor: value,
                  certainty,
                  expectedDate: '2026-08-20',
                }),
              ],
            }),
            today,
          );
          expect(withIt.resultMinor).toBe(withoutIt.resultMinor);
        },
      ),
    );
  });

  test('a larger essential need never produces a larger safe figure', () => {
    fc.assert(
      fc.property(smallAmount, smallAmount, (a, b) => {
        const [smaller, larger] = a <= b ? [a, b] : [b, a];
        const build = (need: number) =>
          safeHouseholdSpend(
            baseInput({
              plannedItems: [
                ...baseInput().plannedItems,
                planned({
                  id: 'extra-need',
                  direction: 'outflow',
                  amountMinor: need,
                  essential: true,
                  expectedDate: '2026-08-18',
                  dueDate: '2026-08-18',
                }),
              ],
            }),
            today,
          );
        expect(build(larger).resultMinor).toBeLessThanOrEqual(build(smaller).resultMinor);
      }),
    );
  });
});

describe('the forecast is arithmetic, not opinion', () => {
  test('the closing balance is the opening balance plus every movement', () => {
    fc.assert(
      fc.property(smallAmount, smallAmount, smallAmount, (cash, income, cost) => {
        const input = baseInput({
          accounts: [account({ balance: { amountMinor: cash, direction: 'inflow' } })],
          plannedItems: [
            planned({
              id: 'in',
              direction: 'inflow',
              amountMinor: income,
              certainty: 'certain',
              expectedDate: '2026-08-20',
            }),
            planned({
              id: 'out',
              direction: 'outflow',
              amountMinor: cost,
              expectedDate: '2026-08-22',
            }),
          ],
        });
        const forecast = projectDailyBalance(input, today, 'conservative');
        expect(forecast.endOfPeriodMinor).toBe(cash + income - cost);
      }),
    );
  });

  test('the conservative scenario never ends above the expected one', () => {
    fc.assert(
      fc.property(smallAmount, (probableIncome) => {
        const input = baseInput({
          plannedItems: [
            ...baseInput().plannedItems,
            planned({
              id: 'probable',
              direction: 'inflow',
              amountMinor: probableIncome,
              certainty: 'probable',
              expectedDate: '2026-08-20',
            }),
          ],
        });
        expect(
          projectDailyBalance(input, today, 'conservative').endOfPeriodMinor,
        ).toBeLessThanOrEqual(projectDailyBalance(input, today, 'expected').endOfPeriodMinor);
      }),
    );
  });

  test('the low point is never above the closing balance of any day', () => {
    fc.assert(
      fc.property(smallAmount, smallAmount, (cash, cost) => {
        const forecast = projectDailyBalance(
          baseInput({
            accounts: [account({ balance: { amountMinor: cash, direction: 'inflow' } })],
            plannedItems: [
              planned({
                id: 'out',
                direction: 'outflow',
                amountMinor: cost,
                expectedDate: '2026-08-20',
              }),
            ],
          }),
          today,
          'conservative',
        );
        for (const day of forecast.days) {
          expect(forecast.lowPointMinor).toBeLessThanOrEqual(day.closingMinor);
        }
      }),
    );
  });
});
