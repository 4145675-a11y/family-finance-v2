import type { Confidence } from '@family-finance/contracts';

import { businessDateOf, daysBetween } from './dates';
import { roundHalfUp } from './money';
import { notice, type EngineNotice } from './notice';
import type { AccountPosition, EngineInput } from './types';

/**
 * Data quality, scored 0–100.
 *
 * 02-FINANCIAL-RULES.md § איכות נתונים lists what the score must consider and adds
 * a constraint that shapes this file: no hard-coded final weight without an ADR
 * and tests, and every score shows its components. The weights below are fixed in
 * ADR-0016 and asserted in quality.test.ts — they cannot drift without both
 * failing.
 *
 * The score is not decoration. A number computed from stale balances is a
 * different kind of claim from one computed from balances confirmed this morning,
 * and 03-UX-SPEC.md requires that difference to be visible next to every figure.
 */

export interface QualityComponent {
  readonly key: string;
  /** 0–100 for this component alone. */
  readonly score: number;
  /** Weight in the final score. The weights sum to 100 (ADR-0016). */
  readonly weight: number;
  /** The one fact that explains this component's score, as a code plus numbers. */
  readonly detail: EngineNotice;
}

export interface DataQualityScore {
  readonly score: number;
  readonly confidence: Confidence;
  readonly components: readonly QualityComponent[];
  readonly missingData: readonly EngineNotice[];
}

/** Weights from ADR-0016. Their sum is asserted in the tests. */
export const QUALITY_WEIGHTS = {
  balance_freshness: 25,
  approval_backlog: 15,
  classification: 20,
  reconciliation: 20,
  debt_completeness: 20,
} as const;

/** Balances confirmed within this many days are treated as fully fresh. */
const FRESH_DAYS = 3;
/** Beyond this, a balance contributes nothing to freshness. */
const STALE_DAYS = 30;

function ratioScore(good: number, total: number): number {
  if (total <= 0) return 100;
  return roundHalfUp((good / total) * 100);
}

function freshnessScore(
  accounts: readonly AccountPosition[],
  asOf: string,
): {
  score: number;
  neverVerified: number;
  oldestAgeDays: number | null;
} {
  const tracked = accounts.filter((account) => account.kind !== 'other');
  if (tracked.length === 0) return { score: 0, neverVerified: 0, oldestAgeDays: null };

  const today = businessDateOf(asOf);
  let total = 0;
  let neverVerified = 0;
  let oldestAgeDays: number | null = null;

  for (const account of tracked) {
    if (account.verifiedAt === null) {
      neverVerified += 1;
      continue;
    }
    const ageDays = daysBetween(businessDateOf(account.verifiedAt), today);
    oldestAgeDays = oldestAgeDays === null ? ageDays : Math.max(oldestAgeDays, ageDays);

    if (ageDays <= FRESH_DAYS) total += 100;
    else if (ageDays >= STALE_DAYS) total += 0;
    else total += roundHalfUp(((STALE_DAYS - ageDays) / (STALE_DAYS - FRESH_DAYS)) * 100);
  }

  return { score: roundHalfUp(total / tracked.length), neverVerified, oldestAgeDays };
}

export function scoreDataQuality(input: EngineInput): DataQualityScore {
  const missingData: EngineNotice[] = [];

  const freshness = freshnessScore(input.accounts, input.asOf);
  if (freshness.neverVerified > 0) {
    missingData.push(
      notice('missing.never_verified_accounts', { count: freshness.neverVerified }),
    );
  }

  const {
    pendingApprovalCount,
    recentTransactionCount,
    transactionsMissingClassificationCount,
  } = input.dataQuality;

  const approvalScore = ratioScore(
    recentTransactionCount - pendingApprovalCount,
    recentTransactionCount,
  );
  if (pendingApprovalCount > 0) {
    missingData.push(notice('missing.pending_approvals', { count: pendingApprovalCount }));
  }

  const classificationScore = ratioScore(
    recentTransactionCount - transactionsMissingClassificationCount,
    recentTransactionCount,
  );
  if (transactionsMissingClassificationCount > 0) {
    missingData.push(
      notice('missing.unclassified_transactions', {
        count: transactionsMissingClassificationCount,
      }),
    );
  }

  // Any unresolved reconciliation difference is treated as a full miss. A gap
  // that is "small" is still a gap: the balance is not explained.
  const reconciliationScore =
    input.dataQuality.unresolvedReconciliationGapMinor === 0 &&
    input.dataQuality.unclassifiedCashMinor === 0
      ? 100
      : 0;
  if (input.dataQuality.unresolvedReconciliationGapMinor > 0) {
    missingData.push(
      notice('missing.reconciliation_gap', {
        amountMinor: input.dataQuality.unresolvedReconciliationGapMinor,
      }),
    );
  }
  if (input.dataQuality.unclassifiedCashMinor > 0) {
    missingData.push(
      notice('missing.unclassified_cash', {
        amountMinor: input.dataQuality.unclassifiedCashMinor,
      }),
    );
  }

  const activeDebts = input.debts.filter((debt) => debt.status === 'active');
  const completeDebts = activeDebts.filter(
    (debt) => debt.effectiveAnnualRateBp !== null && debt.minimumPaymentMinor !== null,
  );
  const debtScore = ratioScore(completeDebts.length, activeDebts.length);
  const incompleteDebts = activeDebts.length - completeDebts.length;
  if (incompleteDebts > 0) {
    missingData.push(notice('missing.incomplete_debts', { count: incompleteDebts }));
  }

  const components: QualityComponent[] = [
    {
      key: 'balance_freshness',
      score: freshness.score,
      weight: QUALITY_WEIGHTS.balance_freshness,
      detail:
        freshness.oldestAgeDays === null
          ? notice('quality.freshness.none')
          : notice('quality.freshness.oldest', { days: freshness.oldestAgeDays }),
    },
    {
      key: 'approval_backlog',
      score: approvalScore,
      weight: QUALITY_WEIGHTS.approval_backlog,
      detail: notice('quality.approvals', {
        pending: pendingApprovalCount,
        total: recentTransactionCount,
      }),
    },
    {
      key: 'classification',
      score: classificationScore,
      weight: QUALITY_WEIGHTS.classification,
      detail: notice('quality.classification', {
        count: transactionsMissingClassificationCount,
      }),
    },
    {
      key: 'reconciliation',
      score: reconciliationScore,
      weight: QUALITY_WEIGHTS.reconciliation,
      detail:
        reconciliationScore === 100
          ? notice('quality.reconciliation.clean')
          : notice('quality.reconciliation.open'),
    },
    {
      key: 'debt_completeness',
      score: debtScore,
      weight: QUALITY_WEIGHTS.debt_completeness,
      detail: notice('quality.debts', {
        complete: completeDebts.length,
        total: activeDebts.length,
      }),
    },
  ];

  const weighted = components.reduce(
    (total, component) => total + component.score * component.weight,
    0,
  );
  const score = roundHalfUp(weighted / 100);

  return {
    score,
    confidence: score >= 80 ? 'high' : score >= 55 ? 'medium' : 'low',
    components,
    missingData,
  };
}

/** Age of the most recently confirmed balance, in whole days. */
export function freshnessAgeDays(input: EngineInput): number | null {
  const verified = input.accounts
    .map((account) => account.verifiedAt)
    .filter((value): value is string => value !== null);
  if (verified.length === 0) return null;

  const today = businessDateOf(input.asOf);
  return Math.min(...verified.map((value) => daysBetween(businessDateOf(value), today)));
}
