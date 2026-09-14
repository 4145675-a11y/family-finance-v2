import { notice, type EngineNotice } from './notice';

/**
 * `FIN-MODE-001` — the six operating modes.
 *
 * The product does not give the same advice in every situation. A household that
 * cannot cover an essential need within a fortnight needs a different answer from
 * one that is choosing between two loans, and 02-FINANCIAL-RULES.md § מצבי
 * ההתנהלות makes that explicit.
 *
 * Every transition here is a measurable condition on numbers the engine already
 * produced. Nothing is a judgement call, and the reasons that selected the mode
 * are returned as codes so the copy layer can say them in the family's language.
 */

export const OPERATING_MODES = [
  'emergency',
  'stabilization',
  'stop_new_debt',
  'repayment',
  'buffer_building',
  'growth',
] as const;

export type OperatingMode = (typeof OPERATING_MODES)[number];

export interface ModeInputs {
  /** Shortfall against obligations falling due within the next 14 days. */
  readonly fundingGapWithin14DaysMinor: number;
  /** Lowest projected balance between today and the end of the period. */
  readonly lowPointMinor: number;
  readonly reserveFloorMinor: number;
  readonly liquidCashMinor: number;
  readonly allMinimumsCovered: boolean;
  /** An essential bill or a legally enforceable debt already in arrears. */
  readonly hasEssentialOrLegalArrears: boolean;
  /** Projected end-of-period balance under the conservative scenario. */
  readonly conservativeForecastEndMinor: number;
  readonly stressTestsPassed: boolean;
  readonly netConsumerDebtChangeMinor: number;
  readonly newDebtOriginatedMinor: number;
  /** Consumer debt outstanding now. Zero is what separates growth from repayment. */
  readonly consumerDebtMinor: number;
}

export interface ModeAssessment {
  readonly mode: OperatingMode;
  /** Why this mode and not a milder one. */
  readonly reasons: readonly EngineNotice[];
  /** Conditions that would force a stricter mode if they became true. */
  readonly watchList: readonly EngineNotice[];
}

/**
 * Selects the operating mode.
 *
 * Evaluated strictest first. A single severe trigger returns the household to a
 * stricter mode automatically, which is the behaviour § מצבי ההתנהלות requires:
 * "הופעת trigger חמור מחזירה אוטומטית למצב מחמיר ומתועדת".
 */
export function determineOperatingMode(inputs: ModeInputs): ModeAssessment {
  const reasons: EngineNotice[] = [];

  // 1. emergency
  if (inputs.fundingGapWithin14DaysMinor > 0) {
    reasons.push(
      notice('mode.gap_within_14_days', { amountMinor: inputs.fundingGapWithin14DaysMinor }),
    );
  }
  if (inputs.lowPointMinor < 0) {
    reasons.push(notice('mode.low_point_negative', { amountMinor: -inputs.lowPointMinor }));
  }
  if (inputs.hasEssentialOrLegalArrears) {
    reasons.push(notice('mode.arrears'));
  }
  if (!inputs.allMinimumsCovered) {
    reasons.push(notice('mode.minimums_uncovered'));
  }
  if (reasons.length > 0) {
    return { mode: 'emergency', reasons, watchList: [notice('mode.watch.close_gap_first')] };
  }

  // 2. stabilization — nothing is failing now, but there is no cushion.
  if (inputs.liquidCashMinor < inputs.reserveFloorMinor) {
    return {
      mode: 'stabilization',
      reasons: [
        notice('mode.no_cushion', {
          shortfallMinor: inputs.reserveFloorMinor - inputs.liquidCashMinor,
        }),
      ],
      watchList: [notice('mode.watch.low_point'), notice('mode.watch.new_debt')],
    };
  }

  // 3. stop_new_debt — the reserve exists but the month still creates debt.
  if (inputs.newDebtOriginatedMinor > 0 || inputs.netConsumerDebtChangeMinor > 0) {
    return {
      mode: 'stop_new_debt',
      reasons: [notice('mode.new_debt_this_period')],
      watchList: [notice('mode.watch.month_without_new_debt')],
    };
  }

  // 4. repayment — every condition in § מצבי ההתנהלות must hold at once.
  const blockers: EngineNotice[] = [];
  if (inputs.conservativeForecastEndMinor < 0) {
    blockers.push(notice('mode.blocker.forecast_negative'));
  }
  if (!inputs.stressTestsPassed) {
    blockers.push(notice('mode.blocker.stress_failed'));
  }

  if (blockers.length > 0) {
    return {
      mode: 'stop_new_debt',
      reasons: [notice('mode.reserve_but_not_ready'), ...blockers],
      watchList: [notice('mode.watch.repayment_conditions')],
    };
  }

  const bufferAboveFloorMinor = inputs.liquidCashMinor - inputs.reserveFloorMinor;

  // 6. growth — long-term goals, and only after stability is real: no consumer
  // debt left and a cushion of at least three times the floor.
  if (inputs.consumerDebtMinor === 0 && bufferAboveFloorMinor >= inputs.reserveFloorMinor * 2) {
    return {
      mode: 'growth',
      reasons: [notice('mode.no_debt_large_cushion')],
      watchList: [notice('mode.watch.new_consumer_debt')],
    };
  }

  // 5. buffer_building — debt is falling and the cushion is above its floor.
  if (
    inputs.netConsumerDebtChangeMinor < 0 &&
    bufferAboveFloorMinor >= inputs.reserveFloorMinor
  ) {
    return {
      mode: 'buffer_building',
      reasons: [
        notice('mode.debt_falling_cushion_growing', {
          amountMinor: -inputs.netConsumerDebtChangeMinor,
        }),
      ],
      watchList: [notice('mode.watch.new_consumer_debt')],
    };
  }

  return {
    mode: 'repayment',
    reasons: [notice('mode.all_conditions_met')],
    watchList: [notice('mode.watch.cash_below_floor'), notice('mode.watch.new_debt')],
  };
}

/**
 * Whether a mode permits recommending discretionary spending.
 *
 * § מצבי ההתנהלות stops recommendations for non-essential spending, goal saving
 * and accelerated repayment while in emergency.
 */
export function allowsDiscretionaryRecommendations(mode: OperatingMode): boolean {
  return mode !== 'emergency';
}
