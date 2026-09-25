import { expect, test } from '@playwright/test';

import {
  ACCOUNT_NAME,
  ACCOUNT_SECOND_NAME,
  HOUSEHOLD_NAME,
  LENDER_PLAIN,
} from '../support/household';
import { storedDocument } from '../support/document';

/**
 * The suite's own foundations, checked before anything is asserted about the
 * product.
 *
 * If the household is not the synthetic one, every other test in this directory
 * is meaningless — and worse, could be reading a real family's records. So that
 * is the first thing proved, and it is tagged `@smoke` because it is also the
 * subset CI runs to know the harness itself still works.
 */

test.describe('@smoke the suite is pointed at the synthetic household', () => {
  test('the document on disk is the E2E one, and only the E2E one', () => {
    const document = storedDocument();
    expect(document.household.name).toBe(HOUSEHOLD_NAME);
    // Every record carries the marker. A real household's would not.
    expect(document.accounts.map((account) => account.name)).toEqual([
      ACCOUNT_NAME,
      ACCOUNT_SECOND_NAME,
    ]);
    for (const debt of document.debts) expect(debt.creditorName).toMatch(/^E2E /);
  });

  test('the home screen is served, in Hebrew, right to left', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'he');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('main')).toBeVisible();
  });

  test('the seeded lender is on the debts screen', async ({ page }) => {
    await page.goto('/lenders');
    await expect(page.getByText(LENDER_PLAIN).first()).toBeVisible();
  });
});
