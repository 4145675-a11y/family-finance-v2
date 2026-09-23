'use server';

import { recordDebtEvent } from '@family-finance/local-store';

import { FieldReader, failed, succeeded, type FormState } from '../forms';
import { householdStore } from '../store/server';
import { ALREADY_RECORDED, describe, refreshMoneyScreens, repeatWatch } from './errors';

/**
 * Adding a line to a lender's ledger.
 *
 * Every action a family can take on a debt arrives here, and every one of them is
 * an *event*. Nothing in this file writes a balance: the balance is replayed from
 * the events by `replayDebtBalances`, so a correction cannot drift away from the
 * history that explains it and a mistake is fixed by recording the correction
 * rather than by editing the past.
 *
 * That is why "adjustment" carries a direction of its own. A correction can go
 * either way, and 02-FINANCIAL-RULES.md § אינווריאנטים requires it to stay
 * visibly distinct from a repayment — a wrong opening figure being fixed is not
 * progress on the debt, and the ledger must not let the two look alike.
 *
 * A note is the one action with no amount. It exists because a lender's history
 * is not only money: a conversation, a promise, a change of terms belong beside
 * the numbers that explain them.
 */
export async function recordLedgerActionAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const reader = new FieldReader(data);
  const debtId = reader.id('debtId', 'החוב', { required: true });
  /**
   * The identifier this ledger line will have.
   *
   * Rendered once with the form, so a double click or a retry records the
   * payment once. A submission without one is still accepted — the field is a
   * safeguard, not a gate — but the page always sends it.
   */
  const idempotencyKey = reader.id('idempotencyKey', 'מזהה הפעולה');
  const kind = reader.choice(
    'kind',
    'סוג הפעולה',
    [
      'new_principal',
      'principal_payment',
      'balance_correction',
      'write_off',
      'note',
      'interest_charge',
      'fee_charge',
    ] as const,
    'principal_payment',
  );
  const occurredOn = reader.date('occurredOn', 'תאריך');
  const note = reader.text('note', 'הערה', { max: 500, required: kind === 'note' });

  // A note records a fact, not a sum. Every other action moves money.
  const amountMinor = kind === 'note' ? 0 : reader.money('amountMinor', 'סכום');

  // A correction has to say which way it goes; nothing else may.
  const correctionEffect =
    kind === 'balance_correction'
      ? reader.choice(
          'correctionEffect',
          'כיוון התיקון',
          ['increase', 'decrease'] as const,
          'decrease',
        )
      : null;

  if (debtId === null) reader.problem('debtId', 'לא ברור לאיזה חוב זה שייך');
  if (!reader.ok) return failed('בואו נשלים כמה פרטים.', reader.errors);

  /*
   * Whether this submission was the one that recorded the action, or a repeat of
   * one already recorded. Both are successes; they are not the same sentence.
   */
  const watch = repeatWatch();

  try {
    await (
      await householdStore()
    ).run(
      (document, context) =>
        recordDebtEvent(
          document,
          {
            debtId: debtId ?? '',
            kind,
            amountMinor,
            occurredOn,
            correctionEffect,
            note: note === '' ? null : note,
            ...(idempotencyKey === null ? {} : { idempotencyKey }),
          },
          context,
        ),
      watch,
    );
  } catch (error) {
    return describe(error);
  }

  // Only now — the write returned and the screens are about to re-read.
  refreshMoneyScreens();
  return succeeded(watch.repeated ? ALREADY_RECORDED : 'הפעולה נרשמה בכרטיס המלווה.');
}
