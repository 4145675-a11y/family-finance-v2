#!/usr/bin/env node
/**
 * Built-shell gate — asserts the Hebrew RTL contract on what a browser actually
 * receives.
 *
 * The unit tests render the layout component. This starts the production server
 * that `next build` produced, fetches pages over HTTP, and checks the HTML and
 * the compiled CSS. A component can be correct while the build drops or rewrites
 * the thing that mattered.
 *
 * It used to read a prerendered `index.html`. That file no longer exists: every
 * screen reads the household's own store and is therefore rendered per request,
 * which is the right behaviour for a financial application and which made the old
 * gate's evidence disappear. Fetching from the running server is stronger — it is
 * the same bytes a person's browser gets — at the cost of needing a build first.
 *
 * The server is bound to 127.0.0.1 and killed when the checks finish.
 *
 * Requires a completed build. Run `npm run build` first.
 *
 * Exit codes: 0 = contract holds, 1 = violation, 2 = gate could not run.
 */

import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

import { resolveNextBin, nextEnv } from './next.mjs';
import { shellFixtureDocument } from './shell-fixture.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB_ROOT = join(REPO_ROOT, 'apps', 'web');
const BUILD_DIR = join(WEB_ROOT, '.next');
const CSS_DIR = join(BUILD_DIR, 'static', 'chunks');

/** A port unlikely to collide with the developer's own `npm run dev`. */
const PORT = 3131;
const HOST = '127.0.0.1';

/** The pages fetched. Each is a route a person can reach from the navigation. */
const ROUTES = ['/', '/entry', '/upload', '/budget', '/more'];

/** @param {string} dir @returns {string[]} */
function cssFilesIn(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.css'))
    .map((name) => join(dir, name))
    .filter((path) => statSync(path).isFile());
}

/**
 * A temporary household for the server to render.
 *
 * Bidi isolation is a rule about digits, so a screen with no figures on it proves
 * nothing. The server is pointed at a throwaway data directory holding invented
 * money, which is deleted when the gate finishes. The developer's own `.data` is
 * never opened.
 *
 * @returns {string} the directory to pass as FAMILY_FINANCE_DATA_DIR
 */
function seedTemporaryHousehold() {
  const root = mkdtempSync(join(tmpdir(), 'family-finance-shell-'));
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'household.json'), shellFixtureDocument(), 'utf8');
  return root;
}

/** Starts `next start` and waits for it to answer. */
async function startServer(dataDirectory) {
  const child = spawn(
    process.execPath,
    [resolveNextBin(), 'start', '--hostname', HOST, '--port', String(PORT)],
    {
      cwd: WEB_ROOT,
      env: {
        ...nextEnv(),
        FAMILY_FINANCE_DATA_BACKEND: 'local_json',
        FAMILY_FINANCE_DATA_DIR: dataDirectory,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  let output = '';
  child.stdout.on('data', (chunk) => {
    output += String(chunk);
  });
  child.stderr.on('data', (chunk) => {
    output += String(chunk);
  });

  for (let attempt = 0; attempt < 60; attempt += 1) {
    await delay(500);
    if (child.exitCode !== null) {
      throw new Error(`the server exited before answering:\n${output}`);
    }
    try {
      const response = await fetch(`http://${HOST}:${PORT}/`, { redirect: 'manual' });
      if (response.status < 500) return child;
    } catch {
      // Not listening yet.
    }
  }

  child.kill();
  throw new Error(`the server did not answer within 30 seconds:\n${output}`);
}

async function main() {
  if (!existsSync(join(BUILD_DIR, 'BUILD_ID'))) {
    console.error(`No build output at ${BUILD_DIR}`);
    console.error('Run `npm run build` before this gate.');
    process.exitCode = 2;
    return;
  }

  const cssFiles = cssFilesIn(CSS_DIR);
  if (cssFiles.length === 0) {
    console.error('Build produced no CSS bundle; the theme layer would be missing.');
    process.exitCode = 2;
    return;
  }
  const css = cssFiles.map((file) => readFileSync(file, 'utf8')).join('\n');

  console.log('Built-shell gate');
  console.log(`  server: http://${HOST}:${PORT} (from the production build)`);
  console.log(`  css:    ${cssFiles.length} bundle(s)`);
  console.log('');

  const dataDirectory = seedTemporaryHousehold();

  let server;
  try {
    server = await startServer(dataDirectory);
  } catch (error) {
    rmSync(dataDirectory, { recursive: true, force: true });
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 2;
    return;
  }

  /** @type {Record<string, string>} */
  const pages = {};
  try {
    for (const route of ROUTES) {
      const response = await fetch(`http://${HOST}:${PORT}${route}`);
      if (!response.ok) {
        throw new Error(`${route} answered ${response.status}`);
      }
      pages[route] = await response.text();
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 2;
    return;
  } finally {
    // Killed after the fetches; the checks below run on the captured HTML.
    server.kill();
    rmSync(dataDirectory, { recursive: true, force: true });
  }

  const home = pages['/'] ?? '';
  const everyPage = Object.values(pages);

  /** @type {{name: string, ok: boolean, detail: string}[]} */
  const checks = [
    {
      name: 'html element declares Hebrew',
      ok: everyPage.every((html) => /<html[^>]*\slang="he"/.test(html)),
      detail: 'UX-RTL-001 — the served document must declare lang="he"',
    },
    {
      name: 'html element declares right-to-left',
      ok: everyPage.every((html) => /<html[^>]*\sdir="rtl"/.test(html)),
      detail: 'UX-RTL-001 — the served document must declare dir="rtl"',
    },
    {
      name: 'direction is declared once, at the root',
      ok: everyPage.every((html) => (html.match(/\sdir="rtl"/g) ?? []).length === 1),
      detail: 'a second dir="rtl" deeper in the tree means the root contract is unclear',
    },
    {
      name: 'digit runs carry their own direction',
      ok: /dir="ltr"/.test(home),
      detail: '04-DESIGN-SYSTEM.md — numbers inside Hebrew text need bidi isolation',
    },
    {
      name: 'the household the server was given actually rendered',
      ok: home.includes('בית לבדיקת תצוגה') || home.includes('₪'),
      detail: 'the gate must be checking a screen with money on it, not an empty state',
    },
    {
      name: 'money is rendered with the shekel symbol, not a currency code',
      ok: /₪/.test(home),
      detail: '04-DESIGN-SYSTEM.md — the canonical money string ends in ₪',
    },
    {
      name: 'every page offers a skip link to the content',
      ok: everyPage.every((html) => /href="#main"/.test(html)),
      detail: 'UX-A11Y-001 — a keyboard user must be able to skip the navigation',
    },
    {
      name: 'every page has a main landmark',
      ok: everyPage.every((html) => /<main[^>]*id="main"/.test(html)),
      detail: 'UX-A11Y-001 — landmarks are how a screen reader navigates',
    },
    {
      name: 'every page has exactly one h1',
      ok: everyPage.every((html) => (html.match(/<h1[\s>]/g) ?? []).length === 1),
      detail: 'a page with two top-level headings has no top-level heading',
    },
    {
      name: 'no inline fixed pixel width in markup',
      ok: everyPage.every((html) => !/style="[^"]*width:\s*\d+px/.test(html)),
      detail: 'a fixed width overflows the 360px viewport',
    },
    {
      name: 'the manifest is linked, so the app can be installed',
      ok: everyPage.every((html) => /rel="manifest"/.test(html)),
      detail: 'PWA-INSTALL-001 — an installable app links its manifest',
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

  for (const check of checks) {
    console.log(`  ${check.ok ? 'PASS' : 'FAIL'}  ${check.name}`);
    if (!check.ok) console.log(`        ${check.detail}`);
  }

  const failed = checks.filter((check) => !check.ok);
  console.log('');
  console.log(`  routes fetched: ${ROUTES.join(', ')}`);
  console.log('');

  if (failed.length > 0) {
    console.log(`RESULT: FAIL — ${failed.length} of ${checks.length} checks failed.`);
    process.exitCode = 1;
    return;
  }
  console.log(`RESULT: PASS — all ${checks.length} checks hold on the served pages.`);
}

try {
  await main();
} catch (error) {
  console.error(
    'Built-shell gate failed to run:',
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 2;
}
