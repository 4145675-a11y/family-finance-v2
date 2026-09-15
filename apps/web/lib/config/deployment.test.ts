import { describe, expect, test } from 'vitest';

import {
  DeploymentConfigError,
  deploymentProblems,
  publicPrefixedSecrets,
  readDeploymentConfig,
  supabaseProjectRefOf,
  type RawEnvironment,
} from './deployment';

/**
 * The rules that decide whether this process may serve a household's money.
 *
 * Every test here is a way a deployment could look healthy and be wrong. The
 * ones that matter most are the refusals: a server that starts is a server
 * somebody will point a domain at.
 */

const PRODUCTION: RawEnvironment = {
  NODE_ENV: 'production',
  FAMILY_FINANCE_DATA_BACKEND: 'supabase',
  FAMILY_FINANCE_APP_ORIGIN: 'https://finance.example.com',
  NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abcdefghijklmnop',
};

function problemsFor(env: RawEnvironment): string[] {
  try {
    readDeploymentConfig(env);
    return [];
  } catch (error) {
    return error instanceof DeploymentConfigError
      ? [...error.problems]
      : ['not a config error'];
  }
}

/**
 * Any non-empty value.
 *
 * The configuration only ever asks whether a key is *present* — it never reads,
 * validates or transmits one — so a realistic-looking literal would add no
 * coverage while putting a credential-shaped string in the source. `scan:forbidden`
 * refuses that pattern, and is right to.
 */
const PRESENT = 'x';

const mentions = (env: RawEnvironment, needle: string): boolean =>
  problemsFor(env).some((problem) => problem.includes(needle));

describe('a well-formed production deployment', () => {
  test('is accepted', () => {
    const config = readDeploymentConfig(PRODUCTION);
    expect(config.isProduction).toBe(true);
    expect(config.backend).toBe('supabase');
    expect(config.appOrigin).toBe('https://finance.example.com');
    expect(config.rpId).toBe('finance.example.com');
  });

  test('derives the relying party id from the origin, so they cannot disagree', () => {
    const config = readDeploymentConfig({
      ...PRODUCTION,
      FAMILY_FINANCE_APP_ORIGIN: 'https://money.family.co.il',
    });
    expect(config.rpId).toBe('money.family.co.il');
  });

  test('has AI off until it is deliberately turned on', () => {
    expect(readDeploymentConfig(PRODUCTION).aiEnabled).toBe(false);
  });

  test('never allows the development fixture', () => {
    const config = readDeploymentConfig({
      ...PRODUCTION,
      NEXT_PUBLIC_DEV_DATA_SOURCE: 'on',
    });
    expect(config.fixtureAllowed).toBe(false);
  });
});

describe('a hosted deployment refuses the local JSON store', () => {
  test('explicitly configured for it', () => {
    // The rule this module exists for. A file has no row-level security, no
    // durability guarantee, and on most hosts a disk that disappears.
    expect(
      mentions(
        { ...PRODUCTION, FAMILY_FINANCE_DATA_BACKEND: 'local_json' },
        'not this machine',
      ),
    ).toBe(true);
  });

  test('but a copy on the household’s own machine may use it', () => {
    /*
     * The case the first version of this rule got wrong. It keyed on
     * NODE_ENV=production and refused this — which is the shape the product has
     * shipped as until now, and the shape the shell gate exercises. The risk is
     * being hosted, not being built for production.
     */
    expect(() =>
      readDeploymentConfig({
        NODE_ENV: 'production',
        FAMILY_FINANCE_DATA_BACKEND: 'local_json',
        FAMILY_FINANCE_APP_ORIGIN: 'http://localhost:3100',
      }),
    ).not.toThrow();
  });

  test('and a hosted deployment is refused whatever NODE_ENV says', () => {
    // A staging service running with NODE_ENV unset is still reachable by
    // other people, and a file is still the wrong place for the money.
    expect(
      mentions(
        {
          FAMILY_FINANCE_DATA_BACKEND: 'local_json',
          FAMILY_FINANCE_APP_ORIGIN: 'https://staging.example.com',
        },
        'not this machine',
      ),
    ).toBe(true);
  });

  test('and when the backend is simply not stated', () => {
    const env = { ...PRODUCTION };
    delete (env as Record<string, unknown>)['FAMILY_FINANCE_DATA_BACKEND'];
    expect(mentions(env, 'must state its backend explicitly')).toBe(true);
  });

  test('there is no flag that permits it', () => {
    // Deliberately hostile: every plausible override tried at once.
    const env: RawEnvironment = {
      ...PRODUCTION,
      FAMILY_FINANCE_DATA_BACKEND: 'local_json',
      // Names this build has never heard of, on purpose: the point is that no
      // variable at all opens this door, not that these particular ones do not.
      ...({
        ALLOW_LOCAL_STORE: 'true',
        FORCE_LOCAL: '1',
        FAMILY_FINANCE_ALLOW_LOCAL_IN_PRODUCTION: 'yes',
      } as Record<string, string>),
    };
    expect(() => readDeploymentConfig(env)).toThrow(DeploymentConfigError);
  });

  test('an unknown backend name is refused rather than guessed at', () => {
    expect(
      mentions({ ...PRODUCTION, FAMILY_FINANCE_DATA_BACKEND: 'postgres' }, 'not a backend'),
    ).toBe(true);
  });
});

describe('development keeps working', () => {
  test('with nothing configured at all', () => {
    const config = readDeploymentConfig({});
    expect(config.backend).toBe('local_json');
    expect(config.isProduction).toBe(false);
    expect(config.appOrigin).toBe('http://localhost:3100');
  });

  test('and may opt into the fixture behind the flag', () => {
    const config = readDeploymentConfig({ NEXT_PUBLIC_DEV_DATA_SOURCE: 'on' });
    expect(config.fixtureAllowed).toBe(true);
  });

  test('but the flag must be the exact literal', () => {
    for (const value of ['true', '1', 'yes', 'ON', '']) {
      expect(readDeploymentConfig({ NEXT_PUBLIC_DEV_DATA_SOURCE: value }).fixtureAllowed).toBe(
        false,
      );
    }
  });
});

describe('the supabase backend needs a real connection', () => {
  test('a missing url is refused', () => {
    const env = { ...PRODUCTION };
    delete (env as Record<string, unknown>)['NEXT_PUBLIC_SUPABASE_URL'];
    expect(mentions(env, 'NEXT_PUBLIC_SUPABASE_URL is required')).toBe(true);
  });

  test('a plain-http url is refused', () => {
    expect(
      mentions(
        { ...PRODUCTION, NEXT_PUBLIC_SUPABASE_URL: 'http://abc.supabase.co' },
        'must be https',
      ),
    ).toBe(true);
  });

  test('a secret key in the publishable slot is refused by shape', () => {
    // The single most expensive paste in this whole migration.
    expect(
      mentions(
        { ...PRODUCTION, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_abcdefghijklmnop' },
        'must never appear in client configuration',
      ),
    ).toBe(true);
  });

  test('a legacy anon JWT is refused too', () => {
    expect(
      mentions(
        { ...PRODUCTION, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6' },
        'sb_publishable_',
      ),
    ).toBe(true);
  });

  test('the local backend needs none of it', () => {
    expect(() =>
      readDeploymentConfig({ FAMILY_FINANCE_DATA_BACKEND: 'local_json' }),
    ).not.toThrow();
  });
});

describe('the origin a family reaches', () => {
  test('a production copy served at localhost is legitimate', () => {
    // The family's own machine. This is what M7 and M8 shipped.
    const config = readDeploymentConfig({
      NODE_ENV: 'production',
      FAMILY_FINANCE_DATA_BACKEND: 'local_json',
      FAMILY_FINANCE_APP_ORIGIN: 'http://localhost:3100',
    });
    expect(config.backend).toBe('local_json');
    expect(config.rpId).toBe('localhost');
  });

  test('a hosted deployment cannot be served at an IP address, and says why', () => {
    /*
     * Refused for a different reason than localhost, and the difference
     * matters: a public IP is perfectly reachable, so "only exists on one
     * machine" would send somebody looking in the wrong place. What is actually
     * wrong is that an address cannot be a relying party — measured in ADR-0029.
     */
    const problems = problemsFor({
      ...PRODUCTION,
      FAMILY_FINANCE_APP_ORIGIN: 'https://203.0.113.10',
    });
    expect(problems.some((p) => p.includes('must be a domain name'))).toBe(true);
  });

  test('a loopback IP is not treated as a hosted address', () => {
    // 127.0.0.1 is an address, but it is this machine — the passkey rule that
    // rejects addresses is about reaching a relying party, not about loopback.
    const problems = problemsFor({
      FAMILY_FINANCE_DATA_BACKEND: 'local_json',
      FAMILY_FINANCE_APP_ORIGIN: 'https://127.0.0.1',
    });
    expect(problems.some((p) => p.includes('must be a domain name'))).toBe(false);
  });

  test('plain http on a real domain is refused, because a lock needs a secure context', () => {
    expect(
      mentions(
        { ...PRODUCTION, FAMILY_FINANCE_APP_ORIGIN: 'http://finance.example.com' },
        'not a secure context',
      ),
    ).toBe(true);
  });

  test('nonsense is refused rather than half-accepted', () => {
    expect(
      mentions({ ...PRODUCTION, FAMILY_FINANCE_APP_ORIGIN: 'not a url' }, 'not a usable URL'),
    ).toBe(true);
  });

  test('http://localhost stays valid for development', () => {
    expect(() =>
      readDeploymentConfig({ FAMILY_FINANCE_APP_ORIGIN: 'http://localhost:3100' }),
    ).not.toThrow();
  });
});

describe('AI is off unless it can actually run', () => {
  test('the flag without a key is refused', () => {
    // Offering to send a document nowhere is worse than not offering.
    expect(
      mentions({ ...PRODUCTION, FAMILY_FINANCE_AI_ENABLED: 'on' }, 'OPENAI_API_KEY is not set'),
    ).toBe(true);
  });

  test('the flag with a key turns it on', () => {
    const config = readDeploymentConfig({
      ...PRODUCTION,
      FAMILY_FINANCE_AI_ENABLED: 'on',
      OPENAI_API_KEY: PRESENT,
    });
    expect(config.aiEnabled).toBe(true);
  });

  test('a key without the flag leaves it off', () => {
    const config = readDeploymentConfig({
      ...PRODUCTION,
      OPENAI_API_KEY: PRESENT,
    });
    expect(config.aiEnabled).toBe(false);
  });
});

describe('a secret must never carry a public prefix', () => {
  test.each([
    'NEXT_PUBLIC_SUPABASE_SECRET_KEY',
    'NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY',
    'NEXT_PUBLIC_OPENAI_API_KEY',
    'NEXT_PUBLIC_SUPABASE_DB_URL',
    'NEXT_PUBLIC_DATABASE_URL',
    'NEXT_PUBLIC_VAPID_PRIVATE_KEY',
    'NEXT_PUBLIC_NOTIFICATION_WORKER_SECRET',
  ])('%s is refused', (name) => {
    // Next inlines every NEXT_PUBLIC_ value into the browser bundle, so this
    // mistake publishes the secret to every visitor. It is one keystroke wide.
    const env = { ...PRODUCTION, [name]: 'anything' } as RawEnvironment;
    expect(mentions(env, name)).toBe(true);
  });

  test('the detector names every offender, not just the first', () => {
    const found = publicPrefixedSecrets({
      NEXT_PUBLIC_OPENAI_API_KEY: 'a',
      NEXT_PUBLIC_SUPABASE_SECRET_KEY: 'b',
      NEXT_PUBLIC_SUPABASE_URL: 'fine',
    });
    expect(found.sort()).toEqual([
      'NEXT_PUBLIC_OPENAI_API_KEY',
      'NEXT_PUBLIC_SUPABASE_SECRET_KEY',
    ]);
  });

  test('the legitimate public values are not flagged', () => {
    expect(publicPrefixedSecrets(PRODUCTION as Record<string, string | undefined>)).toEqual([]);
  });
});

describe('reporting without throwing', () => {
  test('a healthy deployment reports no problems', () => {
    expect(deploymentProblems(PRODUCTION)).toEqual([]);
  });

  test('a broken one reports all of them at once', () => {
    // A person fixing a deployment should get the whole list, not a new error
    // on every restart.
    const problems = deploymentProblems({
      NODE_ENV: 'production',
      FAMILY_FINANCE_DATA_BACKEND: 'local_json',
      // Hosted, over plain http, with AI promised and no key: three separate
      // faults, and a person fixing this should see all three now rather than
      // meet a new one on every restart.
      FAMILY_FINANCE_APP_ORIGIN: 'http://staging.example.com',
      FAMILY_FINANCE_AI_ENABLED: 'on',
    });
    expect(problems.length).toBeGreaterThanOrEqual(3);
  });

  test('it never throws, because a health check that crashes reports nothing', () => {
    expect(() => deploymentProblems({ FAMILY_FINANCE_APP_ORIGIN: '::::' })).not.toThrow();
  });
});

describe('the production-origin contract (PROD-ORIGIN-001)', () => {
  test('a hosted deployment must state its origin; localhost is not assumed for it', () => {
    const withoutOrigin: RawEnvironment = {
      ...PRODUCTION,
      FAMILY_FINANCE_APP_ORIGIN: undefined,
    };
    expect(deploymentProblems(withoutOrigin).join(' ')).toContain(
      'FAMILY_FINANCE_APP_ORIGIN is not set',
    );
    // The auth-origin spelling counts as stating it.
    expect(
      deploymentProblems({
        ...withoutOrigin,
        FAMILY_FINANCE_AUTH_ORIGIN: 'https://finance.example.com',
      }),
    ).toEqual([]);
    // A developer's production-mode copy on the local store keeps the default.
    expect(
      deploymentProblems({ NODE_ENV: 'production', FAMILY_FINANCE_DATA_BACKEND: 'local_json' }),
    ).toEqual([]);
    // In development the default stands, so a developer's .env.local needs no origin.
    const development: RawEnvironment = { ...withoutOrigin, NODE_ENV: 'development' };
    expect(readDeploymentConfig(development).appOrigin).toBe('http://localhost:3100');
  });

  test('an origin is scheme, host and port — nothing more', () => {
    for (const decorated of [
      'https://finance.example.com/app',
      'https://finance.example.com/?x=1',
      'https://finance.example.com/#home',
      'https://user:pw@finance.example.com',
    ]) {
      const problems = deploymentProblems({
        ...PRODUCTION,
        FAMILY_FINANCE_APP_ORIGIN: decorated,
      });
      expect(problems.join(' '), decorated).toContain('origin only');
    }
    expect(
      deploymentProblems({
        ...PRODUCTION,
        FAMILY_FINANCE_APP_ORIGIN: 'https://finance.example.com:8443',
      }),
    ).toEqual([]);
  });

  test('a Supabase host is never the application origin', () => {
    const problems = deploymentProblems({
      ...PRODUCTION,
      FAMILY_FINANCE_APP_ORIGIN: 'https://abcdefghijklmnopqrst.supabase.co',
    });
    expect(problems.join(' ')).toContain('names a Supabase host');
  });

  test('a scheme other than http(s) is refused', () => {
    expect(
      deploymentProblems({
        ...PRODUCTION,
        FAMILY_FINANCE_APP_ORIGIN: 'ftp://finance.example.com',
      }).join(' '),
    ).toContain('not a usable URL');
  });

  test('the Supabase URL must be the project URL exactly', () => {
    for (const wrong of [
      'https://abcdefgh.supabase.co',
      'https://abcdefghijklmnopqrst.supabase.co/rest/v1',
      'https://abcdefghijklmnopqrst.supabase.co:8443',
      'https://abcdefghijklmnopqrst.supabase.com',
      'https://supabase.com/dashboard/project/abcdefghijklmnopqrst',
    ]) {
      expect(
        deploymentProblems({ ...PRODUCTION, NEXT_PUBLIC_SUPABASE_URL: wrong }).join(' '),
        wrong,
      ).toContain('project URL exactly');
    }
  });

  test('the project ref is derived from the URL and exposed for consistency checks, never invented', () => {
    expect(readDeploymentConfig(PRODUCTION).supabaseProjectRef).toBe('abcdefghijklmnopqrst');
    expect(readDeploymentConfig({ NODE_ENV: 'development' }).supabaseProjectRef).toBeNull();
    expect(supabaseProjectRefOf('https://abcdefghijklmnopqrst.supabase.co')).toBe(
      'abcdefghijklmnopqrst',
    );
    expect(supabaseProjectRefOf('http://abcdefghijklmnopqrst.supabase.co')).toBeNull();
    // Lookalike hosts: the dots are literal, and a subdomain is a different host.
    expect(supabaseProjectRefOf('https://abcdefghijklmnopqrstxsupabase.co')).toBeNull();
    expect(
      supabaseProjectRefOf('https://abcdefghijklmnopqrst.supabase.co.evil.example'),
    ).toBeNull();
    expect(supabaseProjectRefOf('https://abcdefghijklmnopqrst.supabasexco')).toBeNull();
  });

  test('two origin settings that disagree are refused; agreeing or single ones are fine', () => {
    expect(
      deploymentProblems({
        ...PRODUCTION,
        FAMILY_FINANCE_AUTH_ORIGIN: 'https://other.example.com',
      }).join(' '),
    ).toContain('disagree');
    expect(
      deploymentProblems({
        ...PRODUCTION,
        FAMILY_FINANCE_AUTH_ORIGIN: 'https://finance.example.com',
      }),
    ).toEqual([]);
    expect(
      deploymentProblems({
        NODE_ENV: 'development',
        FAMILY_FINANCE_AUTH_ORIGIN: 'http://localhost:3100',
      }),
    ).toEqual([]);
  });

  test('session cookies are Secure on every https origin and only there (PROD-COOKIE-001)', () => {
    expect(readDeploymentConfig(PRODUCTION).secureCookies).toBe(true);
    expect(readDeploymentConfig({ NODE_ENV: 'development' }).secureCookies).toBe(false);
    expect(
      readDeploymentConfig({
        ...PRODUCTION,
        NODE_ENV: 'development',
        FAMILY_FINANCE_APP_ORIGIN: 'http://localhost:3100',
      }).secureCookies,
    ).toBe(false);
  });
});

describe('a problem names the setting and never what was put in it', () => {
  /*
   * Every problem string reaches three places: the startup log, the public
   * `/api/health` body, and the message of the error a page hits when it asks
   * for the backend. A value pasted into the wrong variable — a key into the
   * origin slot, say — must not travel with it. So the rule is total: no
   * environment value, parsed or raw, appears in any problem. The variable's
   * name is enough to fix it.
   */
  const PASTED = 'pasted-by-mistake-0000';

  test.each<[string, RawEnvironment]>([
    ['an unknown backend', { ...PRODUCTION, FAMILY_FINANCE_DATA_BACKEND: PASTED }],
    ['an origin that is not a URL', { ...PRODUCTION, FAMILY_FINANCE_APP_ORIGIN: PASTED }],
    [
      'an origin with a non-http scheme',
      { ...PRODUCTION, FAMILY_FINANCE_APP_ORIGIN: `ftp://${PASTED}.example` },
    ],
    [
      'an origin with credentials in it',
      {
        ...PRODUCTION,
        FAMILY_FINANCE_APP_ORIGIN: `https://${PASTED}:${PASTED}@finance.example.com`,
      },
    ],
    [
      'a plain-http origin',
      { ...PRODUCTION, FAMILY_FINANCE_APP_ORIGIN: `http://${PASTED}.example` },
    ],
    [
      'an IP-address origin',
      { ...PRODUCTION, FAMILY_FINANCE_APP_ORIGIN: 'https://203.0.113.7' },
    ],
    [
      'a hosted origin on the local store',
      {
        ...PRODUCTION,
        FAMILY_FINANCE_DATA_BACKEND: 'local_json',
        FAMILY_FINANCE_APP_ORIGIN: `https://${PASTED}.example`,
      },
    ],
    [
      'a Supabase host as the origin',
      { ...PRODUCTION, FAMILY_FINANCE_APP_ORIGIN: `https://${PASTED}12345678.supabase.co` },
    ],
    [
      'two origins that disagree',
      { ...PRODUCTION, FAMILY_FINANCE_AUTH_ORIGIN: `https://${PASTED}.example` },
    ],
    [
      'a wrong Supabase URL',
      { ...PRODUCTION, NEXT_PUBLIC_SUPABASE_URL: `https://${PASTED}.example` },
    ],
    [
      'a secret-shaped publishable key',
      { ...PRODUCTION, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: `sb_secret_${PASTED}` },
    ],
  ])('%s: refused, named, value withheld', (_label, env) => {
    const problems = problemsFor(env);
    expect(problems.length).toBeGreaterThan(0);
    const text = problems.join('\n');
    expect(text).not.toContain(PASTED);
    expect(text).not.toContain('203.0.113.7');
    // The name of at least one of the settings involved is there to act on.
    expect(text).toMatch(/FAMILY_FINANCE_|NEXT_PUBLIC_SUPABASE_/);
  });

  test('the thrown error carries the same names and the same silence', () => {
    let message = '';
    try {
      readDeploymentConfig({ ...PRODUCTION, FAMILY_FINANCE_APP_ORIGIN: PASTED });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('FAMILY_FINANCE_APP_ORIGIN');
    expect(message).not.toContain(PASTED);
  });
});
