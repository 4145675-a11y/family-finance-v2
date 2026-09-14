import { defineConfig } from 'vitest/config';

/**
 * Integration suite — runs against a real PostgreSQL database.
 *
 * Kept separate from the unit config on purpose. Unit tests must stay runnable
 * with no external service, while these tests are meaningless without one. They
 * are never merged into `npm run unit`, and they never skip: with no database
 * configured they fail with instructions.
 */
export default defineConfig({
  test: {
    include: ['supabase/tests/**/*.integration.test.ts'],
    exclude: ['**/node_modules/**', '**/.next/**', '.npm-cache/**'],
    environment: 'node',
    /*
     * Loads `.env.integration.local` before the suite starts.
     *
     * The tests document that file as where the connection string goes, and
     * until now nothing read it — so following the instructions failed exactly
     * as not following them did. A value already in the environment still wins,
     * and the loader never prints anything.
     */
    setupFiles: ['supabase/tests/load-env.ts'],
    allowOnly: false,
    passWithNoTests: false,
    // A database round trip is slower than an in-process assertion, and the
    // fixture setup creates users and households before the first test.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Isolation tests share one fixture; running files in parallel against the
    // same database would let one file's teardown pull rows from under another.
    fileParallelism: false,
  },
});
