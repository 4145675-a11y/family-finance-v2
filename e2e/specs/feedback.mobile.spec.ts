import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { readRunState } from '../support/run-state';

/**
 * The feedback button on a phone (ADR-0047 § 1).
 *
 * The product is used standing in a shop, and the bottom bar is how a thumb
 * gets around. A feedback button that covered one of those five links would be
 * a button that broke the product in order to talk about it.
 */

test('the button sits above the bottom navigation, not on it', async ({ page }) => {
  await page.goto('/');
  const launcher = page.getByRole('button', { name: 'לשלוח משוב על המסך הזה' });
  const bar = page.getByRole('navigation', { name: 'ניווט תחתון' });
  await expect(launcher).toBeVisible();
  await expect(bar).toBeVisible();

  const button = await launcher.boundingBox();
  const nav = await bar.boundingBox();
  if (button === null || nav === null) throw new Error('both must have a box');

  expect(button.y + button.height, 'the button ends above the bar').toBeLessThanOrEqual(nav.y);
  expect(button.width).toBeGreaterThanOrEqual(44);
  expect(button.height).toBeGreaterThanOrEqual(44);
});

test('a note sent from a phone is stored as a phone', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'לשלוח משוב על המסך הזה' }).tap();
  await page.getByRole('button', { name: /הערה על כל המסך/u }).tap();
  await page.getByRole('textbox', { name: 'ההערה' }).fill('E2E מהטלפון');
  await page.getByRole('button', { name: 'שליחה' }).tap();
  const sent = page.getByTestId('feedback-sent');
  await expect(sent).toContainText('fb-');
  const reference = /fb-\d{8}-\d{6}-[0-9a-f]{6}/u.exec((await sent.textContent()) ?? '')?.[0];

  // The device is read from what the server wrote, not from what the screen said.
  const stored = JSON.parse(
    readFileSync(join(readRunState().dataDirectory, 'feedback', `${reference}.json`), 'utf8'),
  ) as { device: string; viewport: { width: number } };
  expect(stored.device).toBe('phone');
  expect(stored.viewport.width).toBe(390);
});
