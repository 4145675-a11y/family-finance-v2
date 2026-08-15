/**
 * Rule coverage for the forbidden-artifact scan.
 *
 * The scanner excludes its own rule table from scanning (a rule table cannot avoid
 * containing the literals it searches for). These tests are what makes that exclusion
 * acceptable: every rule must fire on a positive fixture and stay silent on clean code.
 *
 * Runner: node:test (built into Node) — no dependencies required at Milestone 0.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

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
  assert.deepEqual(Object.keys(POSITIVE_FIXTURES).sort(), ruleIds);
});

for (const rule of RULES) {
  test(`rule ${rule.id} fires on its fixture`, () => {
    const matched = findViolations(POSITIVE_FIXTURES[rule.id], true).map((r) => r.id);
    assert.ok(
      matched.includes(rule.id),
      `expected ${rule.id} to match ${JSON.stringify(POSITIVE_FIXTURES[rule.id])}, matched: ${matched.join(', ') || 'nothing'}`,
    );
  });
}

test('clean production code triggers no rule', () => {
  for (const line of CLEAN_LINES) {
    const matched = findViolations(line, true).map((r) => r.id);
    assert.deepEqual(matched, [], `unexpected match on: ${line}`);
  }
});

test('production-only rules are suppressed in test paths', () => {
  const productionOnlyIds = RULES.filter((rule) => rule.productionOnly).map((rule) => rule.id);
  assert.ok(productionOnlyIds.length > 0, 'expected at least one production-only rule');

  for (const id of productionOnlyIds) {
    const matched = findViolations(POSITIVE_FIXTURES[id], false).map((r) => r.id);
    assert.ok(!matched.includes(id), `${id} must not fire outside a production path`);
  }
});

test('rules that are not production-only fire everywhere', () => {
  const alwaysOn = RULES.filter((rule) => !rule.productionOnly);
  for (const rule of alwaysOn) {
    const matched = findViolations(POSITIVE_FIXTURES[rule.id], false).map((r) => r.id);
    assert.ok(matched.includes(rule.id), `${rule.id} must fire in test paths as well`);
  }
});

test('path classification recognises test and fixture locations', () => {
  assert.equal(isProductionPath('packages/finance-engine/src/safe-spend.ts'), true);
  assert.equal(isProductionPath('packages/finance-engine/src/safe-spend.test.ts'), false);
  assert.equal(isProductionPath('apps/web/tests/home.spec.ts'), false);
  assert.equal(isProductionPath('packages/contracts/fixtures/debt.ts'), false);
  assert.equal(isProductionPath('apps/web/e2e/onboarding.ts'), false);
});

test('test doubles are detected inside camelCase and PascalCase identifiers', () => {
  const disguised = [
    'const client = createMockSupabaseClient();',
    'export class FakeDebtRepository implements DebtRepository {',
    'const balanceStubValue = 0;',
    'import { buildDummyHousehold } from "../support";',
  ];
  for (const line of disguised) {
    const matched = findViolations(line, true).map((rule) => rule.id);
    assert.ok(matched.includes('mock-in-production-path'), `missed test double in: ${line}`);
  }
});

test('camelSplit does not break rules that rely on the raw identifier', () => {
  assert.equal(camelSplit('await seedProduction(db);'), 'await seed Production(db);');
  const matched = findViolations('await seedProduction(db);', true).map((rule) => rule.id);
  assert.ok(matched.includes('production-seed'), 'raw-form rule must still match after adding the split variant');
});

test('every rule carries a severity and a rationale', () => {
  for (const rule of RULES) {
    assert.ok(['error', 'warn'].includes(rule.severity), `${rule.id} has an invalid severity`);
    assert.ok(rule.why.length > 20, `${rule.id} needs a rationale a reviewer can act on`);
  }
});
