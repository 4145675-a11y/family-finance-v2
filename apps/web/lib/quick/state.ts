import type { AiProposal } from '@family-finance/ai-proposal';

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
  /** The open accounts, for the proposal that could not tell which was meant. */
  readonly accounts: readonly { readonly id: string; readonly name: string }[];
  /** The active debts, for a repayment that named no lender. */
  readonly debts: readonly { readonly id: string; readonly creditorName: string }[];
  readonly message: string;
  /**
   * The proposal, whichever reader produced it.
   *
   * One field because there is one card. It used to be one field per reader, with
   * a button each, and the screen had to explain a choice nobody could make;
   * which reader answered is now decided on the server and is deliberately
   * invisible, because it changes nothing about what can happen to the money.
   */
  readonly ai: AiProposal | null;
  /** Whether this deployment has a reader configured at all. */
  readonly aiConfigured: boolean;
}

export const idleQuick: QuickState = {
  status: 'idle',
  text: '',
  accounts: [],
  debts: [],
  message: '',
  ai: null,
  aiConfigured: false,
};

/** The longest utterance the screen accepts. A paragraph is a file, not a sentence. */
export const MAX_QUICK_TEXT = 500;
