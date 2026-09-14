import { describe, expect, test } from 'vitest';

import { healthReport, type Probe } from './health';

/**
 * The health report of the data layer (PROD-HEALTH-002).
 *
 * A probe is a function; here it is a scripted one, so every outcome the real
 * PostgREST probe can produce is exercised without a network.
 */

const PRODUCTION = {
  NODE_ENV: 'production',
  FAMILY_FINANCE_DATA_BACKEND: 'supabase',
  FAMILY_FINANCE_APP_ORIGIN: 'https://finance.example.com',
  NEXT_PUBLIC_SUPABASE_URL: 'https://exampleprojectref.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_0000000000000000000000',
} as NodeJS.ProcessEnv;

const scripted =
  (outcome: Awaited<ReturnType<Probe>>): ((url: string, key: string) => Probe) =>
  () =>
  async () =>
    outcome;

describe('health with the database backend', () => {
  test('a reachable database with the expected schema is ready', async () => {
    const { report, httpStatus } = await healthReport(PRODUCTION, scripted('denied'));
    expect(httpStatus).toBe(200);
    expect(report.status).toBe('ok');
    expect(report.data).toEqual({
      configuration: 'present',
      authenticatedDataSource: 'available',
      database: 'reachable',
      schema: 'compatible',
      readiness: 'ready',
    });
  });

  test('a reachable database missing the data-layer functions is incompatible, not ready', async () => {
    const { report, httpStatus } = await healthReport(PRODUCTION, scripted('missing'));
    expect(httpStatus).toBe(503);
    expect(report.status).toBe('not_ready');
    expect(report.data.database).toBe('reachable');
    expect(report.data.schema).toBe('incompatible');
    expect(report.data.authenticatedDataSource).toBe('unavailable');
  });

  test('a database that does not answer is unreachable, not ready', async () => {
    const { report, httpStatus } = await healthReport(PRODUCTION, scripted('unreachable'));
    expect(httpStatus).toBe(503);
    expect(report.data).toMatchObject({
      database: 'unreachable',
      schema: 'unknown',
      readiness: 'not_ready',
    });
  });

  test('the report never carries the host, the project or a key', async () => {
    for (const outcome of ['denied', 'missing', 'unreachable'] as const) {
      const { report } = await healthReport(PRODUCTION, scripted(outcome));
      const text = JSON.stringify(report);
      expect(text).not.toContain('exampleprojectref');
      expect(text).not.toContain('supabase.co');
      expect(text).not.toContain('sb_publishable');
    }
  });

  test('a misconfigured deployment names the setting and never its value', async () => {
    const { report, httpStatus } = await healthReport(
      { ...PRODUCTION, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_should_never_be_here' },
      scripted('denied'),
    );
    expect(httpStatus).toBe(503);
    expect(report.status).toBe('misconfigured');
    expect(report.problems?.join(' ')).toContain('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
    expect(JSON.stringify(report)).not.toContain('should_never_be_here');
    expect(report.data.readiness).toBe('not_ready');
  });
});

describe('health with the file backend', () => {
  test('the data layer is not applicable and the process is ready', async () => {
    const probeCalls: string[] = [];
    const { report, httpStatus } = await healthReport(
      { NODE_ENV: 'development' } as NodeJS.ProcessEnv,
      () => async (fn) => {
        probeCalls.push(fn);
        return 'denied';
      },
    );
    expect(httpStatus).toBe(200);
    expect(report.backend).toBe('local_json');
    expect(report.data).toEqual({
      configuration: 'present',
      authenticatedDataSource: 'not_applicable',
      database: 'not_applicable',
      schema: 'not_applicable',
      readiness: 'ready',
    });
    expect(probeCalls, 'no probe is made without a database backend').toEqual([]);
  });
});
