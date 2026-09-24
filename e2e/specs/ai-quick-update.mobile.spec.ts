import { expect, test, type Page } from '@playwright/test';

import { aiStateOf, analyse, confirmAi } from '../support/ai';
import { transactionsFor } from '../support/document';

/**
 * The smart reading on a phone, which is where a sentence actually gets typed.
 *
 * The proposal card is the densest screen in the product — badges, quoted
 * evidence, a question, four fields and a button — so it is the one most likely
 * to push a digit off the edge at 390px. That would be a wrong number rather than
 * an ugly layout, which is why this file exists rather than trusting the desktop
 * run.
 */

/** True when the document is wider than the window: content is off the edge. */
async function overflowsSideways(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
}

test.describe.configure({ mode: 'serial' });

test.describe('@smoke the proposal card fits a phone', () => {
  test('nothing is clipped while a suggestion is on screen', async ({ page }) => {
    const card = await analyse(page, 'היום שילמתי 120 שקל במכולת');
    await expect(card).toBeVisible();
    expect(await overflowsSideways(page)).toBe(false);
  });

  test('and every control on it can be hit with a thumb', async ({ page }) => {
    const card = await analyse(page, 'היום שילמתי 120 שקל במכולת');
    const boxes = await card
      .locator('a:visible, button:visible, input:visible, select:visible')
      .evaluateAll((elements) =>
        elements.map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            label: (element.textContent ?? '').trim().slice(0, 30) || element.nodeName,
            height: Math.round(rect.height),
            width: Math.round(rect.width),
          };
        }),
      );

    expect(boxes.length).toBeGreaterThan(0);
    // 44 is the design system's own number, implemented as `min-h-11`.
    const tooSmall = boxes.filter((box) => box.height > 1 && box.width > 1 && box.height < 44);
    expect(tooSmall, JSON.stringify(tooSmall)).toEqual([]);
  });

  test('the question is readable when one is asked', async ({ page }) => {
    const card = await analyse(page, 'היום החזרתי 3,000 שקל');
    expect(await aiStateOf(card)).toBe('needs_clarification');
    await expect(card.getByTestId('ai-missing')).toBeVisible();
    expect(await overflowsSideways(page)).toBe(false);
  });
});

test.describe('the whole journey completes on a phone', () => {
  const MERCHANT = 'במכולת';

  test('from the bottom bar to a record on disk', async ({ page }) => {
    const before = transactionsFor(MERCHANT).length;

    await page.goto('/');
    await page
      .getByRole('navigation', { name: 'ניווט תחתון' })
      .getByRole('link', { name: 'עדכון מהיר' })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'עדכון מהיר' })).toBeVisible();

    const card = await analyse(page, `היום שילמתי 18 שקל ${MERCHANT}`);
    expect(await overflowsSideways(page)).toBe(false);
    await card.getByLabel('סכום').fill('18.00');

    await confirmAi(card);
    await expect(page.getByText('נרשם.')).toBeVisible();
    expect(transactionsFor(MERCHANT).length).toBeGreaterThan(before);
  });
});
