import { expect, test, type Page } from '@playwright/test';

import { balanceOf, debtIdByName, eventsFor, storedDocument } from '../support/document';
import { LENDER_CLOSED, LENDER_EXPECTATION } from '../support/household';

/**
 * Saying when a loan is expected to be repaid, and writing down that the lender
 * asked.
 *
 * Both halves are claims a browser is the only place to check, for different
 * reasons.
 *
 * The expectation has three states and the third one — "we agreed there is no
 * date" — only exists if a person can actually choose it and see it afterwards.
 * A unit test can prove the field holds it; only this can prove the form offers
 * it and the screen says it back.
 *
 * The demand makes a promise in words on the screen: recording one changes
 * nothing about the loan. So the test records one and then reads the persisted
 * document — the balance, the events, the status, the closed date — and refuses
 * any difference. On a loan that has already been repaid, which is the case the
 * whole feature exists for.
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

/** Opens a `<details>` by its summary text, and waits for the form inside. */
async function open(page: Page, summary: string): Promise<void> {
  await page.getByRole('group').filter({ hasText: summary }).locator('summary').click();
}

/** Everything about a debt that a demand must leave alone. */
function debtState(debtId: string) {
  const debt = storedDocument().debts.find((candidate) => candidate.id === debtId);
  return {
    status: debt?.status,
    closedAt: debt?.closedAt ?? null,
    version: debt?.version,
    updatedAt: debt?.updatedAt,
    lastDemandAt: debt?.lastDemandAt ?? null,
    events: eventsFor(debtId).length,
    balance: balanceOf(debtId),
    transactions: storedDocument().transactions.length,
  };
}

test.describe('@smoke what is expected about repayment, in three answers', () => {
  test('a date can be set, and the card says it back', async ({ page }) => {
    await openLenderCard(page, LENDER_EXPECTATION);
    await open(page, 'לעדכן את הצפי לפירעון');

    await page.getByLabel('מה סוכם על הפירעון').first().selectOption('dated');
    await page.getByLabel('תאריך הפירעון הצפוי').first().fill('2027-03-01');
    await page.getByRole('button', { name: 'לשמור' }).first().click();

    await expect(page.getByText('הצפי לפירעון עודכן.')).toBeVisible();
    // Shown as a date, under its own heading, and not as the payment due date.
    await expect(page.getByText('צפי לפירעון', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('01.03.2027').first()).toBeVisible();
  });

  test('"agreed with no date" is an answer, not an empty field', async ({ page }) => {
    /*
     * The state the whole design exists for. A loan from a relative on no terms
     * is an ordinary loan, and the screen has to be able to say so instead of
     * looking like an unfinished form.
     */
    await openLenderCard(page, LENDER_EXPECTATION);
    await open(page, 'לעדכן את הצפי לפירעון');

    await page.getByLabel('מה סוכם על הפירעון').first().selectOption('none');
    await page.getByRole('button', { name: 'לשמור' }).first().click();

    await expect(page.getByText('הצפי לפירעון עודכן.')).toBeVisible();
    await expect(page.getByText('ללא צפי לפירעון').first()).toBeVisible();
    await expect(
      page.getByText('כך זה סוכם — אין תאריך, וזה לא פרט חסר.').first(),
    ).toBeVisible();
  });

  test('and it can be withdrawn, back to nothing recorded', async ({ page }) => {
    await openLenderCard(page, LENDER_EXPECTATION);
    await open(page, 'לעדכן את הצפי לפירעון');

    await page.getByLabel('מה סוכם על הפירעון').first().selectOption('unrecorded');
    await page.getByRole('button', { name: 'לשמור' }).first().click();

    await expect(page.getByText('הצפי לפירעון עודכן.')).toBeVisible();
    await expect(page.getByText('לא נרשם צפי').first()).toBeVisible();
  });

  test('choosing a date without giving one is refused, and says which field', async ({
    page,
  }) => {
    await openLenderCard(page, LENDER_EXPECTATION);
    await open(page, 'לעדכן את הצפי לפירעון');

    await page.getByLabel('מה סוכם על הפירעון').first().selectOption('dated');
    await page.getByLabel('תאריך הפירעון הצפוי').first().fill('');
    await page.getByRole('button', { name: 'לשמור' }).first().click();

    await expect(page.getByText('בחרתם ״יש תאריך צפוי״ — צריך גם תאריך').first()).toBeVisible();
  });
});

test.describe('@smoke a demand is written down and the loan does not move', () => {
  test('one is recorded, with its date and deadline', async ({ page }) => {
    const debtId = debtIdByName(LENDER_EXPECTATION);
    const before = debtState(debtId);

    await openLenderCard(page, LENDER_EXPECTATION);
    await open(page, 'לרשום דרישת פירעון');

    await page.getByLabel('מתי נתבקש').first().fill('2026-09-20');
    await page.getByLabel('עד מתי ביקשו').first().fill('2026-10-05');
    await page.getByLabel('סכום שנתבקש').first().fill('300');
    await page.getByLabel('מה נאמר').first().fill('ביקש בטלפון');
    await page.getByRole('button', { name: 'לרשום' }).first().click();

    await expect(page.getByText('דרישת הפירעון נרשמה. שום דבר בחוב לא השתנה.')).toBeVisible();

    // The record exists.
    const demands = storedDocument().repaymentDemands.filter(
      (demand) => demand.debtId === debtId,
    );
    expect(demands).toHaveLength(1);
    expect(demands[0]?.demandedOn).toBe('2026-09-20');
    expect(demands[0]?.requestedDeadline).toBe('2026-10-05');
    expect(demands[0]?.amountMinor).toBe(30_000);

    // And the loan is exactly what it was.
    expect(debtState(debtId)).toEqual(before);
  });

  test('it is shown under the loan, apart from the ledger', async ({ page }) => {
    await openLenderCard(page, LENDER_EXPECTATION);

    await expect(page.getByText('דרישות פירעון').first()).toBeVisible();
    await expect(page.getByText('ביקש בטלפון').first()).toBeVisible();
    // The promise the screen makes, in words, where a person will read it.
    await expect(
      page
        .getByText(
          'רישום דרישה אינו משנה דבר בחוב: לא את היתרה, לא את ההיסטוריה ולא את המצב. הוא רק שומר מה נתבקש ומתי.',
        )
        .first(),
    ).toBeVisible();

    // And not as a row in the history table, whose column has to add up.
    const table = page.getByRole('table');
    await expect(table.getByText('ביקש בטלפון')).toHaveCount(0);
  });

  test('a second demand is added rather than replacing the first', async ({ page }) => {
    const debtId = debtIdByName(LENDER_EXPECTATION);

    await openLenderCard(page, LENDER_EXPECTATION);
    await open(page, 'לרשום דרישת פירעון');
    await page.getByLabel('מתי נתבקש').first().fill('2026-09-25');
    await page.getByLabel('מה נאמר').first().fill('ביקש שוב');
    await page.getByRole('button', { name: 'לרשום' }).first().click();
    await expect(page.getByText('דרישת הפירעון נרשמה. שום דבר בחוב לא השתנה.')).toBeVisible();

    const demands = storedDocument().repaymentDemands.filter(
      (demand) => demand.debtId === debtId,
    );
    expect(demands).toHaveLength(2);
    expect(demands.map((demand) => demand.note)).toContain('ביקש בטלפון');
    expect(demands.map((demand) => demand.note)).toContain('ביקש שוב');
  });

  test('and both are on the card, the newest first', async ({ page }) => {
    await openLenderCard(page, LENDER_EXPECTATION);
    const notes = await page.locator('li').filter({ hasText: /ביקש/u }).allInnerTexts();
    const positions = notes.join('\n');
    expect(positions.indexOf('ביקש שוב')).toBeLessThan(positions.indexOf('ביקש בטלפון'));
  });

  test('a demand with neither figure nor deadline says so rather than inventing them', async ({
    page,
  }) => {
    await openLenderCard(page, LENDER_CLOSED);
    await open(page, 'לרשום דרישת פירעון');
    await page.getByLabel('מתי נתבקש').first().fill('2026-09-26');
    await page.getByRole('button', { name: 'לרשום' }).first().click();
    await expect(page.getByText('דרישת הפירעון נרשמה. שום דבר בחוב לא השתנה.')).toBeVisible();

    await expect(page.getByText('לא ננקב סכום').first()).toBeVisible();
    await expect(page.getByText('לא ננקב תאריך').first()).toBeVisible();

    const demand = storedDocument()
      .repaymentDemands.filter((row) => row.debtId === debtIdByName(LENDER_CLOSED))
      .at(-1);
    // Not zero, and not today: nobody said either.
    expect(demand?.amountMinor).toBeNull();
    expect(demand?.requestedDeadline).toBeNull();
  });

  test('a deadline before the day it was asked for is refused', async ({ page }) => {
    await openLenderCard(page, LENDER_EXPECTATION);
    await open(page, 'לרשום דרישת פירעון');
    await page.getByLabel('מתי נתבקש').first().fill('2026-09-20');
    await page.getByLabel('עד מתי ביקשו').first().fill('2026-09-01');
    await page.getByRole('button', { name: 'לרשום' }).first().click();

    await expect(
      page.getByText('התאריך שביקשו קודם ליום שבו נתבקש. אפשר לבדוק את שני התאריכים.').first(),
    ).toBeVisible();
  });
});

test.describe('a loan that has already been repaid', () => {
  /** Repays a loan in full through the ledger, then marks it settled. */
  test('is closed by paying it off', async ({ page }) => {
    const debtId = debtIdByName(LENDER_CLOSED);
    await openLenderCard(page, LENDER_CLOSED);
    await open(page, 'לרשום תשלום, הלוואה נוספת, תיקון או הערה');

    await page.getByLabel('סוג הפעולה').last().selectOption('principal_payment');
    await page.getByLabel('סכום (בהערה אין צורך)').first().fill('400');
    await page.getByRole('button', { name: 'לרשום' }).last().click();
    await expect(page.getByText('הפעולה נרשמה בכרטיס המלווה.')).toBeVisible();

    // Exactly nothing left: repaid in full, not overpaid.
    expect(balanceOf(debtId)).toBe(0);
  });

  test('still accepts a demand, and stays exactly as it was', async ({ page }) => {
    /*
     * The case the feature exists for: a lender who comes back after the loan
     * was settled. The family must be able to write that down, and writing it
     * down must not reopen anything.
     */
    const debtId = debtIdByName(LENDER_CLOSED);
    const before = debtState(debtId);

    await openLenderCard(page, LENDER_CLOSED);
    await open(page, 'לרשום דרישת פירעון');
    await page.getByLabel('מתי נתבקש').first().fill('2026-09-28');
    await page.getByLabel('סכום שנתבקש').first().fill('120');
    await page.getByLabel('מה נאמר').first().fill('טוען שנשאר חוב');
    await page.getByRole('button', { name: 'לרשום' }).first().click();

    await expect(page.getByText('דרישת הפירעון נרשמה. שום דבר בחוב לא השתנה.')).toBeVisible();

    const after = debtState(debtId);
    expect(after).toEqual(before);
    expect(
      storedDocument().repaymentDemands.some((demand) => demand.note === 'טוען שנשאר חוב'),
    ).toBe(true);
  });

  test('and the card shows the demand beside the closed loan', async ({ page }) => {
    await openLenderCard(page, LENDER_CLOSED);
    await expect(page.getByText('טוען שנשאר חוב').first()).toBeVisible();
  });
});
