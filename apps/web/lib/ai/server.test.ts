import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  ANALYSES_PER_HOUR,
  aiConfigured,
  provider,
  resetProvider,
  resetRateLimit,
  withinRateLimit,
} from './server';

/**
 * Which reader a deployment has, and how often it may be asked.
 *
 * The case that matters most here is the ordinary one: **no key**. That is what
 * production looks like today, and the required behaviour is that the
 * application stays completely usable and says so honestly rather than pretending
 * a reading happened. A provider that appeared out of nowhere when unconfigured
 * would be the worst possible failure of this feature, so it is the first thing
 * asserted.
 *
 * No test here needs a key that works. `OPENAI_API_KEY` is set to an obvious
 * placeholder to prove a provider is *constructed*; nothing calls it.
 */

const KEY_VAR = 'OPENAI_API_KEY';
const MODEL_VAR = 'OPENAI_MODEL';
const FLAG_VAR = 'FAMILY_FINANCE_AI_PROVIDER';

const saved: Record<string, string | undefined> = {};

/**
 * Sets an environment variable, including the ones Node types as read-only.
 *
 * `NODE_ENV` is declared read-only so application code cannot reassign it, which
 * is right — and a test whose subject is "what happens under production" has to
 * be able to say so. Done here, once, rather than with a cast at each call site.
 */
function setEnv(name: string, value: string | undefined): void {
  const env = process.env as unknown as Record<string, string | undefined>;
  if (value === undefined) delete env[name];
  else env[name] = value;
}

beforeEach(() => {
  for (const name of [KEY_VAR, MODEL_VAR, FLAG_VAR, 'NODE_ENV', 'FAMILY_FINANCE_E2E']) {
    saved[name] = process.env[name];
    setEnv(name, undefined);
  }
  resetProvider();
  resetRateLimit();
});

afterEach(() => {
  for (const [name, value] of Object.entries(saved)) {
    setEnv(name, value);
  }
  resetProvider();
  resetRateLimit();
});

describe('with no key configured — which is production today', () => {
  test('there is no provider at all', () => {
    expect(provider()).toBeNull();
  });

  test('and the screen is told so, rather than being told an error', () => {
    expect(aiConfigured()).toBe(false);
  });

  test('an empty or blank key counts as no key', () => {
    process.env[KEY_VAR] = '';
    resetProvider();
    expect(provider()).toBeNull();

    process.env[KEY_VAR] = '   ';
    resetProvider();
    expect(provider()).toBeNull();
  });
});

describe('with a key configured', () => {
  test('the real provider is built', () => {
    process.env[KEY_VAR] = 'sk-placeholder-not-a-real-key';
    resetProvider();
    expect(provider()?.name).toBe('openai');
    expect(aiConfigured()).toBe(true);
  });

  test('a model override is accepted without a release', () => {
    process.env[KEY_VAR] = 'sk-placeholder-not-a-real-key';
    process.env[MODEL_VAR] = 'some-other-model';
    resetProvider();
    // Construction is what is checked here; which model reaches the wire is
    // asserted in the provider's own tests, where the request body is visible.
    expect(provider()?.name).toBe('openai');
  });
});

describe('the deterministic reader', () => {
  test('is available when a test runtime asks for it', () => {
    process.env[FLAG_VAR] = 'scripted';
    resetProvider();
    expect(provider()?.name).toBe('scripted');
  });

  test('refuses to start in a production process', () => {
    /*
     * The loudest guard in this file. A hosted deployment answering with canned
     * proposals would be false success of the purest kind — a screen saying a
     * sentence was read when nothing read it — so the process refuses rather than
     * degrading quietly.
     */
    process.env[FLAG_VAR] = 'scripted';
    setEnv('NODE_ENV', 'production');
    resetProvider();
    expect(() => provider()).toThrow(/refusing to start/u);
  });

  test('unless the browser suite has explicitly said it is one', () => {
    // The suite runs a production build on purpose, so it needs a way to say so.
    process.env[FLAG_VAR] = 'scripted';
    setEnv('NODE_ENV', 'production');
    setEnv('FAMILY_FINANCE_E2E', 'true');
    resetProvider();
    expect(provider()?.name).toBe('scripted');
  });

  test('and a key does not override the flag, so a test never spends money', () => {
    process.env[FLAG_VAR] = 'scripted';
    process.env[KEY_VAR] = 'sk-placeholder-not-a-real-key';
    resetProvider();
    expect(provider()?.name).toBe('scripted');
  });
});

describe('the rate limit', () => {
  const HOUSEHOLD = '11111111-1111-4111-8111-111111111111';

  test('allows the documented number of readings in an hour', () => {
    for (let index = 0; index < ANALYSES_PER_HOUR; index += 1) {
      expect(withinRateLimit(HOUSEHOLD), `attempt ${index + 1}`).toBe(true);
    }
  });

  test('and refuses the one after that', () => {
    for (let index = 0; index < ANALYSES_PER_HOUR; index += 1) withinRateLimit(HOUSEHOLD);
    expect(withinRateLimit(HOUSEHOLD)).toBe(false);
  });

  test('counts each household separately', () => {
    for (let index = 0; index < ANALYSES_PER_HOUR; index += 1) withinRateLimit(HOUSEHOLD);
    expect(withinRateLimit(HOUSEHOLD)).toBe(false);
    // Another household is not punished for this one's usage.
    expect(withinRateLimit('22222222-2222-4222-8222-222222222222')).toBe(true);
  });

  test('forgets attempts older than the window', () => {
    const start = Date.parse('2026-09-24T10:00:00.000Z');
    for (let index = 0; index < ANALYSES_PER_HOUR; index += 1) {
      withinRateLimit(HOUSEHOLD, start);
    }
    expect(withinRateLimit(HOUSEHOLD, start)).toBe(false);
    // An hour and a minute later the window has moved on.
    expect(withinRateLimit(HOUSEHOLD, start + 61 * 60 * 1000)).toBe(true);
  });
});
