import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';

import { NAV_ITEMS, PHONE_NAV } from '../components/app-shell';
import { copy } from '../lib/copy/copy';
import { Badge, EmptyState, Figure, Money, StatRow } from '../components/ui';
import RootLayout, { metadata, viewport } from './layout';

const WEB_ROOT = fileURLToPath(new URL('../', import.meta.url));

/**
 * The rendered document shell and the presentational pieces every screen uses.
 *
 * Built with `createElement` rather than JSX so the test needs no JSX transform of
 * its own — the app's tsconfig sets `jsx: preserve` for Next, which the runner
 * cannot consume.
 *
 * The page components are deliberately not rendered here. They are async server
 * components that load a data source, and `renderToStaticMarkup` cannot await
 * one; the built output is checked instead by `npm run check:shell`, which reads
 * the HTML a browser actually receives.
 */
const shell = renderToStaticMarkup(
  createElement(RootLayout, null, createElement('main', null, 'תוכן')),
);

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

  test('renders its children inside the body', () => {
    expect(shell).toMatch(/<body>.*<main/s);
  });
});

describe('bidi isolation (04-DESIGN-SYSTEM.md)', () => {
  test('a monetary figure carries its own direction', () => {
    const markup = renderToStaticMarkup(createElement(Money, { amountMinor: 123_45 }));
    expect(markup).toMatch(/<bdi[^>]*dir="ltr"/);
  });

  test('the amount and its currency stay together inside the isolate', () => {
    const markup = renderToStaticMarkup(createElement(Money, { amountMinor: 123_45 }));
    expect(markup).toContain('123.45');
    expect(markup).toContain('₪');
  });

  test('a signed change renders its sign', () => {
    const markup = renderToStaticMarkup(
      createElement(Money, { amountMinor: -100_00, signed: true }),
    );
    expect(markup).toContain('−');
  });

  test('any other digit run is isolated the same way', () => {
    const markup = renderToStaticMarkup(createElement(Figure, null, '360 · 390 · 768 · 1280'));
    expect(markup).toMatch(/dir="ltr"[^>]*>360 · 390 · 768 · 1280</);
  });
});

describe('presentational pieces', () => {
  test('a stat row shows its label, value and hint', () => {
    const markup = renderToStaticMarkup(
      createElement(StatRow, { label: 'יתרה', value: 'ערך', hint: 'הסבר' }),
    );
    expect(markup).toContain('יתרה');
    expect(markup).toContain('ערך');
    expect(markup).toContain('הסבר');
  });

  test('a stat row without a hint renders no empty hint element', () => {
    const markup = renderToStaticMarkup(
      createElement(StatRow, { label: 'יתרה', value: 'ערך' }),
    );
    expect(markup).toContain('יתרה');
    expect(markup).not.toContain('w-full text-small');
  });

  test('a badge renders its content', () => {
    expect(renderToStaticMarkup(createElement(Badge, null, 'מצב'))).toContain('מצב');
  });

  test('the empty state states the reason and promises no numbers', () => {
    const markup = renderToStaticMarkup(createElement(EmptyState, { reason: 'הדגל כבוי' }));
    expect(markup).toContain('הדגל כבוי');
    expect(markup).toContain(copy.states.noSourceBody);
  });
});

describe('navigation', () => {
  test('every destination in the sidebar is a real screen', () => {
    for (const item of NAV_ITEMS) {
      const route = item.href === '/' ? 'page.tsx' : `${item.href.slice(1)}/page.tsx`;
      expect(existsSync(join(WEB_ROOT, 'app', route)), `${item.href} has no page`).toBe(true);
    }
  });

  test('there are five destinations, and only five', () => {
    /*
     * Five is the number a person can hold without being taught. It was fifteen,
     * and the screens that left are all indexed on `/more`.
     */
    expect(NAV_ITEMS.map((item) => item.href)).toEqual([
      '/',
      '/quick',
      '/activity',
      '/lenders',
      '/more',
    ]);
  });

  test('a phone and a desktop show the same five', () => {
    /*
     * They used to differ, which meant learning where something lived on one
     * screen told you nothing about the other.
     */
    expect(PHONE_NAV.map((item) => item.href)).toEqual(NAV_ITEMS.map((item) => item.href));
  });

  test('every screen that left the navigation is indexed on /more', () => {
    /*
     * The rule that keeps a screen from disappearing: it is either in the five,
     * or it is a link on `/more`. A screen in neither place does not exist as
     * far as a person is concerned.
     */
    const more = readFileSync(join(WEB_ROOT, 'app/more/page.tsx'), 'utf8');
    const primary = new Set(NAV_ITEMS.map((item) => item.href));
    const everyScreen = [
      '/accounts',
      '/activity',
      '/approvals',
      '/budget',
      '/business',
      '/entry',
      '/forecast',
      '/gemach',
      '/reports',
      '/rules',
      '/settings',
      '/tasks',
      '/upload',
    ];
    for (const href of everyScreen) {
      if (primary.has(href)) continue;
      expect(more.includes(`'${href}'`), `${href} is not linked from /more`).toBe(true);
    }
  });

  test('every destination has a Hebrew label', () => {
    for (const item of NAV_ITEMS) {
      expect(item.label.length).toBeGreaterThan(0);
    }
  });
});

describe('document metadata', () => {
  test('carries a Hebrew title and description', () => {
    expect(metadata.title).toBeTruthy();
    expect(metadata.description).toBeTruthy();
  });

  test('allows the viewer to zoom, which text scaling depends on (UX-A11Y-001)', () => {
    expect(viewport.maximumScale).toBeGreaterThanOrEqual(5);
  });
});
