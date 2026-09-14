import { describe, expect, test } from 'vitest';

import {
  callRisk,
  debtPeriodMetrics,
  debtTotals,
  debtTrend,
  mandatoryMonthlyDebtPaymentsMinor,
  replayDebtBalances,
} from './debt';
import { debt, debtEvent } from './fixtures/scenario';
import type { RolloverLink } from './types';

const asOf = '2026-08-31';

describe('replayDebtBalances', () => {
  test('an opening balance is the starting point', () => {
    const balances = replayDebtBalances([debtEvent({ amountMinor: 500_000 })], asOf);
    expect(balances.get('debt-1')).toBe(500_000);
  });

  test('a principal payment reduces the balance', () => {
    const balances = replayDebtBalances(
      [
        debtEvent({ id: 'a', amountMinor: 500_000 }),
        debtEvent({
          id: 'b',
          kind: 'principal_payment',
          amountMinor: 100_000,
          occurredOn: '2026-08-05',
        }),
      ],
      asOf,
    );
    expect(balances.get('debt-1')).toBe(400_000);
  });

  test('paying interest does not reduce the balance', () => {
    const balances = replayDebtBalances(
      [
        debtEvent({ id: 'a', amountMinor: 500_000 }),
        debtEvent({
          id: 'b',
          kind: 'interest_paid',
          amountMinor: 20_000,
          occurredOn: '2026-08-05',
        }),
      ],
      asOf,
    );
    expect(balances.get('debt-1')).toBe(500_000);
  });

  test('charged interest increases the balance', () => {
    const balances = replayDebtBalances(
      [
        debtEvent({ id: 'a', amountMinor: 500_000 }),
        debtEvent({
          id: 'b',
          kind: 'interest_charge',
          amountMinor: 20_000,
          occurredOn: '2026-08-05',
        }),
      ],
      asOf,
    );
    expect(balances.get('debt-1')).toBe(520_000);
  });

  test('a correction moves the balance in the direction it states', () => {
    const balances = replayDebtBalances(
      [
        debtEvent({ id: 'a', amountMinor: 500_000 }),
        debtEvent({
          id: 'b',
          kind: 'balance_correction',
          amountMinor: 50_000,
          correctionEffect: 'decrease',
          occurredOn: '2026-08-05',
        }),
      ],
      asOf,
    );
    expect(balances.get('debt-1')).toBe(450_000);
  });

  test('events after the cut-off are ignored, so a snapshot is reproducible', () => {
    const balances = replayDebtBalances(
      [
        debtEvent({ id: 'a', amountMinor: 500_000, occurredOn: '2026-08-01' }),
        debtEvent({
          id: 'b',
          kind: 'principal_payment',
          amountMinor: 100_000,
          occurredOn: '2026-09-15',
        }),
      ],
      asOf,
    );
    expect(balances.get('debt-1')).toBe(500_000);
  });

  test('over-repayment is clamped at zero rather than offsetting another debt', () => {
    const balances = replayDebtBalances(
      [
        debtEvent({ id: 'a', amountMinor: 100_000 }),
        debtEvent({
          id: 'b',
          kind: 'principal_payment',
          amountMinor: 150_000,
          occurredOn: '2026-08-05',
        }),
      ],
      asOf,
    );
    expect(balances.get('debt-1')).toBe(0);
  });
});

describe('debtTotals', () => {
  const debts = [
    debt({ id: 'loan', kind: 'bank_loan' }),
    debt({ id: 'mortgage', kind: 'mortgage' }),
    debt({ id: 'moshe', kind: 'private_person' }),
    debt({ id: 'closed', kind: 'bank_loan', status: 'settled' }),
  ];
  const balances = new Map([
    ['loan', 300_000],
    ['mortgage', 14_000_000],
    ['moshe', 500_000],
    ['closed', 900_000],
  ]);

  test('consumer debt excludes the mortgage', () => {
    expect(debtTotals(debts, balances).consumerDebtMinor).toBe(800_000);
  });

  test('total debt includes it', () => {
    expect(debtTotals(debts, balances).totalDebtMinor).toBe(14_800_000);
  });

  test('a settled debt counts in neither', () => {
    const totals = debtTotals(debts, balances);
    expect(totals.consumerDebtMinor).not.toContain(900_000);
    expect(totals.consumerDebtMinor + totals.mortgageMinor).toBe(totals.totalDebtMinor);
  });
});

describe('debtTrend — the measure that decides whether debt fell', () => {
  const baseline = { asOf: '2026-08-01', consumerDebtMinor: 800_000, totalDebtMinor: 800_000 };

  test('a lower balance is a real reduction', () => {
    const trend = debtTrend(baseline, {
      consumerDebtMinor: 700_000,
      mortgageMinor: 0,
      totalDebtMinor: 700_000,
    });
    expect(trend.netConsumerChangeMinor).toBe(-100_000);
    expect(trend.consumerDirection).toBe('down');
  });

  test('replacing one creditor with another leaves the reading flat', () => {
    const trend = debtTrend(baseline, {
      consumerDebtMinor: 800_000,
      mortgageMinor: 0,
      totalDebtMinor: 800_000,
    });
    expect(trend.netConsumerChangeMinor).toBe(0);
    expect(trend.consumerDirection).toBe('flat');
  });

  test('a higher balance reads as growth even after large repayments', () => {
    const trend = debtTrend(baseline, {
      consumerDebtMinor: 900_000,
      mortgageMinor: 0,
      totalDebtMinor: 900_000,
    });
    expect(trend.consumerDirection).toBe('up');
  });
});

describe('debtPeriodMetrics — the rollover example from 02-FINANCIAL-RULES.md', () => {
  const from = '2026-08-01';
  const to = '2026-08-31';

  const repayMoshe = debtEvent({
    id: 'repay',
    debtId: 'moshe',
    kind: 'principal_payment',
    amountMinor: 500_000,
    occurredOn: '2026-08-12',
  });
  const borrowFromIsrael = debtEvent({
    id: 'borrow',
    debtId: 'israel',
    kind: 'new_principal',
    amountMinor: 500_000,
    occurredOn: '2026-08-12',
  });

  const link: RolloverLink = {
    id: 'link-1',
    fromDebtId: 'moshe',
    toDebtId: 'israel',
    amountMinor: 500_000,
    occurredOn: '2026-08-12',
    status: 'confirmed',
  };

  test('5,000 repaid with 5,000 borrowed shows no income-funded reduction', () => {
    const metrics = debtPeriodMetrics([repayMoshe, borrowFromIsrael], [link], from, to);
    expect(metrics.grossPrincipalRepaidMinor).toBe(500_000);
    expect(metrics.newDebtOriginatedMinor).toBe(500_000);
    expect(metrics.rolloverFundedRepaymentMinor).toBe(500_000);
    expect(metrics.incomeFundedPrincipalReductionMinor).toBe(0);
    expect(metrics.rolloverRatioBp).toBe(10_000);
    expect(metrics.rolloverCount).toBe(1);
  });

  test('5,000 repaid funded by 4,000 borrowed is a real reduction of 1,000', () => {
    const metrics = debtPeriodMetrics(
      [repayMoshe, { ...borrowFromIsrael, amountMinor: 400_000 }],
      [{ ...link, amountMinor: 400_000 }],
      from,
      to,
    );
    expect(metrics.incomeFundedPrincipalReductionMinor).toBe(100_000);
    expect(metrics.rolloverRatioBp).toBe(8_000);
  });

  test('a proposed link does not count; only a person can confirm one', () => {
    const metrics = debtPeriodMetrics(
      [repayMoshe, borrowFromIsrael],
      [{ ...link, status: 'proposed' }],
      from,
      to,
    );
    expect(metrics.rolloverFundedRepaymentMinor).toBe(0);
    expect(metrics.rolloverCount).toBe(0);
  });

  test('interest and fees paid are reported apart from principal', () => {
    const metrics = debtPeriodMetrics(
      [
        repayMoshe,
        debtEvent({
          id: 'interest',
          debtId: 'moshe',
          kind: 'interest_paid',
          amountMinor: 30_000,
          occurredOn: '2026-08-12',
        }),
      ],
      [],
      from,
      to,
    );
    expect(metrics.interestAndFeesPaidMinor).toBe(30_000);
    expect(metrics.grossPrincipalRepaidMinor).toBe(500_000);
  });

  test('a correction is reported on its own line and is not a repayment', () => {
    const metrics = debtPeriodMetrics(
      [
        debtEvent({
          id: 'fix',
          debtId: 'moshe',
          kind: 'balance_correction',
          amountMinor: 20_000,
          correctionEffect: 'decrease',
          occurredOn: '2026-08-12',
        }),
      ],
      [],
      from,
      to,
    );
    expect(metrics.balanceCorrectionMinor).toBe(-20_000);
    expect(metrics.grossPrincipalRepaidMinor).toBe(0);
    expect(metrics.incomeFundedPrincipalReductionMinor).toBe(0);
  });

  test('creditor churn counts both sides of a swap', () => {
    const metrics = debtPeriodMetrics([repayMoshe, borrowFromIsrael], [link], from, to);
    expect(metrics.creditorChurn).toBe(2);
  });

  test('events outside the period are excluded', () => {
    const metrics = debtPeriodMetrics(
      [{ ...repayMoshe, occurredOn: '2026-07-12' }],
      [],
      from,
      to,
    );
    expect(metrics.grossPrincipalRepaidMinor).toBe(0);
  });
});

describe('callRisk', () => {
  const debts = [
    debt({
      id: 'moshe',
      kind: 'private_person',
      expectedCallDate: '2026-08-15',
      urgency: 'none',
    }),
    debt({
      id: 'israel',
      kind: 'private_person',
      expectedCallDate: '2026-09-30',
      urgency: 'none',
    }),
    debt({ id: 'dina', kind: 'private_person', expectedCallDate: null, urgency: 'demanded' }),
    debt({ id: 'bank', kind: 'bank_loan' }),
  ];
  const balances = new Map([
    ['moshe', 300_000],
    ['israel', 200_000],
    ['dina', 100_000],
    ['bank', 900_000],
  ]);

  test('a demanded debt is callable now, whatever date was agreed', () => {
    const risk = callRisk(debts, balances, '2026-08-10');
    expect(risk.demandedNowMinor).toBe(100_000);
  });

  test('a date five days away lands inside the 7-day window, alongside the demand', () => {
    const risk = callRisk(debts, balances, '2026-08-10');
    expect(risk.within7DaysMinor).toBe(400_000);
    expect(risk.within30DaysMinor).toBe(400_000);
  });

  test('a date fifty days away lands only in the 90-day window', () => {
    const risk = callRisk(debts, balances, '2026-08-10');
    expect(risk.within90DaysMinor).toBe(600_000);
  });

  test('institutional debt is not part of call risk', () => {
    const risk = callRisk(debts, balances, '2026-08-10');
    expect(risk.privateDebtTotalMinor).toBe(600_000);
  });

  test('concentration reports the largest lender share', () => {
    const risk = callRisk(debts, balances, '2026-08-10');
    expect(risk.largestLenderShareBp).toBe(5_000);
  });
});

describe('mandatoryMonthlyDebtPaymentsMinor', () => {
  test('sums the minimums of active debts only', () => {
    expect(
      mandatoryMonthlyDebtPaymentsMinor([
        debt({ id: 'a', minimumPaymentMinor: 100_000 }),
        debt({ id: 'b', minimumPaymentMinor: 50_000 }),
        debt({ id: 'c', minimumPaymentMinor: 900_000, status: 'settled' }),
      ]),
    ).toBe(150_000);
  });

  test('a debt with no minimum contributes nothing rather than failing', () => {
    expect(mandatoryMonthlyDebtPaymentsMinor([debt({ minimumPaymentMinor: null })])).toBe(0);
  });
});
