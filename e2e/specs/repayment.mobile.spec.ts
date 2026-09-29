import { expect, test, type Page } from '@playwright/test';

import { storedDocument } from '../support/document';
import { LENDER_CLOSED } from '../support/household';

/**
 * Recording a repayment demand from a phone.
 *
 * Its own file because the phone project runs `*.mobile.spec.ts` and nothing
 * else — a viewport check written inside the desktop spec would skip on every
 * run and pass by never happening, which is the shape of a test that proves
 * nothing.
 *
 * The case is the real one: a lender rings, and the person writing it down is
 * standing in a kitchen holding a phone. So the whole thing has to work at
 * 390px — reachable targets, no sideways scrolling, and a form that submits.
 *
 * It uses the loan the desktop spec has already repaid, which makes this the
 * hardest version of the case: a demand against a closed loan, entered on a
 * phone, still changing nothing about the loan.
 */

/** Opens a lender's card the way a thumb does: bottom bar, list, card. */
async function openLenderCard(page: Page, displayName: string): Promise<void> {
  await page.goto('/lenders');
  const card = page.locator('section').filter({
    has: page.getByRole('heading', { name: displayName, exact: true }),
  });
  await card.getByRole('link', { name: 'לכרטיס המלווה ולהיסטוריה המלאה' }).click();
  await expect(page.getByRole('heading', { level: 1, name: displayName })).toBeVisible();
}

test.describe.configure({ mode: 'serial' });

test.describe('@smoke a demand can be recorded on a phone', () => {
  test('the card and its demand form fit the width', async ({ page }) => {
    await openLenderCard(page, LENDER_CLOSED);
    await page
      .getByRole('group')
      .filter({ hasText: 'לרשום דרישת פירעון' })
      .locator('summary')
      .click();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, 'the page scrolls sideways').toBeLessThanOrEqual(1);
  });

  test('every control on it is a real target', async ({ page }) => {
    await openLenderCard(page, LENDER_CLOSED);
    await page
      .getByRole('group')
      .filter({ hasText: 'לרשום דרישת פירעון' })
      .locator('summary')
      .click();

    for (const label of ['מתי נתבקש', 'עד מתי ביקשו', 'סכום שנתבקש', 'מה נאמר']) {
      const box = await page.getByLabel(label).first().boundingBox();
      expect(box?.height ?? 0, label).toBeGreaterThanOrEqual(44);
    }
  });

  test('and the whole thing completes, leaving the repaid loan repaid', async ({ page }) => {
    const debtId =
      storedDocument().debts.find((debt) => debt.creditorName === LENDER_CLOSED)?.id ?? '';
    const before = storedDocument().debts.find((debt) => debt.id === debtId);
    const eventsBefore = storedDocument().debtEvents.filter(
      (event) => event.debtId === debtId,
    ).length;

    await openLenderCard(page, LENDER_CLOSED);
    await page
      .getByRole('group')
      .filter({ hasText: 'לרשום דרישת פירעון' })
      .locator('summary')
      .click();

    await page.getByLabel('מתי נתבקש').first().fill('2026-09-29');
    await page.getByLabel('מה נאמר').first().fill('E2E בטלפון מהנייד');
    await page.getByRole('button', { name: 'לרשום' }).first().click();

    await expect(page.getByText('דרישת הפירעון נרשמה. שום דבר בחוב לא השתנה.')).toBeVisible();

    const document = storedDocument();
    expect(
      document.repaymentDemands.some((demand) => demand.note === 'E2E בטלפון מהנייד'),
    ).toBe(true);
    // The loan is untouched, from a phone exactly as from a desktop.
    expect(document.debts.find((debt) => debt.id === debtId)).toEqual(before);
    expect(document.debtEvents.filter((event) => event.debtId === debtId)).toHaveLength(
      eventsBefore,
    );
  });

  test('and it is readable on the card afterwards', async ({ page }) => {
    await openLenderCard(page, LENDER_CLOSED);
    await expect(page.getByText('E2E בטלפון מהנייד').first()).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, 'the demand list makes the card scroll sideways').toBeLessThanOrEqual(1);
  });
});
