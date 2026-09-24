import { expect, type Locator, type Page } from '@playwright/test';

import { ACCOUNT_NAME } from './household';

/**
 * The quick-update screen, as a test talks to it.
 *
 * One helper, because there is one flow. There used to be two of these — one per
 * reading button — and the pair was the clearest evidence that the screen was
 * asking a family to choose between two products: a spec had to decide which
 * reader it was testing before it could type a sentence. Now a spec types a
 * sentence and asks for a proposal, exactly as a person does, and which reader
 * answered is not something it can see or needs to.
 *
 * Nothing here writes. `approve` is the only function that causes a record, and
 * it presses the same button a person presses.
 */

/** The one field, the one button, and the proposal that comes back. */
export async function propose(page: Page, sentence: string): Promise<Locator> {
  await page.goto('/quick');
  await page.getByLabel('מה לעדכן?').fill(sentence);
  await page.getByRole('button', { name: 'הצע עדכון' }).click();
  /*
   * Waited for by its result rather than by a timeout: the reading is a server
   * round trip, and either a proposal or an honest "we did not understand" is
   * what ends it.
   */
  const card = proposal(page).or(page.getByTestId('quick-not-understood'));
  await expect(card.first()).toBeVisible();
  return proposal(page);
}

export function proposal(page: Page): Locator {
  return page.getByTestId('quick-proposal');
}

/** The single proposal a sentence produced, asserted to be single. */
export async function onlyProposal(page: Page): Promise<Locator> {
  await expect(proposal(page)).toHaveCount(1);
  return proposal(page).first();
}

/** The state the screen is showing: ready, needs_clarification, not_understood. */
export async function stateOf(card: Locator): Promise<string | null> {
  return card.getAttribute('data-state');
}

/** What the screen decided the sentence was asking for. */
export async function actionOf(card: Locator): Promise<string | null> {
  return card.getAttribute('data-action');
}

/** The question a sentence that did not name an account produces. */
export function accountQuestion(card: Locator): Locator {
  return card.getByTestId('quick-account-question');
}

/**
 * Answers "which account" by pressing the account's own button.
 *
 * A button rather than a dropdown, because that is what the screen offers: the
 * answer is one of two or three things and a thumb should not have to open a
 * picker to give it. Pressing it writes nothing — it completes the card.
 */
export async function chooseAccount(card: Locator, name: string): Promise<void> {
  await accountQuestion(card).getByRole('button', { name }).click();
}

/**
 * A sentence read, with "which account" answered.
 *
 * The seeded household has two open accounts on purpose, so a sentence that does
 * not name one produces that question before the proposal is complete. A journey
 * that is about something else — a retry, a phone layout, the history screen —
 * answers it here instead of repeating three lines; a journey that is *about* the
 * question uses `accountQuestion` and `chooseAccount` directly.
 */
export async function proposeWithAccount(
  page: Page,
  sentence: string,
  account: string = ACCOUNT_NAME,
): Promise<Locator> {
  await propose(page, sentence);
  const card = await onlyProposal(page);
  if (await accountQuestion(card).isVisible()) await chooseAccount(card, account);
  return card;
}

/**
 * The identifier this open form will submit with.
 *
 * Read so a test can prove that a retry really is the *same* submission. Without
 * that check a "no duplicate" assertion could pass because the second attempt
 * never happened, which is the failure mode that matters here.
 */
export async function submissionKeyOf(card: Locator): Promise<string> {
  const value = await card.locator('input[name="idempotencyKey"]').inputValue();
  expect(value.length).toBeGreaterThanOrEqual(8);
  return value;
}

/** Approves the proposal. The one call here that causes a record. */
export async function approve(card: Locator): Promise<void> {
  await card.getByRole('button', { name: 'אישור ורישום' }).click();
}
