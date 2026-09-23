import type { QuickProposal } from '@family-finance/quick-update';

/**
 * What the capture screen holds between reading a sentence and approving it.
 *
 * Deliberately **not** in the `'use server'` module beside the actions. Every
 * export of one of those becomes a callable endpoint, and a constant is not
 * something a browser should be able to invoke — so the shared shape lives here
 * and the action file exports only actions.
 *
 * Nothing in this state is truth. It is what the server understood, on its way
 * to a person who will check it.
 */
export interface QuickState {
  readonly status: 'idle' | 'read' | 'error';
  /** The sentence exactly as it was submitted, so the screen can show it back. */
  readonly text: string;
  readonly proposals: readonly QuickProposal[];
  /** The open accounts, for the proposal that could not tell which was meant. */
  readonly accounts: readonly { readonly id: string; readonly name: string }[];
  /** The active debts, for a repayment that named no lender. */
  readonly debts: readonly { readonly id: string; readonly creditorName: string }[];
  readonly message: string;
}

export const idleQuick: QuickState = {
  status: 'idle',
  text: '',
  proposals: [],
  accounts: [],
  debts: [],
  message: '',
};

/** The longest utterance the screen accepts. A paragraph is a file, not a sentence. */
export const MAX_QUICK_TEXT = 500;
