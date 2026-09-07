import { summariseChecks, type CheckExposure } from './checks';
import type { BusinessDate, Currency } from '@family-finance/contracts';

import {
  businessProfit,
  householdNeedUntilMonthEnd,
  safeBusinessTransfer,
  type BusinessProfit,
  type SafeTransfer,
} from './business';
import { businessDateOf, endOfMonth, isOnOrBefore, startOfMonth } from './dates';
import {
  callRisk,
  debtPeriodMetrics,
  debtTotals,
  debtTrend,
  mandatoryMonthlyDebtPaymentsMinor,
  replayDebtBalances,
  type CallRisk,
  type DebtBalance,
  type DebtPeriodMetrics,
  type DebtTotals,
  type DebtTrend,
} from './debt';
import { buildDecision, inputHashOf, type DecisionResult } from './decision';
import {
  fundingGapWithinDays,
  overdueEssentialsMinor,
  projectDailyBalance,
  type Forecast,
} from './forecast';
import { liquidCashMinor, safeHouseholdSpend, type SafeSpend } from './household';
import { clampAtZero, maxSigned } from './money';
import { determineOperatingMode, type ModeAssessment } from './modes';
import { notice, type EngineNotice, type NoticeParams } from './notice';
import { freshnessAgeDays, scoreDataQuality, type DataQualityScore } from './quality';
import { runStressTests, stressTestsPassed, type StressScenarioResult } from './stress';
import type { EngineInput } from './types';
import { allocateWaterfall, noClaims, type WaterfallResult } from './waterfall';

/**
 * The one composition step: raw facts in, the dashboard's source of truth out.
 *
 * 01-PRODUCT-SPEC.md § מסך הבית fixes the hierarchy this must be able to answer,
 * in order: freshness and confidence, safe spend, forecast and low point, net
 * consumer and total debt, household against business, and one action. Everything
 * below exists to answer exactly those, and each answer carries its own breakdown
 * so no screen has to invent an explanation.
 */

/**
 * The single thing worth doing now.
 *
 * A key plus the numbers the sentence needs. The wording lives in the copy layer:
 * this is a decision, not a phrase, and the two change for different reasons.
 */
export interface NextAction {
  readonly key: string;
  readonly params?: NoticeParams;
}

export interface FinancialSnapshot {
  readonly asOf: string;
  readonly today: BusinessDate;
  readonly periodStart: BusinessDate;
  readonly periodEnd: BusinessDate;
  readonly currency: Currency;
  readonly quality: DataQualityScore;
  readonly freshnessAgeDays: number | null;
  readonly safeSpend: SafeSpend;
  readonly decision: DecisionResult;
  readonly forecastConservative: Forecast;
  readonly forecastExpected: Forecast;
  readonly debtTotals: DebtTotals;
  /** Per-debt balances, replayed from events. Screens read these, never derive them. */
  readonly debtBalances: readonly DebtBalance[];
  readonly debtTrend: DebtTrend | null;
  readonly debtMetrics: DebtPeriodMetrics;
  readonly callRisk: CallRisk;
  readonly householdLiquidMinor: number;
  readonly businessLiquidMinor: number;
  readonly businessProfit: BusinessProfit | null;
  readonly safeTransfer: SafeTransfer;
  readonly waterfall: WaterfallResult;
  readonly mode: ModeAssessment;
  readonly stressTests: readonly StressScenarioResult[];
  /**
   * Post-dated checks: what is still out there, and what has already gone.
   *
   * Carried on the snapshot rather than computed by a screen so that the home
   * screen, the gemach screen and the reports cannot arrive at three different
   * answers to "how much of our paper is still outstanding".
   */
  readonly checkExposure: CheckExposure;
  readonly nextAction: NextAction;
}

/**
 * Builds the ten waterfall claims from the input.
 *
 * Steps are kept strictly non-overlapping: a shekel of essential need is claimed
 * once, by step 1, and a mortgage payment is claimed once, by step 2. Overlap
 * would let the same obligation absorb money twice and make the remaining balance
 * look smaller than it is.
 *
 * Steps 8 and 10 claim nothing yet. Sinking funds and long-term goals are
 * Milestone 10 and have no data behind them today; claiming a guessed number
 * would be worse than claiming none, and the step is still shown so its absence
 * is visible rather than silent.
 */
function buildClaims(
  input: EngineInput,
  today: BusinessDate,
  reserveFloorMinor: number,
  balances: ReadonlyMap<string, number>,
) {
  const periodEnd = endOfMonth(today);
  const claims = { ...noClaims() };

  claims.essential_needs = input.plannedItems
    .filter(
      (item) =>
        item.scope === 'household' &&
        item.direction === 'outflow' &&
        item.essential &&
        isOnOrBefore(item.dueDate ?? item.expectedDate, periodEnd),
    )
    .reduce((total, item) => total + item.amountMinor, 0);

  const activeDebts = input.debts.filter((debt) => debt.status === 'active');

  claims.mortgage_and_material = activeDebts
    .filter((debt) => debt.kind === 'mortgage')
    .reduce((total, debt) => total + (debt.minimumPaymentMinor ?? 0), 0);

  claims.taxes_and_held_funds =
    input.business === null
      ? 0
      : input.business.accruedTaxReserveMinor + input.business.certainObligationsMinor;

  claims.debt_minimums = activeDebts
    .filter((debt) => debt.kind !== 'mortgage')
    .reduce((total, debt) => total + (debt.minimumPaymentMinor ?? 0), 0);

  claims.operating_reserve = clampAtZero(
    reserveFloorMinor - liquidCashMinor(input.accounts, 'household'),
  ).resultMinor;

  claims.legal_or_urgent_debt = activeDebts
    .filter((debt) => debt.urgency === 'legal' || debt.urgency === 'demanded')
    .reduce((total, debt) => total + (balances.get(debt.id) ?? 0), 0);

  // The single most expensive non-mortgage debt is the accelerated-repayment
  // target. A debt with an unknown rate is not assumed to be cheap, but it also
  // cannot be claimed as the most expensive: § קדימות חובות forbids claiming a
  // precise saving without the rate.
  const ranked = activeDebts
    .filter((debt) => debt.kind !== 'mortgage' && debt.effectiveAnnualRateBp !== null)
    .sort((a, b) => (b.effectiveAnnualRateBp ?? 0) - (a.effectiveAnnualRateBp ?? 0));
  claims.expensive_debt = ranked.length > 0 ? (balances.get(ranked[0]?.id ?? '') ?? 0) : 0;

  claims.buffer_growth = reserveFloorMinor;

  return claims;
}

function chooseNextAction(
  mode: ModeAssessment,
  safeSpend: SafeSpend,
  quality: DataQualityScore,
  waterfall: WaterfallResult,
  trend: DebtTrend | null,
  conservative: Forecast,
): NextAction {
  // Ordered by urgency, not by how good the news is. The first branch that
  // matches wins, so the family is never shown a pleasant suggestion while
  // something is actually on fire.
  if (safeSpend.fundingGapMinor > 0) {
    return { key: 'close_funding_gap', params: { amountMinor: safeSpend.fundingGapMinor } };
  }

  if (conservative.firstFailureDate !== null) {
    return { key: 'move_a_payment', params: { date: conservative.firstFailureDate } };
  }

  if (quality.confidence === 'low') {
    return { key: 'confirm_balances', params: { missingCount: quality.missingData.length } };
  }

  if (waterfall.firstUnfundedStep !== null) {
    const step = waterfall.allocations.find(
      (allocation) => allocation.step === waterfall.firstUnfundedStep,
    );
    return {
      key: 'fund_next_step',
      params: {
        step: waterfall.firstUnfundedStep,
        stepKey: step?.key ?? '',
        amountMinor: step?.unfundedMinor ?? 0,
      },
    };
  }

  if (trend !== null && trend.consumerDirection === 'up') {
    return { key: 'stop_new_debt', params: { amountMinor: trend.netConsumerChangeMinor } };
  }

  if (mode.mode === 'repayment' || mode.mode === 'buffer_building' || mode.mode === 'growth') {
    return { key: 'accelerate_repayment' };
  }

  return { key: 'hold_position' };
}

export function buildFinancialSnapshot(input: EngineInput): FinancialSnapshot {
  const today = businessDateOf(input.asOf, input.timeZone);
  const periodStart = startOfMonth(today);
  const periodEnd = endOfMonth(today);

  const quality = scoreDataQuality(input);
  const balances = replayDebtBalances(input.debtEvents, today);
  const totals = debtTotals(input.debts, balances);
  const metrics = debtPeriodMetrics(input.debtEvents, input.rollovers, periodStart, today);
  const risk = callRisk(input.debts, balances, today);
  const checkExposure = summariseChecks(input.checks, today);

  const safeSpend = safeHouseholdSpend(input, today);
  const householdLiquidMinor = liquidCashMinor(input.accounts, 'household');
  const businessLiquidMinor = liquidCashMinor(input.accounts, 'business');

  const forecastConservative = projectDailyBalance(input, today, 'conservative');
  const forecastExpected = projectDailyBalance(input, today, 'expected');

  const profit = businessProfit(input);
  const commitmentsMinor =
    safeSpend.breakdown
      .filter((line) => line.effect === 'subtracts')
      .reduce((total, line) => total + line.amountMinor, 0) - safeSpend.reserve.floorMinor;
  const certainIncomeMinor =
    safeSpend.breakdown.find((line) => line.key === 'certain_income')?.amountMinor ?? 0;
  const availableMinor = householdLiquidMinor + certainIncomeMinor;
  const transfer = safeBusinessTransfer(
    input,
    profit,
    householdNeedUntilMonthEnd(commitmentsMinor, availableMinor),
  );

  const claims = buildClaims(input, today, safeSpend.reserve.floorMinor, balances);
  const allocatable = clampAtZero(
    householdLiquidMinor + certainIncomeMinor + input.approvedSafeTransferMinor,
  ).resultMinor;
  const waterfall = allocateWaterfall(allocatable, claims);

  const stressContext = {
    largestPrivateDebtMinor: maxSigned([
      0,
      ...input.debts
        .filter((debt) => debt.kind === 'private_person' && debt.status === 'active')
        .map((debt) => balances.get(debt.id) ?? 0),
    ]),
    largestCardBalanceMinor: maxSigned([
      0,
      ...input.accounts
        .filter((account) => account.kind === 'credit_card')
        .map((account) => account.balance.amountMinor),
    ]),
    reserveFloorMinor: safeSpend.reserve.floorMinor,
  };
  const stressTests = runStressTests(input, today, stressContext);

  const trend = input.debtBaseline === null ? null : debtTrend(input.debtBaseline, totals);

  const mode = determineOperatingMode({
    fundingGapWithin14DaysMinor: fundingGapWithinDays(input, today, 14),
    lowPointMinor: forecastConservative.lowPointMinor,
    reserveFloorMinor: safeSpend.reserve.floorMinor,
    liquidCashMinor: householdLiquidMinor,
    allMinimumsCovered:
      householdLiquidMinor >= mandatoryMonthlyDebtPaymentsMinor(input.debts) ||
      safeSpend.fundingGapMinor === 0,
    hasEssentialOrLegalArrears:
      overdueEssentialsMinor(input, today) > 0 ||
      input.debts.some((debt) => debt.status === 'active' && debt.urgency === 'legal'),
    conservativeForecastEndMinor: forecastConservative.endOfPeriodMinor,
    stressTestsPassed: stressTestsPassed(stressTests),
    netConsumerDebtChangeMinor: trend?.netConsumerChangeMinor ?? 0,
    newDebtOriginatedMinor: metrics.newDebtOriginatedMinor,
    consumerDebtMinor: totals.consumerDebtMinor,
  });

  const warnings: EngineNotice[] = [
    ...transfer.warnings,
    ...(forecastConservative.firstFailureDate !== null
      ? [notice('warn.failure_day', { date: forecastConservative.firstFailureDate })]
      : []),
    ...(risk.within30DaysMinor > 0
      ? [notice('warn.private_debt_callable', { amountMinor: risk.within30DaysMinor })]
      : []),
  ];

  const decision = buildDecision({
    resultMinor: safeSpend.resultMinor,
    fundingGapMinor: safeSpend.fundingGapMinor,
    breakdown: safeSpend.breakdown,
    assumptions: safeSpend.assumptions,
    warnings,
    missingData: quality.missingData,
    dataQualityScore: quality.score,
    confidence: quality.confidence,
    freshnessAgeDays: freshnessAgeDays(input),
    operatingMode: mode.mode,
    stressTestsPassed: stressTestsPassed(stressTests),
    inputHash: inputHashOf(input),
  });

  return {
    asOf: input.asOf,
    today,
    periodStart,
    periodEnd,
    currency: input.currency,
    quality,
    freshnessAgeDays: freshnessAgeDays(input),
    safeSpend,
    decision,
    forecastConservative,
    forecastExpected,
    debtTotals: totals,
    debtBalances: [...balances].map(([debtId, balanceMinor]) => ({ debtId, balanceMinor })),
    debtTrend: trend,
    debtMetrics: metrics,
    callRisk: risk,
    householdLiquidMinor,
    businessLiquidMinor,
    businessProfit: profit,
    safeTransfer: transfer,
    waterfall,
    mode,
    stressTests,
    checkExposure,
    nextAction: chooseNextAction(
      mode,
      safeSpend,
      quality,
      waterfall,
      trend,
      forecastConservative,
    ),
  };
}
