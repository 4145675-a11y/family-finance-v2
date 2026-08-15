#!/usr/bin/env node
/**
 * Forbidden-artifact scan — enforces the "No False Completion" rule from CLAUDE.md
 * and the global gate in 08-TEST-PLAN.md as an executable check.
 *
 * Zero dependencies (Node built-ins only) so it runs at Milestone 0, before any
 * toolchain is installed, and in CI on a clean checkout.
 *
 * Scope decisions (also documented in docs/COMMANDS.md):
 *  - Only source/code files are scanned. Markdown governance documents are excluded,
 *    because they must be able to name the forbidden patterns in order to forbid them.
 *  - This module and its test file are excluded from scanning: a rule table cannot
 *    avoid containing the very literals it searches for. The resulting blind spot is
 *    closed by tools/forbidden-scan.test.mjs, which asserts that every rule fires on a
 *    positive fixture and stays silent on a clean one. Run it with `npm run unit`.
 *  - There is no per-line suppression mechanism. Adding one requires an ADR.
 *
 * Exit codes: 0 = no error-severity findings, 1 = findings, 2 = scanner failure.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Directories that are scanned when present. */
const SCAN_ROOTS = ['apps', 'packages', 'tools', 'supabase', 'scripts', '.github'];

/** Directory names never scanned, at any depth. */
const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'out',
  'coverage',
  'playwright-report',
  'test-results',
  '.vitest',
  '.turbo',
  '.npm-cache',
]);

/** Repo-relative paths holding the rule table itself. See header note. */
const SELF_EXCLUDED = new Set(['tools/forbidden-scan.mjs', 'tools/forbidden-scan.test.mjs']);

const SCANNED_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.sql',
  '.css',
  '.yml',
  '.yaml',
]);

/** Path fragments that mark a file as test/fixture code rather than a production path. */
const NON_PRODUCTION_MARKERS = [
  '.test.',
  '.spec.',
  '/__tests__/',
  '/__mocks__/',
  '/tests/',
  '/e2e/',
  '/fixtures/',
  '/factories/',
];

/**
 * @typedef {{id: string, severity: 'error'|'warn', productionOnly: boolean,
 *            pattern: RegExp, why: string}} Rule
 */

/** @type {Rule[]} */
export const RULES = [
  {
    id: 'functional-todo',
    severity: 'error',
    productionOnly: false,
    pattern: /\b(TODO|FIXME|XXX|HACK)\b/i,
    why: 'Unfinished work marker. A milestone cannot PASS with functional gaps left in code.',
  },
  {
    id: 'mock-in-production-path',
    severity: 'error',
    productionOnly: true,
    pattern: /\b(mock|mocks|mocked|mocking|stub|stubs|stubbed|fake|fakes|faked|dummy)\b/i,
    why: 'Test double in a production path. Allowed only behind an adapter, in test/dev, with the feature flag off in production and fail-closed behaviour.',
  },
  {
    id: 'disabled-test',
    severity: 'error',
    productionOnly: false,
    pattern:
      /\b(?:describe|it|test|context)\.(?:skip|only|todo|failing)\b|\bx(?:describe|it|test)\s*\(|\bf(?:describe|it|test)\s*\(/,
    why: 'Skipped, focused or pending test. A gate that contains disabled tests is not a gate.',
  },
  {
    id: 'type-check-suppressed',
    severity: 'error',
    productionOnly: false,
    pattern: /@ts-ignore|@ts-nocheck/,
    why: 'Type checking suppressed. Requires an approved ADR; narrow the type instead.',
  },
  {
    id: 'lint-disabled',
    severity: 'error',
    productionOnly: false,
    pattern: /eslint-disable/,
    why: 'Lint rule disabled in source. Fix the code, or change the rule set deliberately.',
  },
  {
    id: 'empty-catch',
    severity: 'error',
    productionOnly: false,
    pattern: /catch\s*(\([^)]*\))?\s*\{\s*\}/,
    why: 'Swallowed error. Financial failures must surface, never disappear silently.',
  },
  {
    id: 'tautological-assertion',
    severity: 'error',
    productionOnly: false,
    pattern:
      /expect\s*\(\s*(?:true|1)\s*\)\s*\.\s*to(?:Be|Equal|BeTruthy)\s*\(\s*(?:true|1)?\s*\)|assert\s*\(\s*true\s*\)/,
    why: 'Assertion passes regardless of the behaviour under test.',
  },
  {
    id: 'private-key-material',
    severity: 'error',
    productionOnly: false,
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/,
    why: 'Private key material committed to the repository.',
  },
  {
    id: 'inline-secret-assignment',
    severity: 'error',
    productionOnly: false,
    pattern:
      /\b(?:SERVICE_ROLE_KEY|SUPABASE_SERVICE_ROLE|ANTHROPIC_API_KEY|OPENAI_API_KEY|SECRET_KEY|ACCESS_TOKEN)\b\s*[:=]\s*['"][^'"\s$][^'"]{7,}['"]/,
    why: 'Secret value assigned inline. Secrets belong in the secret manager, never in source.',
  },
  {
    id: 'production-seed',
    severity: 'error',
    productionOnly: true,
    pattern: /\bseedProduction\b|\bproduction_seed\b|\bseed_production\b/,
    why: 'Production seeding is forbidden; seeds and fixtures are anonymised and test-only.',
  },
];

/** @param {string} relPath */
export function isProductionPath(relPath) {
  const normalised = relPath.split(sep).join('/');
  return !NON_PRODUCTION_MARKERS.some((marker) => normalised.includes(marker));
}

/**
 * Inserts a space at camelCase / PascalCase boundaries so that word-boundary rules
 * also catch identifiers such as `createMockClient` or `FakeRepository`.
 * @param {string} line
 */
export function camelSplit(line) {
  return line.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
}

/**
 * Applies every rule to a single line of source. Each rule is tested against the raw
 * line and against its camel-split form; either match counts.
 * @param {string} line
 * @param {boolean} production
 * @returns {Rule[]} rules that matched
 */
export function findViolations(line, production) {
  const variants = [line, camelSplit(line)];
  return RULES.filter((rule) => {
    if (rule.productionOnly && !production) return false;
    return variants.some((variant) => rule.pattern.test(variant));
  });
}

/** @returns {string[]} absolute paths of files to scan */
function collectFiles() {
  /** @type {string[]} */
  const files = [];

  /** @param {string} dir */
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) continue;
        walk(join(dir, entry.name));
        continue;
      }
      if (entry.isFile() && SCANNED_EXTENSIONS.has(extname(entry.name))) {
        files.push(join(dir, entry.name));
      }
    }
  }

  for (const root of SCAN_ROOTS) {
    const abs = join(REPO_ROOT, root);
    if (existsSync(abs) && statSync(abs).isDirectory()) walk(abs);
  }

  // Root-level code files (config files live here before the workspaces exist).
  for (const entry of readdirSync(REPO_ROOT, { withFileTypes: true })) {
    if (entry.isFile() && SCANNED_EXTENSIONS.has(extname(entry.name))) {
      files.push(join(REPO_ROOT, entry.name));
    }
  }

  return files.sort();
}

function main() {
  const scanned = [];
  /** @type {{file: string, line: number, rule: Rule, text: string}[]} */
  const findings = [];

  for (const absPath of collectFiles()) {
    const relPath = relative(REPO_ROOT, absPath).split(sep).join('/');
    if (SELF_EXCLUDED.has(relPath)) continue;
    scanned.push(relPath);

    const production = isProductionPath(relPath);
    readFileSync(absPath, 'utf8')
      .split(/\r?\n/)
      .forEach((text, index) => {
        for (const rule of findViolations(text, production)) {
          findings.push({
            file: relPath,
            line: index + 1,
            rule,
            text: text.trim().slice(0, 160),
          });
        }
      });
  }

  const errors = findings.filter((f) => f.rule.severity === 'error');
  const warnings = findings.filter((f) => f.rule.severity === 'warn');

  console.log('Forbidden-artifact scan');
  console.log(`  roots:    ${SCAN_ROOTS.join(', ')}`);
  console.log(`  files:    ${scanned.length} scanned`);
  console.log(`  rules:    ${RULES.length} active`);
  console.log(
    `  excluded: ${[...SELF_EXCLUDED].join(', ')} (rule table; covered by unit tests)`,
  );

  for (const finding of [...errors, ...warnings]) {
    console.log(
      `\n${finding.rule.severity.toUpperCase()} ${finding.rule.id}  ${finding.file}:${finding.line}`,
    );
    console.log(`  ${finding.text}`);
    console.log(`  why: ${finding.rule.why}`);
  }

  console.log(`\n  errors:   ${errors.length}`);
  console.log(`  warnings: ${warnings.length}`);

  if (errors.length > 0) {
    console.log('\nRESULT: FAIL — forbidden artifacts present.');
    process.exitCode = 1;
    return;
  }
  console.log('\nRESULT: PASS — no forbidden artifacts found in scanned scope.');
}

// Run only when executed directly; the test suite imports the rules instead.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error('Forbidden-artifact scan failed to run:', error);
    process.exitCode = 2;
  }
}
