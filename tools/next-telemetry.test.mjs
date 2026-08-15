/**
 * Regression guard for framework telemetry (ADR-0011).
 *
 * Telemetry must stay off for every Next invocation the project owns — locally on any
 * platform and in CI. The failure mode this prevents is quiet: someone adds
 * `"start": "next start"` to a package.json, it works fine, and the block is gone with
 * nothing to notice.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import { nextEnv, resolveNextBin, TELEMETRY_ENV_VAR } from './next.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const LAUNCHER = 'tools/next.mjs';

/** Every package.json in the repository that the project itself owns. */
function projectPackageJsonPaths() {
  const paths = [join(REPO_ROOT, 'package.json')];
  for (const group of ['apps', 'packages']) {
    const groupDir = join(REPO_ROOT, group);
    if (!existsSync(groupDir)) continue;
    for (const entry of readdirSync(groupDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = join(groupDir, entry.name, 'package.json');
      if (existsSync(candidate)) paths.push(candidate);
    }
  }
  return paths;
}

/** @returns {{file: string, name: string, command: string}[]} */
function allScripts() {
  return projectPackageJsonPaths().flatMap((path) => {
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    return Object.entries(manifest.scripts ?? {}).map(([name, command]) => ({
      file: path.replace(REPO_ROOT, '').split('\\').join('/'),
      name,
      command,
    }));
  });
}

describe('the launcher forces telemetry off', () => {
  test('sets the variable to "1"', () => {
    expect(nextEnv({})[TELEMETRY_ENV_VAR]).toBe('1');
  });

  test('overrides an inherited value that would re-enable telemetry', () => {
    expect(nextEnv({ [TELEMETRY_ENV_VAR]: '0' })[TELEMETRY_ENV_VAR]).toBe('1');
    expect(nextEnv({ [TELEMETRY_ENV_VAR]: '' })[TELEMETRY_ENV_VAR]).toBe('1');
  });

  test('preserves the rest of the environment', () => {
    const result = nextEnv({ PATH: '/usr/bin', CUSTOM: 'value' });
    expect(result.PATH).toBe('/usr/bin');
    expect(result.CUSTOM).toBe('value');
  });

  test('resolves the Next CLI that it will spawn', () => {
    const bin = resolveNextBin();
    expect(bin).toMatch(/next[\\/]dist[\\/]bin[\\/]next$/);
    expect(existsSync(bin)).toBe(true);
  });
});

describe('no project script may invoke Next directly', () => {
  const scripts = allScripts();

  test('the repository actually defines scripts to check', () => {
    expect(scripts.length).toBeGreaterThan(0);
  });

  test.each(scripts.map((script) => [`${script.file} → ${script.name}`, script]))(
    '%s',
    (_label, script) => {
      // Matches `next build`, `npx next dev`, `./node_modules/.bin/next start`,
      // but not `npm run build --workspace ...` and not the launcher itself.
      const invokesNextDirectly =
        /(^|[\s/\\])next\s+(dev|build|start|lint|telemetry)\b/.test(script.command) &&
        !script.command.includes(LAUNCHER);

      expect(
        invokesNextDirectly,
        `"${script.name}": "${script.command}" runs Next without the telemetry block. Route it through ${LAUNCHER}.`,
      ).toBe(false);
    },
  );

  test('the Next commands that exist are routed through the launcher', () => {
    const routed = scripts.filter((script) => script.command.includes(LAUNCHER));
    const routedNames = routed.map((script) => script.name).sort();
    expect(routedNames).toEqual(['build', 'dev', 'start']);
  });

  test('no script calls `next telemetry`, which writes outside the project', () => {
    for (const script of scripts) {
      expect(script.command).not.toMatch(/next\s+telemetry/);
    }
  });
});

describe('CI also sets the variable', () => {
  const workflow = readFileSync(join(REPO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');

  test('declares the telemetry variable', () => {
    expect(workflow).toMatch(new RegExp(`${TELEMETRY_ENV_VAR}:\\s*'1'`));
  });
});
