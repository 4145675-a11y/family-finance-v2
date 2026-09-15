/**
 * The hosting contract, held to the repository (ADR-0033, PROD-HOSTING-001).
 *
 * `render.yaml` is applied by the owner in the Render dashboard; nothing here
 * talks to Render. What can be proven without a deployment is that the file
 * agrees with the rest of the repository, and that it could not carry a secret:
 *
 *   - the Node it asks for is the Node the repository is verified with
 *   - the build is the one CI runs, and the start script exists
 *   - health is `/api/health`, and that route exists
 *   - every variable the application requires for the Supabase backend is
 *     declared — the public ones as `sync: false`, entered in Render, and the
 *     one that is a decision of the code (`supabase`) as a value
 *   - no value looks like a key, a token or a connection string, and no
 *     variable that would hold one is even named
 *   - the plan is stated, because leaving it out means a paid default
 *
 * The parser in render-blueprint.mjs accepts only a small YAML subset. Its
 * refusals are tested here too: a blueprint that needs anchors or flow syntax
 * has become something to review, not something to parse harder.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import { BlueprintSyntaxError, parseBlueprint, readBlueprint } from './render-blueprint.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** @param {string} relative */
const read = (relative) => readFileSync(join(REPO_ROOT, relative), 'utf8');

const NVMRC = read('.nvmrc').trim();
const CI_WORKFLOW = read('.github/workflows/ci.yml');
const ROOT_MANIFEST = JSON.parse(read('package.json'));
const WEB_MANIFEST = JSON.parse(read('apps/web/package.json'));
const ENV_EXAMPLE = read('apps/web/.env.example');

/** The variables `readDeploymentConfig` needs for a hosted Supabase deployment. */
const REQUIRED_FOR_SUPABASE = [
  'FAMILY_FINANCE_DATA_BACKEND',
  'FAMILY_FINANCE_APP_ORIGIN',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
];

/** Entered in Render, never written here. Public values, but one place to rotate them. */
const ENTERED_BY_OWNER = [
  'FAMILY_FINANCE_APP_ORIGIN',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
];

/** Names that would hold a secret. The application has none on the platform. */
const SECRET_NAME =
  /SECRET|PASSWORD|PASSWD|TOKEN|PRIVATE|SERVICE_ROLE|DB_URL|DATABASE_URL|API_KEY/i;

/** Shapes a secret takes. A value matching any of these fails the build. */
const SECRET_SHAPES = [
  /sb_secret_/i,
  /sb_publishable_/i,
  /service_role/i,
  /^eyJ[A-Za-z0-9_-]{10,}/, // a JWT
  /postgres(ql)?:\/\//i,
  /[A-Za-z0-9+/]{40,}={0,2}/, // a long base64 run
  /sk-[A-Za-z0-9]{20,}/, // an OpenAI-style key
];

const blueprint = /** @type {any} */ (readBlueprint());
const services = blueprint.services;
const service = Array.isArray(services) ? services[0] : undefined;
const envVars = Array.isArray(service?.envVars) ? service.envVars : [];

/** @param {string} key */
const envVar = (key) => envVars.find((entry) => entry.key === key);

describe('the blueprint describes one Node web service', () => {
  test('there is exactly one service and it is a Node web service', () => {
    expect(Object.keys(blueprint)).toEqual(['services']);
    expect(services).toHaveLength(1);
    expect(service.type).toBe('web');
    expect(service.runtime).toBe('node');
    expect(typeof service.name).toBe('string');
    expect(service.name).not.toBe('');
  });

  test('it deploys the main branch, and only after the checks pass', () => {
    expect(service.branch).toBe('main');
    expect(service.autoDeployTrigger).toBe('checksPass');
  });

  test('it lives in a named region', () => {
    expect(['frankfurt', 'oregon', 'ohio', 'virginia', 'singapore']).toContain(service.region);
  });

  test('the plan is stated, because the unstated default costs money', () => {
    expect(typeof service.plan).toBe('string');
    expect(service.plan).not.toBe('');
  });
});

describe('build, start and health agree with the repository', () => {
  test('the build is the one CI runs: reproducible install without scripts, then the build', () => {
    expect(service.buildCommand).toBe('npm ci --ignore-scripts && npm run build');
    expect(CI_WORKFLOW).toContain('npm ci --ignore-scripts');
    expect(CI_WORKFLOW).toMatch(/run:\s*npm run build/);
  });

  test('the start command exists and reaches the web app through the launcher', () => {
    expect(service.startCommand).toBe('npm run start');
    expect(ROOT_MANIFEST.scripts.start).toBe('npm run start --workspace @family-finance/web');
    expect(WEB_MANIFEST.scripts.start).toContain('tools/next.mjs start');
  });

  test('health is the readiness route, and the route exists', () => {
    expect(service.healthCheckPath).toBe('/api/health');
    expect(existsSync(join(REPO_ROOT, 'apps', 'web', 'app', 'api', 'health', 'route.ts'))).toBe(
      true,
    );
  });
});

describe('the Node version is the one the repository is verified with', () => {
  test('.nvmrc pins an exact version', () => {
    expect(NVMRC).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test('NODE_VERSION equals .nvmrc', () => {
    expect(envVar('NODE_VERSION')?.value).toBe(NVMRC);
  });

  test('CI reads the same file', () => {
    expect(CI_WORKFLOW).toMatch(/node-version-file:\s*\.nvmrc/);
  });

  test('the pinned version satisfies the engines floor', () => {
    const floor = /^>=(\d+)\.(\d+)\.(\d+)$/.exec(ROOT_MANIFEST.engines.node);
    expect(floor).not.toBeNull();
    const [major, minor, patch] = NVMRC.split('.').map(Number);
    const [, fMajor, fMinor, fPatch] = (floor ?? []).map(Number);
    const atLeast =
      major > fMajor ||
      (major === fMajor && (minor > fMinor || (minor === fMinor && patch >= fPatch)));
    expect(atLeast).toBe(true);
  });
});

describe('environment variables: names for the owner, values only where the code decides', () => {
  test('every entry has a key and exactly one of a literal value or sync: false', () => {
    expect(envVars.length).toBeGreaterThan(0);
    for (const entry of envVars) {
      expect(typeof entry.key, JSON.stringify(entry)).toBe('string');
      expect(entry.key).toMatch(/^[A-Z][A-Z0-9_]*$/);
      const keys = Object.keys(entry).sort();
      const literal = keys.join(',') === 'key,value';
      const entered = keys.join(',') === 'key,sync' && entry.sync === false;
      expect(literal || entered, `${entry.key}: ${keys.join(',')}`).toBe(true);
      if (literal)
        expect(typeof entry.value, `${entry.key} must be a quoted string`).toBe('string');
    }
  });

  test('no key is declared twice', () => {
    const keys = envVars.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('the runtime is told it is production and telemetry is off', () => {
    expect(envVar('NODE_ENV')?.value).toBe('production');
    expect(envVar('NEXT_TELEMETRY_DISABLED')?.value).toBe('1');
  });

  test('the backend is fixed to supabase by the blueprint, not left to the dashboard', () => {
    expect(envVar('FAMILY_FINANCE_DATA_BACKEND')?.value).toBe('supabase');
  });

  test('everything the Supabase backend requires is declared', () => {
    for (const key of REQUIRED_FOR_SUPABASE) {
      expect(envVar(key), key).toBeDefined();
    }
  });

  test('the origin and the project settings are entered by the owner, not written here', () => {
    const entered = envVars
      .filter((entry) => entry.sync === false)
      .map((entry) => entry.key)
      .sort();
    expect(entered).toEqual([...ENTERED_BY_OWNER].sort());
  });

  test('the names match apps/web/.env.example', () => {
    const documented = new Set(
      ENV_EXAMPLE.split('\n')
        .map((line) => /^([A-Z][A-Z0-9_]*)=/.exec(line)?.[1])
        .filter((name) => name !== undefined),
    );
    for (const key of REQUIRED_FOR_SUPABASE) {
      expect(documented.has(key), `${key} is not in .env.example`).toBe(true);
    }
    // The development fixture switch has no business on a hosted service.
    expect(envVar('NEXT_PUBLIC_DEV_DATA_SOURCE')).toBeUndefined();
  });
});

describe('nothing secret can live in the blueprint', () => {
  const source = read('render.yaml');

  test('no variable that would hold a secret is even named', () => {
    for (const entry of envVars) {
      expect(entry.key, entry.key).not.toMatch(SECRET_NAME);
    }
    expect(source).not.toMatch(/SUPABASE_DB_URL|SUPABASE_SECRET_KEY|SERVICE_ROLE/);
  });

  test('no value has the shape of a key, a token or a connection string', () => {
    for (const entry of envVars) {
      if (typeof entry.value !== 'string') continue;
      for (const shape of SECRET_SHAPES) {
        expect(entry.value, `${entry.key} matches ${shape}`).not.toMatch(shape);
      }
    }
    for (const shape of SECRET_SHAPES) {
      expect(source, `render.yaml matches ${shape}`).not.toMatch(shape);
    }
  });

  test('Render is not asked to generate secrets or copy them between services', () => {
    expect(source).not.toMatch(/generateValue|fromService|fromDatabase|fromGroup/);
  });

  test('no env file is referenced, and none is tracked (check:no-env-files covers the rest)', () => {
    expect(source).not.toMatch(/envVarGroups|\.env\b/);
  });
});

describe('the parser refuses what the blueprint must not contain', () => {
  const parses = (text) => () => parseBlueprint(text);

  test('the accepted subset round-trips', () => {
    expect(
      parseBlueprint(
        [
          '# comment',
          'services:',
          '  - type: web',
          "    name: 'a # not a comment'",
          '    plan: free # a comment',
          '    envVars:',
          '      - key: A',
          "        value: '1'",
          '      - key: B',
          '        sync: false',
          '    tags:',
          '      - one',
          '      - two',
        ].join('\n'),
      ),
    ).toEqual({
      services: [
        {
          type: 'web',
          name: 'a # not a comment',
          plan: 'free',
          envVars: [
            { key: 'A', value: '1' },
            { key: 'B', sync: false },
          ],
          tags: ['one', 'two'],
        },
      ],
    });
  });

  test('an unquoted number is a number, which is why env values are quoted', () => {
    expect(parseBlueprint('value: 1')).toEqual({ value: 1 });
    expect(parseBlueprint("value: '1'")).toEqual({ value: '1' });
  });

  test.each([
    ['a tab', 'a:\n\tb: 1'],
    ['an anchor', 'a: &x 1'],
    ['an alias', 'a: *x'],
    ['flow mapping', 'a: {b: 1}'],
    ['flow sequence', 'a: [1, 2]'],
    ['a block scalar', 'a: |\n  text'],
    ['a second document', 'a: 1\n---\nb: 2'],
    ['a duplicate key', 'a: 1\na: 2'],
    ['a key without a value', 'a:\nb: 1'],
    ['a stray indentation', 'a: 1\n  b: 2'],
    ['an escape in double quotes', 'a: "x\\ny"'],
    ['a list where a key belongs', 'a: 1\n- b'],
    ['an empty document', '# nothing\n'],
  ])('%s is refused', (_label, text) => {
    expect(parses(text)).toThrow(BlueprintSyntaxError);
  });

  test('a refusal names the line', () => {
    expect(parses('a: 1\nb: 2\nc: *x')).toThrow(/line 3/);
  });
});
