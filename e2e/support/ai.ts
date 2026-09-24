import { expect, type Locator, type Page } from '@playwright/test';

/**
 * The smart reading, as a test talks to it.
 *
 * Kept beside `quick.ts` so a spec reads as a journey. The two share the same
 * text box: one button reads it with the rule table, the other with the smart
 * reader, and which result a test is looking at is decided by which card it
 * addresses — never by timing.
 */

/** Types a sentence and asks for the smart reading. Writes nothing. */
export async function analyse(page: Page, sentence: string): Promise<Locator> {
  await page.goto('/quick');
  await page.getByLabel('מה קרה?').fill(sentence);
  await page.getByRole('button', { name: 'הבנה חכמה' }).click();
  // A server round trip; waited for by its result rather than by a timeout.
  const card = page.getByTestId('ai-proposal').or(page.getByTestId('ai-unavailable'));
  await expect(card.first()).toBeVisible();
  return card.first();
}

export function aiProposal(page: Page): Locator {
  return page.getByTestId('ai-proposal');
}

export function aiUnavailable(page: Page): Locator {
  return page.getByTestId('ai-unavailable');
}

/** The state the screen is showing: ready, needs_clarification, not_understood. */
export async function aiStateOf(card: Locator): Promise<string | null> {
  return card.getAttribute('data-state');
}

/** Confirms the smart proposal through its own form. */
export async function confirmAi(card: Locator): Promise<void> {
  await card.getByRole('button', { name: 'לאשר ולרשום' }).click();
}

/** The identifier this open form will submit with, so a retry can be proved. */
export async function aiSubmissionKey(card: Locator): Promise<string> {
  const value = await card.locator('input[name="idempotencyKey"]').inputValue();
  expect(value.length).toBeGreaterThanOrEqual(8);
  return value;
}
