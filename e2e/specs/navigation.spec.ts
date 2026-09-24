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
 */

/** Follows a link by its visible words and waits for the screen to arrive. */
async function follow(page: Page, name: string | RegExp, heading: string | RegExp) {
  await page.getByRole('link', { name }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
}

test.describe('@smoke the daily destinations are in the navigation', () => {
  test('home, the quick update, upload and approvals are one click from anywhere', async ({
    page,
  }) => {
    await page.goto('/accounts');
    const nav = page.getByRole('navigation', { name: 'ניווט ראשי' });

    for (const label of ['בית', 'עדכון מהיר', 'העלאה', 'אישורים']) {
      await expect(nav.getByRole('link', { name: label })).toBeVisible();
    }
  });

  test('so are the screens that answer "how are we doing"', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'ניווט ראשי' });

    for (const label of ['חשבונות', 'תכנון', 'חובות', 'מלווים', 'תחזית']) {
      await expect(nav.getByRole('link', { name: label })).toBeVisible();
    }
  });
});

test.describe('the journeys a person walks by reading', () => {
  test('home offers the quick update as the first thing to do', async ({ page }) => {
    await page.goto('/');
    // In the actions card, not only in the navigation.
    await follow(page, 'עדכון מהיר', 'עדכון מהיר');
  });

  test('from debts a person reaches the lender cards', async ({ page }) => {
    await page.goto('/debts');
    await follow(page, /כרטיסי המלווים|מלווים/, 'מלווים');
  });

  test('and from the lender list to one lender and its history', async ({ page }) => {
    await page.goto('/lenders');
    const card = page.locator('section').filter({
      has: page.getByRole('heading', { name: LENDER_CARD, exact: true }),
    });
    await card.getByRole('link', { name: 'לכרטיס המלווה ולהיסטוריה המלאה' }).click();
    await expect(page.getByRole('heading', { level: 1, name: LENDER_CARD })).toBeVisible();
    await expect(page.getByRole('table')).toBeVisible();
  });

  test('the navigation shows where the lender screens live', async ({ page }) => {
    await page.goto('/lenders');
    // Not highlighting "עוד" while standing on a screen the navigation lists.
    const nav = page.getByRole('navigation', { name: 'ניווט ראשי' });
    await expect(nav.getByRole('link', { name: 'מלווים' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('from home a person reaches uploading a statement', async ({ page }) => {
    await page.goto('/');
    await follow(page, 'העלאת דוח', 'העלאת מסמך');
  });

  test('and the review states are reachable by reading', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'ניווט ראשי' });
    await nav.getByRole('link', { name: 'אישורים' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
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
    expect(hrefs.length).toBeGreaterThan(8);

    for (const href of hrefs) {
      const response = await page.goto(href);
      expect(response?.status(), href).toBeLessThan(400);
      await expect(page.getByRole('heading', { level: 1 }), href).toBeVisible();
    }
  });
});
