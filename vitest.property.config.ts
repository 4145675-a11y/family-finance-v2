import { fileURLToPath } from 'node:url';

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
  resolve: {
    alias: {
      /*
       * The `server-only` marker resolves to nothing under React's
       * `react-server` condition and throws everywhere else. The runner is
       * neither, so a correctly-marked module could not be imported by a test
       * at all — and the wrong way out of that is to leave modules unmarked,
       * which is how something that names secrets reaches the browser.
       *
       * `check:client-secrets` reads the real import in the real source file,
       * so nothing is loosened by standing it down here.
       */
      'server-only': fileURLToPath(
        new URL('./tools/test-shims/server-only.shim.ts', import.meta.url),
      ),
    },
  },
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
