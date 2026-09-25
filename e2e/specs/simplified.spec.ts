import { expect, test, type Page } from '@playwright/test';

import { storedDocument } from '../support/document';
import { ACCOUNT_NAME, LENDER_PLAIN } from '../support/household';
import { accountQuestion, onlyProposal, propose } from '../support/quick';

/**
 * The simplification, measured rather than asserted about.
 *
 * The milestone it belongs to has one honest failure mode: a screen is declared
 * lighter, and six months of additions put it back. So the numbers are the test.
 * Each bound below is generous compared to what the screens actually measure —
 * what it catches is a return to the wall, not a line of new copy.
 *
 * `main` is measured rather than the document, because the navigation and header
 * are not what a person is reading.
 */

interface Reading {
  readonly actions: number;
  readonly textLength: number;
  readonly sections: number;
  readonly primaryButtons: number;
  readonly navLinks: number;
}

async function read(page: Page): Promise<Reading> {
  return page.evaluate(() => {
    const main = document.querySelector('main');
    /*
     * What a person sees without opening anything.
     *
     * A closed `<details>` still lays its contents out in Chromium — they are
     * hidden from the eye and from the accessibility tree, but they report a box.
     * Counting them would make progressive disclosure look like clutter, which is
     * the opposite of what it is.
     */
    const visible = (element: Element): boolean => {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 2 || rect.height <= 2) return false;
      return element.closest('details:not([open])') === null;
    };
    const actions = [...(main?.querySelectorAll('a, button') ?? [])].filter(visible);
    /*
     * The product's primary control is a filled button. Counting them is how
     * "one obvious next action" stops being a matter of opinion.
     *
     * The class has to match exactly: `bg-primary/5` is a tint used by badges and
     * cards, and counting those would make every screen look like it was shouting.
     */
    const primary = actions.filter((element) =>
      element.className.split(/\s+/u).includes('bg-primary'),
    );
    return {
      actions: actions.length,
      textLength: (main as HTMLElement | null)?.innerText.replace(/\s+/g, ' ').length ?? 0,
      sections: main?.querySelectorAll('section').length ?? 0,
      primaryButtons: primary.length,
      navLinks: document.querySelectorAll('nav a').length,
    };
  });
}

test.describe('@smoke the navigation a person has to learn', () => {
  test('is five links on a desktop, and the same five on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    const desktop = await page
      .getByRole('navigation', { name: 'ניווט ראשי' })
      .getByRole('link')
      .allInnerTexts();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const phone = await page
      .getByRole('navigation', { name: 'ניווט תחתון' })
      .getByRole('link')
      .allInnerTexts();

    expect(desktop).toHaveLength(5);
    expect(phone).toEqual(desktop);
  });
});

test.describe('the home screen is a command centre, not a dashboard', () => {
  test('it is one screen of reading, and one thing to press', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const home = await read(page);

    // It was nine sections, ten actions and 824 characters — 2.7 phone screens.
    expect(home.sections, 'sections on the home screen').toBeLessThanOrEqual(6);
    expect(home.textLength, 'characters of text on the home screen').toBeLessThan(750);
    expect(home.primaryButtons, 'primary buttons on the home screen').toBe(1);

    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(height, 'home is taller than two phone screens').toBeLessThan(844 * 2);
  });

  test('and the one thing to press is saying what happened', async ({ page }) => {
    await page.goto('/');
    const record = page.getByRole('link', { name: 'עדכון מהיר' }).first();
    await expect(record).toBeVisible();

    // Above the fold on a phone, which is where it was not.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const top = await page
      .locator('main')
      .getByRole('link', { name: 'עדכון מהיר' })
      .first()
      .evaluate((element) => Math.round(element.getBoundingClientRect().top + window.scrollY));
    expect(top, 'the recording action is below the first phone screen').toBeLessThan(844);
  });

  test('nothing on it is a long explanatory wall', async ({ page }) => {
    await page.goto('/');
    const paragraphs = await page.locator('main p').allInnerTexts();
    const longest = Math.max(0, ...paragraphs.map((text) => text.trim().length));
    // Two useful Hebrew sentences, not an essay.
    expect(longest, 'the longest paragraph on the home screen').toBeLessThan(200);
  });
});

test.describe('debts and lenders are one screen', () => {
  test('the old address still answers, and lands on the merged screen', async ({ page }) => {
    const response = await page.goto('/debts');
    expect(response?.status()).toBeLessThan(400);
    await expect(page).toHaveURL(/\/lenders$/u);
  });

  test('it shows the balance, the next date and a way into the history', async ({ page }) => {
    await page.goto('/lenders');
    const card = page.locator('section').filter({
      has: page.getByRole('heading', { name: LENDER_PLAIN, exact: true }),
    });

    await expect(card.getByText('יתרה נוכחית')).toBeVisible();
    await expect(card.getByText('המועד הבא')).toBeVisible();
    await expect(
      card.getByRole('link', { name: 'לכרטיס המלווה ולהיסטוריה המלאה' }),
    ).toBeVisible();
  });

  test('the rare forms are there, and closed', async ({ page }) => {
    await page.goto('/lenders');

    // Opening a lender by hand and swapping one debt for another still exist.
    const details = page.locator('details').filter({ hasText: 'פעולות נוספות' });
    await expect(details).toHaveCount(1);
    await expect(details).not.toHaveAttribute('open', '');
    // And the form inside is genuinely there once a person asks for it.
    await details.locator('summary').click();
    await expect(details.getByLabel('למי חייבים')).toBeVisible();
  });

  test('and a repayment is not offered here a second time', async ({ page }) => {
    /*
     * There used to be a payment form on the debts screen as well as on the
     * lender's own card: two ways in to one write. The lender's card is the one
     * that stayed, because that is where the balance it moves is shown.
     */
    await page.goto('/lenders');
    await expect(page.getByRole('heading', { name: 'תשלום על חוב' })).toHaveCount(0);
  });
});

test.describe('the quick update stays compact', () => {
  test('one field, one primary action, and no wall', async ({ page }) => {
    await page.goto('/quick');
    const quick = await read(page);

    await expect(page.locator('textarea')).toHaveCount(1);
    expect(quick.primaryButtons, 'primary buttons before a proposal').toBe(1);
    expect(quick.textLength, 'characters on the quick screen').toBeLessThan(400);
  });

  test('a proposal names the lender, says the card exists, and writes nothing', async ({
    page,
  }) => {
    const before = JSON.stringify(storedDocument());

    await propose(page, `קיבלתי עוד 3,000 ₪ מ${LENDER_PLAIN}, לפירעון ב־10/10/2026`);
    const card = await onlyProposal(page);

    await expect(card.getByTestId('quick-lender')).toContainText(LENDER_PLAIN);
    await expect(card.getByTestId('quick-lender')).toContainText('כרטיס קיים');
    await expect(accountQuestion(card)).toContainText('לאיזה חשבון נכנסו 3,000 ₪?');
    await expect(
      accountQuestion(card).getByRole('button', { name: ACCOUNT_NAME }),
    ).toBeVisible();

    expect(JSON.stringify(storedDocument())).toBe(before);
  });

  test('and a person reaches that lender own card from the proposal, in one tap', async ({
    page,
  }) => {
    /*
     * The card it just named, not the list it sits in. Being told "כרטיס קיים"
     * and then having to find it again among seven is the small friction that
     * stops people checking.
     */
    await propose(page, `קיבלתי עוד 3,000 ₪ מ${LENDER_PLAIN}, לפירעון ב־10/10/2026`);
    const card = await onlyProposal(page);

    await card.getByRole('link', { name: 'לכרטיס המלווה' }).click();
    await expect(page.getByRole('heading', { level: 1, name: LENDER_PLAIN })).toBeVisible();
    await expect(page.getByRole('table')).toBeVisible();
  });
});

test.describe('every ordinary screen has one obvious next action', () => {
  test('and never two competing ones', async ({ page }) => {
    /*
     * The filled button is the product's primary control, so more than one on a
     * screen is more than one "do this now". A screen with none is a screen for
     * reading, which is a legitimate answer for history and indexes.
     */
    for (const href of [
      '/',
      '/quick',
      '/activity',
      '/lenders',
      '/more',
      '/upload',
      '/entry',
      '/accounts',
      '/budget',
      '/tasks',
    ]) {
      await page.goto(href);
      const reading = await read(page);
      expect(
        reading.primaryButtons,
        `${href} has competing primary actions`,
      ).toBeLessThanOrEqual(1);
    }
  });
});
