import { expect, test, type Page } from '@playwright/test';

import { asShekels, balanceOf, storedDocument } from '../support/document';
import { debtWorkbook } from '../support/workbook';

/**
 * A spreadsheet crossing the approval boundary, in a browser.
 *
 * The question this file answers is the one a family asks before they upload
 * anything: what happens to my numbers between choosing the file and pressing
 * approve? The answer has to be "nothing", and it has to be observable — so every
 * stage checks the persisted document rather than the screen.
 *
 * The workbook is generated in memory and never committed. Its lenders are all
 * prefixed `E2E`.
 */

test.describe.configure({ mode: 'serial' });

const FILE_LENDER = 'E2E גמח מהקובץ';
const FILE_LENDER_MINOR = 4_500_000;
const HEDGED_LENDER = 'E2E מלווה עם תאריך מסופק';

/** Every lender the workbook names, in the order the rows appear. */
const FILE_LENDERS = [FILE_LENDER, 'E2E קופת חסד מהקובץ', HEDGED_LENDER] as const;

/** Uploads the generated workbook and lands on its review screen. */
async function upload(page: Page): Promise<string> {
  const workbook = debtWorkbook();
  await page.goto('/upload');
  await page.locator('input[name="document"]').setInputFiles({
    name: workbook.name,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: workbook.bytes,
  });
  await page.getByRole('button', { name: 'להעלות ולקרוא' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'מה נמצא בקובץ' })).toBeVisible();
  const url = new URL(page.url());
  const id = url.pathname.split('/').pop() ?? '';
  expect(id.length).toBeGreaterThan(0);
  return id;
}

let batchId = '';

/** What is owed to a lender in total, across every debt carrying that name. */
function totalOwedTo(creditorName: string): number {
  return storedDocument()
    .debts.filter((row) => row.creditorName === creditorName)
    .reduce((total, row) => total + balanceOf(row.id), 0);
}

test.describe('@smoke reading a file changes nothing', () => {
  test('the review screen appears and no debt was created', async ({ page }) => {
    const debtsBefore = storedDocument().debts.length;

    batchId = await upload(page);

    // The promise, said on the screen before anything is decided.
    await expect(
      page.getByText('שום דבר מהקובץ לא נכנס לחשבון לפני שתעברו עליו ותאשרו.'),
    ).toBeVisible();
    await expect(page.getByText('ממתין לבדיקה ואישור').first()).toBeVisible();

    // And kept: the document has the batch, and not one new debt.
    const document = storedDocument();
    expect(document.debts).toHaveLength(debtsBefore);
    expect(document.importBatches.map((batch) => batch.id)).toContain(batchId);
    expect(document.importProposals.length).toBeGreaterThan(0);
  });

  test('the screen says what it recognised', async ({ page }) => {
    await page.goto(`/imports/${batchId}`);

    // Which kind of document, and which columns it read as what.
    await expect(page.getByText('סוג המסמך')).toBeVisible();
    await expect(page.getByText('רשימת חובות פרטיים')).toBeVisible();
    // A debt list has no usable headers, so the screen explains how it read the
    // columns by their contents instead (ADR-0035).
    await expect(page.getByText('הכותרות בקובץ לא אומרות מה יש בעמודות')).toBeVisible();
    await expect(
      page.getByText('קראנו את העמודות לפי התוכן שלהן. כך הבנו אותן:'),
    ).toBeVisible();
    await expect(page.getByText('שם המלווה — העמודה שבה יש שמות')).toBeVisible();
    // The lenders the file named, offered as rows rather than applied.
    await expect(page.getByText(FILE_LENDER).first()).toBeVisible();
  });

  test('and says which row it is not sure about, and why', async ({ page }) => {
    await page.goto(`/imports/${batchId}`);
    // The hedged date is carried as written and not resolved into a due date.
    await expect(page.getByText(HEDGED_LENDER).first()).toBeVisible();
    // Carried as written, with the reason it was not turned into a date.
    await expect(page.getByText('מה שכתוב בקובץ: בערך ג׳ טבת תשפ״ז')).toBeVisible();
    await expect(page.getByText('התאריך נכתב כהערכה, ולכן לא נקבע תאריך')).toBeVisible();
  });
});

test.describe('approving is what creates the debts', () => {
  test('the rows are included, then approved', async ({ page }) => {
    await page.goto(`/imports/${batchId}`);

    // Include everything the reader proposed, through the screen's own control.
    await page.getByRole('button', { name: 'להכניס את כל מה שלא הוכרע' }).click();
    await expect(page.getByText(/שורות ייכנסו לתמונה הפיננסית|שורה אחת תיכנס/)).toBeVisible();

    const debtsBefore = storedDocument().debts.length;
    await page.getByRole('button', { name: 'לאשר ולהכניס' }).click();
    await expect(page.getByText('מה השתנה')).toBeVisible();

    expect(storedDocument().debts.length).toBeGreaterThan(debtsBefore);
  });

  test('the lender from the file has a card, with the balance the file stated', async ({
    page,
  }) => {
    const debt = storedDocument().debts.find((row) => row.creditorName === FILE_LENDER);
    expect(debt).toBeDefined();
    expect(balanceOf(debt?.id ?? '')).toBe(FILE_LENDER_MINOR);

    await page.goto('/lenders');
    await page.reload();
    const card = page.locator('section').filter({
      has: page.getByRole('heading', { name: FILE_LENDER, exact: true }),
    });
    await expect(card.getByText(asShekels(FILE_LENDER_MINOR))).toBeVisible();
  });

  test('the row whose date was hedged has no due date, and says so', async ({ page }) => {
    const debt = storedDocument().debts.find((row) => row.creditorName === HEDGED_LENDER);
    expect(debt).toBeDefined();
    // Not guessed into a real date.
    expect(debt?.dueDate?.gregorian ?? null).toBeNull();

    await page.goto('/lenders');
    // One attention card now, rather than one per kind of thing to attend to.
    await expect(page.getByRole('heading', { name: 'מה דורש טיפול' })).toBeVisible();
    await expect(page.getByText(/תאריך פירעון שלא הצלחנו לקרוא/u)).toBeVisible();
  });
});

test.describe('the same file uploaded twice does not double the money', () => {
  let secondId = '';

  test('uploading it again creates a batch and changes no figure', async ({ page }) => {
    const debtsBefore = storedDocument().debts.length;

    secondId = await upload(page);
    expect(secondId).not.toBe(batchId);

    // Reading is still reading, even the second time.
    expect(storedDocument().debts).toHaveLength(debtsBefore);
  });

  test('every row is flagged as a lender that already exists', async ({ page }) => {
    await page.goto(`/imports/${secondId}`);
    await page.getByRole('button', { name: 'להכניס את כל מה שלא הוכרע' }).click();

    // The row says so…
    await expect(page.getByText('המלווה הזה כבר קיים').first()).toBeVisible();
    await expect(
      page.getByText('צריך לומר אם מדובר באותו מלווה', { exact: false }).first(),
    ).toBeVisible();
  });

  test('and approval is blocked, with the reason that actually applies', async ({ page }) => {
    await page.goto(`/imports/${secondId}`);

    // Not merely a disabled button: the control is not offered at all.
    await expect(page.getByRole('button', { name: 'לאשר ולהכניס' })).toHaveCount(0);
    await expect(page.getByText('עוד אי אפשר לאשר')).toBeVisible();
    await expect(
      page.getByText(
        'יש שורות שהמלווה בהן כבר קיים. צריך לומר בכל אחת אם זה אותו מלווה או מלווה אחר.',
      ),
    ).toBeVisible();
    // And the wrong reason is not shown.
    await expect(page.getByText('יש שורות שעוד לא ברור לאיזה חשבון הן שייכות.')).toHaveCount(0);
  });

  test('naming the existing lender is what unblocks it', async ({ page }) => {
    /*
     * The documented way out: say, per row, that this is the lender you already
     * have. The import then adds the amount to that lender's history instead of
     * opening a second card — which is the "they lent us more" reading, chosen by
     * a person rather than guessed from the file.
     */
    for (const lender of FILE_LENDERS) {
      await page.goto(`/imports/${secondId}`);
      const row = page.locator('section').filter({
        has: page.getByRole('heading', { level: 2, name: lender, exact: true }),
      });
      // The attachment form is behind a <details>; opening it is the journey.
      await row.locator('summary').filter({ hasText: 'מאיזה חשבון' }).click();
      await row.locator('select[name="targetDebtId"]').selectOption({ label: lender });
      await row.getByRole('button', { name: 'לשמור' }).click();
      await expect(row.getByText('נשמר.')).toBeVisible();
    }

    await page.goto(`/imports/${secondId}`);
    await expect(page.getByRole('button', { name: 'לאשר ולהכניס' })).toBeVisible();
  });

  test('and approving joins the history rather than opening a second card', async ({
    page,
  }) => {
    const owedBefore = totalOwedTo(FILE_LENDER);
    const cardsBefore = storedDocument().debts.filter(
      (row) => row.creditorName === FILE_LENDER,
    ).length;
    expect(cardsBefore).toBe(1);

    await page.goto(`/imports/${secondId}`);
    await page.getByRole('button', { name: 'לאשר ולהכניס' }).click();
    await expect(page.getByText('מה השתנה')).toBeVisible();

    // Still one lender. The second file's figure joined its history.
    expect(
      storedDocument().debts.filter((row) => row.creditorName === FILE_LENDER),
    ).toHaveLength(1);
    expect(totalOwedTo(FILE_LENDER)).toBe(owedBefore + FILE_LENDER_MINOR);
  });

  test('an already-approved import offers no way to approve it again', async ({ page }) => {
    await page.goto(`/imports/${batchId}`);
    await expect(page.getByRole('button', { name: 'לאשר ולהכניס' })).toHaveCount(0);
    await expect(page.getByText('אושר').first()).toBeVisible();
    await expect(page.getByText('מה השתנה')).toBeVisible();
  });

  test('so the file read twice left one lender, not two', async () => {
    // The point of the whole section: a family who uploaded the same list twice
    // has one card per lender, and had to say so on purpose.
    const names = storedDocument().debts.map((row) => row.creditorName);
    expect(names.filter((name) => name === FILE_LENDER)).toHaveLength(1);
    expect(new Set(names).size).toBe(names.length);
  });
});
