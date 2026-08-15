import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';

import RootLayout, { metadata, viewport } from './layout.js';
import HomePage from './page.js';

/**
 * The rendered document shell, as a string of HTML.
 *
 * Built with `createElement` rather than JSX so the test needs no JSX transform of its
 * own — the app's tsconfig sets `jsx: preserve` for Next, which the test runner cannot
 * consume. Component tests that genuinely need JSX arrive with the UI milestone.
 */
const shell = renderToStaticMarkup(createElement(RootLayout, null, createElement(HomePage)));

describe('document shell (UX-RTL-001)', () => {
  test('declares Hebrew as the document language', () => {
    expect(shell).toMatch(/<html[^>]*\slang="he"/);
  });

  test('declares right-to-left as the document direction', () => {
    expect(shell).toMatch(/<html[^>]*\sdir="rtl"/);
  });

  test('sets language and direction exactly once, on the root element', () => {
    expect(shell.match(/\slang="he"/g)).toHaveLength(1);
    expect(shell.match(/\sdir="rtl"/g)).toHaveLength(1);
  });

  test('renders the page inside the body', () => {
    expect(shell).toMatch(/<body>.*<main/s);
  });
});

describe('bidi isolation (04-DESIGN-SYSTEM.md)', () => {
  test('a run of digits inside Hebrew text carries its own direction', () => {
    expect(shell).toMatch(/dir="ltr"[^>]*>360 · 390 · 768 · 1280</);
  });
});

describe('viewport and metadata', () => {
  test('is responsive and does not block zoom', () => {
    expect(viewport.width).toBe('device-width');
    expect(viewport.initialScale).toBe(1);
    // Text scaling is an accessibility requirement; a locked viewport would break it.
    expect(viewport.maximumScale ?? Number.POSITIVE_INFINITY).toBeGreaterThanOrEqual(5);
    expect(viewport.userScalable ?? true).not.toBe(false);
  });

  test('carries a Hebrew title', () => {
    expect(metadata.title).toBe('מרכז השליטה הכלכלי המשפחתי');
  });
});

describe('shell content boundaries (Milestone 1 scope)', () => {
  const text = shell.replace(/<[^>]+>/g, ' ');

  test('states plainly that no financial data exists yet', () => {
    expect(text).toMatch(/עדיין אין כאן נתונים פיננסיים/);
  });

  test('shows no currency figure that could be mistaken for real data', () => {
    expect(text).not.toMatch(/₪|ILS/);
  });

  test('uses a single main landmark and one first-level heading', () => {
    expect(shell.match(/<main/g)).toHaveLength(1);
    expect(shell.match(/<h1/g)).toHaveLength(1);
  });

  test('every section landmark has an accessible name', () => {
    const sections = [...shell.matchAll(/<section[^>]*>/g)].map((match) => match[0]);
    expect(sections.length).toBeGreaterThan(0);
    for (const section of sections) {
      expect(section).toMatch(/aria-labelledby=|aria-label=/);
    }
  });
});

describe('layout does not fix widths that would overflow a 360px viewport', () => {
  test('the main container is fluid and capped, not fixed', () => {
    expect(shell).toMatch(/<main[^>]*class="[^"]*\bw-full\b/);
    expect(shell).toMatch(/<main[^>]*class="[^"]*\bmax-w-/);
  });

  test('no inline pixel width is hard-coded into the markup', () => {
    expect(shell).not.toMatch(/style="[^"]*width:\s*\d+px/);
  });
});
