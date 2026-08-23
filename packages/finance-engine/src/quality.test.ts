import { describe, expect, test } from 'vitest';

import {
  CALCULATION_VERSION,
  POLICY_VERSION,
  buildDecision,
  canonicalJson,
  decideStatus,
  inputHashOf,
} from './decision';
import { account, baseInput, debt } from './fixtures/scenario';
import { QUALITY_WEIGHTS, freshnessAgeDays, scoreDataQuality } from './quality';
import type { DecisionDraft } from './decision';

describe('QUALITY_WEIGHTS (ADR-0016)', () => {
  test('sum to exactly 100, so the score is a percentage and not a coincidence', () => {
    const total = Object.values(QUALITY_WEIGHTS).reduce((sum, weight) => sum + weight, 0);
    expect(total).toBe(100);
  });

  test('cover every component 02-FINANCIAL-RULES.md § איכות נתונים names', () => {
    expect(Object.keys(QUALITY_WEIGHTS).sort()).toEqual([
      'approval_backlog',
      'balance_freshness',
      'classification',
      'debt_completeness',
      'reconciliation',
    ]);
  });
});

describe('scoreDataQuality', () => {
  test('a complete, freshly reconciled picture scores 100 with high confidence', () => {
    const quality = scoreDataQuality(baseInput());
    expect(quality.score).toBe(100);
    expect(quality.confidence).toBe('high');
    expect(quality.missingData).toEqual([]);
  });

  test('an unverified balance is scored as worse than an old one', () => {
    const never = scoreDataQuality(baseInput({ accounts: [account({ verifiedAt: null })] }));
    const old = scoreDataQuality(
      baseInput({ accounts: [account({ verifiedAt: '2026-07-25T06:00:00.000Z' })] }),
    );
    expect(never.score).toBeLessThan(old.score);
    expect(never.missingData.join(' ')).toContain('אימות');
  });

  test('a balance older than thirty days contributes nothing to freshness', () => {
    const quality = scoreDataQuality(
      baseInput({ accounts: [account({ verifiedAt: '2026-06-01T06:00:00.000Z' })] }),
    );
    const freshness = quality.components.find((part) => part.key === 'balance_freshness');
    expect(freshness?.score).toBe(0);
  });

  test('pending approvals lower the score and are listed as missing data', () => {
    const input = baseInput();
    const quality = scoreDataQuality({
      ...input,
      dataQuality: { ...input.dataQuality, pendingApprovalCount: 20 },
    });
    expect(quality.score).toBeLessThan(100);
    expect(quality.missingData.join(' ')).toContain('ממתינות');
  });

  test('any unresolved reconciliation gap zeroes that component outright', () => {
    const input = baseInput();
    const quality = scoreDataQuality({
      ...input,
      dataQuality: { ...input.dataQuality, unresolvedReconciliationGapMinor: 1 },
    });
    expect(quality.components.find((part) => part.key === 'reconciliation')?.score).toBe(0);
  });

  test('a debt with no interest rate lowers debt completeness', () => {
    const quality = scoreDataQuality(
      baseInput({ debts: [debt({ effectiveAnnualRateBp: null })] }),
    );
    expect(quality.components.find((part) => part.key === 'debt_completeness')?.score).toBe(0);
    expect(quality.missingData.join(' ')).toContain('ריבית');
  });

  test('confidence drops to low once enough is missing', () => {
    const input = baseInput();
    const quality = scoreDataQuality({
      ...input,
      accounts: [account({ verifiedAt: null })],
      debts: [debt({ effectiveAnnualRateBp: null, minimumPaymentMinor: null })],
      dataQuality: {
        unclassifiedCashMinor: 5_000,
        pendingApprovalCount: 30,
        recentTransactionCount: 40,
        transactionsMissingClassificationCount: 25,
        unresolvedReconciliationGapMinor: 12_000,
      },
    });
    expect(quality.confidence).toBe('low');
  });

  test('every component reports its own score, weight and detail', () => {
    for (const component of scoreDataQuality(baseInput()).components) {
      expect(component.score).toBeGreaterThanOrEqual(0);
      expect(component.score).toBeLessThanOrEqual(100);
      expect(component.weight).toBeGreaterThan(0);
      expect(component.detail.length).toBeGreaterThan(0);
    }
  });
});

describe('freshnessAgeDays', () => {
  test('reports the age of the most recently confirmed balance', () => {
    expect(freshnessAgeDays(baseInput())).toBe(1);
  });

  test('is null when nothing was ever confirmed', () => {
    expect(
      freshnessAgeDays(baseInput({ accounts: [account({ verifiedAt: null })] })),
    ).toBeNull();
  });
});

describe('canonicalJson', () => {
  test('orders keys, so equal facts serialise equally', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });

  test('preserves array order, which is meaningful', () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  test('distinguishes null from a missing key', () => {
    expect(canonicalJson({ a: null })).not.toBe(canonicalJson({}));
  });

  test('drops undefined rather than emitting invalid JSON', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});

describe('inputHashOf', () => {
  test('is stable for the same input', () => {
    expect(inputHashOf(baseInput())).toBe(inputHashOf(baseInput()));
  });

  test('changes when a number changes', () => {
    expect(inputHashOf(baseInput())).not.toBe(
      inputHashOf(baseInput({ approvedSafeTransferMinor: 1 })),
    );
  });

  test('does not change when only key order differs', () => {
    expect(inputHashOf({ a: 1, b: 2 })).toBe(inputHashOf({ b: 2, a: 1 }));
  });

  test('is a fixed-width hex string', () => {
    expect(inputHashOf(baseInput())).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('decideStatus', () => {
  const draft: DecisionDraft = {
    resultMinor: 380_000,
    fundingGapMinor: 0,
    breakdown: [],
    assumptions: [],
    warnings: [],
    missingData: [],
    dataQualityScore: 100,
    confidence: 'high',
    freshnessAgeDays: 1,
    operatingMode: 'repayment',
    stressTestsPassed: true,
    inputHash: 'abc',
  };

  test('a complete, stress-tested, fresh picture is safe', () => {
    expect(decideStatus(draft)).toBe('safe');
  });

  test('a funding gap is never safe', () => {
    expect(decideStatus({ ...draft, fundingGapMinor: 1 })).toBe('not_safe');
  });

  test('a zero result is not safe rather than trivially safe', () => {
    expect(decideStatus({ ...draft, resultMinor: 0 })).toBe('not_safe');
  });

  test('a failing stress test downgrades safe to conditional', () => {
    expect(decideStatus({ ...draft, stressTestsPassed: false })).toBe('conditional');
  });

  test('anything less than high confidence is conditional at best', () => {
    expect(decideStatus({ ...draft, confidence: 'medium' })).toBe('conditional');
  });

  test('missing data with low confidence is its own answer', () => {
    expect(decideStatus({ ...draft, confidence: 'low', missingData: ['יתרות לא אומתו'] })).toBe(
      'insufficient_data',
    );
  });
});

describe('buildDecision', () => {
  const draft: DecisionDraft = {
    resultMinor: 380_000,
    fundingGapMinor: 0,
    breakdown: [{ key: 'cash', label: 'מזומן', amountMinor: 500_000, effect: 'adds' }],
    assumptions: ['הנחה'],
    warnings: [],
    missingData: [],
    dataQualityScore: 100,
    confidence: 'high',
    freshnessAgeDays: 1,
    operatingMode: 'repayment',
    stressTestsPassed: true,
    inputHash: 'deadbeefdeadbeef',
  };

  test('carries every field 02-FINANCIAL-RULES.md § פלט החלטה מחייב requires', () => {
    const decision = buildDecision(draft);
    for (const field of [
      'status',
      'resultMinor',
      'fundingGapMinor',
      'breakdown',
      'assumptions',
      'warnings',
      'missingData',
      'dataQualityScore',
      'confidence',
      'freshnessAgeDays',
      'operatingMode',
      'calculationSnapshotId',
      'calculationVersion',
      'policyVersion',
    ]) {
      expect(decision).toHaveProperty(field);
    }
  });

  test('derives the snapshot id from the input hash, so it is reproducible', () => {
    expect(buildDecision(draft).calculationSnapshotId).toBe('snap_deadbeefdeadbeef');
  });

  test('stamps the calculation and policy versions separately', () => {
    const decision = buildDecision(draft);
    expect(decision.calculationVersion).toBe(CALCULATION_VERSION);
    expect(decision.policyVersion).toBe(POLICY_VERSION);
    expect(decision.calculationVersion).not.toBe(decision.policyVersion);
  });
});
