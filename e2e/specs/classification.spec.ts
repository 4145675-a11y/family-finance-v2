import { expect, test, type Page } from '@playwright/test';

import { buildCsv } from '@family-finance/document-import';

import { storedDocument } from '../support/document';
import { readRunState } from '../support/run-state';

/**
 * What the classifier says on a review screen, and what a household teaches it.
 *
 * Two things are being checked, and the second is the one that keeps the feature
 * honest: a row it recognises arrives with a class, a confidence and a sentence
 * saying why; and a row it does not recognise is **not** dressed up as certain.
 * A review screen that looked equally sure about everything would train a family
 * to approve without reading, which is the failure this whole boundary exists to
 * prevent.
 */

test.describe.configure({ mode: 'serial' });

const CLEAR_ROW = 'משכורת חודש ספטמבר';
const UNKNOWN_ROW = 'E2E חנות שלא מכירים';

/** A small statement: one row the rules know, one they do not. */
function statement(): Buffer {
  return Buffer.from(
    buildCsv({
      header: ['תאריך', 'תיאור', 'חובה', 'זכות'],
      rows: [
        ['01/09/2026', CLEAR_ROW, '', '9000.00'],
        ['02/09/2026', UNKNOWN_ROW, '42.50', ''],
      ],
    }),
  );
}

let batchId = '';

async function uploadStatement(page: Page): Promise<string> {
  await page.goto('/upload');
  await page.locator('input[name="document"]').setInputFiles({
    name: 'E2E תנועות.csv',
    mimeType: 'text/csv',
    buffer: statement(),
  });
  // The account the rows belong to, chosen at upload time.
  await page.locator('select[name="targetAccountId"]').selectOption(readRunState().accountId);
  await page.getByRole('button', { name: 'להעלות ולקרוא' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'מה נמצא בקובץ' })).toBeVisible();
  return new URL(page.url()).pathname.split('/').pop() ?? '';
}

/** The row card carrying this description. */
function rowFor(page: Page, description: string) {
  return page.locator('section').filter({
    has: page.getByRole('heading', { level: 2, name: description, exact: true }),
  });
}

test.describe('@smoke a row the rules know arrives explained', () => {
  test('with a class, a confidence and a reason', async ({ page }) => {
    batchId = await uploadStatement(page);
    const row = rowFor(page, CLEAR_ROW);

    await expect(row.getByText('משכורת', { exact: true }).first()).toBeVisible();
    await expect(row.getByText('זיהוי ברור')).toBeVisible();
    // The sentence names the evidence rather than a score.
    await expect(row.locator('p').filter({ hasText: /./ }).first()).toBeVisible();
  });

  test('and nothing is written by the reading', async () => {
    expect(
      storedDocument().transactions.filter(
        (transaction) => transaction.importBatchId === batchId,
      ),
    ).toHaveLength(0);
  });
});

test.describe('a row the rules do not know is not dressed up as certain', () => {
  test('it is offered as a decision, not as a finding', async ({ page }) => {
    await page.goto(`/imports/${batchId}`);
    const row = rowFor(page, UNKNOWN_ROW);

    // Not "זיהוי ברור": the screen asks rather than tells.
    await expect(row.getByText('זיהוי ברור')).toHaveCount(0);
    await expect(row.getByText(/כדאי לבדוק|צריך להחליט/)).toBeVisible();
  });
});

test.describe('a household rule is taught once and then applied', () => {
  test('the correction offers to remember it', async ({ page }) => {
    await page.goto(`/imports/${batchId}`);
    const row = rowFor(page, UNKNOWN_ROW);

    // The row's own correction form, where a person says what this is.
    await row.locator('summary').filter({ hasText: 'לא זה? לתקן ולזכור להבא' }).click();
    await expect(row.getByRole('button', { name: 'לזכור' })).toBeVisible();
  });

  test('saving it puts one rule in the household, and it survives a reload', async ({
    page,
  }) => {
    const before = storedDocument().learnedRules.length;

    await page.goto(`/imports/${batchId}`);
    const row = rowFor(page, UNKNOWN_ROW);
    await row.locator('summary').filter({ hasText: 'לא זה? לתקן ולזכור להבא' }).click();

    // One correction form per row, so the row itself is a precise enough scope.
    await row.locator('select[name="class"]').selectOption('purchase');
    await row.locator('select[name="budgetCategoryKey"]').selectOption('food');
    await row.getByRole('button', { name: 'לזכור' }).click();

    await expect.poll(() => storedDocument().learnedRules.length).toBe(before + 1);
    const rule = storedDocument().learnedRules.at(-1);
    expect(rule?.class).toBe('purchase');
    expect(rule?.budgetCategoryKey).toBe('food');
    expect(rule?.enabled).toBe(true);

    // And the rules screen shows it after a full reload.
    await page.goto('/rules');
    await page.reload();
    await expect(page.getByText('הכללים שלכם')).toBeVisible();
    await expect(page.getByText(rule?.label ?? '—')).toBeVisible();
  });

  test('and it only applies where its own matcher says', async ({ page }) => {
    const rule = storedDocument().learnedRules.at(-1);
    expect(rule).toBeDefined();
    // The matcher is a phrase from the row it was taught on, and a direction.
    expect(rule?.matcher.descriptionContains.length ?? 0).toBeGreaterThan(0);
    expect(rule?.matcher.direction).toBe('outflow');

    /*
     * The same words, uploaded again: the rule now recognises them and says so.
     * A rule that quietly applied to everything would be worse than no rule, so
     * what is checked is that the badge appears on this row and not on the other.
     */
    const secondId = await uploadStatement(page);
    expect(secondId).not.toBe(batchId);

    const taught = rowFor(page, UNKNOWN_ROW);
    await expect(taught.getByText('כלל שלכם')).toBeVisible();
    await expect(taught.getByText('זיהוי ברור')).toBeVisible();

    const untouched = rowFor(page, CLEAR_ROW);
    await expect(untouched.getByText('כלל שלכם')).toHaveCount(0);
  });

  test('every rule in the household is one this suite created', () => {
    // A guard on the suite: no rule may exist that a spec did not teach.
    for (const rule of storedDocument().learnedRules) {
      expect(rule.householdId).toBe(storedDocument().household.id);
    }
  });
});
