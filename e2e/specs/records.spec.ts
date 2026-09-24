import { expect, test } from '@playwright/test';

import { approve, interpret, onlyProposal } from '../support/quick';
import { asShekels, transactionsFor } from '../support/document';
import { ACCOUNT_NAME } from '../support/household';

/**
 * Seeing back what you just recorded.
 *
 * The gap this covers was found by walking the product rather than by reading it:
 * a person could record an expense, get "נרשם.", and then have nowhere in the
 * whole application to see the thing. `/activity` listed the *names* of actions —
 * "נרשמה תנועה" — with no amount, no merchant and no account, and no other screen
 * listed transactions at all.
 *
 * That breaks the loop the product depends on. A family that cannot check what
 * went in stops trusting the figures, and a figure nobody trusts is the same as no
 * figure. So the check here is deliberately the naive one: record something, go
 * looking for it the way a person would, and find it.
 */

test.describe.configure({ mode: 'serial' });

const MERCHANT = 'במכולת הבדיקה';
const AMOUNT_MINOR = 3_450;

test.describe('@smoke a recorded expense can be found again', () => {
  test('it appears on the history screen, with its amount', async ({ page }) => {
    await interpret(page, `היום שילמתי 34.50 שקל ${MERCHANT}`);
    await approve(await onlyProposal(page));
    await expect(page.getByText('נרשם.')).toBeVisible();
    expect(transactionsFor(MERCHANT)).toHaveLength(1);

    await page.goto('/activity');
    const card = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'מה נרשם' }),
    });

    await expect(card.getByText(MERCHANT)).toBeVisible();
    await expect(card.getByText(asShekels(AMOUNT_MINOR))).toBeVisible();
    // Which account it came out of, because a household has more than one.
    await expect(card.getByText(ACCOUNT_NAME).first()).toBeVisible();
  });

  test('and survives a full reload', async ({ page }) => {
    await page.goto('/activity');
    await page.reload();
    const card = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'מה נרשם' }),
    });
    await expect(card.getByText(MERCHANT)).toBeVisible();
  });

  test('money out is signed as money out', async ({ page }) => {
    await page.goto('/activity');
    const row = page
      .getByRole('table')
      .first()
      .locator('tbody tr')
      .filter({ hasText: MERCHANT });
    // A minus, not a negative stored amount: the record holds a positive figure
    // and a direction (02-FINANCIAL-RULES.md).
    await expect(row).toContainText('−');
  });

  test('and money in is signed as money in', async ({ page }) => {
    await interpret(page, 'היום קיבלתי 500 שקל החזר מהקופה');
    await approve(await onlyProposal(page));
    await expect(page.getByText('נרשם.')).toBeVisible();

    await page.goto('/activity');
    const row = page
      .getByRole('table')
      .first()
      .locator('tbody tr')
      .filter({ hasText: 'מהקופה' });
    await expect(row).toContainText('+');
  });

  test('the trail of what was done is still there, underneath', async ({ page }) => {
    await page.goto('/activity');
    // Both answers on one screen: what was recorded, and what was done.
    await expect(page.getByRole('heading', { name: 'מה נרשם' })).toBeVisible();
    await expect(page.getByText('נרשמה תנועה').first()).toBeVisible();
  });
});
