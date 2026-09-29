'use server';

import type { RepaymentExpectation } from '@family-finance/contracts';
import {
  recordDebtEvent,
  recordRepaymentDemand,
  setRepaymentExpectation,
} from '@family-finance/local-store';

import { repayment } from '../copy/repayment';
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

/**
 * Setting, changing or withdrawing when a loan is expected to be repaid.
 *
 * Three answers, and the third is why this is a choice rather than a date field.
 * "No repayment date was agreed" is a fact about the loan; an empty date box is
 * a fact about the form. A product that cannot tell them apart either invents a
 * deadline or keeps asking a family to complete something they already
 * completed.
 *
 * Refused on a closed loan. That refusal comes from the command, which is where
 * it belongs, and it names the thing that *is* still possible — recording a
 * demand — so the sentence is an answer and not a wall.
 */
export async function setRepaymentExpectationAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const reader = new FieldReader(data);
  const debtId = reader.id('debtId', 'החוב', { required: true });
  const choice = reader.choice(
    'expectation',
    repayment.expectation.choiceLabel,
    ['dated', 'none', 'unrecorded'] as const,
    'dated',
  );
  // Read whatever the box holds whichever answer was given, so a person who
  // typed a date and then chose "agreed with no date" is not told off for the
  // date they left behind — it is simply not what they said.
  const on = reader.optionalDate('expectedRepaymentOn', repayment.expectation.dateLabel);

  if (choice === 'dated' && on === null) {
    reader.problem('expectedRepaymentOn', repayment.expectation.dateNeeded);
  }
  if (!reader.ok) return failed('בואו נשלים כמה פרטים.', reader.errors);

  const expectation: RepaymentExpectation | undefined =
    choice === 'unrecorded'
      ? undefined
      : choice === 'none'
        ? { kind: 'none' }
        : { kind: 'dated', on: on ?? '' };

  const watch = repeatWatch();

  try {
    await (
      await householdStore()
    ).run(
      (document, context) =>
        setRepaymentExpectation(
          document,
          { debtId: debtId ?? '', ...(expectation === undefined ? {} : { expectation }) },
          context,
        ),
      watch,
    );
  } catch (error) {
    return describe(error);
  }

  refreshMoneyScreens();
  return succeeded(
    watch.repeated ? repayment.expectation.unchanged : repayment.expectation.saved,
  );
}

/**
 * Writing down that the lender asked to be repaid.
 *
 * The amount and the deadline are both genuinely optional, and neither is
 * defaulted. A lender who said "I need it back soon" named no figure and no day;
 * recording 0 ₪ or today's date would put words in their mouth, and the family
 * would later read them as facts.
 *
 * Works on a loan that is already repaid, and changes nothing about it. That is
 * the whole reason this action exists separately from the ledger: a demand that
 * had to be a ledger line would either move a balance or masquerade as a note,
 * and neither is what happened.
 */
export async function recordRepaymentDemandAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const reader = new FieldReader(data);
  const debtId = reader.id('debtId', 'החוב', { required: true });
  const idempotencyKey = reader.id('idempotencyKey', 'מזהה הפעולה');
  const demandedOn = reader.date('demandedOn', repayment.demand.demandedOn);
  const requestedDeadline = reader.optionalDate(
    'requestedDeadline',
    repayment.demand.requestedDeadline,
  );
  const amountMinor = reader.optionalMoney('amountMinor', repayment.demand.amount);
  const note = reader.optionalText('note', repayment.demand.note);

  if (requestedDeadline !== null && demandedOn !== '' && requestedDeadline < demandedOn) {
    reader.problem('requestedDeadline', repayment.demand.deadlineBeforeDemand);
  }
  if (!reader.ok) return failed('בואו נשלים כמה פרטים.', reader.errors);

  const watch = repeatWatch();

  try {
    await (
      await householdStore()
    ).run(
      (document, context) =>
        recordRepaymentDemand(
          document,
          {
            debtId: debtId ?? '',
            demandedOn,
            requestedDeadline,
            amountMinor,
            note,
            ...(idempotencyKey === null ? {} : { idempotencyKey }),
          },
          context,
        ),
      watch,
    );
  } catch (error) {
    return describe(error);
  }

  refreshMoneyScreens();
  return succeeded(watch.repeated ? ALREADY_RECORDED : repayment.demand.saved);
}
