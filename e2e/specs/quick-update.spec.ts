import { expect, test } from '@playwright/test';

import {
  approve,
  interpret,
  onlyProposal,
  proposals,
  stateOf,
  submissionKeyOf,
} from '../support/quick';
import {
  accountBalanceMinor,
  asShekels,
  balanceOf,
  debtIdByName,
  eventsFor,
  storedDocument,
  transactionsFor,
} from '../support/document';
import { ACCOUNT_NAME, LENDER_OVERLAP_B, LENDER_PLAIN } from '../support/household';
import { readRunState } from '../support/run-state';

/**
 * The quick update, in a browser, against a real document on disk.
 *
 * The unit tests already prove the sentence is read correctly. What only a
 * browser can prove is the part a family actually experiences: that looking at a
 * proposal writes nothing, that approving writes exactly one thing, that the
 * thing survives a reload, and that pressing approve a second time after a lost
 * response does not pay the money twice.
 *
 * Every assertion about "a record exists" reads the persisted document, not the
 * screen. A screen can say נרשם because a component decided to.
 */

test.describe.configure({ mode: 'serial' });

test.describe('@smoke reading a sentence writes nothing', () => {
  test('a proposal appears, and the document is untouched', async ({ page }) => {
    const before = storedDocument().transactions.length;

    await interpret(page, 'היום שילמתי 120 שקל בסופר');
    const card = await onlyProposal(page);

    await expect(card).toContainText('כסף שיצא');
    expect(await stateOf(card)).toBe('ready');
    // The sum is offered for checking, in shekels, in an editable field.
    await expect(card.getByLabel('סכום')).toHaveValue('120.00');

    expect(storedDocument().transactions).toHaveLength(before);
  });

  test('leaving the screen without approving still writes nothing', async ({ page }) => {
    const before = storedDocument().transactions.length;

    await interpret(page, 'היום שילמתי 77 שקל בקיוסק');
    await onlyProposal(page);
    // The way a person abandons a proposal: they go somewhere else.
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    expect(storedDocument().transactions).toHaveLength(before);
  });
});

test.describe('the screen says where the point of no return is', () => {
  test('the promise is on the page before anything is typed', async ({ page }) => {
    await page.goto('/quick');
    // The same promise the upload screen makes above its file picker.
    await expect(page.getByText('שום דבר לא נרשם לפני שתראו מה הבנו ותאשרו.')).toBeVisible();
  });

  test('a proposal states the category as a category, and contradicts nothing', async ({
    page,
  }) => {
    await interpret(page, 'היום שילמתי 52 שקל בחנות שאיננו מכירים');
    const card = await onlyProposal(page);

    // The verdict, and then what will be recorded.
    expect(await stateOf(card)).toBe('ready');
    await expect(card).toContainText('הבנו: כסף שיצא.');

    /*
     * The category is undecided, and it says so as a fact about the envelope.
     * What it must not do is sit beside "מוכן לאישור" saying "לא זיהינו מה השורה
     * הזאת" — which is true of the category and reads, to anybody who has not
     * read the classifier, as a denial of the sentence above it.
     */
    await expect(card).toContainText('קטגוריה: בלי קטגוריה');
    await expect(card.getByText('לא זיהינו מה השורה הזאת')).toHaveCount(0);
  });

  test('and a category the rules do know is named', async ({ page }) => {
    await interpret(page, 'היום שילמתי 90 שקל על חשמל');
    const card = await onlyProposal(page);
    await expect(card).toContainText('קטגוריה: דיור וחשבונות');
  });
});

test.describe('approving records exactly one expense', () => {
  const SENTENCE = 'היום שילמתי 120 שקל בסופר';
  const MERCHANT = 'בסופר';

  test('the record exists after approval', async ({ page }) => {
    await interpret(page, SENTENCE);
    const card = await onlyProposal(page);
    await approve(card);

    await expect(page.getByText('נרשם.')).toBeVisible();
    expect(transactionsFor(MERCHANT)).toHaveLength(1);
    expect(transactionsFor(MERCHANT)[0]?.amountMinor).toBe(12_000);
    expect(transactionsFor(MERCHANT)[0]?.direction).toBe('outflow');
  });

  test('and reaches the account balance, after a full reload', async ({ page }) => {
    // The strongest reload check available: a figure the server recomputed from
    // the document it re-read, not a value the browser was holding.
    const expected = asShekels(accountBalanceMinor(readRunState().accountId));

    await page.goto('/accounts');
    await page.reload();
    const card = page.locator('section').filter({
      has: page.getByRole('heading', { name: ACCOUNT_NAME }),
    });
    await expect(card.getByText(expected).first()).toBeVisible();
  });
});

test.describe('a retry after a lost response records nothing new', () => {
  /*
   * The scenario this reproduces is the one that actually happens: the write
   * reaches the server, the answer never reaches the browser, and the person
   * presses approve again. Aborting the *response* rather than the request is
   * what makes it faithful — the record really is written the first time.
   *
   * It is deliberately not "click twice quickly". The button disables itself
   * while a submission is in flight, so a double click proves the button works
   * and says nothing about what reached the document.
   *
   * One test rather than two, because it is one browsing session: the identifier
   * an open form carries lives in that tab's `sessionStorage`, and a second test
   * would get a fresh context and therefore a different submission — which would
   * make the assertion pass for the wrong reason.
   */
  const SENTENCE = 'היום שילמתי 64 שקל במאפייה';
  const MERCHANT = 'במאפייה';

  test('the write lands once, and the retry is told it already did', async ({ page }) => {
    await interpret(page, SENTENCE);
    const firstCard = await onlyProposal(page);
    const firstKey = await submissionKeyOf(firstCard);

    let swallowed = false;
    await page.route('**/quick', async (route) => {
      if (route.request().method() !== 'POST' || swallowed) {
        await route.continue();
        return;
      }
      swallowed = true;
      // The server really processes it; only the answer is dropped.
      await route.fetch();
      await route.abort('failed');
    });

    await approve(firstCard);
    await expect.poll(() => transactionsFor(MERCHANT).length).toBe(1);
    expect(swallowed).toBe(true);

    // The answer gets through from here on: this is the person trying again.
    await page.unroute('**/quick');

    await interpret(page, SENTENCE);
    const retryCard = await onlyProposal(page);

    /*
     * The same submission, because the page never saw a success and so never
     * rotated the identifier. Asserted rather than assumed: if this stopped
     * holding, the test below would pass while proving nothing.
     */
    expect(await submissionKeyOf(retryCard)).toBe(firstKey);

    await approve(retryCard);
    await expect(page.getByText('הפעולה הזו כבר נרשמה. לא נוצרה רשומה כפולה.')).toBeVisible();
    expect(transactionsFor(MERCHANT)).toHaveLength(1);
  });
});

test.describe('what the sentence did not say is asked for, not invented', () => {
  test('no amount means no record and a field to fill', async ({ page }) => {
    const before = storedDocument().transactions.length;

    await interpret(page, 'שילמתי בסופר');
    const card = await onlyProposal(page);

    expect(await stateOf(card)).toBe('needs_amount');
    await expect(card).toContainText('לא זיהינו סכום');
    // Offered empty rather than as zero.
    await expect(card.getByLabel('סכום')).toHaveValue('');

    expect(storedDocument().transactions).toHaveLength(before);
  });

  test('a repayment naming no lender waits for the choice', async ({ page }) => {
    const debtId = debtIdByName(LENDER_PLAIN);
    const before = eventsFor(debtId).length;

    await interpret(page, 'היום החזרתי 200 שקל להלוואה');
    const card = await onlyProposal(page);

    expect(await stateOf(card)).toBe('needs_debt');
    await expect(card.getByLabel('הלוואה')).toBeVisible();
    expect(eventsFor(debtId)).toHaveLength(before);
  });

  test('a repayment naming two lenders at once picks neither', async ({ page }) => {
    // Naming the branch names the parent gemach too, so two debts fit.
    await interpret(page, `היום החזרתי 200 שקל ל${LENDER_OVERLAP_B}`);
    const card = await onlyProposal(page);

    expect(await stateOf(card)).toBe('needs_debt');
    await expect(card).toContainText('יותר מהלוואה אחת');
  });

  test('and choosing the lender is what lets it through', async ({ page }) => {
    const debtId = debtIdByName(LENDER_PLAIN);
    const before = eventsFor(debtId).length;
    const balanceBefore = balanceOf(debtId);

    await interpret(page, 'היום החזרתי 200 שקל להלוואה');
    const card = await onlyProposal(page);
    await card.getByLabel('הלוואה').selectOption({ label: LENDER_PLAIN });
    await approve(card);

    await expect(page.getByText('נרשם.')).toBeVisible();
    expect(eventsFor(debtId)).toHaveLength(before + 1);
    expect(balanceOf(debtId)).toBe(balanceBefore - 20_000);
  });
});

test.describe('the typed path needs no microphone', () => {
  test('a browser with no speech API still offers the whole feature', async ({ browser }) => {
    /*
     * The only thing mocked anywhere in this suite, and it is a browser
     * capability rather than anything financial: a context where the speech API
     * simply is not defined, which is what Firefox and most in-app browsers
     * actually look like.
     */
    const context = await browser.newContext();
    await context.addInitScript(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).SpeechRecognition;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).webkitSpeechRecognition;
    });
    const page = await context.newPage();

    await interpret(page, 'היום שילמתי 31 שקל בדוכן');
    const card = await onlyProposal(page);
    expect(await stateOf(card)).toBe('ready');

    await expect(page.getByText('הדפדפן הזה לא תומך בהכתבה')).toBeVisible();
    await expect(page.getByRole('button', { name: 'הקלטה' })).toHaveCount(0);

    await context.close();
  });

  test('where dictation exists it is explained, and never starts on its own', async ({
    page,
  }) => {
    await page.goto('/quick');
    // A button, not an auto-start: the page loads with nothing listening.
    await expect(page.getByRole('button', { name: 'הקלטה' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'הקלטה' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect(page.getByText(/ההכתבה נעשית בידי הדפדפן/)).toBeVisible();
    await expect(page.getByText(/מה שנשלח הוא רק הטקסט שאתם רואים ומאשרים/)).toBeVisible();
  });

  test('the transcript box is editable, which is what makes dictation safe', async ({
    page,
  }) => {
    await page.goto('/quick');
    const box = page.getByLabel('מה קרה?');
    // Whatever a microphone would have put here, a person can change before it
    // is read. That is the whole privacy argument, so it is tested.
    await box.fill('טקסט שהוכתב');
    await box.fill('היום שילמתי 15 שקל בדוכן');
    await expect(box).toHaveValue('היום שילמתי 15 שקל בדוכן');
    await expect(box).toBeEditable();
  });
});

test.describe('two updates in one sentence are two decisions', () => {
  test('each is approved on its own', async ({ page }) => {
    await interpret(page, 'היום שילמתי 45 שקל בירקן ו-55 שקל בדגים');
    await expect(proposals(page)).toHaveCount(2);

    const before = storedDocument().transactions.length;
    await approve(proposals(page).first());
    await expect(page.getByText('נרשם.').first()).toBeVisible();

    // One approved, one not. The second is still waiting.
    expect(storedDocument().transactions).toHaveLength(before + 1);
    expect(transactionsFor('בירקן')).toHaveLength(1);
    expect(transactionsFor('בדגים')).toHaveLength(0);
  });
});
