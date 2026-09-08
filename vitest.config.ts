import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

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
  // Vitest 4 transforms with oxc. The app's tsconfig sets `jsx: preserve` for Next, so
  // the runner is told explicitly to compile JSX with the automatic React runtime.
  oxc: {
    jsx: { runtime: 'automatic' },
  },
  test: {
    // Tests are authored without JSX so no JSX transform is configured here; the app's
    // `jsx: preserve` setting belongs to Next and must not be reinterpreted by the runner.
    include: ['tools/**/*.test.mjs', 'packages/*/src/**/*.test.ts', 'apps/*/**/*.test.ts'],
    // Property tests are a separate gate with its own config; including them here
    // would report one number for two different kinds of evidence.
    exclude: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '.npm-cache/**',
      '**/*.property.test.ts',
    ],
    environment: 'node',
    // A test that neither passes nor fails is not evidence. 08-TEST-PLAN.md forbids
    // shipping a gate with skipped tests, so make the runner refuse them outright.
    allowOnly: false,
    passWithNoTests: false,
    reporters: ['default'],
  },
});
