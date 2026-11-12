import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { LENDER_CARD } from '../support/household';
import { readRunState } from '../support/run-state';

/**
 * The feedback button, pressed in a browser (ADR-0047).
 *
 * What the unit tests cannot show: that the button is on the screen, that a
 * person can mark a component or a region and send, and that what reaches the
 * disk is the white list and nothing else. Every assertion about content reads
 * the file the server wrote — the screen saying "תודה" proves nothing.
 *
 * The button lives in a Shadow DOM. Playwright's locators pierce open shadow
 * roots, so these are the same locators a person's assistive technology sees.
 */

interface StoredNote {
  readonly reference: string;
  readonly status: string;
  readonly text: string;
  readonly route: string;
  readonly device: string;
  readonly mark: { type: string; chain?: string[]; rect?: Record<string, number> };
}

function feedbackDirectory(): string {
  return join(readRunState().dataDirectory, 'feedback');
}

/** Every note this run wrote, read from disk. */
function storedNotes(): StoredNote[] {
  const directory = feedbackDirectory();
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(join(directory, name), 'utf8')) as StoredNote);
}

/** The raw file of one note, for "this string must not be in it". */
function rawNote(reference: string): string {
  return readFileSync(join(feedbackDirectory(), `${reference}.json`), 'utf8');
}

async function open(page: Page) {
  await page.getByRole('button', { name: 'לשלוח משוב על המסך הזה' }).click();
  await expect(page.getByRole('dialog', { name: 'על מה ההערה?' })).toBeVisible();
}

async function writeAndSend(page: Page, text: string): Promise<string> {
  const form = page.getByRole('dialog', { name: 'מה לשנות?' });
  await expect(form).toBeVisible();
  await form.getByRole('textbox', { name: 'ההערה' }).fill(text);
  await form.getByRole('button', { name: 'שליחה' }).click();
  const sent = page.getByTestId('feedback-sent');
  await expect(sent).toBeVisible();
  const reference = /fb-\d{8}-\d{6}-[0-9a-f]{6}/u.exec((await sent.textContent()) ?? '')?.[0];
  expect(reference, 'the thank-you shows the reference').toBeTruthy();
  return reference ?? '';
}

test.describe('a note about the whole screen', () => {
  test('is stored with the route and nothing that was on the screen', async ({ page }) => {
    await page.goto('/');
    // What the answer on the home screen says right now: figures and words alike.
    const heroText = await page.locator('[data-fb="hero"]').innerText();
    const onScreen = heroText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length >= 4);
    expect(onScreen.length, 'the hero has something to say').toBeGreaterThan(0);

    await open(page);
    await page.getByRole('button', { name: /הערה על כל המסך/u }).click();
    const reference = await writeAndSend(page, 'E2E הערה על המסך כולו');

    const note = storedNotes().find((candidate) => candidate.reference === reference);
    expect(note).toMatchObject({
      status: 'new',
      text: 'E2E הערה על המסך כולו',
      route: '/',
      device: 'desktop',
      mark: { type: 'page' },
    });

    const raw = rawNote(reference);
    for (const line of [...onScreen, '₪']) {
      expect(raw, `«${line}» was on the screen and must not be stored`).not.toContain(line);
    }
  });
});

test.describe('a note about one component', () => {
  test('carries the chain of names from the screen to the component', async ({ page }) => {
    await page.goto('/');
    const hero = page.locator('[data-fb="hero"]');
    await expect(hero).toBeVisible();
    const box = await hero.boundingBox();
    if (box === null) throw new Error('the hero has no box');

    await open(page);
    await page.getByRole('button', { name: /לבחור רכיב/u }).click();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.getByRole('button', { name: 'זה הרכיב' }).click();
    const reference = await writeAndSend(page, 'E2E להגדיל את הכותרת');

    const note = storedNotes().find((candidate) => candidate.reference === reference);
    expect(note?.mark.type).toBe('element');
    expect(note?.mark.chain).toEqual(['screen', 'hero']);
    expect(note?.mark.rect?.['width']).toBeGreaterThan(0);
  });

  test('"outer" climbs to the component around it', async ({ page }) => {
    await page.goto('/');
    const hero = page.locator('[data-fb="hero"]');
    const box = await hero.boundingBox();
    if (box === null) throw new Error('the hero has no box');

    await open(page);
    await page.getByRole('button', { name: /לבחור רכיב/u }).click();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.getByRole('button', { name: 'רכיב עוטף' }).click();
    await page.getByRole('button', { name: 'זה הרכיב' }).click();
    const reference = await writeAndSend(page, 'E2E על כל העמוד');

    const note = storedNotes().find((candidate) => candidate.reference === reference);
    expect(note?.mark.chain).toEqual(['screen']);
  });
});

test.describe('a note about a region', () => {
  test('stores the rectangle that was dragged, in page coordinates', async ({ page }) => {
    await page.goto('/');
    await open(page);
    await page.getByRole('button', { name: /לסמן אזור/u }).click();
    await expect(page.getByTestId('feedback-catcher')).toBeVisible();

    await page.mouse.move(400, 200);
    await page.mouse.down();
    await page.mouse.move(600, 300, { steps: 5 });
    await page.mouse.up();
    const reference = await writeAndSend(page, 'E2E האזור הזה עמוס');

    const note = storedNotes().find((candidate) => candidate.reference === reference);
    expect(note?.mark.type).toBe('region');
    expect(note?.mark.rect).toEqual({ x: 400, y: 200, width: 200, height: 100 });
  });
});

test.describe('the address is a template', () => {
  test('a lender page is stored as /lenders/[id]', async ({ page }) => {
    await page.goto('/lenders');
    const card = page.locator('section').filter({
      has: page.getByRole('heading', { name: LENDER_CARD, exact: true }),
    });
    await card.getByRole('link', { name: 'לכרטיס המלווה ולהיסטוריה המלאה' }).click();
    await expect(page.getByRole('heading', { level: 1, name: LENDER_CARD })).toBeVisible();

    await open(page);
    await page.getByRole('button', { name: /הערה על כל המסך/u }).click();
    const reference = await writeAndSend(page, 'E2E על דף המלווה');

    expect(storedNotes().find((candidate) => candidate.reference === reference)?.route).toBe(
      '/lenders/[id]',
    );
    expect(rawNote(reference)).not.toContain(LENDER_CARD);
  });
});

test.describe('the warning before sending', () => {
  test('stops the first press, and the second press sends', async ({ page }) => {
    await page.goto('/');
    await open(page);
    await page.getByRole('button', { name: /הערה על כל המסך/u }).click();

    const form = page.getByRole('dialog', { name: 'מה לשנות?' });
    await form.getByRole('textbox', { name: 'ההערה' }).fill('E2E כתוב 1,250 ₪ ולא 1,200');
    await form.getByRole('button', { name: 'שליחה' }).click();
    await expect(form.getByRole('alert')).toContainText('סכום');
    await expect(page.getByTestId('feedback-sent')).toHaveCount(0);

    await form.getByRole('button', { name: 'שליחה' }).click();
    await expect(page.getByTestId('feedback-sent')).toBeVisible();
  });
});

test.describe('leaving', () => {
  test('Escape closes from every stage and nothing is stored', async ({ page }) => {
    await page.goto('/');
    const before = storedNotes().length;

    await open(page);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await open(page);
    await page.getByRole('button', { name: /לסמן אזור/u }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('feedback-catcher')).toHaveCount(0);

    await open(page);
    await page.getByRole('button', { name: /הערה על כל המסך/u }).click();
    await page.getByRole('textbox', { name: 'ההערה' }).fill('E2E לא תישלח');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    expect(storedNotes()).toHaveLength(before);
  });
});

test.describe('the button stays out of the product', () => {
  test('its styles do not reach the page', async ({ page }) => {
    await page.goto('/');
    // The widget defines `.primary` and `.panel`; the product's own elements
    // with those words in their class must look exactly as they did.
    const outside = await page.evaluate(() => {
      const probe = document.createElement('button');
      probe.className = 'primary';
      document.body.appendChild(probe);
      const colour = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return colour;
    });
    expect(outside).not.toBe('rgb(30, 79, 115)');
  });
});
