import { expect, test } from '@playwright/test';

import { aiProposal, aiUnavailable, analyse } from '../support/ai';
import { approve, interpret, onlyProposal } from '../support/quick';
import { storedDocument, transactionsFor } from '../support/document';

/**
 * The deployment as it stands today: no smart reader configured.
 *
 * This runs against a second server started with neither `OPENAI_API_KEY` nor the
 * test-provider flag — which is exactly how the hosted service is configured
 * right now. Everything here is therefore a statement about what the owner would
 * see if they opened the product this minute.
 *
 * The requirement being checked is narrow and important: the application must
 * stay completely usable, and it must **not pretend that anything read the
 * sentence**. A screen that showed a spinner and then a plausible proposal with
 * nothing behind it would be the worst outcome this feature could have.
 */

test.describe.configure({ mode: 'serial' });

test.describe('@smoke nothing is set up, and the screen says so', () => {
  test('the quick screen loads and works', async ({ page }) => {
    await page.goto('/quick');
    await expect(page.getByRole('heading', { level: 1, name: 'עדכון מהיר' })).toBeVisible();
    await expect(page.getByLabel('מה קרה?')).toBeEditable();
  });

  test('the note says smart reading is not set up here, before anybody presses', async ({
    page,
  }) => {
    await page.goto('/quick');
    const note = page.getByTestId('ai-privacy');
    await expect(note).toContainText('אף אחד לא הגדיר כאן חיבור לשירות חיצוני');
    // And it does not claim anything is being sent anywhere.
    await expect(note).not.toContainText('נשלח לשירות חיצוני');
  });

  test('pressing it explains, and offers the route that does work', async ({ page }) => {
    await analyse(page, 'היום שילמתי 120 שקל במכולת');

    const notice = aiUnavailable(page);
    await expect(notice).toBeVisible();
    await expect(notice).toHaveAttribute('data-reason', 'not_configured');
    await expect(notice).toContainText('אף אחד לא הגדיר כאן חיבור לשירות חיצוני');
    await expect(notice).toContainText('הקריאה הרגילה');
  });

  test('and no proposal is offered, so nothing can be confirmed', async ({ page }) => {
    await analyse(page, 'היום שילמתי 120 שקל במכולת');
    await expect(aiProposal(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'לאשר ולרשום' })).toHaveCount(0);
  });

  test('pressing it writes nothing at all', async ({ page }) => {
    const before = JSON.stringify(storedDocument());
    await analyse(page, 'היום שילמתי 120 שקל במכולת');
    expect(JSON.stringify(storedDocument())).toBe(before);
  });
});

test.describe('the deterministic route is untouched', () => {
  const MERCHANT = 'בקיוסק ללא בינה';

  test('a sentence is read, proposed, confirmed and persisted', async ({ page }) => {
    const before = transactionsFor(MERCHANT).length;

    await interpret(page, `היום שילמתי 26 שקל ${MERCHANT}`);
    const card = await onlyProposal(page);
    await approve(card);

    await expect(page.getByText('נרשם.')).toBeVisible();
    expect(transactionsFor(MERCHANT)).toHaveLength(before + 1);
  });

  test('and it survives a reload, on the history screen', async ({ page }) => {
    await page.goto('/activity');
    await page.reload();
    const records = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'מה נרשם' }),
    });
    await expect(records.getByText(MERCHANT).first()).toBeVisible();
  });

  test('the service itself reports healthy with no reader configured', async ({ request }) => {
    // The claim the production smoke check makes: an absent key is not an
    // unhealthy deployment.
    const response = await request.get('/api/health');
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { status: string };
    expect(body.status).toBe('ok');
  });
});
