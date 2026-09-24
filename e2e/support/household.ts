import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  addAccount,
  addDebt,
  addPlannedItem,
  HouseholdStore,
  recordBalance,
  resolveStorePaths,
} from '@family-finance/local-store';

/**
 * The household the browser suite works in.
 *
 * Two properties make it safe to run these tests on the machine that also holds
 * a real household, and both are structural rather than a matter of care:
 *
 *   1. **It lives in a temporary directory.** `FAMILY_FINANCE_DATA_DIR` points
 *      the server at a fresh `mkdtemp` path, so the family's own `.data` is not
 *      opened, not read and not written. Deleting that directory is the whole
 *      cleanup, and it runs whether the suite passed or failed.
 *   2. **Every name starts with `E2E`.** If one of these records ever appeared
 *      on a real screen it would be unmistakable, and a test asserting on
 *      `E2E גמח ראשון` cannot quietly pass against a real lender.
 *
 * It is built by calling the product's **own commands** rather than by writing
 * JSON. A hand-written document drifts from the schema the day somebody adds a
 * field, and the failure surfaces as a validation error in an unrelated test.
 * Building it through `addAccount` and `addDebt` means the seed is correct by
 * construction, or the seed itself fails loudly before a browser opens.
 */

export const HOUSEHOLD_NAME = 'E2E משק בית בדיקה';

/** One open account, so a quick update has nothing to ask about. */
export const ACCOUNT_NAME = 'E2E עובר ושב';

/**
 * A lender per concern, so one spec file cannot move a figure another asserts on.
 *
 * The suite seeds once and the files share the household, which is right — a
 * product is one household, and re-seeding between files would hide the kind of
 * interaction a real family has. What it means in practice is that a spec has to
 * own the records it changes, and the cheapest way to arrange that is a lender
 * each.
 */

/** Named in quick-update sentences, and chosen from its dropdown. */
export const LENDER_PLAIN = 'E2E גמח ראשון';

/** Written to through the lender card's own form. */
export const LENDER_CARD = 'E2E גמח שני';

/** Deliberately paid more than it is owed, to check how that is displayed. */
export const LENDER_OVERPAY = 'E2E גמח שלישי';

/**
 * The smart-reading journeys' own lender.
 *
 * Opened large enough to absorb the 3,000 repayment those journeys make, so that
 * spec never zeroes a balance another spec is asserting on. One lender per
 * concern is what keeps the files reorderable.
 */
export const LENDER_AI = 'E2E גמח רביעי';

/**
 * A gemach and its branch, whose names overlap.
 *
 * Naming the longer one names the shorter one too, so "החזרתי 200 לE2E גמח אור
 * החיים" matches both at once. That is the case the product must refuse to
 * resolve on its own, and it has to be seeded to be tested — which is also why
 * the pair is written this way round rather than as two unrelated names: an
 * overlap has to actually overlap.
 */
export const LENDER_OVERLAP_A = 'E2E גמח אור';
export const LENDER_OVERLAP_B = 'E2E גמח אור החיים';

/** Openings, in agorot. Distinct figures so a wrong lender is obvious. */
export const LENDER_PLAIN_OPENING_MINOR = 100_000;
export const LENDER_CARD_OPENING_MINOR = 100_000;
export const LENDER_OVERPAY_OPENING_MINOR = 50_000;
export const LENDER_AI_OPENING_MINOR = 500_000;
export const LENDER_OVERLAP_A_OPENING_MINOR = 50_000;
export const LENDER_OVERLAP_B_OPENING_MINOR = 70_000;

/** The account's opening balance, in agorot. */
export const ACCOUNT_OPENING_MINOR = 1_250_000;

export interface SeededHousehold {
  /** The data directory the server is pointed at. */
  readonly dataDirectory: string;
  readonly accountId: string;
  readonly lenderPlainId: string;
  readonly lenderCardId: string;
  readonly lenderOverpayId: string;
  readonly lenderAiId: string;
  readonly lenderOverlapAId: string;
  readonly lenderOverlapBId: string;
}

/** The shape of a debt this seed creates. Only the name and opening differ. */
function debtInput(creditorName: string, openingBalanceMinor: number) {
  return {
    creditorName,
    kind: 'gemach' as const,
    openingBalanceMinor,
    openedOn: '2026-08-01',
    effectiveAnnualRateBp: null,
    minimumPaymentMinor: null,
    paymentDueDay: null,
    urgency: 'none' as const,
    promiseSummary: null,
    relationshipSensitivity: 'low' as const,
    partialPaymentAllowed: true,
    expectedCallDate: null,
    notes: null,
  };
}

/**
 * Creates the temporary household and returns where it lives.
 *
 * Called once per run, from the Playwright config, before any server starts.
 */
export async function seedHousehold(): Promise<SeededHousehold> {
  const dataDirectory = mkdtempSync(join(tmpdir(), 'family-finance-e2e-'));
  const store = new HouseholdStore(resolveStorePaths(dataDirectory, dataDirectory));

  await store.create({
    householdName: HOUSEHOLD_NAME,
    profileName: 'E2E בודקת',
    currency: 'ILS',
    timeZone: 'Asia/Jerusalem',
  });

  const accountId = await store.run((document, context) =>
    addAccount(
      document,
      {
        name: ACCOUNT_NAME,
        kind: 'bank_account',
        scope: 'household',
        institution: null,
        displaySuffix: null,
        openingBalanceMinor: ACCOUNT_OPENING_MINOR,
        openingBalanceDirection: 'inflow',
        openingBalanceDate: '2026-09-01',
      },
      context,
    ),
  );

  // A confirmed balance, so the home screen has a figure rather than a prompt.
  await store.run((document, context) =>
    recordBalance(
      document,
      {
        accountId,
        balanceMinor: ACCOUNT_OPENING_MINOR,
        balanceDirection: 'inflow',
        verifiedAt: '2026-09-20T09:00:00.000Z',
        source: 'manual_entry',
        note: null,
      },
      context,
    ),
  );

  // Something expected, so the forecast and the month-end card have content.
  await store.run((document, context) =>
    addPlannedItem(
      document,
      {
        label: 'E2E משכורת',
        scope: 'household',
        direction: 'inflow',
        amountMinor: 1_400_000,
        accountId,
        categoryId: null,
        certainty: 'certain',
        expectedDate: '2026-10-10',
        dueDate: null,
        essential: false,
      },
      context,
    ),
  );

  const lend = (name: string, opening: number): Promise<string> =>
    store.run((document, context) => addDebt(document, debtInput(name, opening), context));

  const lenderPlainId = await lend(LENDER_PLAIN, LENDER_PLAIN_OPENING_MINOR);
  const lenderCardId = await lend(LENDER_CARD, LENDER_CARD_OPENING_MINOR);
  const lenderOverpayId = await lend(LENDER_OVERPAY, LENDER_OVERPAY_OPENING_MINOR);
  const lenderAiId = await lend(LENDER_AI, LENDER_AI_OPENING_MINOR);
  const lenderOverlapAId = await lend(LENDER_OVERLAP_A, LENDER_OVERLAP_A_OPENING_MINOR);
  const lenderOverlapBId = await lend(LENDER_OVERLAP_B, LENDER_OVERLAP_B_OPENING_MINOR);

  return {
    dataDirectory,
    accountId,
    lenderPlainId,
    lenderCardId,
    lenderOverpayId,
    lenderAiId,
    lenderOverlapAId,
    lenderOverlapBId,
  };
}

/** Removes the temporary household. Safe to call twice. */
export function removeHousehold(dataDirectory: string): void {
  rmSync(dataDirectory, { recursive: true, force: true });
}
