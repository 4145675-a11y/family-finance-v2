'use server';

import {
  acceptReconciliationGap,
  addDebt,
  addPlannedItem,
  addTask,
  closeAccount,
  recordBalance,
  recordDebtEvent,
  recordRollover,
  recordTransaction,
  removePlannedItem,
  setBudgetLine,
  settlePlannedItem,
  startBudget,
  transferToHousehold,
  updateTask,
  voidTransaction,
} from '@family-finance/local-store';
import { revalidatePath } from 'next/cache';

import { FieldReader, failed, succeeded, type FormState } from '../forms';
import { householdStore } from '../store/server';
import { describe, refreshMoneyScreens } from './errors';

/**
 * The manual entry surface: everything a family can record by hand.
 *
 * Manual entry is not the fallback for when import fails. It is the primary way
 * a household knows what it owns — 01-PRODUCT-SPEC.md's opening picture is typed,
 * not uploaded — and every one of these actions has to work on a phone, in a
 * kitchen, in under a minute.
 *
 * So the validation is strict and the messages are specific. "לא הצלחנו לקרוא את
 * הסכום" with an example beats "שגיאה", and a form that keeps what was typed
 * beats one that empties itself.
 */

export async function recordExpenseAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const reader = new FieldReader(data);
  const accountId = reader.id('accountId', 'חשבון', { required: true });
  const scope = reader.choice(
    'scope',
    'שייך ל',
    ['household', 'business'] as const,
    'household',
  );
  const amountMinor = reader.money('amountMinor', 'סכום');
  const merchant = reader.text('merchant', 'על מה', { max: 160 });
  const transactionDate = reader.date('transactionDate', 'תאריך');
  const categoryId = reader.id('categoryId', 'קטגוריה');
  const note = reader.optionalText('note', 'הערה');

  if (!reader.ok || accountId === null) {
    return failed('בואו נשלים כמה פרטים.', reader.errors);
  }

  try {
    await householdStore().run((document, context) =>
      recordTransaction(
        document,
        {
          accountId,
          counterpartAccountId: null,
          scope,
          kind: 'expense',
          direction: 'outflow',
          amountMinor,
          categoryId,
          merchant,
          transactionDate,
          note,
          status: 'confirmed',
        },
        context,
      ),
    );
  } catch (error) {
    return describe(error);
  }

  refreshMoneyScreens();
  return succeeded('ההוצאה נרשמה.');
}

export async function recordIncomeAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const reader = new FieldReader(data);
  const accountId = reader.id('accountId', 'חשבון', { required: true });
  const scope = reader.choice(
    'scope',
    'שייך ל',
    ['household', 'business'] as const,
    'household',
  );
  const amountMinor = reader.money('amountMinor', 'סכום');
  const merchant = reader.text('merchant', 'ממי או ממה', { max: 160 });
  const transactionDate = reader.date('transactionDate', 'תאריך');
  const note = reader.optionalText('note', 'הערה');

  if (!reader.ok || accountId === null) {
    return failed('בואו נשלים כמה פרטים.', reader.errors);
  }

  try {
    await householdStore().run((document, context) =>
      recordTransaction(
        document,
        {
          accountId,
          counterpartAccountId: null,
          scope,
          kind: 'income',
          direction: 'inflow',
          amountMinor,
          categoryId: null,
          merchant,
          transactionDate,
          note,
          status: 'confirmed',
        },
        context,
      ),
    );
  } catch (error) {
    return describe(error);
  }

  refreshMoneyScreens();
  return succeeded('ההכנסה נרשמה.');
}

/**
 * Moving money between the household's own accounts, and paying a card.
 *
 * A settlement is offered as its own kind rather than as a transfer with a note,
 * because 02-FINANCIAL-RULES.md treats it as one: paying the card is not a second
 * expense, and the only way to guarantee that is for the record to say what it is.
 */
export async function recordMovementAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const reader = new FieldReader(data);
  const accountId = reader.id('accountId', 'מאיזה חשבון', { required: true });
  const counterpartAccountId = reader.id('counterpartAccountId', 'לאיזה חשבון', {
    required: true,
  });
  const kind = reader.choice('kind', 'סוג', ['transfer', 'settlement'] as const, 'transfer');
  const amountMinor = reader.money('amountMinor', 'סכום');
  const transactionDate = reader.date('transactionDate', 'תאריך');
  const note = reader.optionalText('note', 'הערה');

  if (accountId !== null && accountId === counterpartAccountId) {
    reader.problem('counterpartAccountId', 'צריך לבחור שני חשבונות שונים');
  }

  if (!reader.ok || accountId === null || counterpartAccountId === null) {
    return failed('בואו נשלים כמה פרטים.', reader.errors);
  }

  try {
    await householdStore().run((document, context) =>
      recordTransaction(
        document,
        {
          accountId,
          counterpartAccountId,
          scope: 'household',
          kind,
          direction: 'outflow',
          amountMinor,
          categoryId: null,
          merchant: null,
          transactionDate,
          note,
          status: 'confirmed',
        },
        context,
      ),
    );
  } catch (error) {
    return describe(error);
  }

  refreshMoneyScreens();
  return succeeded(kind === 'settlement' ? 'תשלום הכרטיס נרשם.' : 'ההעברה נרשמה.');
}

export async function recordBalanceAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const reader = new FieldReader(data);
  const accountId = reader.id('accountId', 'חשבון', { required: true });
  const balanceMinor = reader.money('balanceMinor', 'היתרה', { allowZero: true });
  const balanceDirection = reader.choice(
    'balanceDirection',
    'האם זה כסף שיש או כסף שחייבים',
    ['inflow', 'outflow'] as const,
    'inflow',
  );
  const verifiedOn = reader.date('verifiedOn', 'נכון לתאריך');
  const note = reader.optionalText('note', 'הערה', 280);

  if (!reader.ok || accountId === null) {
    return failed('בואו נשלים כמה פרטים.', reader.errors);
  }

  try {
    await householdStore().run((document, context) =>
      recordBalance(
        document,
        {
          accountId,
          balanceMinor,
          balanceDirection,
          verifiedAt: `${verifiedOn}T12:00:00.000Z`,
          source: 'manual_entry',
          note,
        },
        context,
      ),
    );
  } catch (error) {
    return describe(error);
  }

  refreshMoneyScreens();
  return succeeded('היתרה עודכנה. התמונה מעודכנת יותר עכשיו.');
}

export async function acceptGapAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const reader = new FieldReader(data);
  const accountId = reader.id('accountId', 'חשבון', { required: true });
  const differenceMinor = reader.money('differenceMinor', 'ההפרש');
  const direction = reader.choice(
    'direction',
    'כיוון',
    ['inflow', 'outflow'] as const,
    'outflow',
  );
  const asOfDate = reader.date('asOfDate', 'תאריך');

  if (!reader.ok || accountId === null) {
    return failed('בואו נשלים כמה פרטים.', reader.errors);
  }

  try {
    await householdStore().run((document, context) =>
      acceptReconciliationGap(
        document,
        { accountId, differenceMinor, direction, asOfDate },
        context,
      ),
    );
  } catch (error) {
    return describe(error);
  }

  refreshMoneyScreens();
  return succeeded('ההפרש נסגר ונרשם כתיקון, לא כהוצאה.');
}

export async function closeAccountAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const reader = new FieldReader(data);
  const accountId = reader.id('accountId', 'חשבון', { required: true });
  if (!reader.ok || accountId === null) return failed('לא נבחר חשבון.', reader.errors);

  try {
    await householdStore().run((document, context) =>
      closeAccount(document, { accountId }, context),
    );
  } catch (error) {
    return describe(error);
  }

  refreshMoneyScreens();
  return succeeded('החשבון נסגר. ההיסטוריה שלו נשמרה.');
}

export async function voidTransactionAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const reader = new FieldReader(data);
  const transactionId = reader.id('transactionId', 'רשומה', { required: true });
  const reason = reader.text('reason', 'למה', { max: 300 });

  if (!reader.ok || transactionId === null) {
    return failed('בואו נשלים כמה פרטים.', reader.errors);
  }

  try {
    await householdStore().run((document, context) =>
      voidTransaction(document, { transactionId, reason }, context),
    );
  } catch (error) {
    return describe(error);
  }

  refreshMoneyScreens();
  return succeeded('הרשומה בוטלה. היא נשארת בהיסטוריה, מסומנת.');
}

export async function addPlannedItemAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const reader = new FieldReader(data);
  const label = reader.text('label', 'על מה מדובר', { max: 160 });
  const scope = reader.choice(
    'scope',
    'שייך ל',
    ['household', 'business'] as const,
    'household',
  );
  const direction = reader.choice(
    'direction',
    'נכנס או יוצא',
    ['inflow', 'outflow'] as const,
    'outflow',
  );
  const amountMinor = reader.money('amountMinor', 'סכום');
  const certainty = reader.choice(
    'certainty',
    'עד כמה זה בטוח',
    ['certain', 'probable', 'possible'] as const,
    'certain',
  );
  const expectedDate = reader.date('expectedDate', 'מתי זה צפוי');
  const dueDate = reader.optionalDate('dueDate', 'תאריך אחרון לתשלום');
  const essential = reader.boolean('essential');
  const categoryId = reader.id('categoryId', 'קטגוריה');
  const accountId = reader.id('accountId', 'חשבון');

  if (!reader.ok) return failed('בואו נשלים כמה פרטים.', reader.errors);

  try {
    await householdStore().run((document, context) =>
      addPlannedItem(
        document,
        {
          label,
          scope,
          direction,
          amountMinor,
          certainty,
          expectedDate,
          dueDate,
          essential,
          categoryId,
          accountId,
        },
        context,
      ),
    );
  } catch (error) {
    return describe(error);
  }

  refreshMoneyScreens();
  return succeeded(
    direction === 'inflow' ? 'נרשם ככסף שצפוי להיכנס.' : 'נרשם כתשלום שצפוי לרדת.',
  );
}

/**
 * Marking an expected movement as done, and recording the money at the same time.
 *
 * Two records in one action, because splitting them is how a family ends up with
 * a bill counted twice: once as still-to-pay and once as paid.
 */
export async function settlePlannedItemAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const reader = new FieldReader(data);
  const itemId = reader.id('itemId', 'פריט', { required: true });
  const accountId = reader.id('accountId', 'חשבון', { required: true });
  const amountMinor = reader.money('amountMinor', 'סכום');
  const transactionDate = reader.date('transactionDate', 'תאריך');

  if (!reader.ok || itemId === null || accountId === null) {
    return failed('בואו נשלים כמה פרטים.', reader.errors);
  }

  try {
    await householdStore().run((document, context) => {
      const item = document.cashflowItems.find((candidate) => candidate.id === itemId);
      if (item === undefined) {
        return { document, value: undefined };
      }

      const recorded = recordTransaction(
        document,
        {
          accountId,
          counterpartAccountId: null,
          scope: item.scope,
          kind: item.direction === 'inflow' ? 'income' : 'expense',
          direction: item.direction,
          amountMinor,
          categoryId: item.categoryId,
          merchant: item.label,
          transactionDate,
          note: null,
          status: 'confirmed',
        },
        context,
      );

      return settlePlannedItem(
        recorded.document,
        { itemId, transactionId: recorded.value },
        context,
      );
    });
  } catch (error) {
    return describe(error);
  }

  refreshMoneyScreens();
  return succeeded('סומן כבוצע, והכסף נרשם.');
}

export async function removePlannedItemAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const reader = new FieldReader(data);
  const itemId = reader.id('itemId', 'פריט', { required: true });
  if (!reader.ok || itemId === null) return failed('לא נבחר פריט.', reader.errors);

  try {
    await householdStore().run((document, context) =>
      removePlannedItem(document, { itemId }, context),
    );
  } catch (error) {
    return describe(error);
  }

  refreshMoneyScreens();
  return succeeded('הפריט הוסר מהתחזית.');
}

export async function addDebtAction(_previous: FormState, data: FormData): Promise<FormState> {
  const reader = new FieldReader(data);
  const creditorName = reader.text('creditorName', 'למי חייבים', { max: 160 });
  const kind = reader.choice(
    'kind',
    'סוג החוב',
    [
      'mortgage',
      'bank_loan',
      'revolving_credit',
      'overdraft',
      'private_person',
      'institution',
      'other',
    ] as const,
    'bank_loan',
  );
  const openingBalanceMinor = reader.money('openingBalanceMinor', 'כמה נשאר לשלם');
  const openedOn = reader.date('openedOn', 'מתי נלקח');
  const effectiveAnnualRateBp = reader.percentBp('annualRatePercent', 'ריבית שנתית');
  const minimumPaymentMinor = reader.optionalMoney('minimumPaymentMinor', 'תשלום חודשי');
  const paymentDueDay = reader.integer('paymentDueDay', 'יום התשלום בחודש', {
    min: 1,
    max: 31,
  });
  const urgency = reader.choice(
    'urgency',
    'עד כמה זה דוחק',
    ['none', 'watch', 'demanded', 'legal'] as const,
    'none',
  );
  const promiseSummary = reader.optionalText('promiseSummary', 'מה סוכם');
  const expectedCallDate = reader.optionalDate('expectedCallDate', 'מתי עלולים לבקש בחזרה');
  const notes = reader.optionalText('notes', 'הערות', 1000);

  const isPrivate = kind === 'private_person';
  const relationshipSensitivity = isPrivate
    ? (reader.optionalChoice('relationshipSensitivity', ['low', 'medium', 'high'] as const) ??
      'medium')
    : null;
  const partialPaymentAllowed = isPrivate ? reader.boolean('partialPaymentAllowed') : null;

  if (!reader.ok) return failed('בואו נשלים כמה פרטים.', reader.errors);

  try {
    await householdStore().run((document, context) =>
      addDebt(
        document,
        {
          creditorName,
          kind,
          openingBalanceMinor,
          openedOn,
          effectiveAnnualRateBp,
          minimumPaymentMinor,
          paymentDueDay,
          urgency,
          promiseSummary,
          relationshipSensitivity,
          partialPaymentAllowed,
          expectedCallDate,
          notes,
        },
        context,
      ),
    );
  } catch (error) {
    return describe(error);
  }

  refreshMoneyScreens();
  return succeeded('החוב נרשם.');
}

/**
 * A repayment: cash out of an account, and principal off the debt.
 *
 * Interest is entered separately and recorded as a separate event, because a
 * payment that is mostly interest is not mostly progress, and a single "payment"
 * field would hide exactly that.
 */
export async function recordDebtPaymentAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const reader = new FieldReader(data);
  const debtId = reader.id('debtId', 'חוב', { required: true });
  const accountId = reader.id('accountId', 'מאיזה חשבון');
  const principalMinor = reader.money('principalMinor', 'על חשבון הקרן', { allowZero: true });
  const interestMinor = reader.optionalMoney('interestMinor', 'ריבית ועמלות') ?? 0;
  const occurredOn = reader.date('occurredOn', 'תאריך');

  if (principalMinor === 0 && interestMinor === 0) {
    reader.problem('principalMinor', 'צריך למלא לפחות אחד מהשניים');
  }

  if (!reader.ok || debtId === null) {
    return failed('בואו נשלים כמה פרטים.', reader.errors);
  }

  try {
    await householdStore().run((document, context) => {
      let working = document;
      let transactionId: string | null = null;

      if (accountId !== null) {
        const paid = recordTransaction(
          working,
          {
            accountId,
            counterpartAccountId: null,
            scope: 'household',
            kind: 'expense',
            direction: 'outflow',
            amountMinor: principalMinor + interestMinor,
            categoryId: null,
            merchant: 'תשלום חוב',
            transactionDate: occurredOn,
            note: null,
            status: 'confirmed',
          },
          context,
        );
        working = paid.document;
        transactionId = paid.value;
      }

      if (principalMinor > 0) {
        working = recordDebtEvent(
          working,
          {
            debtId,
            kind: 'principal_payment',
            amountMinor: principalMinor,
            occurredOn,
            correctionEffect: null,
            transactionId,
          },
          context,
        ).document;
      }

      if (interestMinor > 0) {
        working = recordDebtEvent(
          working,
          {
            debtId,
            kind: 'interest_paid',
            amountMinor: interestMinor,
            occurredOn,
            correctionEffect: null,
            transactionId,
          },
          context,
        ).document;
      }

      return { document: working, value: undefined };
    });
  } catch (error) {
    return describe(error);
  }

  refreshMoneyScreens();
  return succeeded(
    interestMinor > 0
      ? 'התשלום נרשם. הריבית נרשמה בנפרד — היא לא מקטינה את הקרן.'
      : 'התשלום נרשם.',
  );
}

export async function recordNewDebtAmountAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const reader = new FieldReader(data);
  const debtId = reader.id('debtId', 'חוב', { required: true });
  const amountMinor = reader.money('amountMinor', 'סכום');
  const occurredOn = reader.date('occurredOn', 'תאריך');

  if (!reader.ok || debtId === null) {
    return failed('בואו נשלים כמה פרטים.', reader.errors);
  }

  try {
    await householdStore().run((document, context) =>
      recordDebtEvent(
        document,
        {
          debtId,
          kind: 'new_principal',
          amountMinor,
          occurredOn,
          correctionEffect: null,
        },
        context,
      ),
    );
  } catch (error) {
    return describe(error);
  }

  refreshMoneyScreens();
  return succeeded('החוב החדש נרשם.');
}

export async function recordRolloverAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const reader = new FieldReader(data);
  const fromDebtId = reader.id('fromDebtId', 'החוב שנפרע', { required: true });
  const toDebtId = reader.id('toDebtId', 'החוב שמימן את הפירעון', { required: true });
  const amountMinor = reader.money('amountMinor', 'סכום');
  const occurredOn = reader.date('occurredOn', 'תאריך');
  const notes = reader.optionalText('notes', 'הערות');

  if (!reader.ok || fromDebtId === null || toDebtId === null) {
    return failed('בואו נשלים כמה פרטים.', reader.errors);
  }

  try {
    await householdStore().run((document, context) =>
      recordRollover(
        document,
        { fromDebtId, toDebtId, amountMinor, occurredOn, notes },
        context,
      ),
    );
  } catch (error) {
    return describe(error);
  }

  refreshMoneyScreens();
  return succeeded('נרשם: חוב אחד נפרע, חוב אחר נפתח. סך החובות לא ירד.');
}

export async function transferToHouseholdAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const reader = new FieldReader(data);
  const businessAccountId = reader.id('businessAccountId', 'חשבון העסק', { required: true });
  const householdAccountId = reader.id('householdAccountId', 'חשבון הבית', { required: true });
  const amountMinor = reader.money('amountMinor', 'סכום');
  const transactionDate = reader.date('transactionDate', 'תאריך');
  const note = reader.optionalText('note', 'הערה');

  if (!reader.ok || businessAccountId === null || householdAccountId === null) {
    return failed('בואו נשלים כמה פרטים.', reader.errors);
  }

  try {
    await householdStore().run((document, context) =>
      transferToHousehold(
        document,
        { businessAccountId, householdAccountId, amountMinor, transactionDate, note },
        context,
      ),
    );
  } catch (error) {
    return describe(error);
  }

  refreshMoneyScreens();
  return succeeded('ההעברה נרשמה. אל תשכחו לבצע אותה גם בבנק.');
}

export async function startBudgetAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const reader = new FieldReader(data);
  const period = reader.text('period', 'חודש', { max: 7 });
  if (!/^\d{4}-\d{2}$/.test(period)) {
    reader.problem('period', 'חודש — בפורמט 2026-09');
  }
  if (!reader.ok) return failed('בואו נשלים כמה פרטים.', reader.errors);

  try {
    await householdStore().run((document, context) =>
      startBudget(document, { period, lines: [] }, context),
    );
  } catch (error) {
    return describe(error);
  }

  refreshMoneyScreens();
  return succeeded('התחלנו תקציב לחודש. אפשר לקבוע סכומים.');
}

export async function setBudgetLineAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const reader = new FieldReader(data);
  const budgetId = reader.id('budgetId', 'תקציב', { required: true });
  const categoryKey = reader.choice(
    'categoryKey',
    'קטגוריה',
    [
      'food',
      'housing_and_bills',
      'transport_and_fuel',
      'health',
      'education',
      'clothing',
      'celebrations_and_gifts',
      'cash_and_small',
      'holidays',
      'other',
    ] as const,
    'other',
  );
  const plannedMinor = reader.money('plannedMinor', 'סכום', { allowZero: true });

  if (!reader.ok || budgetId === null) {
    return failed('בואו נשלים כמה פרטים.', reader.errors);
  }

  try {
    await householdStore().run((document, context) =>
      setBudgetLine(document, { budgetId, categoryKey, plannedMinor }, context),
    );
  } catch (error) {
    return describe(error);
  }

  refreshMoneyScreens();
  return succeeded('הסכום נשמר.');
}

export async function addTaskAction(_previous: FormState, data: FormData): Promise<FormState> {
  const reader = new FieldReader(data);
  const title = reader.text('title', 'מה צריך לעשות', { max: 160 });
  const reason = reader.optionalText('reason', 'למה');
  const amountMinor = reader.optionalMoney('amountMinor', 'סכום');
  const assignedMemberId = reader.id('assignedMemberId', 'מי');
  const dueOn = reader.optionalDate('dueOn', 'עד מתי');
  const relatedDebtId = reader.id('relatedDebtId', 'חוב');
  const recommendationKey = reader.optionalText('recommendationKey', 'מקור', 80);

  if (!reader.ok) return failed('בואו נשלים כמה פרטים.', reader.errors);

  try {
    await householdStore().run((document, context) =>
      addTask(
        document,
        {
          title,
          reason,
          origin: recommendationKey === null ? 'manual' : 'recommendation',
          recommendationKey,
          amountMinor,
          relatedDebtId,
          relatedAccountId: null,
          assignedMemberId,
          dueOn,
        },
        context,
      ),
    );
  } catch (error) {
    return describe(error);
  }

  revalidatePath('/tasks');
  revalidatePath('/');
  return succeeded('המשימה נוספה.');
}

export async function updateTaskAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const reader = new FieldReader(data);
  const taskId = reader.id('taskId', 'משימה', { required: true });
  const status = reader.optionalChoice('status', ['open', 'done', 'dismissed'] as const);
  const followUpOn = reader.optionalDate('followUpOn', 'תאריך מעקב');
  const assignedMemberId = reader.id('assignedMemberId', 'מי');

  if (!reader.ok || taskId === null) {
    return failed('בואו נשלים כמה פרטים.', reader.errors);
  }

  try {
    await householdStore().run((document, context) =>
      updateTask(
        document,
        {
          taskId,
          ...(status === null ? {} : { status }),
          followUpOn,
          assignedMemberId,
        },
        context,
      ),
    );
  } catch (error) {
    return describe(error);
  }

  revalidatePath('/tasks');
  revalidatePath('/');
  return succeeded(status === 'done' ? 'סומן כבוצע.' : 'המשימה עודכנה.');
}
