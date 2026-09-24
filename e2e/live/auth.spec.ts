import { expect, test, type Page } from '@playwright/test';

import { readLiveState } from '../support/live';
import type { SyntheticUser } from '../support/synthetic-user';

/**
 * Signing in, and seeing only your own household.
 *
 * Against the real database, as a real person: the sign-in form, Supabase Auth,
 * the cookies the browser is given, and row-level security deciding what comes
 * back. None of it is stubbed, and none of it can be — that is the point of this
 * file existing beside the local suite.
 *
 * Both people here are synthetic, created by the run's setup and deleted by its
 * teardown, which counts the rows afterwards to prove it. Neither is ever invited
 * into anybody else's household, and nothing here reads a household it did not
 * create.
 */

test.describe.configure({ mode: 'serial' });

function people(): readonly SyntheticUser[] {
  return readLiveState().people;
}

/** Signs in through the form a person actually meets. */
async function signIn(page: Page, person: SyntheticUser): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('אימייל').fill(person.email);
  await page.getByLabel('סיסמה').fill(person.password);
  await page.getByRole('button', { name: 'כניסה' }).click();
  /*
   * Signing in is a server action that redirects, so the wait has to be for the
   * navigation and not for an element: the sign-in screen has an `h1` too, and
   * waiting for one would pass before anything had happened.
   */
  await page.waitForURL((url) => new URL(url).pathname !== '/login', { timeout: 30_000 });
}

const HOUSEHOLD_ONE = 'E2E בית ראשון';
const HOUSEHOLD_TWO = 'E2E בית שני';

test.describe('@smoke a signed-out visitor sees the sign-in screen', () => {
  test('the health endpoint says the database backend is ready', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.status()).toBe(200);
    const body = (await response.json()) as {
      status: string;
      backend: string;
      data: { readiness: string };
    };
    expect(body.backend).toBe('supabase');
    expect(body.data.readiness).toBe('ready');
  });

  test('every protected route redirects to the sign-in screen', async ({ page }) => {
    for (const path of ['/', '/quick', '/debts', '/lenders', '/upload', '/accounts']) {
      await page.goto(path);
      /*
       * Where the browser ended up is the whole assertion. The status code of a
       * redirect chain is Playwright's business; what matters to a family is that
       * asking for a money screen without a session shows a sign-in form and not
       * somebody's balance.
       */
      expect(new URL(page.url()).pathname, path).toBe('/login');
      await expect(page.getByRole('heading', { level: 1, name: 'כניסה לחשבון' })).toBeVisible();
    }
  });

  test('and the sign-in screen carries no household data at all', async ({ page }) => {
    await page.goto('/login');
    const html = await page.content();
    // Nothing about anybody's money on a page anyone can reach.
    expect(html).not.toContain('₪');
  });
});

test.describe('the first synthetic person', () => {
  test('signs in through the real form and is offered setup', async ({ page }) => {
    const first = people()[0];
    expect(first).toBeDefined();
    if (first === undefined) return;

    await signIn(page, first);
    /*
     * A signed-in person with no household lands on the home screen, and what it
     * shows them is the offer to set one up — not a zero, not an error, and not
     * somebody else's figures.
     */
    expect(new URL(page.url()).pathname).toBe('/');
    await expect(page.getByRole('heading', { name: 'בואו נתחיל' })).toBeVisible();
    await expect(page.getByText('עוד לא הוקם משק בית לחשבון הזה')).toBeVisible();
    await expect(page.getByRole('link', { name: 'ליצור את משק הבית' })).toBeVisible();
  });

  test('creates a household through the screen, and reaches it', async ({ page }) => {
    const first = people()[0];
    if (first === undefined) throw new Error('no synthetic person');

    await signIn(page, first);
    // Walked the way a person walks it: from the offer on the home screen.
    await page.getByRole('link', { name: 'ליצור את משק הבית' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'בואו נתחיל' })).toBeVisible();
    await page.getByLabel('איך לקרוא למשק הבית').fill(HOUSEHOLD_ONE);
    await page.getByLabel('איך קוראים לכם').fill('E2E בודקת');
    await page.getByRole('button', { name: 'ליצור את משק הבית' }).click();

    /*
     * The name comes back in the rename field, which is where the setup screen
     * shows it once a household exists.
     *
     * The create field has to be gone first, and that check is not decoration.
     * Both fields carry the same label, so a value assertion on its own passes
     * against a *create* field that still holds what was typed — which is exactly
     * what happened once against the deployed service: this test went green
     * without creating anything and the next one failed instead, pointing at the
     * wrong place. Waiting for the create form to disappear is both the honest
     * assertion and the thing that waits for the write to land.
     */
    await expect(page.locator('input[name="householdName"]')).toHaveCount(0);
    await expect(page.getByLabel('איך לקרוא למשק הבית')).toHaveValue(HOUSEHOLD_ONE);
    await expect(page.getByText(/מתוך .*שלבים/)).toBeVisible();

    // And the home screen is now their own, not a sign-in redirect.
    await page.goto('/');
    expect(new URL(page.url()).pathname).toBe('/');
    /*
     * The home screen's own heading is the question it answers, which changes with
     * the figures — so what is asserted is that there is exactly one, and that the
     * "you have no household" offer is gone. Both are true only if the household
     * was really created and is really readable as this person.
     */
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('heading', { name: 'בואו נתחיל' })).toHaveCount(0);
  });
});

test.describe('the second synthetic person never sees the first household', () => {
  test('signs in and is offered setup, not somebody else’s household', async ({ browser }) => {
    const second = people()[1];
    if (second === undefined) throw new Error('no second synthetic person');

    // A separate context: separate cookies, separate session.
    const context = await browser.newContext();
    const page = await context.newPage();
    await signIn(page, second);

    // The first person's household must not appear anywhere on this screen.
    await expect(page.getByText(HOUSEHOLD_ONE)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'בואו נתחיל' })).toBeVisible();

    await page.getByRole('link', { name: 'ליצור את משק הבית' }).click();
    await page.getByLabel('איך לקרוא למשק הבית').fill(HOUSEHOLD_TWO);
    await page.getByLabel('איך קוראים לכם').fill('E2E בודק');
    await page.getByRole('button', { name: 'ליצור את משק הבית' }).click();

    // Two households now exist, and this person is looking at theirs.
    await expect(page.locator('input[name="householdName"]')).toHaveCount(0);
    await expect(page.getByLabel('איך לקרוא למשק הבית')).toHaveValue(HOUSEHOLD_TWO);
    await context.close();
  });

  test('and each person reads back only their own household name', async ({ browser }) => {
    /*
     * The isolation assertion, made where the name is actually readable. Both
     * people are asked the same question — "what is this household called" — on
     * the same screen, and row-level security is what makes the two answers
     * different. A check on the home screen would pass whether isolation held or
     * not, because the home screen never prints the name.
     */
    const [first, second] = people();
    if (first === undefined || second === undefined) throw new Error('need two people');

    for (const [person, expected, other] of [
      [first, HOUSEHOLD_ONE, HOUSEHOLD_TWO],
      [second, HOUSEHOLD_TWO, HOUSEHOLD_ONE],
    ] as const) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await signIn(page, person);
      await page.goto('/setup');
      // A person with a household sees the rename field; one without sees the
      // create field. Checking which is present makes a failure say which
      // happened rather than reporting an empty value.
      await expect(page.locator('input[name="householdName"]'), person.id).toHaveCount(0);
      await expect(page.getByLabel('איך לקרוא למשק הבית')).toHaveValue(expected);
      await expect(page.getByLabel('איך לקרוא למשק הבית')).not.toHaveValue(other);
      await context.close();
    }
  });
});

test.describe('signing out ends it', () => {
  test('the protected screens go back to asking for a sign-in', async ({ page }) => {
    const first = people()[0];
    if (first === undefined) throw new Error('no synthetic person');

    await signIn(page, first);
    await page.goto('/account');
    await page.getByRole('button', { name: 'יציאה מהחשבון' }).click();

    /*
     * Signing out is a server action that clears the cookies and redirects. The
     * wait is for that navigation: asking for a protected screen before the
     * response has been applied would test the old session, not the new absence
     * of one.
     */
    await page.waitForURL((url) => new URL(url).pathname === '/login', { timeout: 30_000 });

    // And it stays gone: the money screens ask for a sign-in again.
    await page.goto('/quick');
    expect(new URL(page.url()).pathname).toBe('/login');
    await expect(page.getByRole('heading', { level: 1, name: 'כניסה לחשבון' })).toBeVisible();
  });
});
