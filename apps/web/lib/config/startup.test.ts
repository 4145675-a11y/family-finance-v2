import { describe, expect, test } from 'vitest';

import type { RawEnvironment } from './deployment';
import { announceStartupVerdict, decideStartup, type StartupLog } from './startup';

/**
 * What a process does with its own configuration at startup.
 *
 * The refusal is neither an exit nor a throw (ADR-0034): `process.exit` in
 * instrumentation.ts failed the first Render build, and a throw leaves Next
 * listening and answering 500. What startup does is decide and announce; the
 * proxy and the health route enforce. These tests pin the announcement — one
 * line when safe, the problems by name when not — and that nothing a setting
 * holds ever reaches the log.
 */

const PRODUCTION: RawEnvironment = {
  NODE_ENV: 'production',
  FAMILY_FINANCE_DATA_BACKEND: 'supabase',
  FAMILY_FINANCE_APP_ORIGIN: 'https://finance.example.com',
  NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abcdefghijklmnop',
};

function capture(): StartupLog & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    info: (message) => lines.push(message),
    error: (message) => lines.push(message),
  };
}

describe('the startup verdict', () => {
  test('a safe production configuration is accepted, with its config', () => {
    const verdict = decideStartup(PRODUCTION);
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.config.backend).toBe('supabase');
  });

  test('a problem is a verdict, never a throw', () => {
    const verdict = decideStartup({ ...PRODUCTION, FAMILY_FINANCE_DATA_BACKEND: 'local_json' });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.problems.join(' ')).toContain('not this machine');
  });

  test('a hosted process without a stated origin is a problem', () => {
    const verdict = decideStartup({ ...PRODUCTION, FAMILY_FINANCE_APP_ORIGIN: undefined });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.problems.join(' ')).toContain('FAMILY_FINANCE_APP_ORIGIN');
  });
});

describe('announcing the verdict', () => {
  test('a safe configuration logs one starting line and returns the config', () => {
    const log = capture();
    const verdict = announceStartupVerdict(PRODUCTION, log);
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.config.appOrigin).toBe('https://finance.example.com');
    expect(log.lines).toHaveLength(1);
    expect(log.lines[0]).toMatch(
      /^\[family-finance\] starting: env=production backend=supabase/,
    );
  });

  test('a bad configuration logs the problems by name and what happens next — and does not throw', () => {
    const log = capture();
    const env: RawEnvironment = {
      ...PRODUCTION,
      NEXT_PUBLIC_SUPABASE_URL: undefined,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined,
    };
    const verdict = announceStartupVerdict(env, log);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.problems).toHaveLength(2);
    const output = log.lines.join('\n');
    expect(output).toContain('refusing to serve');
    expect(output).toContain('NEXT_PUBLIC_SUPABASE_URL');
    expect(output).toContain('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
    expect(output).toContain('503');
    expect(output).toContain('misconfigured');
    expect(output).toContain('Nothing is served');
  });

  test('the log never carries the value of a key', () => {
    const log = capture();
    // A secret-shaped key in the publishable slot is refused by shape; the
    // refusal must name the setting and not echo what was pasted into it.
    const pasted = 'sb_secret_pastedbymistake0000000000';
    const verdict = announceStartupVerdict(
      { ...PRODUCTION, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: pasted },
      log,
    );
    expect(verdict.ok).toBe(false);
    expect(log.lines.join('\n')).not.toContain(pasted);
    expect(log.lines.join('\n')).toContain('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  });
});
