import 'server-only';

import {
  addDebt,
  recordBalance,
  recordDebtEvent,
  recordTransaction,
} from '@family-finance/local-store';
import type { RecordScope } from '@family-finance/contracts';

import { debtEventKey } from './keys';
import { householdStore } from '../store/server';

/**
 * The one place a quick update becomes a record.
 *
 * Two readers now produce proposals — the deterministic rule table and the smart
 * one — and both end here. That is the whole point of this file existing: a
 * second write path would mean a money rule that holds for one reader and not
 * the other, and the rule that matters most (nothing is written that a person
 * did not confirm) is exactly the one a second path would quietly relax.
 *
 * What arrives is an `ApprovedAction`: values a caller has already validated
 * against this household. This function does not decide anything. It does not
 * look at a model's output, does not resolve a name, does not create a lender
 * from a string, and does not compute a balance — M1's replay remains the only
 * thing that does. It takes verified values and calls the same commands every
 * other form in the product calls.
 */

export type ApprovedIntent = 'expense' | 'income' | 'balance' | 'debt_repayment' | 'new_debt';

export interface ApprovedAction {
  readonly intent: ApprovedIntent;
  /** Agorot. Non-negative, integer; the caller has already checked. */
  readonly amountMinor: number;
  /** An account of this household, verified by the caller. */
  readonly accountId: string;
  readonly scope: RecordScope;
  /** An active debt of this household, for a repayment. */
  readonly debtId: string | null;
  /** The lender's name, for a new debt. Typed by a person, never by a model. */
  readonly creditorName: string | null;
  readonly occurredOn: string;
  readonly merchant: string | null;
  /** The sentence, kept on the record so the reading can be checked later. */
  readonly sourceText: string;
  /** The submission's identifier (ADR-0038). Absent only for a caller with none. */
  readonly idempotencyKey: string | undefined;
}

export interface ApplyOptions {
  /** Told whether the write was the one that recorded it, or a repeat. */
  readonly report?: (outcome: { readonly alreadyRecorded: boolean }) => void;
}

export async function applyQuickUpdate(
  action: ApprovedAction,
  options: ApplyOptions = {},
): Promise<void> {
  const store = await householdStore();
  const key = action.idempotencyKey;
  const keyed = key === undefined ? {} : { idempotencyKey: key };

  switch (action.intent) {
    case 'balance':
      await store.run(
        (document, context) =>
          recordBalance(
            document,
            {
              ...keyed,
              accountId: action.accountId,
              balanceMinor: action.amountMinor,
              balanceDirection: 'inflow',
              verifiedAt: action.occurredOn,
              source: 'manual_entry',
              note: action.merchant,
            },
            context,
          ),
        options,
      );
      return;

    case 'debt_repayment': {
      if (action.debtId === null) {
        throw new Error('a repayment reached the writer without a verified debt');
      }
      /*
       * Two records, because a repayment is two facts: money left an account and
       * a balance moved. Recording only the event would leave the account
       * overstated; recording only the transaction would leave the debt
       * untouched. Both keys derive from one submission, so a double press still
       * leaves one of each (ADR-0038, ADR-0039).
       */
      await store.run(
        (document, context) =>
          recordTransaction(
            document,
            {
              ...keyed,
              accountId: action.accountId,
              counterpartAccountId: null,
              scope: action.scope,
              kind: 'expense',
              direction: 'outflow',
              amountMinor: action.amountMinor,
              categoryId: null,
              merchant: action.merchant,
              transactionDate: action.occurredOn,
              note: action.sourceText,
              status: 'confirmed',
            },
            context,
          ),
        options,
      );
      await store.run((document, context) =>
        recordDebtEvent(
          document,
          {
            ...(key === undefined ? {} : { idempotencyKey: debtEventKey(key) }),
            debtId: action.debtId ?? '',
            kind: 'principal_payment',
            amountMinor: action.amountMinor,
            occurredOn: action.occurredOn,
            correctionEffect: null,
            note: action.merchant,
          },
          context,
        ),
      );
      return;
    }

    case 'new_debt': {
      if (action.creditorName === null || action.creditorName.trim() === '') {
        throw new Error('a new debt reached the writer without a lender named by a person');
      }
      /*
       * A lender is created only here, and only from a name a person typed into
       * a field and pressed confirm on. A model naming a lender never reaches
       * this line: `verifyProposal` refuses an id that is not already in the
       * household, and the review screen requires the name as an ordinary
       * required field.
       *
       * The opening balance is what was borrowed, recorded as an event by
       * `addDebt` — so the balance stays a replay and not a stored figure (M1).
       */
      await store.run(
        (document, context) =>
          addDebt(
            document,
            {
              ...keyed,
              creditorName: action.creditorName ?? '',
              kind: 'private_person',
              openingBalanceMinor: action.amountMinor,
              openedOn: action.occurredOn,
              effectiveAnnualRateBp: null,
              minimumPaymentMinor: null,
              paymentDueDay: null,
              urgency: 'none',
              promiseSummary: null,
              // A private loan has to say both of these; neither is guessed from
              // the sentence, so both take the cautious value a person can change
              // on the lender's card.
              relationshipSensitivity: 'medium',
              partialPaymentAllowed: true,
              expectedCallDate: null,
              notes: action.sourceText,
            },
            context,
          ),
        options,
      );
      return;
    }

    default:
      await store.run(
        (document, context) =>
          recordTransaction(
            document,
            {
              ...keyed,
              accountId: action.accountId,
              counterpartAccountId: null,
              scope: action.scope,
              kind: action.intent === 'income' ? 'income' : 'expense',
              direction: action.intent === 'income' ? 'inflow' : 'outflow',
              amountMinor: action.amountMinor,
              categoryId: null,
              merchant: action.merchant,
              transactionDate: action.occurredOn,
              note: action.sourceText,
              status: 'confirmed',
            },
            context,
          ),
        options,
      );
  }
}
