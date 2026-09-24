import 'server-only';

import { CONTRACT_VERSION, type AiProposal } from '@family-finance/ai-proposal';
import { formatHebrewDate, gregorianToHebrew } from '@family-finance/hebrew-calendar';
import type { StoreDocument } from '@family-finance/local-store';
import { interpretQuickUpdate, type QuickProposal } from '@family-finance/quick-update';

import { contextFromDocument } from './read';

/**
 * The rule table's reading, wearing the same shape as the smart one.
 *
 * There is **one** flow on the screen, and this is how that stays true when the
 * smart reader is unavailable — unconfigured, timed out, rate-limited, or
 * answering nonsense. The person presses one button and gets one proposal card;
 * which reader produced it is an implementation detail of that moment, not a
 * choice they were asked to make.
 *
 * That is a product decision with a real cost, and it is worth naming: a family
 * can no longer tell from the screen that a reading was local rather than
 * remote. The compensating guarantees are that both readings pass through the
 * same verification, reach the same confirmation, and write through the same
 * command — so the thing they could previously infer from the button no longer
 * changes what can happen to their money.
 *
 * It converts rather than re-implements. The rule reader keeps its own shape and
 * its own tests; this maps one onto the other, and every field it sets is one the
 * rule reader established.
 */

/** The rule reader's intents, named as the proposal contract names them. */
const ACTION: Readonly<Record<QuickProposal['intent'], AiProposal['action']>> = {
  expense: 'expense',
  income: 'income',
  debt_payment: 'debt_repayment',
  new_principal: 'new_principal',
  new_debt: 'new_debt',
  balance: 'balance',
  unknown: 'unknown',
};

/** What the rule reader's state means in the proposal contract's words. */
function stateOf(proposal: QuickProposal, action: AiProposal['action']): AiProposal['state'] {
  if (proposal.state === 'not_understood') return 'not_understood';
  // A card that does not exist yet is a question, however clear the sentence was.
  if (action === 'new_debt') return 'needs_clarification';
  return proposal.state === 'ready' ? 'ready' : 'needs_clarification';
}

/** The questions the rule reader implies, as the card's own question list. */
function missingOf(
  proposal: QuickProposal,
  action: AiProposal['action'],
): AiProposal['missing'] {
  if (action === 'new_debt') {
    return [{ field: 'lender', question: 'ממי ההלוואה? ייפתח כרטיס חדש.' }];
  }
  switch (proposal.state) {
    case 'needs_amount':
      return [{ field: 'amount', question: 'מה הסכום?' }];
    case 'needs_account':
      return [{ field: 'account', question: 'מאיזה חשבון?' }];
    case 'needs_debt':
      return [
        {
          field: 'lender',
          question:
            proposal.debtCandidates > 1 ? 'לאיזה מלווה מתוך אלה?' : 'לאיזו הלוואה זה שייך?',
        },
      ];
    case 'needs_date':
      return [{ field: 'date', question: 'באיזה תאריך?' }];
    default:
      return [];
  }
}

function hebrewFormOf(date: string | null): string | null {
  if (date === null) return null;
  try {
    return formatHebrewDate(gregorianToHebrew(date as never));
  } catch {
    return null;
  }
}

/**
 * Reads a sentence with the rule table and returns it as a proposal.
 *
 * Writes nothing, like every other reading path. `safeToConfirm` is still
 * decided here rather than taken from anywhere: the rule reader's `ready` is a
 * statement about the sentence, and this is a statement about whether a record
 * could be written from it.
 */
export function fallbackProposal(
  text: string,
  document: StoreDocument,
  today: string,
): AiProposal {
  const context = contextFromDocument(document, today);
  const first = interpretQuickUpdate(text, context)[0];

  if (first === undefined) {
    return {
      version: CONTRACT_VERSION,
      state: 'not_understood',
      action: 'unknown',
      summary: '',
      confidence: 'low',
      evidence: { amountText: null, dateText: null, counterpartyText: null },
      amountMinor: null,
      date: null,
      hebrewDate: null,
      dueDate: null,
      dueHebrewDate: null,
      accountId: null,
      debtId: null,
      lenderName: null,
      label: null,
      lenderCandidates: 0,
      categoryId: null,
      missing: [],
      reason: '',
      safeToConfirm: false,
      unavailableReason: null,
    };
  }

  const action = ACTION[first.intent];
  const state = stateOf(first, action);
  const lenderName =
    first.debtId === null
      ? null
      : (document.debts.find((row) => row.id === first.debtId)?.creditorName ?? null);

  /*
   * The rule reader has one date slot, and a borrowing sentence can name two
   * different days: when the money arrived, and when it goes back. A day that has
   * not happened cannot be the first, so on a borrowing sentence it is the
   * second — the same rule the verifier applies to a smart reading, so one
   * sentence means one thing whichever reader saw it.
   */
  const borrowing = action === 'new_principal' || action === 'new_debt';
  const read = first.dateProblem === null ? first.date : null;
  const dueDate = borrowing && read !== null && read > today ? read : null;
  const occurred = dueDate === null ? read : today;

  return {
    version: CONTRACT_VERSION,
    state,
    action,
    summary: '',
    // The rule table is exact about what it recognises and silent otherwise, so
    // a reading it completed is a clear one.
    confidence: state === 'ready' ? 'high' : 'medium',
    evidence: { amountText: null, dateText: null, counterpartyText: null },
    amountMinor: first.amountMinor,
    date: occurred,
    hebrewDate: hebrewFormOf(occurred),
    dueDate,
    dueHebrewDate: hebrewFormOf(dueDate),
    accountId: first.accountId,
    debtId: first.debtId,
    lenderName,
    // What is left of the sentence once the sum, the day and the verb are taken
    // out — the rule reader's own label, and the person's own words.
    label: first.description === '' ? null : first.description,
    lenderCandidates: first.debtCandidates,
    categoryId: first.classification?.budgetCategoryKey ?? null,
    missing: missingOf(first, action),
    reason: '',
    /*
     * Opening a lender's card is never something a reading does on its own, so a
     * new debt is never ready here either — a person names the lender and presses
     * confirm. The same rule as the verifier's, for the same reason.
     */
    safeToConfirm: state === 'ready' && action !== 'new_debt',
    unavailableReason: null,
  };
}
