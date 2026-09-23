import { CONSUMER_DEBT_KINDS, DEBT_EVENT_BALANCE_EFFECT } from '@family-finance/contracts';
import type { BusinessDate } from '@family-finance/contracts';

import { daysBetween, isOnOrAfter, isOnOrBefore } from './dates';
import { assertStoredAmount, clampAtZero, roundHalfUp } from './money';
import type { DebtBaseline, DebtEventRecord, DebtRecord, RolloverLink } from './types';

/**
 * The debt domain calculations.
 *
 * The one rule this file exists to defend, from 02-FINANCIAL-RULES.md § גלגול חוב:
 * the measure that counts is the change in balances between two points in time,
 * not the size of the payment cycle. Repaying one creditor with another creditor's
 * money is not progress, and this module must never let it look like progress.
 *
 * The effect table is imported from `@family-finance/contracts` rather than
 * restated here. Two copies of "does paying interest reduce the balance" would
 * eventually disagree, and the disagreement would be invisible.
 */

export interface DebtBalance {
  readonly debtId: string;
  readonly balanceMinor: number;
}

/**
 * How one event moves one balance, as a signed amount.
 *
 * The single definition. Everything that walks debt events — the totals, the
 * per-lender ledger, anything added later — goes through this function, so there
 * is exactly one answer to "does this line add or subtract" and no screen can
 * hold a second opinion.
 *
 * A UI that reimplemented this drifted from it: it clamped at every step while
 * the totals clamped once at the end, and the two disagreed on any debt that had
 * dipped below zero and recovered. That is the mistake this export exists to
 * make unrepeatable.
 */
export function debtEventDeltaMinor(event: DebtEventRecord): number {
  assertStoredAmount(event.amountMinor, `event ${event.id}`);

  const effect =
    event.kind === 'balance_correction'
      ? event.correctionEffect
      : DEBT_EVENT_BALANCE_EFFECT[event.kind];

  if (effect === null || effect === undefined) {
    throw new Error(`debt event ${event.id} has kind ${event.kind} with no balance effect`);
  }

  if (effect === 'increase') return event.amountMinor;
  if (effect === 'decrease') return -event.amountMinor;
  return 0;
}

/**
 * Replays events into balances.
 *
 * A balance is never stored, so this is the only definition of what is owed.
 * Events after `asOf` are ignored, which is what makes a historical snapshot
 * reproducible.
 */
export function replayDebtBalances(
  events: readonly DebtEventRecord[],
  asOf: BusinessDate,
): Map<string, number> {
  const balances = new Map<string, number>();

  for (const event of events) {
    if (!isOnOrBefore(event.occurredOn, asOf)) continue;
    const current = balances.get(event.debtId) ?? 0;
    balances.set(event.debtId, current + debtEventDeltaMinor(event));
  }

  // A balance below zero means more was repaid than was ever owed, which is a
  // data error rather than a credit. It is clamped so it cannot silently offset
  // another debt in the total, and the gap surfaces through data quality.
  //
  // Clamped once, at the end, and nowhere else. Clamping each step instead would
  // turn a dip below zero into a permanent gift: 100 in, 150 out, 100 in is 50
  // owed, but step-clamping reports 100.
  for (const [debtId, balance] of balances) {
    if (balance < 0) balances.set(debtId, 0);
  }

  return balances;
}

/** One line of a debt's history, with the balance it left behind. */
export interface DebtLedgerLine {
  readonly event: DebtEventRecord;
  /** Signed, from `debtEventDeltaMinor`. Zero for a line that moves no money. */
  readonly deltaMinor: number;
  /**
   * The running balance after this line.
   *
   * Not clamped. A running total that hid its dip below zero would not add up to
   * the figure the totals report, and a column that does not add up to its own
   * heading is worse than one showing an uncomfortable number. A negative here
   * is a real signal: more has been repaid than was ever recorded as owed.
   */
  readonly balanceAfterMinor: number;
}

/**
 * Replays one debt's events into the running history a lender card shows.
 *
 * Built on the same delta function as `replayDebtBalances`, and clamped the same
 * way — which is to say not at all until the end. `finalBalanceOf` below is the
 * one place the two meet, and it is asserted in the tests: the last line of this
 * series, clamped once, is exactly what the totals say is owed.
 *
 * Events are ordered by the day they happened and then by the order they were
 * recorded, so two events on the same date do not swap places between renders
 * and make the column appear to change.
 */
export function replayDebtLedger(
  events: readonly DebtEventRecord[],
  debtId: string,
  asOf: BusinessDate,
): readonly DebtLedgerLine[] {
  const mine = events
    .filter((event) => event.debtId === debtId && isOnOrBefore(event.occurredOn, asOf))
    .sort((a, b) =>
      a.occurredOn !== b.occurredOn
        ? a.occurredOn < b.occurredOn
          ? -1
          : 1
        : a.id < b.id
          ? -1
          : 1,
    );

  let running = 0;
  return mine.map((event) => {
    const deltaMinor = debtEventDeltaMinor(event);
    running += deltaMinor;
    return { event, deltaMinor, balanceAfterMinor: running };
  });
}

/**
 * What the ledger says is owed at the end — the totals' answer, from the series.
 *
 * The clamp lives here and only here, so the number under a lender's name and the
 * number in `replayDebtBalances` cannot be produced by two different rules.
 */
export function finalBalanceOf(lines: readonly DebtLedgerLine[]): number {
  const last = lines[lines.length - 1];
  return last === undefined ? 0 : clampAtZero(last.balanceAfterMinor).resultMinor;
}

export interface DebtTotals {
  readonly consumerDebtMinor: number;
  readonly mortgageMinor: number;
  readonly totalDebtMinor: number;
}

/**
 * Consumer debt and total debt, as two separate numbers.
 *
 * 01-PRODUCT-SPEC.md requires both: a mortgage behaves nothing like revolving
 * credit, and folding them together hides whichever one is moving.
 */
export function debtTotals(
  debts: readonly DebtRecord[],
  balances: ReadonlyMap<string, number>,
): DebtTotals {
  let consumerDebtMinor = 0;
  let mortgageMinor = 0;

  for (const debt of debts) {
    if (debt.status !== 'active') continue;
    const balance = balances.get(debt.id) ?? 0;
    if (debt.kind === 'mortgage') mortgageMinor += balance;
    else if (CONSUMER_DEBT_KINDS.includes(debt.kind)) consumerDebtMinor += balance;
  }

  return {
    consumerDebtMinor,
    mortgageMinor,
    totalDebtMinor: consumerDebtMinor + mortgageMinor,
  };
}

export interface DebtPeriodMetrics {
  readonly grossPrincipalRepaidMinor: number;
  readonly newDebtOriginatedMinor: number;
  readonly rolloverFundedRepaymentMinor: number;
  readonly incomeFundedPrincipalReductionMinor: number;
  readonly interestAndFeesPaidMinor: number;
  readonly rolloverCount: number;
  readonly creditorChurn: number;
  /** Share of repayment that was funded by new debt, in basis points. */
  readonly rolloverRatioBp: number;
  /**
   * Balance corrections in the period, signed. Reported apart from every other
   * figure: a correction is neither an achievement nor a deterioration.
   */
  readonly balanceCorrectionMinor: number;
}

function inPeriod(date: BusinessDate, from: BusinessDate, to: BusinessDate): boolean {
  return isOnOrAfter(date, from) && isOnOrBefore(date, to);
}

/**
 * The explanation metrics that sit beside the headline change.
 *
 * Every one of them exists so that a repayment financed by a new loan reads as
 * what it is. `incomeFundedPrincipalReduction` is the only one of these that
 * represents real progress.
 */
export function debtPeriodMetrics(
  events: readonly DebtEventRecord[],
  rollovers: readonly RolloverLink[],
  from: BusinessDate,
  to: BusinessDate,
): DebtPeriodMetrics {
  let grossPrincipalRepaidMinor = 0;
  let newDebtOriginatedMinor = 0;
  let interestAndFeesPaidMinor = 0;
  let balanceCorrectionMinor = 0;

  const repaidDebts = new Set<string>();
  const originatedDebts = new Set<string>();

  for (const event of events) {
    if (!inPeriod(event.occurredOn, from, to)) continue;

    switch (event.kind) {
      case 'principal_payment':
        grossPrincipalRepaidMinor += event.amountMinor;
        repaidDebts.add(event.debtId);
        break;
      case 'new_principal':
        newDebtOriginatedMinor += event.amountMinor;
        originatedDebts.add(event.debtId);
        break;
      case 'interest_paid':
      case 'fee_paid':
        interestAndFeesPaidMinor += event.amountMinor;
        break;
      case 'balance_correction':
        balanceCorrectionMinor +=
          event.correctionEffect === 'decrease' ? -event.amountMinor : event.amountMinor;
        break;
      default:
        break;
    }
  }

  // Only a confirmed link counts. An inferred one is a proposal, and counting it
  // would let the system decide on its own that a repayment was not progress.
  const confirmed = rollovers.filter(
    (link) => link.status === 'confirmed' && inPeriod(link.occurredOn, from, to),
  );
  const rolloverFundedRepaymentMinor = confirmed.reduce(
    (total, link) => total + link.amountMinor,
    0,
  );

  const incomeFundedPrincipalReductionMinor = clampAtZero(
    grossPrincipalRepaidMinor - rolloverFundedRepaymentMinor,
  ).resultMinor;

  const rolloverRatioBp =
    grossPrincipalRepaidMinor === 0
      ? 0
      : roundHalfUp((rolloverFundedRepaymentMinor * 10_000) / grossPrincipalRepaidMinor);

  // Creditors that saw money leave and creditors that were newly drawn on. A
  // household that keeps replacing lenders shows churn even when the total is flat.
  const churn = new Set<string>([...repaidDebts, ...originatedDebts]);

  return {
    grossPrincipalRepaidMinor,
    newDebtOriginatedMinor,
    rolloverFundedRepaymentMinor,
    incomeFundedPrincipalReductionMinor,
    interestAndFeesPaidMinor,
    rolloverCount: confirmed.length,
    creditorChurn: churn.size,
    rolloverRatioBp,
    balanceCorrectionMinor,
  };
}

export interface DebtTrend {
  readonly netConsumerChangeMinor: number;
  readonly netTotalChangeMinor: number;
  /** `down` is the only reading that counts as progress. */
  readonly consumerDirection: 'down' | 'flat' | 'up';
  readonly baselineConsumerMinor: number;
  readonly baselineTotalMinor: number;
}

/**
 * The measure that decides whether debt fell.
 *
 * Deliberately subtraction of two balances and nothing else. A creditor being
 * paid off contributes nothing here unless the total actually moved.
 */
export function debtTrend(baseline: DebtBaseline, current: DebtTotals): DebtTrend {
  const netConsumerChangeMinor = current.consumerDebtMinor - baseline.consumerDebtMinor;
  const netTotalChangeMinor = current.totalDebtMinor - baseline.totalDebtMinor;

  return {
    netConsumerChangeMinor,
    netTotalChangeMinor,
    consumerDirection:
      netConsumerChangeMinor < 0 ? 'down' : netConsumerChangeMinor > 0 ? 'up' : 'flat',
    baselineConsumerMinor: baseline.consumerDebtMinor,
    baselineTotalMinor: baseline.totalDebtMinor,
  };
}

export interface CallRisk {
  readonly within7DaysMinor: number;
  readonly within30DaysMinor: number;
  readonly within90DaysMinor: number;
  /** Debt already demanded or in enforcement: callable now, by definition. */
  readonly demandedNowMinor: number;
  readonly averageNoticeDays: number | null;
  /** Largest single lender's share of private debt, in basis points. */
  readonly largestLenderShareBp: number;
  readonly privateDebtTotalMinor: number;
}

/**
 * Exposure to a sudden demand.
 *
 * 02-FINANCIAL-RULES.md requires the amount that could be called within 7, 30 and
 * 90 days, the concentration across lenders, and the average notice. A private
 * loan with no agreed date is not assumed to be safe; it is counted as demanded
 * as soon as the lender has asked.
 */
export function callRisk(
  debts: readonly DebtRecord[],
  balances: ReadonlyMap<string, number>,
  asOf: BusinessDate,
): CallRisk {
  let within7DaysMinor = 0;
  let within30DaysMinor = 0;
  let within90DaysMinor = 0;
  let demandedNowMinor = 0;
  let privateDebtTotalMinor = 0;
  let largestLenderMinor = 0;

  const noticeDays: number[] = [];

  for (const debt of debts) {
    if (debt.status !== 'active' || debt.kind !== 'private_person') continue;
    const balance = balances.get(debt.id) ?? 0;
    if (balance === 0) continue;

    privateDebtTotalMinor += balance;
    if (balance > largestLenderMinor) largestLenderMinor = balance;

    if (debt.urgency === 'demanded' || debt.urgency === 'legal') {
      demandedNowMinor += balance;
      within7DaysMinor += balance;
      within30DaysMinor += balance;
      within90DaysMinor += balance;
      noticeDays.push(0);
      continue;
    }

    if (debt.expectedCallDate === null) continue;

    const days = daysBetween(asOf, debt.expectedCallDate);
    noticeDays.push(days);
    if (days <= 7) within7DaysMinor += balance;
    if (days <= 30) within30DaysMinor += balance;
    if (days <= 90) within90DaysMinor += balance;
  }

  const averageNoticeDays =
    noticeDays.length === 0
      ? null
      : roundHalfUp(noticeDays.reduce((total, days) => total + days, 0) / noticeDays.length);

  return {
    within7DaysMinor,
    within30DaysMinor,
    within90DaysMinor,
    demandedNowMinor,
    averageNoticeDays,
    largestLenderShareBp:
      privateDebtTotalMinor === 0
        ? 0
        : roundHalfUp((largestLenderMinor * 10_000) / privateDebtTotalMinor),
    privateDebtTotalMinor,
  };
}

/** Total of the contractual monthly minimums across every active debt. */
export function mandatoryMonthlyDebtPaymentsMinor(debts: readonly DebtRecord[]): number {
  return debts
    .filter((debt) => debt.status === 'active')
    .reduce((total, debt) => total + (debt.minimumPaymentMinor ?? 0), 0);
}
