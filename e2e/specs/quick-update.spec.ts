import { expect, test } from '@playwright/test';

import {
  accountQuestion,
  actionOf,
  approve,
  chooseAccount,
  onlyProposal,
  propose,
  proposeWithAccount,
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
import {
  ACCOUNT_NAME,
  ACCOUNT_SECOND_NAME,
  LENDER_OVERLAP_B,
  LENDER_PLAIN,
} from '../support/household';
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
 *
 * The sentences here are deliberately ones the remote reader has no answer for,
 * so this file exercises the rule table underneath — the resilience path that
 * keeps the one flow working when nothing is configured. Which reader answered is
 * invisible on purpose, so a spec cannot assert on it and does not try.
 */

test.describe.configure({ mode: 'serial' });

test.describe('@smoke reading a sentence writes nothing', () => {
  test('a proposal appears, and the document is untouched', async ({ page }) => {
    const before = storedDocument().transactions.length;

    await propose(page, 'היום שילמתי 120 שקל בסופר');
    const card = await onlyProposal(page);

    expect(await actionOf(card)).toBe('expense');
    await expect(card).toContainText('הוצאה');
    await expect(card).toContainText('טיוטה — עדיין לא נשמרה');

    expect(storedDocument().transactions).toHaveLength(before);
  });

  test('leaving the screen without approving still writes nothing', async ({ page }) => {
    const before = storedDocument().transactions.length;

    await propose(page, 'היום שילמתי 77 שקל בקיוסק');
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
    await expect(page.getByTestId('quick-promise')).toHaveText(
      'נוצרת הצעה בלבד; שום פעולה אינה נשמרת בלי אישור.',
    );
  });

  test('the sentence is asked for in one field, under one heading', async ({ page }) => {
    await page.goto('/quick');
    await expect(page.getByRole('heading', { level: 1, name: 'מה לעדכן?' })).toBeVisible();
    await expect(page.getByLabel('מה לעדכן?')).toBeEditable();
    // One field. A second textarea would be a second way in.
    await expect(page.locator('textarea')).toHaveCount(1);
  });
});

test.describe('approving records exactly one expense', () => {
  const SENTENCE = 'היום שילמתי 120 שקל בסופר';
  const MERCHANT = 'בסופר';

  test('the record exists after approval', async ({ page }) => {
    const card = await proposeWithAccount(page, SENTENCE);
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
    const firstCard = await proposeWithAccount(page, SENTENCE);
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

    const retryCard = await proposeWithAccount(page, SENTENCE);

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

    await propose(page, 'שילמתי בסופר');
    const card = await onlyProposal(page);

    expect(await stateOf(card)).toBe('needs_clarification');
    // Offered empty rather than as zero.
    await expect(card.getByLabel('סכום')).toHaveValue('');

    expect(storedDocument().transactions).toHaveLength(before);
  });

  test('no account named means one question, with the accounts as buttons', async ({
    page,
  }) => {
    const before = storedDocument().transactions.length;

    await propose(page, 'היום שילמתי 41 שקל בפרחים');
    const card = await onlyProposal(page);

    const question = accountQuestion(card);
    await expect(question).toContainText('מאיזה חשבון יצאו 41 ₪?');
    await expect(question.getByRole('button', { name: ACCOUNT_NAME })).toBeVisible();
    await expect(question.getByRole('button', { name: ACCOUNT_SECOND_NAME })).toBeVisible();

    // Answering it is not confirming it.
    await chooseAccount(card, ACCOUNT_SECOND_NAME);
    expect(storedDocument().transactions).toHaveLength(before);
  });

  test('and the account that was chosen is the one that gets the record', async ({ page }) => {
    const card = await proposeWithAccount(
      page,
      'היום שילמתי 41 שקל בפרחים',
      ACCOUNT_SECOND_NAME,
    );
    await approve(card);
    await expect(page.getByText('נרשם.')).toBeVisible();

    const document = storedDocument();
    const second = document.accounts.find((row) => row.name === ACCOUNT_SECOND_NAME);
    expect(transactionsFor('בפרחים')).toHaveLength(1);
    expect(transactionsFor('בפרחים')[0]?.accountId).toBe(second?.id);
  });

  test('a sentence naming an account uses it without asking', async ({ page }) => {
    await propose(page, `היום שילמתי 29 שקל בגלידה מ${ACCOUNT_NAME}`);
    const card = await onlyProposal(page);
    // Nothing to ask: the sentence said which account.
    await expect(accountQuestion(card)).toHaveCount(0);
  });

  test('a repayment naming no lender waits for the choice', async ({ page }) => {
    const debtId = debtIdByName(LENDER_PLAIN);
    const before = eventsFor(debtId).length;

    await propose(page, 'היום החזרתי 200 שקל להלוואה');
    const card = await onlyProposal(page);

    expect(await stateOf(card)).toBe('needs_clarification');
    await expect(card.getByLabel('הלוואה')).toBeVisible();
    expect(eventsFor(debtId)).toHaveLength(before);
  });

  test('a repayment naming two lenders at once picks neither', async ({ page }) => {
    // Naming the branch names the parent gemach too, so two debts fit.
    await propose(page, `היום החזרתי 200 שקל ל${LENDER_OVERLAP_B}`);
    const card = await onlyProposal(page);

    expect(await stateOf(card)).toBe('needs_clarification');
    await expect(card.getByLabel('הלוואה')).toBeVisible();
    // Never a guess between them: no card is claimed as the one that exists.
    await expect(card.getByTestId('quick-lender')).toHaveCount(0);
  });

  test('and choosing the lender is what lets it through', async ({ page }) => {
    const debtId = debtIdByName(LENDER_PLAIN);
    const before = eventsFor(debtId).length;
    const balanceBefore = balanceOf(debtId);

    const card = await proposeWithAccount(page, 'היום החזרתי 200 שקל להלוואה');
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
     * The only thing stubbed anywhere in this suite, and it is a browser
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

    const card = await proposeWithAccount(page, 'היום שילמתי 31 שקל בדוכן');
    // The reading asked one question, it has been answered in the page, and the
    // card is now complete. `data-state` still describes the reading itself.
    await expect(card.getByRole('button', { name: 'אישור ורישום' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'הקלטה' })).toHaveCount(0);

    await context.close();
  });

  test('where dictation exists it is a button, and never starts on its own', async ({
    page,
  }) => {
    await page.goto('/quick');
    const microphone = page.getByRole('button', { name: 'הקלטה' });
    await expect(microphone).toBeVisible();
    await expect(microphone).toHaveAttribute('aria-pressed', 'false');
  });

  test('the transcript box is editable, which is what makes dictation safe', async ({
    page,
  }) => {
    await page.goto('/quick');
    const box = page.getByLabel('מה לעדכן?');
    // Whatever a microphone would have put here, a person can change before it
    // is read. That is the whole privacy argument, so it is tested.
    await box.fill('טקסט שהוכתב');
    await box.fill('היום שילמתי 15 שקל בדוכן');
    await expect(box).toHaveValue('היום שילמתי 15 שקל בדוכן');
    await expect(box).toBeEditable();
  });
});

test.describe('two updates in one sentence', () => {
  /*
   * One card, and the rest said out loud.
   *
   * The screen used to show a card per update, which is a shape a remote reader
   * cannot produce — it answers with one proposal. Rather than keep two card
   * shapes, the flow proposes one update and states that the others were not
   * read. Dropping them silently would be exactly the quiet wrongness
   * 02-FINANCIAL-RULES.md forbids.
   */
  test('the first is proposed, and the screen says the rest was not', async ({ page }) => {
    const before = storedDocument().transactions.length;

    await propose(page, 'היום שילמתי 45 שקל בירקן ו-55 שקל בדגים');
    await expect(page.getByText('יש כאן יותר מעדכון אחד')).toBeVisible();

    const card = await onlyProposal(page);
    await chooseAccount(card, ACCOUNT_NAME);
    await approve(card);
    await expect(page.getByText('נרשם.')).toBeVisible();

    // One recorded, and the other is not quietly in the document.
    expect(storedDocument().transactions).toHaveLength(before + 1);
    expect(transactionsFor('בירקן')).toHaveLength(1);
    expect(transactionsFor('בדגים')).toHaveLength(0);
  });
});
