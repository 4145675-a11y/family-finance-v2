import 'server-only';

import {
  OpenAIProvider,
  ScriptedAIProvider,
  type AIProvider,
} from '@family-finance/ai-proposal';

import { e2eFallback, e2eScriptRules } from './e2e-script';

/**
 * Which reader this deployment has, and the only place a key is read.
 *
 * `server-only` is the first line, and it is the whole security boundary for
 * `OPENAI_API_KEY`. A module that reads a secret and can be imported from a
 * client component will eventually be imported from one; marking it makes that a
 * build error rather than a discovery. The key is read here, passed to the
 * provider as an argument, and never touched again — the provider package itself
 * never looks at `process.env`, so it cannot carry a secret anywhere by
 * accident.
 *
 * The name is `OPENAI_API_KEY` and it is deliberately **not** `NEXT_PUBLIC_*`.
 * Anything with that prefix is compiled into the browser bundle, and
 * `check:client-secrets` fails the build over it.
 *
 * ## Three states, all of them honest
 *
 *   * a key is set → the real provider;
 *   * `FAMILY_FINANCE_AI_PROVIDER=scripted` → the deterministic one, for tests;
 *   * neither → **no provider**, and the screen says smart reading is not set up
 *     on this service. It does not pretend, and the deterministic route stays
 *     exactly where it was.
 */

/** Set by a test runtime only. A production process that asks for it refuses. */
const PROVIDER_FLAG = 'FAMILY_FINANCE_AI_PROVIDER';
const SCRIPTED = 'scripted';

/**
 * How often one household may ask, per hour.
 *
 * In memory, per process. That is a real limitation and it is the right one for
 * a single-instance deployment: a shared counter would need a table, a table
 * would need a migration, and the thing being protected is a spend limit that the
 * provider also enforces. Documented in `docs/AI-QUICK-UPDATE.md` rather than
 * papered over.
 */
export const ANALYSES_PER_HOUR = 30;

const WINDOW_MS = 60 * 60 * 1000;

const asked = new Map<string, number[]>();

/** Records an attempt and says whether it is within the allowance. */
export function withinRateLimit(householdId: string, now = Date.now()): boolean {
  const recent = (asked.get(householdId) ?? []).filter((at) => now - at < WINDOW_MS);
  if (recent.length >= ANALYSES_PER_HOUR) {
    asked.set(householdId, recent);
    return false;
  }
  recent.push(now);
  asked.set(householdId, recent);
  return true;
}

/** Exposed for tests, which must not inherit another test's counter. */
export function resetRateLimit(): void {
  asked.clear();
}

/**
 * What the screen needs to know without being told why.
 *
 * `configured: false` is not an error state. It is the ordinary condition of a
 * deployment whose owner has not enabled this, and the screen says so plainly.
 */
export function aiConfigured(): boolean {
  return provider() !== null;
}

let cached: AIProvider | null | undefined;

export function provider(): AIProvider | null {
  if (cached !== undefined) return cached;
  cached = build();
  return cached;
}

/** Exposed for tests that change the environment between cases. */
export function resetProvider(): void {
  cached = undefined;
}

function build(): AIProvider | null {
  if (process.env[PROVIDER_FLAG] === SCRIPTED) {
    /*
     * A deterministic reader, and never in production.
     *
     * The refusal is deliberate and loud: a hosted deployment answering with a
     * canned proposal would be the purest form of false success this repository
     * forbids. `NODE_ENV` is what Render sets, so the guard is on the thing that
     * is actually true in production rather than on a flag somebody could unset.
     */
    if (
      process.env['NODE_ENV'] === 'production' &&
      process.env['FAMILY_FINANCE_E2E'] !== 'true'
    ) {
      throw new Error(
        'the deterministic AI provider was requested in a production process; refusing to start',
      );
    }
    return new ScriptedAIProvider(e2eScriptRules(), e2eFallback());
  }

  const key = (process.env['OPENAI_API_KEY'] ?? '').trim();
  if (key === '') return null;

  const model = (process.env['OPENAI_MODEL'] ?? '').trim();

  return new OpenAIProvider({
    apiKey: key,
    ...(model === '' ? {} : { model }),
    /*
     * Operational metadata only: what happened, how long it took, and a status
     * when there was one. No prompt, no answer, no sentence, and no key — a log
     * line is one of the easiest places for a family's money to end up.
     */
    report: (event) => {
      console.log(
        `[ai] outcome=${event.outcome} duration_ms=${event.durationMs}` +
          (event.status === undefined ? '' : ` status=${event.status}`),
      );
    },
  });
}
