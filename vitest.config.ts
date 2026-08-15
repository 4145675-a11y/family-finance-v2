import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Vitest 4 transforms with oxc. The app's tsconfig sets `jsx: preserve` for Next, so
  // the runner is told explicitly to compile JSX with the automatic React runtime.
  oxc: {
    jsx: { runtime: 'automatic' },
  },
  test: {
    // Tests are authored without JSX so no JSX transform is configured here; the app's
    // `jsx: preserve` setting belongs to Next and must not be reinterpreted by the runner.
    include: ['tools/**/*.test.mjs', 'packages/*/src/**/*.test.ts', 'apps/*/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/.next/**', '**/dist/**', '.npm-cache/**'],
    environment: 'node',
    // A test that neither passes nor fails is not evidence. 08-TEST-PLAN.md forbids
    // shipping a gate with skipped tests, so make the runner refuse them outright.
    allowOnly: false,
    passWithNoTests: false,
    reporters: ['default'],
  },
});
