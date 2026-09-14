import { defineConfig } from 'vitest/config';

/**
 * The production-path validation (supabase/validation/*).
 *
 * Apart from the integration suite on purpose: it needs a completed build,
 * starts the production server, signs in through Supabase Auth over the
 * network and commits through PostgREST — nothing here is rolled back, so it
 * cleans up after itself instead. It runs on demand, never inside `verify`.
 */
export default defineConfig({
  test: {
    include: ['supabase/validation/**/*.validation.ts'],
    exclude: ['**/node_modules/**', '**/.next/**', '.npm-cache/**'],
    environment: 'node',
    setupFiles: ['supabase/tests/load-env.ts'],
    allowOnly: false,
    passWithNoTests: false,
    testTimeout: 120_000,
    hookTimeout: 180_000,
    fileParallelism: false,
    // One file, in order: every test builds on the one before it.
    sequence: { concurrent: false },
  },
});
