import { expect, test, type Page } from '@playwright/test';

import { LENDER_CARD } from '../support/household';

/**
 * Finding things without knowing their addresses.
 *
 * The test a family actually applies to an app: can I get to the thing I want by
 * reading, in one or two taps, without being told a URL. Every destination below
 * is one somebody needs on an ordinary day, so "it is reachable if you type
 * /lenders" is not an answer.
 *
 * Reached by clicking, deliberately. A test that navigated with `page.goto` would
 * prove the route exists — which the build already proves — and say nothing about
 * whether anyone can find it.
 *
 * Since the navigation came down to five, the burden shifted: `עוד` is now the
 * only index of everything else, so "reachable by reading" means reachable from
 * those five plus that one page. That is what most of this file checks.
 */

/** Follows a link by its visible words and waits for the screen to arrive. */
async function follow(page: Page, name: string | RegExp, heading: string | RegExp) {
  await page.getByRole('link', { name }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
}

test.describe('@smoke the navigation is five things, and the same five everywhere', () => {
  test('the five are in the sidebar, and nothing else is', async ({ page }) => {
    await page.goto('/accounts');
    const nav = page.getByRole('navigation', { name: 'ניווט ראשי' });

    for (const label of ['בית', 'עדכון מהיר', 'כסף ותנועה', 'חובות ומלווים', 'עוד']) {
      await expect(nav.getByRole('link', { name: label })).toBeVisible();
    }
    await expect(nav.getByRole('link')).toHaveCount(5);
  });

  test('and the screens that left it are not in it any more', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'ניווט ראשי' });

    for (const label of ['חשבונות', 'תכנון', 'תחזית', 'העלאה', 'אישורים', 'עסק']) {
      await expect(nav.getByRole('link', { name: label })).toHaveCount(0);
    }
  });
});

test.describe('the journeys a person walks by reading', () => {
  test('home offers recording something as its one action', async ({ page }) => {
    await page.goto('/');
    // In the record card, not only in the navigation.
    await follow(page, 'עדכון מהיר', 'מה לעדכן?');
  });

  test('home reaches the debts in one click', async ({ page }) => {
    await page.goto('/');
    await follow(page, 'לראות את כל החובות', 'חובות ומלווים');
  });

  test('and from there to one lender and its history', async ({ page }) => {
    await page.goto('/lenders');
    const card = page.locator('section').filter({
      has: page.getByRole('heading', { name: LENDER_CARD, exact: true }),
    });
    await card.getByRole('link', { name: 'לכרטיס המלווה ולהיסטוריה המלאה' }).click();
    await expect(page.getByRole('heading', { level: 1, name: LENDER_CARD })).toBeVisible();
    await expect(page.getByRole('table')).toBeVisible();
  });

  test('the navigation says where a person is standing', async ({ page }) => {
    await page.goto('/lenders');
    const nav = page.getByRole('navigation', { name: 'ניווט ראשי' });
    await expect(nav.getByRole('link', { name: 'חובות ומלווים' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('everything that left the navigation is one click from "עוד"', async ({ page }) => {
    /*
     * The rule that keeps the smaller navigation honest. A screen that is in
     * neither the five nor this index does not exist as far as a person is
     * concerned, whatever its route says.
     */
    const elsewhere = [
      '/accounts',
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

    await page.goto('/more');
    const hrefs = await page
      .locator('main')
      .getByRole('link')
      .evaluateAll((links) =>
        links.map((link) => (link as HTMLAnchorElement).getAttribute('href') ?? ''),
      );

    for (const href of elsewhere) {
      expect(hrefs, `${href} is not linked from /more`).toContain(href);
    }
  });
});

test.describe('the links a family may already have saved still work', () => {
  test('the old debts address lands on the merged screen', async ({ page }) => {
    /*
     * `/debts` and `/lenders` were one subject on two screens and were merged.
     * The address stays, because a bookmark is a promise.
     */
    const response = await page.goto('/debts');
    expect(response?.status()).toBeLessThan(400);
    await expect(page).toHaveURL(/\/lenders$/u);
    await expect(page.getByRole('heading', { level: 1, name: 'חובות ומלווים' })).toBeVisible();
  });

  test('and every screen that left the navigation still answers on its own address', async ({
    page,
  }) => {
    for (const href of [
      '/accounts',
      '/activity',
      '/approvals',
      '/budget',
      '/business',
      '/entry',
      '/forecast',
      '/gemach',
      '/lenders',
      '/more',
      '/quick',
      '/reports',
      '/rules',
      '/settings',
      '/tasks',
      '/upload',
    ]) {
      const response = await page.goto(href);
      expect(response?.status(), href).toBeLessThan(400);
      await expect(page.getByRole('heading', { level: 1 }), href).toBeVisible();
    }
  });
});

test.describe('every navigation destination answers', () => {
  test('no link in the sidebar leads to an error', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'ניווט ראשי' });
    const hrefs = await nav
      .getByRole('link')
      .evaluateAll((links) =>
        links.map((link) => (link as HTMLAnchorElement).getAttribute('href') ?? ''),
      );
    expect(hrefs).toHaveLength(5);

    for (const href of hrefs) {
      const response = await page.goto(href);
      expect(response?.status(), href).toBeLessThan(400);
      await expect(page.getByRole('heading', { level: 1 }), href).toBeVisible();
    }
  });
});
