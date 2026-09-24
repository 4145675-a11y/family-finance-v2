import { defineConfig, devices } from '@playwright/test';

import { LOCAL_BASE_URL, PLAIN_BASE_URL } from './e2e/support/origins';

/**
 * The browser suite.
 *
 * What it runs against is the **built** application served by `next start`, with
 * the file-backed store pointed at a temporary directory — not a dev server and
 * not a stand-in for the screens. Every write these tests make goes through a real server
 * action, a real command and a real document on disk, and every assertion after
 * a reload is reading what was actually persisted. That is the whole reason the
 * suite exists: the unit tests already prove the commands, and what they cannot
 * prove is that a person pressing a button reaches them.
 *
 * Why the file store and not the database: this suite has to be runnable by
 * anybody who has cloned the repository, in CI, with no credentials of any kind.
 * `local_json` is a first-class backend of the product (ADR-0024, ADR-0031), it
 * runs the same commands and the same actions as the hosted deployment, and it
 * can be given a throw-away household in a temporary directory. The things that
 * genuinely differ — Supabase Auth, row-level security, PostgREST — are covered
 * by `npm run integration` and `npm run validate:production-path`, which do need
 * a database and say so.
 *
 * Serial by design. These tests write money into one household; running two of
 * them at once would make an assertion about "exactly one record" depend on
 * timing rather than on the product.
 */
export default defineConfig({
  testDir: './e2e/specs',
  outputDir: './test-results',

  // One worker, no parallelism inside a file. Financial writes must not race.
  workers: 1,
  fullyParallel: false,

  /*
   * No retries. A browser test for a financial write that passes on the second
   * attempt is telling us something, and retrying would hide it. A flake here is
   * a bug report, not noise to be smoothed over.
   */
  retries: 0,
  // `forbidOnly` in CI so a focused run can never be mistaken for a full one.
  forbidOnly: !!process.env['CI'],

  timeout: 60_000,
  expect: { timeout: 10_000 },

  reporter: process.env['CI'] ? [['github'], ['list']] : [['list']],

  use: {
    baseURL: LOCAL_BASE_URL,
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    // Kept only for a failure, and written to a git-ignored directory.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  globalSetup: './e2e/support/global-setup.ts',
  globalTeardown: './e2e/support/global-teardown.ts',

  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
      testIgnore: /\.(mobile|plain)\.spec\.ts$/,
    },
    {
      /*
       * The deployment as it stands today: no smart reader configured.
       *
       * Its own server on its own port, because "not set up here" is a property
       * of the process rather than of a request — and it is the state a person
       * meets on the hosted service right now, so it is the one most worth
       * seeing in a browser.
       */
      name: 'unconfigured',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 900 },
        baseURL: PLAIN_BASE_URL,
      },
      testMatch: /\.plain\.spec\.ts$/,
    },
    {
      /*
       * A phone, because the product is used standing in a shop. 390×844 is an
       * iPhone-class viewport; the suite runs the navigation and one full
       * journey here to prove nothing is clipped and every control is reachable.
       */
      name: 'phone',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: false,
        hasTouch: true,
      },
      testMatch: /\.mobile\.spec\.ts$/,
    },
  ],
});
