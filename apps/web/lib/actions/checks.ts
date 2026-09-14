'use server';

import {
  CommandError,
  addCheck,
  addCheckSeries,
  cancelCheck,
  clearCheck,
  closeLoan,
  deliverChecks,
  markCheckDeposited,
  markCheckReturned,
  replaceCheck,
  revertCheckStatus,
  setRepaymentPlan,
  addDebt,
} from '@family-finance/local-store';

import { FieldReader, failed, succeeded, type FormState } from '../forms';
import { gemach } from '../copy/gemach';
import { householdStore } from '../store/server';
import { describe, refreshMoneyScreens } from './errors';
import { revalidatePath } from 'next/cache';

/**
 * The gemach workflows, as server actions.
 *
 * Thin by design. Every rule that matters — which transitions are legal, that
 * delivering moves nothing, that clearing writes both halves once — lives in the
 * store commands where it can be tested without a browser. These functions read a
 * form, call one command, and turn a refusal into a Hebrew sentence.
 *
 * The one thing they do that the commands cannot is decide which screens are now
 * out of date. A check clearing changes the balance, the debt, the forecast and
 * the home screen's answer, so all of them are revalidated; a check being handed
 * over changes only the gemach screen and the exposure, and saying so keeps the
 * distinction visible even here.
 */

const refreshGemach = (): void => {
  revalidatePath('/gemach');
  revalidatePath('/gemach/[id]', 'page');
  revalidatePath('/');
  revalidatePath('/forecast');
};

/** Turns a check-specific refusal into a sentence, falling back to the general set. */
function explain(error: unknown): FormState {
  if (error instanceof CommandError) {
    const message = gemach.errors[error.code];
    if (message !== undefined) return failed(message);
  }
  return describe(error);
}

export async function addGemachLoanAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const reader = new FieldReader(data);
  const creditorName = reader.text('creditorName', gemach.lenderName, { max: 160 });
  const openingBalanceMinor = reader.money('openingBalanceMinor', gemach.principal);
  const openedOn = reader.date('openedOn', gemach.startDate);
  const agreement = reader.optionalText('agreement', gemach.agreement, 500);

  if (!reader.ok) return failed('בואו נשלים כמה פרטים.', reader.errors);

  let debtId: string;
  try {
    debtId = await (
      await householdStore()
    ).run((document, context) =>
      addDebt(
        document,
        {
          creditorName,
          kind: 'gemach',
          openingBalanceMinor,
          openedOn,
          // Zero, not null. A gemach genuinely charges nothing, and "unknown"
          // would make the debt screen warn that the cost cannot be compared.
          effectiveAnnualRateBp: 0,
          minimumPaymentMinor: null,
          paymentDueDay: null,
          urgency: 'none',
          promiseSummary: agreement,
          relationshipSensitivity: null,
          partialPaymentAllowed: null,
          expectedCallDate: null,
          notes: null,
        },
        context,
      ),
    );
  } catch (error) {
    return explain(error);
  }

  refreshMoneyScreens();
  refreshGemach();
  return succeeded('ההלוואה נרשמה.', debtId);
}

export async function setRepaymentPlanAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const reader = new FieldReader(data);
  const debtId = reader.id('debtId', 'הלוואה', { required: true });
  const installmentCount = reader.integer('installmentCount', gemach.installmentCount, {
    min: 1,
    max: 600,
    required: true,
  });
  const installmentAmountMinor = reader.money(
    'installmentAmountMinor',
    gemach.installmentAmount,
  );
  const finalInstallmentAmountMinor = reader.optionalMoney(
    'finalInstallmentAmountMinor',
    gemach.finalInstallment,
  );
  const firstDueDate = reader.date('firstDueDate', gemach.firstDueDate);
  const agreementSummary = reader.optionalText('agreementSummary', gemach.agreement, 1000);

  if (!reader.ok || debtId === null || installmentCount === null) {
    return failed('בואו נשלים כמה פרטים.', reader.errors);
  }

  try {
    await (
      await householdStore()
    ).run((document, context) =>
      setRepaymentPlan(
        document,
        {
          debtId,
          agreementSummary,
          installmentCount,
          installmentAmountMinor,
          finalInstallmentAmountMinor,
          firstDueDate,
        },
        context,
      ),
    );
  } catch (error) {
    return explain(error);
  }

  refreshGemach();
  return succeeded(gemach.planSaved);
}

export async function addCheckAction(_previous: FormState, data: FormData): Promise<FormState> {
  const reader = new FieldReader(data);
  const debtId = reader.id('debtId', 'הלוואה', { required: true });
  const accountId = reader.id('accountId', gemach.fromAccount, { required: true });
  const amountMinor = reader.money('amountMinor', gemach.amount);
  const dueDate = reader.date('dueDate', gemach.dueDate);
  const payeeName = reader.text('payeeName', gemach.lenderName, { max: 160 });
  const note = reader.optionalText('note', 'הערה', 500);
  const deliveredOn = reader.optionalDate('deliveredOn', gemach.deliveredOn);
  const checkNumber = reader.optionalText('checkNumber', gemach.checkNumber, 12);

  if (checkNumber !== null && !/^[0-9]{1,12}$/.test(checkNumber)) {
    reader.problem('checkNumber', 'מספר צ׳ק מורכב מספרות בלבד.');
  }
  if (!reader.ok || debtId === null || accountId === null) {
    return failed('בואו נשלים כמה פרטים.', reader.errors);
  }

  try {
    await (
      await householdStore()
    ).run((document, context) =>
      addCheck(
        document,
        {
          debtId,
          accountId,
          checkNumber,
          amountMinor,
          dueDate,
          payeeName,
          installmentNumber: null,
          note,
          deliveredOn,
        },
        context,
      ),
    );
  } catch (error) {
    return explain(error);
  }

  refreshGemach();
  return succeeded(gemach.checkAdded);
}

export async function addCheckSeriesAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const reader = new FieldReader(data);
  const debtId = reader.id('debtId', 'הלוואה', { required: true });
  const accountId = reader.id('accountId', gemach.fromAccount, { required: true });
  const payeeName = reader.text('payeeName', gemach.lenderName, { max: 160 });
  const count = reader.integer('count', gemach.howMany, { min: 1, max: 120, required: true });
  const amountPerCheckMinor = reader.money('amountPerCheckMinor', gemach.amountPerCheck);
  const finalCheckAmountMinor = reader.optionalMoney(
    'finalCheckAmountMinor',
    gemach.finalCheckAmount,
  );
  const firstDueDate = reader.date('firstDueDate', gemach.firstDueDate);
  const firstCheckNumber = reader.optionalText('firstCheckNumber', gemach.firstCheckNumber, 12);
  const intendedTotalMinor = reader.optionalMoney('intendedTotalMinor', gemach.intendedTotal);
  const note = reader.optionalText('note', 'הערה', 500);
  const deliveredOn = reader.optionalDate('deliveredOn', gemach.deliveredOn);

  if (firstCheckNumber !== null && !/^[0-9]{1,12}$/.test(firstCheckNumber)) {
    reader.problem('firstCheckNumber', 'מספר צ׳ק מורכב מספרות בלבד.');
  }
  if (!reader.ok || debtId === null || accountId === null || count === null) {
    return failed('בואו נשלים כמה פרטים.', reader.errors);
  }

  let created = 0;
  try {
    created = (
      await (
        await householdStore()
      ).run((document, context) =>
        addCheckSeries(
          document,
          {
            debtId,
            accountId,
            payeeName,
            count,
            amountPerCheckMinor,
            finalCheckAmountMinor,
            firstDueDate,
            firstCheckNumber,
            intendedTotalMinor,
            note,
            deliveredOn,
          },
          context,
        ),
      )
    ).length;
  } catch (error) {
    return explain(error);
  }

  refreshGemach();
  return succeeded(gemach.seriesCreated(created));
}

export async function deliverChecksAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const reader = new FieldReader(data);
  const deliveredOn = reader.date('deliveredOn', gemach.deliveredOn);
  const checkIds = data
    .getAll('checkId')
    .filter((value): value is string => typeof value === 'string' && value.length > 0);

  if (checkIds.length === 0) {
    reader.problem('checkId', 'לא נבחר אף צ׳ק.');
  }
  if (!reader.ok) return failed('בואו נשלים כמה פרטים.', reader.errors);

  let count = 0;
  try {
    count = await (
      await householdStore()
    ).run((document, context) => deliverChecks(document, { checkIds, deliveredOn }, context));
  } catch (error) {
    return explain(error);
  }

  // Deliberately only the screens that changed. No balance moved, so the money
  // screens have nothing new to say — and revalidating them anyway would blur
  // the very distinction this feature exists to hold.
  refreshGemach();
  return succeeded(
    count === 0 ? 'הצ׳קים כבר היו מסומנים כנמסרו.' : `סומנו ${count} צ׳קים כנמסרו.`,
  );
}

export async function markCheckDepositedAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const reader = new FieldReader(data);
  const checkId = reader.id('checkId', 'צ׳ק', { required: true });
  if (!reader.ok || checkId === null) return failed('בואו נשלים כמה פרטים.', reader.errors);

  try {
    await (
      await householdStore()
    ).run((document, context) => markCheckDeposited(document, { checkId }, context));
  } catch (error) {
    return explain(error);
  }

  refreshGemach();
  return succeeded('סומן כהופקד. הכסף עוד לא יצא.');
}

export async function clearCheckAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const reader = new FieldReader(data);
  const checkId = reader.id('checkId', 'צ׳ק', { required: true });
  const clearedOn = reader.date('clearedOn', gemach.clearedOn);
  if (!reader.ok || checkId === null) return failed('בואו נשלים כמה פרטים.', reader.errors);

  try {
    await (
      await householdStore()
    ).run((document, context) => clearCheck(document, { checkId, clearedOn }, context));
  } catch (error) {
    return explain(error);
  }

  // Money moved. Everything that reads a balance is now stale.
  refreshMoneyScreens();
  refreshGemach();
  return succeeded('נרשם שהצ׳ק נפרע. הכסף ירד והחוב קטן.');
}

export async function markCheckReturnedAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const reader = new FieldReader(data);
  const checkId = reader.id('checkId', 'צ׳ק', { required: true });
  const occurredOn = reader.date('occurredOn', gemach.returnedOn);
  const reason = reader.text('reason', gemach.reason, { max: 300 });
  if (!reader.ok || checkId === null) return failed('בואו נשלים כמה פרטים.', reader.errors);

  try {
    await (
      await householdStore()
    ).run((document, context) =>
      markCheckReturned(document, { checkId, occurredOn, reason }, context),
    );
  } catch (error) {
    return explain(error);
  }

  refreshGemach();
  return succeeded('נרשם שהצ׳ק חזר. החוב לא קטן — הצ׳ק לא נפרע.');
}

export async function cancelCheckAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const reader = new FieldReader(data);
  const checkId = reader.id('checkId', 'צ׳ק', { required: true });
  const occurredOn = reader.date('occurredOn', 'תאריך');
  const reason = reader.text('reason', gemach.reason, { max: 300 });
  if (!reader.ok || checkId === null) return failed('בואו נשלים כמה פרטים.', reader.errors);

  try {
    await (
      await householdStore()
    ).run((document, context) =>
      cancelCheck(document, { checkId, occurredOn, reason }, context),
    );
  } catch (error) {
    return explain(error);
  }

  refreshGemach();
  return succeeded('הצ׳ק בוטל.');
}

export async function replaceCheckAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const reader = new FieldReader(data);
  const checkId = reader.id('checkId', 'צ׳ק', { required: true });
  const reason = reader.text('reason', gemach.reason, { max: 300 });
  const amountMinor = reader.money('amountMinor', gemach.amount);
  const dueDate = reader.date('dueDate', gemach.dueDate);
  const checkNumber = reader.optionalText('checkNumber', gemach.checkNumber, 12);
  const deliveredOn = reader.optionalDate('deliveredOn', gemach.deliveredOn);
  const note = reader.optionalText('note', 'הערה', 500);

  if (checkNumber !== null && !/^[0-9]{1,12}$/.test(checkNumber)) {
    reader.problem('checkNumber', 'מספר צ׳ק מורכב מספרות בלבד.');
  }
  if (!reader.ok || checkId === null) return failed('בואו נשלים כמה פרטים.', reader.errors);

  try {
    await (
      await householdStore()
    ).run((document, context) =>
      replaceCheck(
        document,
        { checkId, reason, checkNumber, amountMinor, dueDate, note, deliveredOn },
        context,
      ),
    );
  } catch (error) {
    return explain(error);
  }

  refreshGemach();
  return succeeded('הצ׳ק הוחלף. שני הרישומים נשמרו ומקושרים זה לזה.');
}

export async function correctCheckAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const reader = new FieldReader(data);
  const checkId = reader.id('checkId', 'צ׳ק', { required: true });
  const reason = reader.text('reason', gemach.reason, { max: 300 });
  const occurredOn = reader.date('occurredOn', 'תאריך');
  if (!reader.ok || checkId === null) return failed('בואו נשלים כמה פרטים.', reader.errors);

  try {
    await (
      await householdStore()
    ).run((document, context) =>
      revertCheckStatus(document, { checkId, reason, occurredOn }, context),
    );
  } catch (error) {
    return explain(error);
  }

  // A correction can put money back, so the money screens are stale too.
  refreshMoneyScreens();
  refreshGemach();
  return succeeded('התיקון נרשם. היומן שומר גם את הרישום המקורי.');
}

export async function closeLoanAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const reader = new FieldReader(data);
  const debtId = reader.id('debtId', 'הלוואה', { required: true });
  if (!reader.ok || debtId === null) return failed('בואו נשלים כמה פרטים.', reader.errors);

  try {
    await (
      await householdStore()
    ).run((document, context) => closeLoan(document, { debtId }, context));
  } catch (error) {
    return explain(error);
  }

  refreshMoneyScreens();
  refreshGemach();
  return succeeded(gemach.closed);
}
