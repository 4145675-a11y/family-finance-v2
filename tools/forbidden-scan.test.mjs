/**
 * Rule coverage for the forbidden-artifact scan.
 *
 * The scanner excludes its own rule table from scanning (a rule table cannot avoid
 * containing the literals it searches for). These tests are what makes that exclusion
 * acceptable: every rule must fire on a positive fixture and stay silent on clean code.
 *
 * Runner: Vitest. Milestone 0 ran these on node:test because no dependency was installed
 * yet; Milestone 1 consolidated on one runner (ADR-0009). The assertions are unchanged.
 */

import { describe, expect, test } from 'vitest';

import { RULES, findViolations, isProductionPath, camelSplit } from './forbidden-scan.mjs';

/** Positive fixture per rule id. Each line must trigger exactly that rule. */
const POSITIVE_FIXTURES = {
  'functional-todo': '// TODO: wire the real balance source',
  'mock-in-production-path': 'const client = createMockSupabaseClient();',
  'disabled-test': "it.skip('reconciles the opening balance', () => {});",
  'type-check-suppressed': '// @ts-ignore',
  'lint-disabled': '/* eslint-disable no-console */',
  'empty-catch': 'try { post(); } catch (error) {}',
  'tautological-assertion': 'expect(true).toBe(true);',
  'private-key-material': '-----BEGIN RSA PRIVATE KEY-----',
  'inline-secret-assignment': "const SERVICE_ROLE_KEY = 'sbp_live_9f2a77c41b';",
  'production-seed': 'await seedProduction(db);',
};

/** Lines that must never trigger any rule in a production path. */
const CLEAN_LINES = [
  'export function safeHouseholdSpend(input: SpendInput): SpendResult {',
  'const amountMinor = Math.max(0, verifiedLiquidCash - essentialNeeds);',
  'if (!snapshot.isFresh) return { status: "insufficient_data", warnings };',
  'try { await commit(); } catch (error) { logger.error(error); throw error; }',
  'expect(result.amountMinor).toBe(125_00);',
  '// Rounding is half-up at the charge point, per 02-FINANCIAL-RULES.md.',
  'const onlyChild = members.find((m) => m.role === "child");',
  'const contextValue = useHouseholdContext();',
];

test('every rule has a positive fixture', () => {
  const ruleIds = RULES.map((rule) => rule.id).sort();
  expect(Object.keys(POSITIVE_FIXTURES).sort()).toEqual(ruleIds);
});

describe('each rule fires on its fixture', () => {
  test.each(RULES.map((rule) => [rule.id]))('%s', (id) => {
    const matched = findViolations(POSITIVE_FIXTURES[id], true).map((rule) => rule.id);
    expect(matched, `fixture: ${POSITIVE_FIXTURES[id]}`).toContain(id);
  });
});

test('clean production code triggers no rule', () => {
  for (const line of CLEAN_LINES) {
    expect(
      findViolations(line, true).map((rule) => rule.id),
      `line: ${line}`,
    ).toEqual([]);
  }
});

test('production-only rules are suppressed in test paths', () => {
  const productionOnlyIds = RULES.filter((rule) => rule.productionOnly).map((rule) => rule.id);
  expect(productionOnlyIds.length).toBeGreaterThan(0);

  for (const id of productionOnlyIds) {
    expect(findViolations(POSITIVE_FIXTURES[id], false).map((rule) => rule.id)).not.toContain(
      id,
    );
  }
});

test('rules that are not production-only fire everywhere', () => {
  for (const rule of RULES.filter((r) => !r.productionOnly)) {
    expect(findViolations(POSITIVE_FIXTURES[rule.id], false).map((r) => r.id)).toContain(
      rule.id,
    );
  }
});

test('path classification recognises test and fixture locations', () => {
  expect(isProductionPath('packages/finance-engine/src/safe-spend.ts')).toBe(true);
  expect(isProductionPath('packages/finance-engine/src/safe-spend.test.ts')).toBe(false);
  expect(isProductionPath('apps/web/tests/home.spec.ts')).toBe(false);
  expect(isProductionPath('packages/contracts/fixtures/debt.ts')).toBe(false);
  expect(isProductionPath('apps/web/e2e/onboarding.ts')).toBe(false);
});

test('test doubles are detected inside camelCase and PascalCase identifiers', () => {
  const disguised = [
    'const client = createMockSupabaseClient();',
    'export class FakeDebtRepository implements DebtRepository {',
    'const balanceStubValue = 0;',
    'import { buildDummyHousehold } from "../support";',
  ];
  for (const line of disguised) {
    expect(
      findViolations(line, true).map((rule) => rule.id),
      `line: ${line}`,
    ).toContain('mock-in-production-path');
  }
});

test('camelSplit does not break rules that rely on the raw identifier', () => {
  expect(camelSplit('await seedProduction(db);')).toBe('await seed Production(db);');
  expect(findViolations('await seedProduction(db);', true).map((rule) => rule.id)).toContain(
    'production-seed',
  );
});

test('every rule carries a severity and a rationale', () => {
  for (const rule of RULES) {
    expect(['error', 'warn']).toContain(rule.severity);
    expect(rule.why.length, `${rule.id} needs an actionable rationale`).toBeGreaterThan(20);
  }
});
