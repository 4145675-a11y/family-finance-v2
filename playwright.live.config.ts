import { defineConfig, devices } from '@playwright/test';

import { liveOrigin } from './e2e/support/live';

/**
 * The live browser suite: the real database, a synthetic person, one household.
 *
 * It exists for what `npm run e2e` structurally cannot reach. That suite runs the
 * file-backed store, which is a real backend of this product and enough to prove
 * every financial journey — but it has no sign-in screen, no row-level security
 * and no PostgREST. Those are the three things a hosted deployment lives or dies
 * on, so they get a suite that talks to the actual database.
 *
 * Not part of `npm run e2e` and not part of CI as configured today, because it
 * needs `SUPABASE_DB_URL` — the owner connection. It **fails** rather than
 * skipping when that is absent: a green run that quietly tested nothing is the
 * one outcome CLAUDE.md rules out entirely.
 *
 * Everything it creates it deletes, and it counts the rows afterwards to prove it.
 *
 * With `--live-origin=https://…` the same specs run against the **deployed**
 * service instead of a server started here. That is the authenticated production
 * check: a synthetic person signing in to the real site, seeing their own
 * household and nobody else's, and being removed afterwards.
 */
export default defineConfig({
  testDir: './e2e/live',
  outputDir: './test-results/live',

  // One worker. These tests sign in, write money and assert on counts.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: !!process.env['CI'],

  timeout: 90_000,
  expect: { timeout: 15_000 },

  reporter: process.env['CI'] ? [['github'], ['list']] : [['list']],

  use: {
    baseURL: liveOrigin(),
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  globalSetup: './e2e/support/live-setup.ts',
  globalTeardown: './e2e/support/live-teardown.ts',

  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
  ],
});
