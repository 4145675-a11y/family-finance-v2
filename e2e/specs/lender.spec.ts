import { expect, test, type Page } from '@playwright/test';

import { approve, proposeWithAccount, submissionKeyOf } from '../support/quick';
import {
  asShekels,
  balanceOf,
  debtIdByName,
  eventsFor,
  storedDocument,
  transactionsFor,
} from '../support/document';
import {
  LENDER_CARD,
  LENDER_CARD_OPENING_MINOR,
  LENDER_OVERLAP_A,
  LENDER_OVERLAP_A_OPENING_MINOR,
  LENDER_OVERLAP_B,
  LENDER_OVERLAP_B_OPENING_MINOR,
  LENDER_OVERPAY,
  LENDER_OVERPAY_OPENING_MINOR,
} from '../support/household';

/**
 * The lender card, the ledger behind it, and the one balance they both come from.
 *
 * M1 said there is exactly one calculation of what a lender is owed. That is a
 * claim about two numbers on one screen agreeing, so a browser is the only place
 * it can actually be checked: the balance at the top of the card, and the running
 * column in the history underneath it, have to be the same arithmetic — including
 * when the history dips below zero and the balance does not.
 */

test.describe.configure({ mode: 'serial' });

/** Opens a lender's card the way a person does: from the list, by its name. */
async function openLenderCard(page: Page, displayName: string): Promise<void> {
  await page.goto('/lenders');
  const card = page.locator('section').filter({
    has: page.getByRole('heading', { name: displayName, exact: true }),
  });
  await card.getByRole('link', { name: 'לכרטיס המלווה ולהיסטוריה המלאה' }).click();
  await expect(page.getByRole('heading', { level: 1, name: displayName })).toBeVisible();
}

/**
 * Records one ledger action through the card's own form.
 *
 * Fields are addressed by their `name`, not by their Hebrew label. The name is
 * the contract the server action reads, so it is the more stable of the two —
 * and the page has a filter form carrying similar words, which makes label
 * matching ambiguous in a way that would only show up as a flake.
 */
async function recordOnCard(
  page: Page,
  options: { kind: string; amount: string; date: string; note?: string },
): Promise<void> {
  // The form is behind a disclosure: opening it is part of the journey.
  await page.getByText('לרשום תשלום, הלוואה נוספת, תיקון או הערה').click();
  const form = page
    .locator('form')
    .filter({ has: page.locator('input[name="idempotencyKey"]') });
  await form.locator('select[name="kind"]').selectOption({ label: options.kind });
  await form.locator('input[name="amountMinor"]').fill(options.amount);
  await form.locator('input[name="occurredOn"]').fill(options.date);
  if (options.note !== undefined) {
    await form.locator('input[name="note"]').fill(options.note);
  }
  await form.getByRole('button', { name: 'לרשום' }).click();
}

/** The "יתרה אחרי" column of the history, top row first. */
function balanceAfterColumn(page: Page) {
  return page.getByRole('table').locator('tbody tr').locator('td').nth(3);
}

test.describe('@smoke the card shows what the events say', () => {
  test('the opening balance is the balance, before anything is paid', async ({ page }) => {
    const debtId = debtIdByName(LENDER_CARD);
    expect(balanceOf(debtId)).toBe(LENDER_CARD_OPENING_MINOR);

    await openLenderCard(page, LENDER_CARD);
    await expect(page.getByText(asShekels(LENDER_CARD_OPENING_MINOR)).first()).toBeVisible();
    // One event so far, and the history says so.
    await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(1);
  });
});

test.describe('a repayment recorded on the card', () => {
  const PAID_MINOR = 30_000;

  test('moves the balance, and the history grows by one line', async ({ page }) => {
    const debtId = debtIdByName(LENDER_CARD);
    const before = eventsFor(debtId).length;

    await openLenderCard(page, LENDER_CARD);
    await recordOnCard(page, {
      kind: 'תשלום',
      amount: '300',
      date: '2026-09-22',
      note: 'E2E תשלום מהכרטיס',
    });
    await expect(page.getByText('הפעולה נרשמה בכרטיס המלווה.')).toBeVisible();

    expect(eventsFor(debtId)).toHaveLength(before + 1);
    expect(balanceOf(debtId)).toBe(LENDER_CARD_OPENING_MINOR - PAID_MINOR);
  });

  test('and the card, the summary and the history all agree after a reload', async ({
    page,
  }) => {
    const debtId = debtIdByName(LENDER_CARD);
    const expected = asShekels(balanceOf(debtId));

    await openLenderCard(page, LENDER_CARD);
    await page.reload();

    // The balance at the top of the card.
    await expect(page.getByText(expected).first()).toBeVisible();
    // The newest line of the history ends at the same figure.
    await expect(balanceAfterColumn(page).first()).toContainText(
      asShekels(LENDER_CARD_OPENING_MINOR - PAID_MINOR).replace(/\s/g, ' '),
    );
    // And the debts screen, which reaches the same number by its own route.
    await page.goto('/debts');
    await expect(page.getByText(expected).first()).toBeVisible();
  });

  test('no other lender moved', async ({ page }) => {
    /*
     * The two lenders nothing in this suite ever writes to. Checking their event
     * count rather than only their balance is the stronger statement: a balance
     * can be unchanged after two mistakes that cancel out.
     */
    for (const name of [LENDER_OVERLAP_A, LENDER_OVERLAP_B]) {
      expect(eventsFor(debtIdByName(name))).toHaveLength(1);
      expect(eventsFor(debtIdByName(name))[0]?.kind).toBe('opening_balance');
    }
    expect(balanceOf(debtIdByName(LENDER_OVERLAP_A))).toBe(LENDER_OVERLAP_A_OPENING_MINOR);
    expect(balanceOf(debtIdByName(LENDER_OVERLAP_B))).toBe(LENDER_OVERLAP_B_OPENING_MINOR);

    await page.goto('/lenders');
    await expect(
      page.getByText(asShekels(LENDER_OVERLAP_B_OPENING_MINOR)).first(),
    ).toBeVisible();
  });
});

test.describe('an overpayment is shown honestly', () => {
  /*
   * The exact divergence M1 fixed. Paying more than is owed makes one line of
   * the history end below zero — that is what happened, and the column says so —
   * while the balance the product acts on is the engine's single answer, which is
   * floored once at the end. Two different numbers, one calculation, and the
   * screen must not quietly invent a second.
   */
  test('the history may dip below zero while the balance does not', async ({ page }) => {
    const debtId = debtIdByName(LENDER_OVERPAY);
    expect(balanceOf(debtId)).toBe(LENDER_OVERPAY_OPENING_MINOR);

    await openLenderCard(page, LENDER_OVERPAY);
    await recordOnCard(page, {
      kind: 'תשלום',
      amount: '700',
      date: '2026-09-23',
      note: 'E2E תשלום גדול מהיתרה',
    });
    await expect(page.getByText('הפעולה נרשמה בכרטיס המלווה.')).toBeVisible();

    // The engine's answer: nothing is owed. Not minus two hundred.
    expect(balanceOf(debtId)).toBe(0);

    await openLenderCard(page, LENDER_OVERPAY);

    // The card says nothing is owed…
    const summary = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'יתרה נוכחית' }),
    });
    await expect(summary.getByText(asShekels(0))).toBeVisible();
    // …says the figure is not a stored field but the sum of the lines below…
    await expect(summary).toContainText('זה אינו שדה שנרשם');
    // …and explains a line that reads below zero rather than hiding it.
    await expect(summary).toContainText('איננו מסתירים');

    // The history still shows the step that went past zero.
    await expect(balanceAfterColumn(page).first()).toContainText('−');
  });

  test('and the list agrees that nothing is owed', async ({ page }) => {
    await page.goto('/lenders');
    const row = page.locator('section').filter({
      has: page.getByRole('heading', { name: LENDER_OVERPAY, exact: true }),
    });
    await expect(row.getByText('אין יתרה')).toBeVisible();
  });
});

test.describe('a repayment through the quick screen writes both facts, once', () => {
  /*
   * The quick screen's approval writes two records for one intention: the money
   * leaving the account, and the balance moving. A retry has to leave one of
   * each — which is the case where "one logical repayment" is not the same thing
   * as "one row".
   */
  test('a retry leaves one transaction and one event', async ({ page }) => {
    const debtId = debtIdByName(LENDER_CARD);
    const eventsBefore = eventsFor(debtId).length;
    const balanceBefore = balanceOf(debtId);
    const SENTENCE = `היום החזרתי 150 שקל ל${LENDER_CARD}`;
    /*
     * The lender's own recorded name, not the sentence's wording.
     *
     * Once the words have been resolved to a card, that card's name is what the
     * record is filed under — so one lender's history is under one spelling
     * however a family happened to phrase it that day.
     */
    const MERCHANT = LENDER_CARD;

    const card = await proposeWithAccount(page, SENTENCE);
    const key = await submissionKeyOf(card);

    let swallowed = false;
    await page.route('**/quick', async (route) => {
      if (route.request().method() !== 'POST' || swallowed) {
        await route.continue();
        return;
      }
      swallowed = true;
      await route.fetch();
      await route.abort('failed');
    });

    await approve(card);
    await expect.poll(() => eventsFor(debtId).length).toBe(eventsBefore + 1);
    expect(transactionsFor(MERCHANT)).toHaveLength(1);

    await page.unroute('**/quick');
    const retry = await proposeWithAccount(page, SENTENCE);
    expect(await submissionKeyOf(retry)).toBe(key);
    await approve(retry);
    await expect(page.getByText('הפעולה הזו כבר נרשמה. לא נוצרה רשומה כפולה.')).toBeVisible();

    // One of each, and the balance moved by one payment.
    expect(eventsFor(debtId)).toHaveLength(eventsBefore + 1);
    expect(transactionsFor(MERCHANT)).toHaveLength(1);
    expect(balanceOf(debtId)).toBe(balanceBefore - 15_000);
  });

  test('and every debt event in the document belongs to a seeded lender', () => {
    // A guard on the suite itself: nothing here may touch a record it did not create.
    const document = storedDocument();
    const seeded = new Set(document.debts.map((debt) => debt.id));
    for (const event of document.debtEvents) expect(seeded.has(event.debtId)).toBe(true);
    for (const debt of document.debts) expect(debt.creditorName).toMatch(/^E2E /);
  });
});
