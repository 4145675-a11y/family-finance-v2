import { expect, test, type Locator, type Page } from '@playwright/test';

import { approve, proposeWithAccount } from '../support/quick';
import { transactionsFor } from '../support/document';

/**
 * The product on a phone, which is where it is actually used.
 *
 * A family records an expense standing in a shop with bags in the other hand.
 * Everything below is checked at 390×844 for that reason: a layout that works at
 * 1280 and clips at 390 is broken for the case the product was built for.
 *
 * Three properties, each a way the phone experience fails in practice:
 *
 *   * **nothing scrolls sideways** — a horizontal scrollbar on a money screen
 *     means a digit is off the edge, and a digit off the edge is a wrong number;
 *   * **every control can be hit with a thumb** — 44px is the floor the design
 *     system already commits to, and a form is useless if its button is 30px;
 *   * **the whole task completes** — not just renders. The quick update is walked
 *     end to end and the record is read back from disk.
 */

/** True when the document is wider than the window: content is off the edge. */
async function overflowsSideways(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
}

/** Every interactive control that is actually on the screen. */
function controls(page: Page): Locator {
  return page.locator(
    'a:visible, button:visible, input:visible, select:visible, textarea:visible, summary:visible',
  );
}

async function assertTouchTargets(page: Page): Promise<void> {
  const boxes = await controls(page).evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        label: (element.textContent ?? '').trim().slice(0, 40) || element.nodeName,
        height: Math.round(rect.height),
        width: Math.round(rect.width),
      };
    }),
  );
  expect(boxes.length).toBeGreaterThan(0);

  /*
   * Anything a person can see and press has to be reachable, and 44 is the figure
   * 04-DESIGN-SYSTEM.md sets and `min-h-11` implements — so this gate is the
   * design system's own number rather than one this file invented.
   *
   * A 1×1 element is the screen-reader-only skip link, which is correct as it
   * stands: it is not a visual target until it takes focus, and that it grows
   * when it does is checked on its own below.
   */
  const tooSmall = boxes.filter((box) => box.height > 1 && box.width > 1 && box.height < 44);
  expect(tooSmall, JSON.stringify(tooSmall)).toEqual([]);
}

const SCREENS = ['/', '/quick', '/debts', '/lenders', '/upload', '/approvals', '/more'];

test.describe('@smoke nothing is clipped on a phone', () => {
  for (const path of SCREENS) {
    test(`${path} fits the width and has usable controls`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(await overflowsSideways(page), `${path} scrolls sideways`).toBe(false);
      await assertTouchTargets(page);
    });
  }
});

test.describe('the skip link is a real target once it is focused', () => {
  test('it is out of the way until a keyboard reaches it, then full size', async ({ page }) => {
    await page.goto('/');
    const skip = page.getByRole('link', { name: 'דילוג לתוכן' });

    // Out of the way: one pixel, so it takes no space in the layout.
    const hidden = await skip.boundingBox();
    expect(hidden?.height ?? 0).toBeLessThan(4);

    await skip.focus();
    const shown = await skip.boundingBox();
    expect(shown?.height ?? 0).toBeGreaterThanOrEqual(44);
  });
});

test.describe('the bottom bar is how a thumb navigates', () => {
  test('it carries the five daily destinations and is reachable', async ({ page }) => {
    await page.goto('/');
    const bar = page.getByRole('navigation', { name: 'ניווט תחתון' });
    await expect(bar).toBeVisible();
    await expect(bar.getByRole('link')).toHaveCount(5);
    await expect(bar.getByRole('link', { name: 'עדכון מהיר' })).toBeVisible();
  });

  test('and the sidebar is hidden rather than squeezed', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('navigation', { name: 'ניווט ראשי' })).toBeHidden();
  });

  test('lenders are still reachable by reading, in two taps', async ({ page }) => {
    await page.goto('/');
    await page
      .getByRole('navigation', { name: 'ניווט תחתון' })
      .getByRole('link', { name: 'עוד' })
      .click();
    await page.getByRole('link', { name: 'מלווים' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'מלווים' })).toBeVisible();
  });
});

test.describe('the whole quick update completes on a phone', () => {
  const MERCHANT = 'בפיצוציה';

  test('from the bottom bar to a record on disk', async ({ page }) => {
    await page.goto('/');
    await page
      .getByRole('navigation', { name: 'ניווט תחתון' })
      .getByRole('link', { name: 'עדכון מהיר' })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'מה לעדכן?' })).toBeVisible();

    const card = await proposeWithAccount(page, `היום שילמתי 18 שקל ${MERCHANT}`);
    // The proposal, and its controls, are reachable without sideways scrolling.
    expect(await overflowsSideways(page)).toBe(false);

    await approve(card);
    await expect(page.getByText('נרשם.')).toBeVisible();
    expect(transactionsFor(MERCHANT)).toHaveLength(1);
  });

  test('and the lender card reads on a phone, table and all', async ({ page }) => {
    await page.goto('/lenders');
    await page.getByRole('link', { name: 'לכרטיס המלווה ולהיסטוריה המלאה' }).first().click();
    await expect(page.getByRole('table')).toBeVisible();
    // The history is a table on a desktop and a stack of cards here; either way
    // it must not push the page sideways.
    expect(await overflowsSideways(page)).toBe(false);
  });
});
