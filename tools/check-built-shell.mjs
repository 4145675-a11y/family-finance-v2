#!/usr/bin/env node
/**
 * Built-shell gate — asserts the Hebrew RTL contract on the artifact that actually ships.
 *
 * The unit tests render the layout component. This checks the prerendered HTML and the
 * compiled CSS produced by `next build`, which is what a browser receives. A component
 * can be correct while the build drops or rewrites the thing that mattered.
 *
 * Requires a completed build. Run `npm run build` first.
 *
 * Exit codes: 0 = contract holds, 1 = violation, 2 = gate could not run.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const BUILD_DIR = join(REPO_ROOT, 'apps', 'web', '.next');
const PRERENDERED_HTML = join(BUILD_DIR, 'server', 'app', 'index.html');
const CSS_DIR = join(BUILD_DIR, 'static', 'chunks');

/** @param {string} dir @returns {string[]} */
function cssFilesIn(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.css'))
    .map((name) => join(dir, name))
    .filter((path) => statSync(path).isFile());
}

function main() {
  if (!existsSync(PRERENDERED_HTML)) {
    console.error(`No build output at ${PRERENDERED_HTML}`);
    console.error('Run `npm run build` before this gate.');
    process.exitCode = 2;
    return;
  }

  const html = readFileSync(PRERENDERED_HTML, 'utf8');
  const cssFiles = cssFilesIn(CSS_DIR);
  const css = cssFiles.map((file) => readFileSync(file, 'utf8')).join('\n');

  if (cssFiles.length === 0) {
    console.error('Build produced no CSS bundle; the theme layer would be missing.');
    process.exitCode = 2;
    return;
  }

  /** @type {{name: string, ok: boolean, detail: string}[]} */
  const checks = [
    {
      name: 'html element declares Hebrew',
      ok: /<html[^>]*\slang="he"/.test(html),
      detail: 'UX-RTL-001 — the served document must declare lang="he"',
    },
    {
      name: 'html element declares right-to-left',
      ok: /<html[^>]*\sdir="rtl"/.test(html),
      detail: 'UX-RTL-001 — the served document must declare dir="rtl"',
    },
    {
      name: 'direction is declared once, at the root',
      ok: (html.match(/\sdir="rtl"/g) ?? []).length === 1,
      detail: 'a second dir="rtl" deeper in the tree means the root contract is unclear',
    },
    {
      name: 'digit runs carry their own direction',
      ok: /dir="ltr"/.test(html),
      detail: '04-DESIGN-SYSTEM.md — numbers inside Hebrew text need bidi isolation',
    },
    {
      name: 'no inline fixed pixel width in markup',
      ok: !/style="[^"]*width:\s*\d+px/.test(html),
      detail: 'a fixed width overflows the 360px viewport',
    },
    {
      name: 'horizontal overflow guard is in the stylesheet',
      ok: /overflow-x:\s*hidden/.test(css),
      detail: 'UX-RTL-001 — the document must not scroll sideways',
    },
    {
      name: 'reduced motion is honoured',
      ok: /prefers-reduced-motion/.test(css),
      detail: 'UX-A11Y-001 — motion must be disabled on request',
    },
    {
      name: 'a visible focus indicator is defined',
      ok: /focus-visible/.test(css),
      detail: 'UX-A11Y-001 — keyboard users need a visible focus ring',
    },
  ];

  console.log('Built-shell gate');
  console.log(`  html: ${PRERENDERED_HTML.replace(REPO_ROOT, '.')}`);
  console.log(`  css:  ${cssFiles.length} bundle(s)`);
  console.log('');

  for (const check of checks) {
    console.log(`  ${check.ok ? 'PASS' : 'FAIL'}  ${check.name}`);
    if (!check.ok) console.log(`        ${check.detail}`);
  }

  const failed = checks.filter((check) => !check.ok);
  console.log('');
  if (failed.length > 0) {
    console.log(`RESULT: FAIL — ${failed.length} of ${checks.length} checks failed.`);
    process.exitCode = 1;
    return;
  }
  console.log(`RESULT: PASS — all ${checks.length} checks hold on the built output.`);
}

try {
  main();
} catch (error) {
  console.error(
    'Built-shell gate failed to run:',
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 2;
}
