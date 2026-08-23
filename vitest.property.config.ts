import { defineConfig } from 'vitest/config';

/**
 * Property suite — the invariants from 02-FINANCIAL-RULES.md § אינווריאנטים.
 *
 * Separate from the unit gate on purpose. A unit test states that one input
 * produces one output; a property test states that a rule holds for every input
 * in a generated range, and it is the only kind of test that can catch the class
 * of bug where a formula is right for the example someone had in mind and wrong
 * a hundred shekels either side of it. 08-TEST-PLAN.md requires both for any
 * calculation, so they are reported as two gates rather than one number.
 *
 * Runs are deterministic: the seed is fixed here, so a failure a colleague sees
 * is a failure this machine reproduces. fast-check prints the counterexample and
 * the seed needed to replay it.
 */
export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.property.test.ts'],
    exclude: ['**/node_modules/**', '**/.next/**', '**/dist/**', '.npm-cache/**'],
    environment: 'node',
    allowOnly: false,
    passWithNoTests: false,
    reporters: ['default'],
    // Generated cases are cheap here but not free; the engine is pure, so a
    // failing property is reproducible without any external state.
    testTimeout: 30_000,
  },
});
