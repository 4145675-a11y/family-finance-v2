import { expect, test, type Page } from '@playwright/test';

import {
  accountQuestion,
  approve,
  chooseAccount,
  onlyProposal,
  propose,
  proposeWithAccount,
} from '../support/quick';
import { balanceOf, debtIdByName, eventsFor, transactionsFor } from '../support/document';
import { ACCOUNT_NAME, LENDER_TOPUP } from '../support/household';

/**
 * The one flow on a phone, which is where a sentence actually gets typed.
 *
 * The proposal card is the densest screen in the product, so it is the one most
 * likely to push a digit off the edge at 390px — and a clipped digit is a wrong
 * number rather than an ugly layout, which is why this file exists rather than
 * trusting the desktop run.
 *
 * What it is checking after this slice is narrower and more useful than before:
 * that the whole journey — sentence, proposal, the one question, confirmation —
 * happens **without scrolling past an essay** to reach the thing that needs
 * answering. That was the complaint the slice came from, and on a phone it is the
 * difference between a usable product and one somebody gives up on in a shop.
 */

/** True when the document is wider than the window: content is off the edge. */
async function overflowsSideways(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
}

/** How far down the page an element sits, in pixels from the top of the document. */
async function distanceFromTop(page: Page, testId: string): Promise<number> {
  return page.getByTestId(testId).evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return Math.round(rect.top + window.scrollY);
  });
}

test.describe.configure({ mode: 'serial' });

const SENTENCE = `קיבלתי עוד 3,000 ₪ מ${LENDER_TOPUP}, לפירעון ב־10/10/2026`;

test.describe('@smoke the proposal fits a phone', () => {
  test('nothing is clipped while a proposal is on screen', async ({ page }) => {
    await propose(page, SENTENCE);
    await expect(await onlyProposal(page)).toBeVisible();
    expect(await overflowsSideways(page)).toBe(false);
  });

  test('and every control on it can be hit with a thumb', async ({ page }) => {
    await propose(page, SENTENCE);
    const card = await onlyProposal(page);
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

  test('the question is reachable without scrolling through an essay', async ({ page }) => {
    await propose(page, SENTENCE);
    const card = await onlyProposal(page);

    await expect(accountQuestion(card)).toBeVisible();
    /*
     * Within two phone screens of the top of the document, which on this viewport
     * is 1688px. The previous screen put a paragraph of privacy prose, a summary,
     * a reason and a list of quoted evidence above this question; the bound is
     * what stops that coming back without anybody noticing.
     */
    expect(await distanceFromTop(page, 'quick-account-question')).toBeLessThan(844 * 2);
    expect(await overflowsSideways(page)).toBe(false);
  });

  test('and the whole page is not much longer than the card', async ({ page }) => {
    await propose(page, SENTENCE);
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    // Three phone screens is already generous for one field and one card.
    expect(height).toBeLessThan(844 * 3);
  });
});

test.describe('the whole top-up completes on a phone', () => {
  test('from the bottom bar to a record on disk', async ({ page }) => {
    const debtId = debtIdByName(LENDER_TOPUP);
    const eventsBefore = eventsFor(debtId).length;
    const balanceBefore = balanceOf(debtId);
    const arrivedBefore = transactionsFor(LENDER_TOPUP).length;

    await page.goto('/');
    await page
      .getByRole('navigation', { name: 'ניווט תחתון' })
      .getByRole('link', { name: 'עדכון מהיר' })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'מה לעדכן?' })).toBeVisible();

    await page.getByLabel('מה לעדכן?').fill(SENTENCE);
    await page.getByRole('button', { name: 'הצע עדכון' }).click();
    const card = await onlyProposal(page);
    expect(await overflowsSideways(page)).toBe(false);

    await chooseAccount(card, ACCOUNT_NAME);
    await approve(card);
    await expect(page.getByText('נרשם.')).toBeVisible();

    expect(eventsFor(debtId)).toHaveLength(eventsBefore + 1);
    expect(balanceOf(debtId)).toBe(balanceBefore + 300_000);
    expect(transactionsFor(LENDER_TOPUP)).toHaveLength(arrivedBefore + 1);
  });

  test('and an ordinary expense still completes here too', async ({ page }) => {
    const MERCHANT = 'במכולת';
    const before = transactionsFor(MERCHANT).length;

    const card = await proposeWithAccount(page, `היום שילמתי 18 שקל ${MERCHANT}`);
    // The reading asked one question, it has been answered in the page, and the
    // card is now complete. `data-state` still describes the reading itself.
    await expect(card.getByRole('button', { name: 'אישור ורישום' })).toBeVisible();
    /*
     * No amount field, on purpose: the sentence settled the sum, so the card
     * states it rather than offering an empty box beside it. A card that asked
     * again for facts a person had just given would be the long form it replaced.
     */
    await expect(card.getByLabel('סכום')).toHaveCount(0);

    await approve(card);
    await expect(page.getByText('נרשם.')).toBeVisible();
    expect(transactionsFor(MERCHANT).length).toBeGreaterThan(before);
  });
});
