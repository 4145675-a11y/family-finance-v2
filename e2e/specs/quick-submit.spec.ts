import { expect, test, type Page } from '@playwright/test';

import { storedDocument } from '../support/document';
import { ACCOUNT_NAME } from '../support/household';
import { accountQuestion, onlyProposal } from '../support/quick';

/**
 * Sending the sentence without reaching for a button.
 *
 * A quick update is one sentence, so the key that ends a sentence should be the
 * key that sends it, and letting go of the microphone should be enough on its
 * own. Both of these start a **reading** and nothing else — the rule this file
 * exists to hold is that an effortless way in does not become an effortless way
 * to write. Every test here checks the document is untouched afterwards.
 *
 * The button stays. It is the only visible affordance on a phone, where there is
 * no Enter to press and no Shift to hold.
 */

/**
 * A sentence the rule table reads on its own, so no reader has to be configured.
 *
 * Its own shop. The last test here confirms, so the record it leaves would be
 * counted by any other spec asserting on the same merchant — which is exactly
 * what happened with "בפרחים" the first time this file was written.
 */
const SENTENCE = 'היום שילמתי 23 שקל בכלבו';

/**
 * A speech recogniser that says one thing and stops.
 *
 * The browser's own API is not available to a headless run and cannot be driven
 * from a test even where it is: it needs a microphone and a person. This stands
 * in for the **browser capability** only — everything it feeds is an ordinary
 * transcript arriving through the ordinary handler, and nothing financial is
 * replaced. The suite already does the mirror image of this, deleting the API to
 * prove the typed path stands alone.
 */
async function withRecogniser(page: Page, transcript: string): Promise<void> {
  await page.addInitScript((said: string) => {
    class Recogniser {
      lang = '';
      continuous = false;
      interimResults = false;
      onresult: ((event: unknown) => void) | null = null;
      onerror: (() => void) | null = null;
      onend: (() => void) | null = null;

      start(): void {
        // Asynchronous, like the real thing: a result, then the end.
        setTimeout(() => {
          this.onresult?.({
            resultIndex: 0,
            results: { length: 1, 0: { isFinal: true, length: 1, 0: { transcript: said } } },
          });
          this.onend?.();
        }, 10);
      }

      stop(): void {
        // The real API ends the session; `onend` is already scheduled by start.
      }
    }

    Object.defineProperty(window, 'SpeechRecognition', {
      value: Recogniser,
      configurable: true,
    });
  }, transcript);
}

test.describe('@smoke Enter sends the sentence', () => {
  test('and a proposal comes back without the button being pressed', async ({ page }) => {
    const before = JSON.stringify(storedDocument());

    await page.goto('/quick');
    const box = page.getByLabel('מה לעדכן?');
    await box.fill(SENTENCE);
    await box.press('Enter');

    const card = await onlyProposal(page);
    await expect(card).toContainText('טיוטה — עדיין לא נשמרה');

    // A reading, and only a reading.
    expect(JSON.stringify(storedDocument())).toBe(before);
  });

  test('Shift+Enter writes a new line instead of sending', async ({ page }) => {
    await page.goto('/quick');
    const box = page.getByLabel('מה לעדכן?');

    await box.fill('שורה ראשונה');
    await box.press('Shift+Enter');
    await box.pressSequentially('שורה שנייה');

    await expect(box).toHaveValue('שורה ראשונה\nשורה שנייה');
    // Nothing was sent: no card, and no "we did not understand" either.
    await expect(page.getByTestId('quick-proposal')).toHaveCount(0);
    await expect(page.getByTestId('quick-not-understood')).toHaveCount(0);
  });

  test('an empty box does nothing at all, rather than complaining', async ({ page }) => {
    await page.goto('/quick');
    const box = page.getByLabel('מה לעדכן?');

    await box.press('Enter');
    await box.fill('   ');
    await box.press('Enter');

    await expect(page.getByTestId('quick-proposal')).toHaveCount(0);
    await expect(page.getByTestId('quick-not-understood')).toHaveCount(0);
    await expect(page.getByText('צריך לכתוב או להקריא משהו קודם.')).toHaveCount(0);
  });

  test('and the button still works, because a phone has no Enter to press', async ({
    page,
  }) => {
    await page.goto('/quick');
    await page.getByLabel('מה לעדכן?').fill(SENTENCE);
    await page.getByRole('button', { name: 'הצע עדכון' }).click();

    await expect(await onlyProposal(page)).toBeVisible();
  });
});

test.describe('stopping a recording sends it too', () => {
  test('the transcript is read on its own, and still writes nothing', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await withRecogniser(page, SENTENCE);

    const before = JSON.stringify(storedDocument());

    await page.goto('/quick');
    await page.getByRole('button', { name: 'הקלטה' }).click();

    /*
     * Nothing else is pressed from here. The recogniser reports what it heard
     * and ends, and that is what starts the reading.
     */
    const card = await onlyProposal(page);
    await expect(card).toContainText('טיוטה — עדיין לא נשמרה');
    // The words reached the box, so nothing spoken was dropped on the way.
    await expect(page.getByLabel('מה לעדכן?')).toHaveValue(SENTENCE);

    expect(JSON.stringify(storedDocument())).toBe(before);

    await context.close();
  });

  test('and only an explicit confirmation records it', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await withRecogniser(page, SENTENCE);

    const before = storedDocument().transactions.length;

    await page.goto('/quick');
    await page.getByRole('button', { name: 'הקלטה' }).click();
    const card = await onlyProposal(page);

    // Still nothing, with a complete proposal on the screen.
    expect(storedDocument().transactions).toHaveLength(before);

    if (await accountQuestion(card).isVisible()) {
      await accountQuestion(card).getByRole('button', { name: ACCOUNT_NAME }).click();
    }
    // Answering the question is not confirming it either.
    expect(storedDocument().transactions).toHaveLength(before);

    await card.getByRole('button', { name: 'אישור ורישום' }).click();
    await expect(page.getByText('נרשם.')).toBeVisible();
    expect(storedDocument().transactions).toHaveLength(before + 1);

    await context.close();
  });
});
