import { expect, type Locator, type Page } from '@playwright/test';

/**
 * The quick-update screen, as a test talks to it.
 *
 * Kept in one place so a spec reads as a journey rather than as a list of
 * selectors, and so that a change to the screen is one edit here instead of one
 * in every spec.
 */

/** Types a sentence and asks the server what it understood. Writes nothing. */
export async function interpret(page: Page, sentence: string): Promise<void> {
  await page.goto('/quick');
  const box = page.getByLabel('מה קרה?');
  await box.fill(sentence);
  await page.getByRole('button', { name: 'מה הבנתם?' }).click();
  // The reading is a server round trip; wait for its result rather than a timeout.
  await expect(page.getByTestId('quick-proposal').first()).toBeVisible();
}

export function proposals(page: Page): Locator {
  return page.getByTestId('quick-proposal');
}

/** The single proposal a sentence produced, asserted to be single. */
export async function onlyProposal(page: Page): Promise<Locator> {
  await expect(proposals(page)).toHaveCount(1);
  return proposals(page).first();
}

/** The state the screen is showing for a proposal: ready, needs_amount, … */
export async function stateOf(card: Locator): Promise<string | null> {
  return card.getAttribute('data-state');
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

/** Approves one proposal and waits for the screen to say what happened. */
export async function approve(card: Locator): Promise<void> {
  await card.getByRole('button', { name: 'אישור ורישום' }).click();
}
