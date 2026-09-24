import type { ModelOutput } from './contract';
import type { AiUnavailableReason } from './contract';

/**
 * The boundary between this product and whatever reads a sentence for it.
 *
 * Deliberately one method and no options. What a provider is allowed to do is
 * take a context this application built, take one piece of text, and return
 * something that either matches the contract or does not. It cannot ask a
 * question, cannot call a tool, cannot read a database, and cannot be given one:
 * everything it needs arrives in `AnalysisRequest`, and that object is assembled
 * on the server from a deliberately small set of facts.
 *
 * The interface is owned here — in the domain — rather than in the adapter, so
 * adding a second provider is writing one class against this file and changing
 * nothing else. That is the same shape the CRM integrations use, and the reason
 * is the same: the thing that must not move is what the application asks for.
 */

/** A choice the model may refer to, by an id this application issued. */
export interface ContextChoice {
  readonly id: string;
  readonly label: string;
  /** Other spellings of the same thing, when a family writes it several ways. */
  readonly aliases?: readonly string[];
}

/**
 * Everything a provider is told. Nothing else exists as far as it is concerned.
 *
 * What is **not** here is the point: no household document, no transactions, no
 * balances, no account numbers, no credentials, no SQL, no tools. A lender is a
 * name and an id; an account is a label and an id. There is nothing in this
 * object that would matter if it were read by a stranger, apart from the
 * sentence the person chose to send.
 */
export interface AnalysisRequest {
  /** What the person typed. Untrusted, and passed as data rather than as instructions. */
  readonly text: string;
  /** Today, so a relative day can be resolved. */
  readonly today: string;
  /** Today in the Hebrew calendar, for a sentence that speaks in it. */
  readonly todayHebrew: string;
  /** Accounts the person may be referring to. Capped by the builder. */
  readonly accounts: readonly ContextChoice[];
  /** Active lenders, for a repayment. Names and ids only — no balances. */
  readonly lenders: readonly ContextChoice[];
  /** The budget envelopes an expense can belong to. */
  readonly categories: readonly ContextChoice[];
  /** Answers already given to earlier questions, so the same one is not asked twice. */
  readonly answered?: readonly { readonly field: string; readonly value: string }[];
}

export type AnalysisOutcome =
  | { readonly kind: 'answered'; readonly output: ModelOutput }
  | { readonly kind: 'unavailable'; readonly reason: AiUnavailableReason };

export interface AIProvider {
  /** A short name for diagnostics. Never a key, never a URL with credentials. */
  readonly name: string;
  /**
   * Reads one sentence.
   *
   * Never throws for an expected failure — a timeout, a refusal, a malformed
   * answer and an absent configuration all come back as `unavailable` with a
   * reason, because the screen has to say something true about each of them and
   * an exception would become "something went wrong".
   */
  analyse(request: AnalysisRequest): Promise<AnalysisOutcome>;
}
