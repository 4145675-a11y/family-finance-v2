'use server';

import { recordBalance, recordDebtEvent, recordTransaction } from '@family-finance/local-store';

import { FieldReader, failed, succeeded, submissionKey, type FormState } from '../forms';
import { debtEventKey } from '../quick/keys';
import { readQuickUpdate } from '../quick/read';
import { idleQuick, MAX_QUICK_TEXT, type QuickState } from '../quick/state';
import { householdStore } from '../store/server';
import { ALREADY_RECORDED, describe, refreshMoneyScreens, repeatWatch } from './errors';

/**
 * The quick update: reading a sentence, and recording what it meant.
 *
 * Two actions, and the split between them is the approval boundary. Reading
 * writes nothing at all. Recording writes through the same commands every form
 * on the product writes through — there is no command that exists only for this
 * screen, and therefore no money rule that holds on one screen and not another
 * (05-ARCHITECTURE-DATA.md).
 *
 * The approval **re-reads the sentence on the server**. The proposal the browser
 * is showing is output, not input: trusting it would mean a page could name any
 * amount against any account. What the browser may change are named fields —
 * the sum, the day, the account, the lender — and each of those is read and
 * validated here like any other form field.
 */

/**
 * Reading. Writes nothing, and says so by returning only what it understood.
 */
export async function interpretQuickUpdateAction(
  _previous: QuickState,
  data: FormData,
): Promise<QuickState> {
  const raw = data.get('text');
  const text = typeof raw === 'string' ? raw.trim().slice(0, MAX_QUICK_TEXT) : '';
  if (text === '') {
    return { ...idleQuick, status: 'error', message: 'צריך לכתוב או להקריא משהו קודם.' };
  }

  try {
    const reading = await readQuickUpdate(text);
    return {
      status: 'read',
      text,
      proposals: reading.proposals,
      accounts: reading.accounts.map((account) => ({ id: account.id, name: account.name })),
      debts: reading.debts,
      message: reading.proposals.length === 0 ? 'לא מצאנו כאן עדכון. אפשר לנסח אחרת.' : '',
    };
  } catch (error) {
    const described = describe(error);
    return { ...idleQuick, status: 'error', text, message: described.message };
  }
}

/**
 * Approving one proposal.
 *
 * The sentence is read again, the person's corrections are applied on top, and
 * only then does a command run. `idempotencyKey` comes from the form
 * (ADR-0038), so a double press records once.
 */
export async function confirmQuickUpdateAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const reader = new FieldReader(data);
  const sourceText = reader.text('sourceText', 'המשפט', { max: MAX_QUICK_TEXT });
  const index = reader.integer('proposalIndex', 'מספר ההצעה', { min: 0, max: 20 }) ?? 0;

  // The corrections a person made on the screen. Each is optional: a proposal
  // that was already complete submits them unchanged.
  const amountOverride = reader.optionalMoney('amountMinor', 'סכום');
  const accountOverride = reader.id('accountId', 'חשבון');
  const debtOverride = reader.id('debtId', 'הלוואה');
  const dateOverride = reader.optionalDate('occurredOn', 'תאריך');

  if (!reader.ok) return failed('בואו נשלים כמה פרטים.', reader.errors);
  if (sourceText === '') return failed('אין מה לרשום.');

  const watch = repeatWatch();

  try {
    const reading = await readQuickUpdate(sourceText);
    const proposal = reading.proposals[index];
    if (proposal === undefined) {
      return failed('ההצעה הזו כבר לא קיימת. כדאי לקרוא את המשפט מחדש.');
    }

    const amountMinor = amountOverride ?? proposal.amountMinor ?? 0;
    const accountId = accountOverride ?? proposal.accountId;
    const debtId = debtOverride ?? proposal.debtId;
    const occurredOn = dateOverride ?? proposal.date;

    if (amountMinor <= 0) return failed('צריך סכום גדול מאפס.');
    if (accountId === null) return failed('צריך לבחור חשבון.');

    const scope =
      reading.accounts.find((account) => account.id === accountId)?.scope ?? 'household';
    const merchant = proposal.description === '' ? null : proposal.description;
    const key = submissionKey(data);

    const store = await householdStore();

    switch (proposal.intent) {
      case 'balance':
        await store.run(
          (document, context) =>
            recordBalance(
              document,
              {
                ...(key === undefined ? {} : { idempotencyKey: key }),
                accountId,
                balanceMinor: amountMinor,
                balanceDirection: 'inflow',
                verifiedAt: occurredOn,
                source: 'manual_entry',
                note: merchant,
              },
              context,
            ),
          watch,
        );
        break;

      case 'debt_payment': {
        if (debtId === null) return failed('צריך לבחור לאיזו הלוואה התשלום שייך.');
        /*
         * Two records, because a repayment is two facts: money left an account,
         * and a balance moved. Recording only the event would leave the account
         * overstated; recording only the transaction would leave the debt
         * untouched. Both carry a key derived from the same submission, so a
         * double press still leaves one of each.
         */
        await store.run(
          (document, context) =>
            recordTransaction(
              document,
              {
                ...(key === undefined ? {} : { idempotencyKey: key }),
                accountId,
                counterpartAccountId: null,
                scope,
                kind: 'expense',
                direction: 'outflow',
                amountMinor,
                categoryId: null,
                merchant,
                transactionDate: occurredOn,
                note: sourceText,
                status: 'confirmed',
              },
              context,
            ),
          watch,
        );
        await store.run((document, context) =>
          recordDebtEvent(
            document,
            {
              ...(key === undefined ? {} : { idempotencyKey: debtEventKey(key) }),
              debtId,
              kind: 'principal_payment',
              amountMinor,
              occurredOn,
              correctionEffect: null,
              note: merchant,
            },
            context,
          ),
        );
        break;
      }

      default:
        await store.run(
          (document, context) =>
            recordTransaction(
              document,
              {
                ...(key === undefined ? {} : { idempotencyKey: key }),
                accountId,
                counterpartAccountId: null,
                scope,
                kind: proposal.direction === 'inflow' ? 'income' : 'expense',
                direction: proposal.direction ?? 'outflow',
                amountMinor,
                categoryId: null,
                merchant,
                transactionDate: occurredOn,
                note: sourceText,
                status: 'confirmed',
              },
              context,
            ),
          watch,
        );
    }
  } catch (error) {
    return describe(error);
  }

  refreshMoneyScreens();
  if (watch.repeated) return succeeded(ALREADY_RECORDED);
  return succeeded('נרשם.');
}
