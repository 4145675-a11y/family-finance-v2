#!/usr/bin/env node
/**
 * Client-secret boundary gate.
 *
 * 07-SECURITY-PRIVACY.md: "service role לעולם לא בבנדל". This checks the rule two
 * ways, because either alone can be fooled:
 *
 *  1. Source analysis — no client-reachable module may name a secret variable.
 *     A module is client-reachable unless it imports 'server-only' or lives in a
 *     server-only location.
 *  2. Build-output analysis — no secret-shaped string may appear in the compiled
 *     browser bundle. This catches a value that arrived by a path the source
 *     scan cannot see, such as inlining through a differently named variable.
 *
 * Build-output analysis is skipped only when there is no build to inspect, and
 * that case is reported explicitly rather than counted as a pass.
 *
 * Zero dependencies. Exit codes: 0 = boundary holds, 1 = violation, 2 = gate failure.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB_APP = join(REPO_ROOT, 'apps', 'web');
const BUILD_STATIC = join(WEB_APP, '.next', 'static');

/** Identifiers that must never be reachable from the browser. */
const SECRET_IDENTIFIERS = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SERVICE_ROLE',
  'SUPABASE_SECRET_KEY',
  'SERVICE_ROLE_KEY',
  'SUPABASE_DB_URL',
  'DATABASE_URL',
  'SUPABASE_ACCESS_TOKEN',
  'SUPABASE_JWT_SECRET',
];

/** Value shapes that identify a real credential inside a bundle. */
const SECRET_VALUE_PATTERNS = [
  { name: 'Supabase secret key', pattern: /\bsb_secret_[A-Za-z0-9_-]{10,}/ },
  {
    name: 'service-role JWT',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  },
  { name: 'postgres connection string', pattern: /\bpostgres(?:ql)?:\/\/[^\s"'`]+:[^\s"'`]+@/ },
];

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.next',
  'dist',
  'build',
  'coverage',
  '.npm-cache',
]);

/** Directories whose contents never ship to the browser. */
const SERVER_ONLY_DIRS = ['lib/server/', 'app/api/'];

/** @param {string} dir @param {(abs: string) => void} visit */
function walk(dir, visit) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      walk(join(dir, entry.name), visit);
      continue;
    }
    if (entry.isFile()) visit(join(dir, entry.name));
  }
}

/**
 * A module is treated as server-only when it imports the `server-only` marker,
 * or lives in a directory that never reaches the client.
 * @param {string} relPath @param {string} contents
 */
function isServerOnly(relPath, contents) {
  const normalised = relPath.split(sep).join('/');
  if (SERVER_ONLY_DIRS.some((dir) => normalised.includes(dir))) return true;
  return /(^|\n)\s*import\s+['"]server-only['"]/.test(contents);
}

/** @param {string} relPath */
function isTestFile(relPath) {
  const normalised = relPath.split(sep).join('/');
  return /\.test\.|\.spec\.|\/tests\//.test(normalised);
}

function scanSources() {
  /** @type {{file: string, line: number, identifier: string}[]} */
  const findings = [];
  let scanned = 0;

  walk(WEB_APP, (abs) => {
    if (!SOURCE_EXTENSIONS.has(extname(abs))) return;
    const relPath = relative(REPO_ROOT, abs);
    const contents = readFileSync(abs, 'utf8');

    if (isServerOnly(relPath, contents) || isTestFile(relPath)) return;
    scanned += 1;

    contents.split(/\r?\n/).forEach((line, index) => {
      for (const identifier of SECRET_IDENTIFIERS) {
        if (line.includes(identifier)) {
          findings.push({ file: relPath.split(sep).join('/'), line: index + 1, identifier });
        }
      }
    });
  });

  return { findings, scanned };
}

function scanBuildOutput() {
  if (!existsSync(BUILD_STATIC)) {
    return { available: false, findings: [], scanned: 0 };
  }

  /** @type {{file: string, name: string}[]} */
  const findings = [];
  let scanned = 0;

  walk(BUILD_STATIC, (abs) => {
    if (!['.js', '.mjs', '.css', '.json'].includes(extname(abs))) return;
    if (!statSync(abs).isFile()) return;
    scanned += 1;
    const contents = readFileSync(abs, 'utf8');
    for (const { name, pattern } of SECRET_VALUE_PATTERNS) {
      if (pattern.test(contents)) {
        findings.push({ file: relative(REPO_ROOT, abs).split(sep).join('/'), name });
      }
    }
  });

  return { available: true, findings, scanned };
}

function main() {
  const sources = scanSources();
  const build = scanBuildOutput();

  console.log('Client-secret boundary gate');
  console.log(`  client-reachable modules scanned: ${sources.scanned}`);
  console.log(`  secret identifiers checked:       ${SECRET_IDENTIFIERS.length}`);
  console.log(
    build.available
      ? `  browser bundle files scanned:     ${build.scanned}`
      : '  browser bundle:                   NOT BUILT (run `npm run build` to include this check)',
  );

  for (const finding of sources.findings) {
    console.log(`\nFAIL secret-identifier-in-client  ${finding.file}:${finding.line}`);
    console.log(`  references ${finding.identifier}`);
    console.log('  why: this module can reach the browser. Move it behind an import of');
    console.log("       'server-only', or into lib/server/.");
  }

  for (const finding of build.findings) {
    console.log(`\nFAIL secret-value-in-bundle  ${finding.file}`);
    console.log(`  a ${finding.name} appears in the compiled browser bundle`);
  }

  const total = sources.findings.length + build.findings.length;
  console.log('');

  if (total > 0) {
    console.log(`RESULT: FAIL — ${total} boundary violation(s).`);
    process.exitCode = 1;
    return;
  }

  if (!build.available) {
    console.log('RESULT: PASS (source only) — bundle not inspected because it is not built.');
    return;
  }

  console.log('RESULT: PASS — no secret reachable from the browser, in source or bundle.');
}

try {
  main();
} catch (error) {
  console.error(
    'Client-secret boundary gate failed to run:',
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 2;
}
