import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import { NAV_ITEMS } from '../components/app-shell';

/**
 * Structural rules about the screens themselves.
 *
 * These are read off the source rather than a rendered tree, because the pages are
 * async server components that load a data source and `renderToStaticMarkup`
 * cannot await one. What they check is not styling — it is the two things that
 * would quietly undo this milestone: a screen doing its own arithmetic, and a
 * screen showing numbers when it has no data.
 */

const APP_ROOT = fileURLToPath(new URL('./', import.meta.url));

function pageFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      pageFiles(full, acc);
      continue;
    }
    if (entry === 'page.tsx') acc.push(full);
  }
  return acc;
}

const pages = pageFiles(APP_ROOT).map((file) =>
  file.slice(APP_ROOT.length).split('\\').join('/'),
);

const read = (page: string) => readFileSync(join(APP_ROOT, page), 'utf8');

/** Screens that read financial data, as opposed to the honest placeholders. */
const DATA_PAGES = pages.filter((page) => read(page).includes('loadDashboardView'));

describe('the routes that exist', () => {
  test('every navigation destination has a page', () => {
    for (const item of NAV_ITEMS) {
      const expected = item.href === '/' ? 'page.tsx' : `${item.href.slice(1)}/page.tsx`;
      expect(pages, `${item.href} is in the navigation with no page behind it`).toContain(
        expected,
      );
    }
  });

  test('navigation is the five destinations 03-UX-SPEC.md names', () => {
    expect(NAV_ITEMS.map((item) => item.label)).toEqual([
      'בית',
      'אישורים',
      'תנועה',
      'תכנון',
      'עוד',
    ]);
  });

  test('the destinations that are not built yet say so rather than showing figures', () => {
    for (const item of NAV_ITEMS.filter((entry) => !entry.ready)) {
      const source = read(`${item.href.slice(1)}/page.tsx`);
      expect(source).toContain('ComingSoon');
      expect(source, `${item.href} must not read financial data yet`).not.toContain(
        'loadDashboardView',
      );
    }
  });

  test('the detail screens are still reachable', () => {
    for (const route of ['forecast/page.tsx', 'debts/page.tsx', 'business/page.tsx']) {
      expect(pages).toContain(route);
    }
  });
});

describe('screens do not calculate', () => {
  test.each(DATA_PAGES)('%s contains no money arithmetic of its own', (page) => {
    const source = read(page);
    // Converting minor units, applying a rate or averaging inside a component is
    // how a screen and the engine start disagreeing about what a number means.
    expect(source, `${page} converts minor units itself`).not.toMatch(/\/\s*100\b/);
    expect(source, `${page} scales an amount itself`).not.toMatch(/Minor\s*\*\s*\d/);
    expect(source, `${page} divides an amount itself`).not.toMatch(/Minor\s*\/\s*\d/);
  });

  test.each(DATA_PAGES)('%s takes its figures from the one loader', (page) => {
    const source = read(page);
    expect(source).toContain('loadDashboardView');
    expect(source, `${page} builds its own snapshot`).not.toContain('buildFinancialSnapshot');
    expect(source, `${page} runs the budget engine itself`).not.toContain('calculateBudget(');
    expect(source, `${page} runs the food engine itself`).not.toContain('calculateFoodWeek(');
  });

  test.each(DATA_PAGES)('%s never formats money without isolating it', (page) => {
    const source = read(page);
    // `formatMoney` returns a bare string; `<Money>` wraps it in a bdi element.
    expect(source, `${page} should render amounts through <Money>`).not.toContain(
      'formatMoney(',
    );
  });
});

describe('screens fail closed', () => {
  test.each(DATA_PAGES)('%s renders an empty state when there is no data', (page) => {
    const source = read(page);
    expect(source).toContain('EmptyState');
    expect(source, `${page} must branch on a missing source`).toMatch(/=== null/);
  });

  test.each(DATA_PAGES)('%s shows the demo banner whenever data is not real', (page) => {
    expect(read(page)).toContain('descriptor.isRealData');
  });
});

describe('the home screen keeps its hierarchy', () => {
  const home = read('page.tsx');

  test('the dominant answer comes before the four cards', () => {
    expect(home.indexOf('copy.home.safeTitle')).toBeLessThan(
      home.indexOf('copy.home.debtTitle'),
    );
  });

  test('the one action comes before the four cards', () => {
    expect(home.indexOf('copy.home.actionTitle')).toBeLessThan(
      home.indexOf('copy.home.debtTitle'),
    );
  });

  test('the four daily cards are debts, food, month end and business', () => {
    const order = [
      'copy.home.debtTitle',
      'copy.food.title',
      'copy.home.monthEndTitle',
      'copy.home.businessTitle',
    ];
    const positions = order.map((key) => home.indexOf(key));
    expect(positions.every((position) => position > 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  test('quick updates come after the cards', () => {
    expect(home.indexOf('copy.home.updatesTitle')).toBeGreaterThan(
      home.indexOf('copy.home.businessTitle'),
    );
  });

  test('the deeper detail is last, and collapsed', () => {
    expect(home.indexOf('copy.home.moreTitle')).toBeGreaterThan(
      home.indexOf('copy.home.updatesTitle'),
    );
    expect(home).toContain('Disclosure');
  });

  test('exactly one hero is rendered', () => {
    expect((home.match(/<Hero\b/g) ?? []).length).toBe(1);
  });

  test('the full monthly budget is not on the home screen', () => {
    // The budget belongs to its own screen; only the weekly food figure appears here.
    expect(home).not.toContain('budget.lines');
    expect(home).toContain('copy.food.title');
  });

  test('actions that cannot yet save are disabled and say why', () => {
    expect(home).toContain('disabled');
    expect(home).toContain('copy.states.devOnly');
  });
});

describe('the budget screen', () => {
  const budget = read('budget/page.tsx');

  test('shows planned, spent, pending, committed and remaining apart', () => {
    for (const key of [
      'copy.budget.planned',
      'copy.budget.spent',
      'copy.budget.pending',
      'copy.budget.committed',
      'copy.budget.remaining',
    ]) {
      expect(budget).toContain(key);
    }
  });

  test('shows a projection for the end of the month', () => {
    expect(budget).toContain('copy.budget.projected');
  });

  test('explains that a transfer keeps the total unchanged and needs approval', () => {
    expect(budget).toContain('copy.budget.transferKeepsTotal');
    expect(budget).toContain('copy.budget.transferNeedsApproval');
  });

  test('carries the weekly food figure in full', () => {
    expect(budget).toContain('copy.food.remaining');
    expect(budget).toContain('copy.food.projection');
  });
});
