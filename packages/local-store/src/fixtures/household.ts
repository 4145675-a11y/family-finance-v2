import { emptyDocument, type StoreDocument } from '../document';
import {
  addAccount,
  addBusiness,
  addDebt,
  addPlannedItem,
  recordBalance,
  recordTransaction,
  startBudget,
  type CommandContext,
  type CommandResult,
} from '../commands';

/**
 * A household the tests can build on.
 *
 * Invented, and small enough to reason about by hand: two accounts, one card, one
 * loan, one salary. Every figure below appears in an assertion somewhere, which is
 * the only reason any of them is what it is.
 *
 * There is no "realistic demo household" here on purpose. A fixture that looks
 * like a plausible family invites tests that assert plausible-looking totals
 * nobody has actually checked.
 */

export const TEST_NOW = '2026-09-06T09:00:00.000Z';
export const TEST_TODAY = '2026-09-06';

export function blankHousehold(now = TEST_NOW): StoreDocument {
  return emptyDocument({
    householdId: crypto.randomUUID(),
    householdName: 'משק בית לבדיקה',
    profileId: crypto.randomUUID(),
    profileName: 'בודקת',
    now,
    currency: 'ILS',
    timeZone: 'Asia/Jerusalem',
  });
}

export function contextFor(document: StoreDocument, now = TEST_NOW): CommandContext {
  const profile = document.profiles[0];
  if (profile === undefined) throw new Error('fixture has no profile');
  return { actorProfileId: profile.id, now };
}

/** Applies a sequence of commands, threading the document through. */
export function apply(
  document: StoreDocument,
  steps: readonly ((
    document: StoreDocument,
    context: CommandContext,
  ) => CommandResult<unknown>)[],
  now = TEST_NOW,
): StoreDocument {
  let working = document;
  for (const step of steps) {
    working = step(working, contextFor(working, now)).document;
  }
  return working;
}

export interface SeededHousehold {
  readonly document: StoreDocument;
  readonly bankAccountId: string;
  readonly cardAccountId: string;
  readonly businessAccountId: string;
  readonly loanDebtId: string;
  readonly privateDebtId: string;
}

/** A household with enough in it for the engine to have something to say. */
export function seededHousehold(now = TEST_NOW): SeededHousehold {
  let document = blankHousehold(now);
  const context = () => contextFor(document, now);

  const bank = addAccount(
    document,
    {
      name: 'עובר ושב',
      kind: 'bank_account',
      scope: 'household',
      institution: 'בנק לדוגמה',
      displaySuffix: null,
      openingBalanceMinor: 1_200_000,
      openingBalanceDirection: 'inflow',
      openingBalanceDate: '2026-09-01',
    },
    context(),
  );
  document = bank.document;

  const card = addAccount(
    document,
    {
      name: 'כרטיס אשראי',
      kind: 'credit_card',
      scope: 'household',
      institution: null,
      displaySuffix: '4321',
      openingBalanceMinor: 300_000,
      openingBalanceDirection: 'outflow',
      openingBalanceDate: '2026-09-01',
    },
    context(),
  );
  document = card.document;

  const business = addBusiness(
    document,
    { name: 'העסק', taxReserveRateBp: 2_500, operatingReserveMinor: 500_000 },
    context(),
  );
  document = business.document;

  const businessAccount = addAccount(
    document,
    {
      name: 'חשבון העסק',
      kind: 'bank_account',
      scope: 'business',
      institution: null,
      displaySuffix: null,
      openingBalanceMinor: 0,
      openingBalanceDirection: 'inflow',
      openingBalanceDate: '2026-09-01',
    },
    context(),
  );
  document = businessAccount.document;

  const loan = addDebt(
    document,
    {
      creditorName: 'בנק לדוגמה',
      kind: 'bank_loan',
      openingBalanceMinor: 4_000_000,
      openedOn: '2026-01-01',
      effectiveAnnualRateBp: 900,
      minimumPaymentMinor: 120_000,
      paymentDueDay: 10,
      urgency: 'none',
      promiseSummary: null,
      relationshipSensitivity: null,
      partialPaymentAllowed: null,
      expectedCallDate: null,
      notes: null,
    },
    context(),
  );
  document = loan.document;

  const privateDebt = addDebt(
    document,
    {
      creditorName: 'משה',
      kind: 'private_person',
      openingBalanceMinor: 500_000,
      openedOn: '2026-05-01',
      effectiveAnnualRateBp: null,
      minimumPaymentMinor: null,
      paymentDueDay: null,
      urgency: 'watch',
      promiseSummary: 'להחזיר כשאפשר',
      relationshipSensitivity: 'high',
      partialPaymentAllowed: true,
      expectedCallDate: '2026-10-15',
      notes: null,
    },
    context(),
  );
  document = privateDebt.document;

  document = apply(
    document,
    [
      (documentIn, contextIn) =>
        recordBalance(
          documentIn,
          {
            accountId: bank.value,
            balanceMinor: 1_200_000,
            balanceDirection: 'inflow',
            verifiedAt: '2026-09-05T18:00:00.000Z',
            source: 'manual_entry',
            note: null,
          },
          contextIn,
        ),
      (documentIn, contextIn) =>
        addPlannedItem(
          documentIn,
          {
            label: 'משכורת',
            scope: 'household',
            direction: 'inflow',
            amountMinor: 1_400_000,
            certainty: 'certain',
            expectedDate: '2026-09-10',
            dueDate: null,
            essential: false,
            categoryId: null,
            accountId: bank.value,
          },
          contextIn,
        ),
      (documentIn, contextIn) =>
        addPlannedItem(
          documentIn,
          {
            label: 'שכר דירה',
            scope: 'household',
            direction: 'outflow',
            amountMinor: 700_000,
            certainty: 'certain',
            expectedDate: '2026-09-08',
            dueDate: '2026-09-08',
            essential: true,
            categoryId: null,
            accountId: bank.value,
          },
          contextIn,
        ),
      (documentIn, contextIn) =>
        startBudget(
          documentIn,
          {
            period: '2026-09',
            lines: [
              { categoryKey: 'food', plannedMinor: 400_000 },
              { categoryKey: 'housing_and_bills', plannedMinor: 900_000 },
              { categoryKey: 'transport_and_fuel', plannedMinor: 150_000 },
            ],
          },
          contextIn,
        ),
    ],
    now,
  );

  return {
    document,
    bankAccountId: bank.value,
    cardAccountId: card.value,
    businessAccountId: businessAccount.value,
    loanDebtId: loan.value,
    privateDebtId: privateDebt.value,
  };
}

/** Records an ordinary household expense on the bank account. */
export function spend(
  document: StoreDocument,
  accountId: string,
  amountMinor: number,
  date: string,
  merchant: string,
  categoryId: string | null = null,
  now = TEST_NOW,
): CommandResult<string> {
  return recordTransaction(
    document,
    {
      accountId,
      counterpartAccountId: null,
      scope: 'household',
      kind: 'expense',
      direction: 'outflow',
      amountMinor,
      categoryId,
      merchant,
      transactionDate: date,
      note: null,
      status: 'confirmed',
    },
    contextFor(document, now),
  );
}
