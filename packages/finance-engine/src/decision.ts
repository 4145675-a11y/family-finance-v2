import type { Confidence } from '@family-finance/contracts';

import type { EngineNotice } from './notice';
import type { BreakdownLine, DecisionStatus } from './types';

/**
 * The decision envelope every calculation must return.
 *
 * 02-FINANCIAL-RULES.md § פלט החלטה מחייב lists the fields, and adds the rule that
 * makes them matter: "UI ו־AI אינם רשאים להציג result בלי גישה לפירוט ולעדכניות".
 * A bare number is not a permitted output of this engine. Anything that reaches a
 * screen or a model arrives wrapped in what produced it, how fresh it is and what
 * it assumed.
 *
 * `inputHash` and `calculationSnapshotId` are derived from the input, not from a
 * clock or a counter, so the same facts always produce the same identifier. That
 * is what makes a stored decision checkable months later: recompute, compare the
 * hash, and you know whether you are looking at the same question.
 */

/** Bumped when a formula changes shape. Stored on every result. */
export const CALCULATION_VERSION = '1.0.0';

/**
 * The revision of 02-FINANCIAL-RULES.md this engine implements. Separate from the
 * calculation version: the rules can change without the code, and the code can be
 * fixed without the rules changing.
 */
export const POLICY_VERSION = '2026-08-16';

export interface DecisionResult {
  readonly status: DecisionStatus;
  readonly resultMinor: number;
  readonly fundingGapMinor: number;
  readonly breakdown: readonly BreakdownLine[];
  readonly assumptions: readonly EngineNotice[];
  readonly warnings: readonly EngineNotice[];
  readonly missingData: readonly EngineNotice[];
  readonly dataQualityScore: number;
  readonly confidence: Confidence;
  /** Age in days of the freshest confirmed balance; null when none exists. */
  readonly freshnessAgeDays: number | null;
  readonly operatingMode: string;
  readonly calculationSnapshotId: string;
  readonly inputHash: string;
  readonly calculationVersion: string;
  readonly policyVersion: string;
}

/**
 * Canonical JSON: object keys sorted, so two structurally equal inputs hash the
 * same regardless of the order their fields happened to be built in.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`);

  return `{${entries.join(',')}}`;
}

/**
 * FNV-1a, 64-bit, as hex.
 *
 * Deliberately not a cryptographic hash and not `node:crypto`. This identifies an
 * input for replay and cache comparison; it is never a security boundary, and
 * keeping it dependency-free lets the engine run unchanged on a server, in a test
 * and in a browser.
 */
export function inputHashOf(value: unknown): string {
  const text = canonicalJson(value);
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= BigInt(text.charCodeAt(index) & 0xff);
    hash = (hash * prime) & mask;
  }

  return hash.toString(16).padStart(16, '0');
}

export interface DecisionDraft {
  readonly resultMinor: number;
  readonly fundingGapMinor: number;
  readonly breakdown: readonly BreakdownLine[];
  readonly assumptions: readonly EngineNotice[];
  readonly warnings: readonly EngineNotice[];
  readonly missingData: readonly EngineNotice[];
  readonly dataQualityScore: number;
  readonly confidence: Confidence;
  readonly freshnessAgeDays: number | null;
  readonly operatingMode: string;
  readonly stressTestsPassed: boolean;
  readonly inputHash: string;
}

/**
 * Decides the status of a result.
 *
 * The precedence is what 02-FINANCIAL-RULES.md § נזילות מול ודאות demands:
 * uncertain never counts as safe, and missing data is its own answer rather than
 * a quietly optimistic one.
 */
export function decideStatus(draft: DecisionDraft): DecisionStatus {
  if (draft.missingData.length > 0 && draft.confidence === 'low') return 'insufficient_data';
  if (draft.fundingGapMinor > 0) return 'not_safe';
  if (draft.resultMinor === 0) return 'not_safe';
  if (!draft.stressTestsPassed) return 'conditional';
  if (draft.confidence !== 'high') return 'conditional';
  return 'safe';
}

export function buildDecision(draft: DecisionDraft): DecisionResult {
  return {
    status: decideStatus(draft),
    resultMinor: draft.resultMinor,
    fundingGapMinor: draft.fundingGapMinor,
    breakdown: draft.breakdown,
    assumptions: draft.assumptions,
    warnings: draft.warnings,
    missingData: draft.missingData,
    dataQualityScore: draft.dataQualityScore,
    confidence: draft.confidence,
    freshnessAgeDays: draft.freshnessAgeDays,
    operatingMode: draft.operatingMode,
    calculationSnapshotId: `snap_${draft.inputHash}`,
    inputHash: draft.inputHash,
    calculationVersion: CALCULATION_VERSION,
    policyVersion: POLICY_VERSION,
  };
}
