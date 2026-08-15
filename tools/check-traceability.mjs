#!/usr/bin/env node
/**
 * Traceability gate — keeps requirement IDs, the requirement registry and the
 * traceability matrix from drifting apart.
 *
 * Zero dependencies (Node built-ins only).
 *
 * Enforced invariants:
 *  1. Every requirement ID that appears in an authority document is registered
 *     in docs/REQUIREMENTS.md.
 *  2. Every registered ID has a row in 10-TRACEABILITY-MATRIX.md.
 *  3. Every ID in the matrix is registered (no mapping to an unknown requirement).
 *  4. Every registry row cites a source document that exists.
 *
 * Exit codes: 0 = consistent, 1 = violations found, 2 = gate failure.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

const AUTHORITY_DOCS = [
  '01-PRODUCT-SPEC.md',
  '02-FINANCIAL-RULES.md',
  '03-UX-SPEC.md',
  '04-DESIGN-SYSTEM.md',
  '05-ARCHITECTURE-DATA.md',
  '07-SECURITY-PRIVACY.md',
  '08-TEST-PLAN.md',
  '09-MILESTONES.md',
  '11-OPERATIONS.md',
];

const REGISTRY = join('docs', 'REQUIREMENTS.md');
const MATRIX = '10-TRACEABILITY-MATRIX.md';

const ID_PATTERN = /\b[A-Z]{2,5}-[A-Z0-9]{2,12}-\d{3}\b/g;

/** @param {string} relPath */
function read(relPath) {
  const abs = join(REPO_ROOT, relPath);
  if (!existsSync(abs)) throw new Error(`required document is missing: ${relPath}`);
  return readFileSync(abs, 'utf8');
}

/** @param {string} text @returns {Set<string>} */
function idsIn(text) {
  return new Set(text.match(ID_PATTERN) ?? []);
}

/**
 * Registry rows look like: | `ID` | statement | source | owner milestone | status |
 * @param {string} text
 * @returns {{id: string, source: string}[]}
 */
function parseRegistryRows(text) {
  /** @type {{id: string, source: string}[]} */
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    const idCell = cells[1] ?? '';
    const match = idCell.match(/\b[A-Z]{2,5}-[A-Z0-9]{2,12}-\d{3}\b/);
    if (!match) continue;
    rows.push({ id: match[0], source: cells[3] ?? '' });
  }
  return rows;
}

/** @param {string[]} items */
function list(items) {
  return items.length === 0 ? '(none)' : items.sort().join(', ');
}

function main() {
  const registryText = read(REGISTRY);
  const matrixText = read(MATRIX);

  const registryRows = parseRegistryRows(registryText);
  const registered = new Set(registryRows.map((r) => r.id));
  const mapped = idsIn(matrixText);

  /** @type {{doc: string, ids: Set<string>}[]} */
  const perDoc = AUTHORITY_DOCS.map((doc) => ({ doc, ids: idsIn(read(doc)) }));
  const sourceIds = new Set(perDoc.flatMap((d) => [...d.ids]));

  /** @type {string[]} */
  const violations = [];

  const unregistered = [...sourceIds].filter((id) => !registered.has(id));
  if (unregistered.length > 0) {
    violations.push(
      `IDs used in authority documents but absent from ${REGISTRY}: ${list(unregistered)}`,
    );
  }

  const unmapped = [...registered].filter((id) => !mapped.has(id));
  if (unmapped.length > 0) {
    violations.push(`Registered IDs with no row in ${MATRIX}: ${list(unmapped)}`);
  }

  const orphanMappings = [...mapped].filter((id) => !registered.has(id));
  if (orphanMappings.length > 0) {
    violations.push(
      `IDs mapped in ${MATRIX} but not registered in ${REGISTRY}: ${list(orphanMappings)}`,
    );
  }

  const badSources = registryRows.filter((row) => {
    const cited = row.source.match(/\d{2}-[A-Z-]+\.md/);
    return cited !== null && !existsSync(join(REPO_ROOT, cited[0]));
  });
  if (badSources.length > 0) {
    violations.push(
      `Registry rows citing a missing document: ${list(badSources.map((r) => r.id))}`,
    );
  }

  console.log('Traceability gate');
  console.log(`  registry:  ${registered.size} requirement(s) in ${REGISTRY}`);
  console.log(`  matrix:    ${mapped.size} mapped ID(s) in ${MATRIX}`);
  console.log(`  documents: ${AUTHORITY_DOCS.length} authority document(s) scanned`);
  for (const { doc, ids } of perDoc) {
    console.log(`    ${doc}: ${ids.size} labelled requirement(s)`);
  }

  if (violations.length > 0) {
    console.log('');
    for (const violation of violations) console.log(`  VIOLATION: ${violation}`);
    console.log('\nRESULT: FAIL — requirement traceability is inconsistent.');
    process.exitCode = 1;
    return;
  }

  console.log('\nRESULT: PASS — registry, matrix and authority documents agree.');
}

try {
  main();
} catch (error) {
  console.error(
    'Traceability gate failed to run:',
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 2;
}
