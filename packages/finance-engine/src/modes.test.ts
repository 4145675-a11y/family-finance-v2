import { describe, expect, test } from 'vitest';

import {
  OPERATING_MODES,
  allowsDiscretionaryRecommendations,
  determineOperatingMode,
} from './modes';
import type { ModeInputs } from './modes';

/** A household in the mildest state the rules allow, so each test breaks one thing. */
const healthy: ModeInputs = {
  fundingGapWithin14DaysMinor: 0,
  lowPointMinor: 500_000,
  reserveFloorMinor: 400_000,
  liquidCashMinor: 600_000,
  allMinimumsCovered: true,
  hasEssentialOrLegalArrears: false,
  conservativeForecastEndMinor: 700_000,
  stressTestsPassed: true,
  netConsumerDebtChangeMinor: 0,
  newDebtOriginatedMinor: 0,
  consumerDebtMinor: 500_000,
};

describe('the six modes', () => {
  test('are exactly the ones FIN-MODE-001 defines', () => {
    expect([...OPERATING_MODES]).toEqual([
      'emergency',
      'stabilization',
      'stop_new_debt',
      'repayment',
      'buffer_building',
      'growth',
    ]);
  });
});

describe('emergency', () => {
  test('a gap within 14 days is enough on its own', () => {
    const result = determineOperatingMode({ ...healthy, fundingGapWithin14DaysMinor: 1 });
    expect(result.mode).toBe('emergency');
  });

  test('a negative low point is enough on its own', () => {
    expect(determineOperatingMode({ ...healthy, lowPointMinor: -1 }).mode).toBe('emergency');
  });

  test('arrears on an essential or legal debt are enough on their own', () => {
    expect(determineOperatingMode({ ...healthy, hasEssentialOrLegalArrears: true }).mode).toBe(
      'emergency',
    );
  });

  test('an uncovered minimum payment is enough on its own', () => {
    expect(determineOperatingMode({ ...healthy, allMinimumsCovered: false }).mode).toBe(
      'emergency',
    );
  });

  test('every trigger that fired is reported, not just the first', () => {
    const result = determineOperatingMode({
      ...healthy,
      fundingGapWithin14DaysMinor: 1,
      lowPointMinor: -1,
    });
    expect(result.reasons.length).toBeGreaterThan(1);
  });

  test('discretionary recommendations are switched off', () => {
    expect(allowsDiscretionaryRecommendations('emergency')).toBe(false);
    expect(allowsDiscretionaryRecommendations('repayment')).toBe(true);
  });
});

describe('stabilization', () => {
  test('nothing is failing, but cash is below the reserve floor', () => {
    const result = determineOperatingMode({ ...healthy, liquidCashMinor: 100_000 });
    expect(result.mode).toBe('stabilization');
  });

  test('is stricter than stop_new_debt even when no new debt was taken', () => {
    const result = determineOperatingMode({
      ...healthy,
      liquidCashMinor: 100_000,
      newDebtOriginatedMinor: 0,
    });
    expect(result.mode).toBe('stabilization');
  });
});

describe('stop_new_debt', () => {
  test('applies when new debt was taken this period', () => {
    expect(determineOperatingMode({ ...healthy, newDebtOriginatedMinor: 1 }).mode).toBe(
      'stop_new_debt',
    );
  });

  test('applies when consumer debt grew, even without a new loan', () => {
    expect(determineOperatingMode({ ...healthy, netConsumerDebtChangeMinor: 1 }).mode).toBe(
      'stop_new_debt',
    );
  });

  test('a failing stress test blocks repayment and names the reason', () => {
    const result = determineOperatingMode({ ...healthy, stressTestsPassed: false });
    expect(result.mode).toBe('stop_new_debt');
    expect(result.reasons.map((r) => r.code)).toContain('mode.blocker.stress_failed');
  });

  test('a negative conservative forecast blocks repayment', () => {
    const result = determineOperatingMode({ ...healthy, conservativeForecastEndMinor: -1 });
    expect(result.mode).toBe('stop_new_debt');
  });
});

describe('repayment', () => {
  test('needs every condition at once', () => {
    expect(determineOperatingMode(healthy).mode).toBe('repayment');
  });

  test('states what would send the household back to a stricter mode', () => {
    expect(determineOperatingMode(healthy).watchList.length).toBeGreaterThan(0);
  });
});

describe('buffer_building', () => {
  test('applies when debt is falling and the cushion is twice the floor', () => {
    const result = determineOperatingMode({
      ...healthy,
      netConsumerDebtChangeMinor: -100_000,
      liquidCashMinor: 800_000,
    });
    expect(result.mode).toBe('buffer_building');
  });
});

describe('growth', () => {
  test('needs no consumer debt and a cushion of three times the floor', () => {
    const result = determineOperatingMode({
      ...healthy,
      consumerDebtMinor: 0,
      liquidCashMinor: 1_200_000,
    });
    expect(result.mode).toBe('growth');
  });

  test('a household with debt left is never in growth, however large the cushion', () => {
    const result = determineOperatingMode({
      ...healthy,
      consumerDebtMinor: 1,
      liquidCashMinor: 10_000_000,
    });
    expect(result.mode).not.toBe('growth');
  });
});
