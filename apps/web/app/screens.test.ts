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

  test('the four daily cards are food, debts, month end and business, in that order', () => {
    // Food leads: it is the figure a family steers week by week, and the one they
    // open the app for on most days.
    const order = [
      'copy.food.title',
      'copy.home.debtTitle',
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

  test('actions that cannot yet save are shown as planned, not as broken buttons', () => {
    // A greyed-out control that looks like a production action reads as broken
    // software. A labelled "בקרוב" chip reads as a plan.
    expect(home).toContain('SoonChip');
    expect(home).toContain('copy.states.soonUpdates');
    expect(home, 'no disabled control should reach the daily screen').not.toContain('disabled');
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

const homeSource = read('page.tsx');

describe('the daily screen stays a daily screen', () => {
  const home = homeSource;

  test('the safe amount is never shown as a bare zero', () => {
    // A very large "0 ₪" is accurate and frightening. The screen says what the
    // zero means in words, and the arithmetic follows underneath it.
    expect(home).toContain('copy.home.safeZeroHeadline');
    expect(home).toContain('safeSpend.resultMinor > 0');
  });

  test('a shortfall is stated as a fact, with its amount', () => {
    expect(home).toContain('copy.home.safeGap');
    expect(home).toContain('safeSpend.fundingGapMinor');
  });

  test('missing data produces an explanation instead of a number', () => {
    expect(home).toContain('copy.home.safeCannotCalculateWhy');
    expect(home).toContain("decision.status === 'insufficient_data'");
  });

  test('the recommendation offers a concrete plan, not only a sentence', () => {
    expect(home).toContain('copy.plan.gapTitle');
    expect(home).toContain('copy.plan.movePayments');
    expect(home).toContain('copy.plan.businessTransfer');
    expect(home).toContain('copy.plan.expectedIncome');
  });

  test('the plan is built from engine figures, never invented', () => {
    expect(home).toContain('snapshot.safeTransfer.resultMinor');
    expect(home).toContain('input.plannedItems.filter');
  });

  test('the technical calculation version is not on the daily screen', () => {
    expect(home).not.toContain('CALCULATION_VERSION');
    expect(home).not.toContain('POLICY_VERSION');
  });

  test('the technical version is still available, under "עוד"', () => {
    const more = read('more/page.tsx');
    expect(more).toContain('CALCULATION_VERSION');
    expect(more).toContain('POLICY_VERSION');
  });

  test('the month-end card leads with the amount, not with a date', () => {
    const monthEnd = home.slice(home.indexOf('copy.home.monthEndTitle'));
    const headline = monthEnd.slice(0, monthEnd.indexOf('meaning='));
    expect(headline).toContain('forecast.lowPointMinor');
  });
});

describe('the shell', () => {
  const home = homeSource;
  const shell = readFileSync(join(APP_ROOT, '..', 'components', 'app-shell.tsx'), 'utf8');

  test('desktop navigation sits on the right of a Hebrew document', () => {
    // In a right-to-left document `flex-row` already lays children out from the
    // right, so the navigation — the first child — is the right-hand column.
    // `flex-row-reverse` pushed it to the left, which is what shipped until the
    // layout was looked at in a browser.
    // Only the classes are judged. The comment above them explains the trap and
    // necessarily names it.
    const classes = [...shell.matchAll(/className={?`?"?([^"`}]*)/g)]
      .map((match) => match[1] ?? '')
      .join(' ');
    expect(classes).toContain('sm:flex-row');
    expect(classes).not.toContain('flex-row-reverse');
  });

  test('the navigation is the first child, so reading order matches the layout', () => {
    expect(shell.indexOf('<nav')).toBeLessThan(shell.indexOf('<main'));
  });

  test('mobile keeps bottom navigation', () => {
    expect(shell).toContain('fixed inset-x-0 bottom-0');
    expect(shell).toContain('sm:hidden');
  });

  test('every navigation target meets the minimum touch size', () => {
    expect(shell).toContain('min-h-11');
    expect(shell).toContain('min-w-11');
  });

  test('the header carries the product identity in one line', () => {
    expect(shell).toContain('copy.app.name');
    expect(shell).toContain('<Mark />');
  });

  test('the header does not carry technical version content', () => {
    expect(shell).not.toContain('CALCULATION_VERSION');
  });

  test('the home screen renders exactly one h1, and it is the question', () => {
    expect(home).toContain('showHeading={false}');
    expect(home).toContain('asHeading');
    expect((home.match(/<h1/g) ?? []).length).toBe(0);
  });
});
