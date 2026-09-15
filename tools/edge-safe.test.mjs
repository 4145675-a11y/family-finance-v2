/**
 * Regression guard for the first Render build failure.
 *
 * `apps/web/instrumentation.ts` is compiled for the Edge runtime as well as
 * for Node — always, whether or not anything runs at the edge — and the
 * production build's static analysis refuses a Node API anywhere in that
 * source:
 *
 *   apps/web/instrumentation.ts:51:5
 *   A Node.js API is used (process.exit at line 51) which is not supported in
 *   the Edge Runtime
 *   Ecmascript file had an error
 *
 * That `process.exit` sat behind `if (process.env.NEXT_RUNTIME !== 'nodejs')
 * return;` and was dead code in the Edge variant; the analysis reads the
 * source, not what runs. So the rule is about the source: the files Next
 * compiles for the edge, and everything they import statically, use no Node
 * API. Node-only work goes behind the runtime check in a dynamic import.
 *
 * `check:build` proves the same thing against the real build, with
 * NODE_ENV=production as Render sets it. This test says which line, in
 * milliseconds, before a build is attempted.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB_ROOT = join(REPO_ROOT, 'apps', 'web');

/**
 * Sources Next compiles for the Edge runtime. `proxy.ts` runs on Node in Next
 * 16, but it is the request-level refusal and must stay free of Node APIs as
 * well: it is the one file that must keep working if the runtime ever moves.
 */
const EDGE_SOURCES = ['instrumentation.ts', 'proxy.ts'];

/** `process.<method>(` — anything on `process` other than reading `env`. */
const PROCESS_API = /\bprocess\.(?!env\b)[A-Za-z_$][\w$]*/g;

/** Built-in modules that only exist in Node. */
const NODE_MODULE =
  /^(node:|fs$|path$|os$|child_process$|crypto$|net$|http$|https$|stream$|worker_threads$|module$|url$|util$|events$|buffer$|zlib$|tls$|dns$|readline$)/;

/** Strips comments so a mention in prose is not a finding. */
function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Static import specifiers of a module: `import … from '…'` and `import '…'`. */
function staticImports(source) {
  const specifiers = [];
  for (const match of source.matchAll(
    /^\s*import\s+(?:type\s+)?(?:[\s\S]*?\sfrom\s+)?['"]([^'"]+)['"]/gm,
  )) {
    specifiers.push(match[1]);
  }
  for (const match of source.matchAll(/^\s*export\s+[\s\S]*?\sfrom\s+['"]([^'"]+)['"]/gm)) {
    specifiers.push(match[1]);
  }
  return specifiers;
}

/** Resolves a relative specifier to a source file in apps/web, if it is one. */
function resolveLocal(from, specifier) {
  if (!specifier.startsWith('.')) return null;
  const base = resolve(dirname(from), specifier);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    if (existsSync(candidate) && !candidate.endsWith('.d.ts')) {
      try {
        readFileSync(candidate, 'utf8');
        return candidate;
      } catch {
        // a directory named like the specifier; keep looking
      }
    }
  }
  return null;
}

/**
 * The file and every local file it reaches through static imports. Dynamic
 * imports are not followed on purpose: behind the runtime check they are the
 * sanctioned place for Node-only code.
 */
function staticGraph(entry) {
  const seen = new Map();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    const source = withoutComments(readFileSync(file, 'utf8'));
    seen.set(file, source);
    for (const specifier of staticImports(source)) {
      const local = resolveLocal(file, specifier);
      if (local !== null) queue.push(local);
    }
  }
  return seen;
}

describe.each(EDGE_SOURCES)('%s and its static imports use no Node API', (name) => {
  const entry = join(WEB_ROOT, name);
  const graph = staticGraph(entry);

  test('the file exists and reaches at least itself', () => {
    expect(existsSync(entry)).toBe(true);
    expect(graph.size).toBeGreaterThan(0);
  });

  test.each(
    [...graph.keys()].map((file) => [file.replace(REPO_ROOT, '').split('\\').join('/')]),
  )('%s', (label) => {
    const file = join(REPO_ROOT, label);
    const source = graph.get(file) ?? '';
    const calls = [...source.matchAll(PROCESS_API)].map((m) => m[0]);
    expect(calls, `${label} uses ${calls.join(', ')}`).toEqual([]);
    const nodeModules = staticImports(source).filter((s) => NODE_MODULE.test(s));
    expect(nodeModules, `${label} imports ${nodeModules.join(', ')}`).toEqual([]);
    expect(source, `${label} uses require()`).not.toMatch(/\brequire\s*\(/);
  });
});

describe('instrumentation.ts keeps the Node-only work behind the runtime check', () => {
  const source = withoutComments(readFileSync(join(WEB_ROOT, 'instrumentation.ts'), 'utf8'));

  test('it imports nothing statically', () => {
    expect(staticImports(source)).toEqual([]);
  });

  test('the runtime check comes before the dynamic import', () => {
    const check = source.indexOf("process.env.NEXT_RUNTIME !== 'nodejs'");
    const dynamicImport = source.indexOf('await import(');
    expect(check).toBeGreaterThan(-1);
    expect(dynamicImport).toBeGreaterThan(check);
  });

  test('it never calls process.exit — the refusal is served, not exited (ADR-0034)', () => {
    expect(source).not.toMatch(/process\.exit/);
  });
});
