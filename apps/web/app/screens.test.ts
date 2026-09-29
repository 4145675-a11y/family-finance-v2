import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import { NAV_ITEMS, PHONE_NAV } from '../components/app-shell';

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

/** Screens that put a monetary figure in front of a person. */
const MONEY_PAGES = DATA_PAGES.filter((page) => /<Money[s/>]/.test(read(page)));

describe('the routes that exist', () => {
  test('every navigation destination has a page', () => {
    for (const item of NAV_ITEMS) {
      const expected = item.href === '/' ? 'page.tsx' : `${item.href.slice(1)}/page.tsx`;
      expect(pages, `${item.href} is in the navigation with no page behind it`).toContain(
        expected,
      );
    }
  });

  test('the phone bar carries five destinations, the same five as a desktop', () => {
    expect(PHONE_NAV.map((item) => item.label)).toEqual([
      'בית',
      'עדכון מהיר',
      'כסף ותנועה',
      'חובות ומלווים',
      'עוד',
    ]);
  });

  test('every screen in the navigation is built, and none of them says "coming soon"', () => {
    for (const item of NAV_ITEMS) {
      const source = read(item.href === '/' ? 'page.tsx' : `${item.href.slice(1)}/page.tsx`);
      expect(source, `${item.href} is still a placeholder`).not.toContain('ComingSoon');
    }
  });

  test('every screen that reads the household is rendered per request', () => {
    // A prerendered financial screen shows what the build saw. There is no
    // acceptable version of that, so it is a structural rule rather than a habit.
    for (const page of DATA_PAGES) {
      expect(read(page), `${page} would be prerendered`).toContain("dynamic = 'force-dynamic'");
    }
  });

  test('a screen never mutates the store itself', () => {
    // Writes go through a server action, which validates, audits and revalidates.
    // A page calling a command directly would skip all three.
    for (const page of pages) {
      const source = read(page);
      expect(source, `${page} runs a store command directly`).not.toMatch(
        /householdStore\(\)\.run\(/,
      );
      expect(source, `${page} writes to the store directly`).not.toMatch(
        /\.replaceDocument\(|\.mutate\(/,
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
    // `toAmountInput` is the one reviewed conversion from minor units to the
    // text a person edits. Anything else doing it inline is how two screens end
    // up rounding differently.
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
  test.each(DATA_PAGES)('%s says so rather than showing nothing', (page) => {
    const source = read(page);
    // Either the honest empty state, or the invitation to set a household up.
    // Both branch explicitly on the absence; neither substitutes a zero.
    expect(source, `${page} has no answer for a missing household`).toMatch(
      /EmptyState|NoHousehold|EmptyPrompt/,
    );
    expect(source, `${page} must branch on a missing source`).toMatch(/=== null/);
  });

  test('a route kept only as a forwarding address passes the lock first', () => {
    /*
     * The failure this catches, found by the production smoke check rather than
     * by anybody's judgement: `/debts` was merged into `/lenders` and left behind
     * as a bare redirect — and a bare redirect answers an anonymous visitor.
     * Every other path in the product sends them to sign in first, and one that
     * does not is the exception somebody later builds on.
     *
     * A forwarding page reads no household, so the data-page rules above never
     * see it. This is the rule that does. It is deliberately about
     * `permanentRedirect`, which is what a moved route uses; the sign-in screens
     * redirect conditionally and are meant to answer a stranger.
     */
    const forwarding = pages.filter((page) => read(page).includes('permanentRedirect('));
    expect(forwarding.length, 'no forwarding routes found to check').toBeGreaterThan(0);

    for (const page of forwarding) {
      expect(read(page), `${page} forwards without passing the lock`).toMatch(
        /requireUnlocked|loadDashboardView/,
      );
    }
  });

  test.each(MONEY_PAGES)('%s cannot show invented figures without saying so', (page) => {
    // The banner is the shell's job now, and passing the descriptor is what turns
    // it on. A screen that renders money and does not pass it could show fixture
    // figures silently, which is the one failure this whole gate exists for.
    // The shell renders the banner from `source`; a page outside the shell —
    // the print view — declares it directly.
    expect(read(page), `${page} renders money without declaring its source`).toMatch(
      /source={|SourceNotice/,
    );
  });
});

describe('the home screen keeps its hierarchy', () => {
  const home = read('page.tsx');

  /*
   * The order the screen is built in, and the rule behind it: the answer first,
   * then the one thing a person is asked to do, then anything wrong, then the
   * picture. The screen used to carry nine sections and ten links with the
   * recording action ninth, so these exist to stop that returning by accretion.
   */
  const order = [
    'copy.home.safeTitle',
    'copy.home.recordTitle',
    'copy.home.attentionTitle',
    'copy.home.pictureTitle',
  ];

  test('saying what happened is the one primary action, above everything else', () => {
    const record = home.indexOf('copy.home.recordTitle');
    expect(record).toBeGreaterThan(0);
    expect(record).toBeLessThan(home.indexOf('copy.home.attentionTitle'));
    expect(record).toBeLessThan(home.indexOf('copy.home.pictureTitle'));
    // And it points at the sentence screen, not at a form.
    expect(home).toContain('href="/quick"');
  });

  test('the four things appear in that order and no other', () => {
    const positions = order.map((key) => home.indexOf(key));
    expect(positions.every((position) => position > 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  test('there is exactly one call to action on the screen', () => {
    // A LinkButton is the product's primary control. Four in a row was the
    // "quick actions" card, and it is why the recording action was invisible.
    expect((home.match(/<LinkButton\b/g) ?? []).length).toBe(1);
  });

  test('the screens that left are not re-added as cards', () => {
    for (const gone of [
      'copy.food.title',
      'copy.home.businessTitle',
      'copy.home.updatesTitle',
    ]) {
      expect(home.includes(gone), `${gone} is back on the home screen`).toBe(false);
    }
  });

  test('what needs attention is one card, not one card each', () => {
    // Rows waiting, cheques outstanding, the recommendation and engine warnings
    // join one list. Three cards taught a reader to skip the last two.
    expect(home).toContain('copy.home.attentionTitle');
    expect(home).toContain('attention.push');
    expect(home).not.toContain('copy.home.waitingTitle');
  });

  test('the recommendation is still offered, with its plan behind a disclosure', () => {
    // Folded away, not deleted: the options and the "make it a task" form are
    // one press from the line that names the recommendation.
    expect(home).toContain('copy.plan.howTitle');
    expect(home).toContain('copy.plan.movePayments');
    expect(home).toContain('addTaskAction');
  });

  test('exactly one hero is rendered', () => {
    expect((home.match(/<Hero\b/g) ?? []).length).toBe(1);
  });

  test('the full monthly budget is not on the home screen', () => {
    expect(home).not.toContain('budget.lines');
  });

  test('the detail a person did not ask for is collapsed', () => {
    expect(home).toContain('Disclosure');
    expect(home).toContain('copy.home.howWeCalculated');
    expect(home).toContain('copy.sections.ourProgress');
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

  test('the month-end line leads with the amount, not with a date', () => {
    const monthEnd = home.slice(home.indexOf('copy.home.monthEndTitle'));
    const line = monthEnd.slice(0, monthEnd.indexOf('hint='));
    expect(line).toContain('forecast.endOfPeriodMinor');
  });
});

describe('the administration link is gated on the server', () => {
  const shellSource = readFileSync(join(APP_ROOT, '..', 'components', 'app-shell.tsx'), 'utf8');

  test('the shell asks the shared authorisation helper, and nothing else', () => {
    /*
     * The one mechanism, reused. Not an email comparison, not a claim read off
     * the session, not a flag in storage: isPlatformOwner() asks the database
     * through public.is_platform_owner(), which calls app.is_platform_admin().
     */
    expect(shellSource).toContain("from '../lib/auth/platform'");
    expect(shellSource).toContain('await isPlatformOwner()');
  });

  test('and decides nothing for itself', () => {
    // A second rule about who is an administrator is a second rule to get wrong.
    for (const forbidden of ['email', 'localStorage', 'process.env']) {
      expect(shellSource.includes(forbidden), `the shell judges by ${forbidden}`).toBe(false);
    }
  });

  test('the admin screen checks again, whatever the navigation drew', () => {
    /*
     * Hiding a link is a courtesy. The screen behind it is the boundary, and it
     * turns away a person who is not the platform owner even when they type the
     * address — which is what somebody reading the page's JavaScript would do.
     */
    const admin = read('admin/page.tsx');
    expect(admin).toContain('isPlatformOwner');
    expect(admin).toContain("redirect('/')");
  });

  test('and so does every action behind it', () => {
    // A third time, in the database: requireOwner is the readable sentence, and
    // the function it calls checks app.is_platform_admin() for itself.
    const actions = readFileSync(join(APP_ROOT, '..', 'lib', 'actions', 'platform.ts'), 'utf8');
    expect(actions).toContain('isPlatformOwner');
    expect(actions).toContain('requireOwner');
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

describe('repayment expectation and demands are two things on the screen', () => {
  const component = readFileSync(join(APP_ROOT, '..', 'components', 'repayment.tsx'), 'utf8');
  const lenderPage = read('lenders/[lender]/page.tsx');

  test('the lender card shows both, from the component that owns each', () => {
    expect(lenderPage).toContain('RepaymentExpectationLine');
    expect(lenderPage).toContain('RepaymentDemands');
  });

  test('the expectation is not folded into the payment due date', () => {
    /*
     * `dueDate` is when an instalment falls due and it recurs; the expectation
     * is when the whole loan is expected to be finished. A screen that showed
     * the soonest of the two would answer neither question.
     */
    const expectationBlock = lenderPage.slice(
      lenderPage.indexOf('<RepaymentExpectationLine'),
      lenderPage.indexOf('<RepaymentDemands'),
    );
    expect(expectationBlock).not.toContain('DueDateLines');
    expect(lenderPage).toContain('<DueDateLines due={debt.dueDate} />');
  });

  test('all three states of the expectation are rendered, each its own way', () => {
    const line = component.slice(
      component.indexOf('export function RepaymentExpectationLine'),
      component.indexOf('export function RepaymentExpectationForm'),
    );
    // Nothing recorded, and an agreed absence, each get a sentence of their own.
    expect(line).toContain('repayment.expectation.unrecorded');
    expect(line).toContain('repayment.expectation.none');
    // The dated state shows the date, formatted, rather than a word.
    expect(line).toContain('formatDueDate(expectation.on)');
    // And the three are distinguished by the fact, not by a truthiness test
    // that would read an agreed absence as nothing recorded.
    expect(line).toContain('expectation === undefined');
    expect(line).toContain("expectation.kind === 'none'");
  });

  test('the demand list says plainly that recording one changes nothing', () => {
    // The fear that writing a demand down reopens a settled debt is what stops
    // people writing it down, so the screen answers it before it is asked.
    expect(component).toContain('repayment.demand.harmless');
  });

  test('a closed loan still gets the demand form, and not the expectation form', () => {
    const expectationForm = component.slice(
      component.indexOf('export function RepaymentExpectationForm'),
      component.indexOf('export function RepaymentDemands'),
    );
    const demandForm = component.slice(component.indexOf('export function RepaymentDemands'));

    // The expectation form removes itself once the loan is closed.
    expect(expectationForm).toContain("debt.status !== 'active'");
    expect(expectationForm).toContain('return null');
    // The demand form has no such gate: it is the thing that must keep working.
    expect(demandForm).not.toContain('return null');
    expect(demandForm).toContain('repayment.demand.onClosedDebt');
  });

  test('neither form computes a balance or an amount of its own', () => {
    expect(component).not.toMatch(/amountMinor\s*[*+-]/);
    expect(component).not.toContain('replayDebt');
    expect(component).not.toContain('finalBalanceOf');
  });

  test('the demand form defaults its date to today and nothing else', () => {
    /*
     * A deadline or a figure filled in by the product would be a fact nobody
     * stated. The day it was asked is the one thing the form may assume, and a
     * person can change it.
     */
    expect(component).toContain('defaultValue={today}');
    const deadline = component.slice(
      component.indexOf('name="requestedDeadline"'),
      component.indexOf('name="note"'),
    );
    expect(deadline).not.toContain('defaultValue={today}');
  });

  test('every target on it is a real one, so it works on a phone', () => {
    // The shared field components carry the 44px minimum; this screen must not
    // hand-roll an input that skips them.
    expect(component).not.toContain('<input');
    expect(component).not.toContain('<select');
    expect(component).not.toContain('<button');
  });
});
