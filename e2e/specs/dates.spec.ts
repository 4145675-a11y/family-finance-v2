import { expect, test, type Page } from '@playwright/test';

import { buildXlsx } from '@family-finance/document-import';
import { hebrewMonthNumber } from '@family-finance/hebrew-calendar';

import { storedDocument } from '../support/document';

/**
 * Two calendars on one screen, and the dates that must not be guessed.
 *
 * The figures here are not invented for this file: every Hebrew string is one the
 * `@family-finance/hebrew-calendar` tests already pin, with the Gregorian day it
 * resolves to. That matters — a browser test that made up its own calendar
 * arithmetic would be asserting against a second implementation, which is exactly
 * what ADR-0035 exists to prevent.
 *
 *   ז׳ טבת תשפ״ז   → 2026-12-17, and reads cleanly
 *   ל׳ כסלו תשפ״ד   → Kislev has 29 days that year, so there is no 30th
 *   ד׳ אדר תשפ״ז   → 5787 has two Adars, so a bare Adar names neither
 *   בערך ז׳ טבת תשפ״ז → hedged, and a hedged date is not a date
 */

test.describe.configure({ mode: 'serial' });

const CLEAN = 'E2E מלווה תאריך תקין';
const CLEAN_HEBREW = 'ז׳ טבת תשפ״ז';
const CLEAN_GREGORIAN = '17/12/2026';

const NO_SUCH_DAY = 'E2E מלווה יום שאינו קיים';
const TWO_ADARS = 'E2E מלווה אדר כפול';
const HEDGED = 'E2E מלווה תאריך משוער';

function calendarWorkbook(): Buffer {
  return Buffer.from(
    buildXlsx([
      {
        name: 'חובות',
        rows: [
          ['מזהה', 'שדה1', 'שדה2', 'שדה3'],
          ['1', CLEAN, 11_000, CLEAN_HEBREW],
          ['2', NO_SUCH_DAY, 12_000, 'ל׳ כסלו תשפ״ד'],
          ['3', TWO_ADARS, 13_000, 'ד׳ אדר תשפ״ז'],
          ['4', HEDGED, 14_000, 'בערך ז׳ טבת תשפ״ז'],
        ],
      },
    ]),
  );
}

let batchId = '';

async function uploadCalendarList(page: Page): Promise<string> {
  await page.goto('/upload');
  await page.locator('input[name="document"]').setInputFiles({
    name: 'E2E מועדים.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: calendarWorkbook(),
  });
  await page.getByRole('button', { name: 'להעלות ולקרוא' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'מה נמצא בקובץ' })).toBeVisible();
  return new URL(page.url()).pathname.split('/').pop() ?? '';
}

test.describe('@smoke a date that reads is shown in both calendars', () => {
  test('the review screen prints the Hebrew form and the Gregorian one', async ({ page }) => {
    batchId = await uploadCalendarList(page);
    const row = page.locator('section').filter({
      has: page.getByRole('heading', { level: 2, name: CLEAN, exact: true }),
    });
    await expect(row.getByText(`עברי: ${CLEAN_HEBREW}`)).toBeVisible();
    await expect(row.getByText(`לועזי: ${CLEAN_GREGORIAN}`)).toBeVisible();
  });
});

test.describe('a date that does not read stays in review', () => {
  test('a day its month does not have is carried as written, with the reason', async ({
    page,
  }) => {
    await page.goto(`/imports/${batchId}`);
    const row = page.locator('section').filter({
      has: page.getByRole('heading', { level: 2, name: NO_SUCH_DAY, exact: true }),
    });
    await expect(row.getByText('מה שכתוב בקובץ: ל׳ כסלו תשפ״ד')).toBeVisible();
    await expect(row.getByText('לבדיקה')).toBeVisible();
    // And no resolved date is offered beside it.
    await expect(row.getByText('לועזי:')).toHaveCount(0);
  });

  test('a bare Adar in a leap year names neither of them', async ({ page }) => {
    await page.goto(`/imports/${batchId}`);
    const row = page.locator('section').filter({
      has: page.getByRole('heading', { level: 2, name: TWO_ADARS, exact: true }),
    });
    await expect(row.getByText('מה שכתוב בקובץ: ד׳ אדר תשפ״ז')).toBeVisible();
    await expect(row.getByText('לועזי:')).toHaveCount(0);
  });

  test('a hedged date is not a date', async ({ page }) => {
    await page.goto(`/imports/${batchId}`);
    const row = page.locator('section').filter({
      has: page.getByRole('heading', { level: 2, name: HEDGED, exact: true }),
    });
    await expect(row.getByText('התאריך נכתב כהערכה, ולכן לא נקבע תאריך')).toBeVisible();
    await expect(row.getByText('לועזי:')).toHaveCount(0);
  });
});

test.describe('both calendars survive approval and a reload', () => {
  test('the approved debt carries the Hebrew date and the Gregorian one', async ({ page }) => {
    await page.goto(`/imports/${batchId}`);
    await page.getByRole('button', { name: 'להכניס את כל מה שלא הוכרע' }).click();
    await page.getByRole('button', { name: 'לאשר ולהכניס' }).click();
    await expect(page.getByText('מה השתנה')).toBeVisible();

    // In the document: both forms stored, neither derived on the fly.
    const debt = storedDocument().debts.find((row) => row.creditorName === CLEAN);
    expect(debt?.dueDate?.gregorian).toBe('2026-12-17');
    // Both forms stored, and the cell kept exactly as the family wrote it.
    // The month number comes from the calendar package rather than from this
    // file: a literal here would be a second opinion about hebcal's numbering.
    expect(debt?.dueDate?.hebrew).toEqual({
      day: 7,
      month: hebrewMonthNumber('טבת', 5787),
      year: 5787,
    });
    expect(debt?.dueDate?.isHebrew).toBe(true);
    expect(debt?.dueDate?.sourceText).toBe(CLEAN_HEBREW);

    // On the lender's card, after a full reload.
    await page.goto('/lenders');
    await page.reload();
    const card = page.locator('section').filter({
      has: page.getByRole('heading', { name: CLEAN, exact: true }),
    });
    await expect(card.getByText(CLEAN_HEBREW)).toBeVisible();
    await expect(card.getByText(CLEAN_GREGORIAN)).toBeVisible();
  });

  test('and the one that could not be read has no due date at all', async ({ page }) => {
    for (const name of [NO_SUCH_DAY, TWO_ADARS, HEDGED]) {
      const debt = storedDocument().debts.find((row) => row.creditorName === name);
      expect(debt, name).toBeDefined();
      // Never guessed into a real day.
      expect(debt?.dueDate?.gregorian ?? null, name).toBeNull();
    }

    // The lenders screen says which ones still need a person.
    await page.goto('/lenders');
    await expect(page.getByText('מועדים שצריך להשלים')).toBeVisible();
    await expect(page.getByRole('link', { name: HEDGED })).toBeVisible();
  });
});
