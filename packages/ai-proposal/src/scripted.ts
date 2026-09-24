import type { AiUnavailableReason, ModelOutput } from './contract';
import type { AIProvider, AnalysisOutcome, AnalysisRequest } from './provider';

/**
 * A reader that answers from a prepared script, the same way every time.
 *
 * It exists so the browser suite, the unit tests and CI can exercise the **whole
 * real path** — the action, the server-side verification, the review screen, the
 * confirmation, the command, the document — without a key, without a network and
 * without a bill. What it replaces is one remote system; everything downstream of
 * it is the product.
 *
 * It deliberately does not always succeed. Its whole value is that
 * a test can ask for the awkward answers: a malformed one, a stale id, an
 * invented lender, a timeout, a rate limit. Those are the cases where the safety
 * argument either holds or does not, and they never arrive on demand from a real
 * provider.
 *
 * It lives beside the real provider rather than in a test directory because the
 * browser suite runs against a built server and has to be able to configure one.
 * It is selected only when the deployment explicitly asks for it, and a
 * production configuration that asks for it fails to start (see the web app's
 * provider selection).
 */

/** What a prepared reader should answer. One per scripted reply. */
export type PreparedReply =
  | { readonly kind: 'answer'; readonly output: ModelOutput }
  /** Whatever the provider layer would classify as unusable. */
  | { readonly kind: 'unavailable'; readonly reason: AiUnavailableReason }
  /** An answer that does not match the contract, to prove the parser refuses it. */
  | { readonly kind: 'malformed' }
  /** Hangs past any sane timeout. */
  | { readonly kind: 'hang'; readonly ms: number };

export interface SequencedAIProviderOptions {
  /**
   * Replies, consumed in order; the last one repeats.
   *
   * Ordered rather than keyed by input, so a test can say "first a clarification,
   * then a ready answer" — which is the sequence a person actually walks.
   */
  readonly replies: readonly PreparedReply[];
  /** Every request it was given, for a test to assert on what was sent. */
  readonly seen?: AnalysisRequest[];
}

export class SequencedAIProvider implements AIProvider {
  readonly name = 'sequenced';

  private readonly replies: readonly PreparedReply[];
  private readonly seen: AnalysisRequest[];
  private index = 0;

  constructor(options: SequencedAIProviderOptions) {
    if (options.replies.length === 0)
      throw new Error('SequencedAIProvider needs at least one reply');
    this.replies = options.replies;
    this.seen = options.seen ?? [];
  }

  /** What it was asked, so a test can prove the context stayed small. */
  get requests(): readonly AnalysisRequest[] {
    return this.seen;
  }

  async analyse(request: AnalysisRequest): Promise<AnalysisOutcome> {
    this.seen.push(request);
    const reply = this.replies[Math.min(this.index, this.replies.length - 1)];
    this.index += 1;
    if (reply === undefined) return { kind: 'unavailable', reason: 'provider_error' };

    switch (reply.kind) {
      case 'answer':
        return { kind: 'answered', output: reply.output };
      case 'unavailable':
        return { kind: 'unavailable', reason: reply.reason };
      case 'malformed':
        /*
         * The provider layer is what turns an unparseable answer into a reason,
         * and it has already done so by the time anything reaches here — so the
         * reader reports the outcome that a malformed answer produces. The parser
         * itself is tested directly against malformed input.
         */
        return { kind: 'unavailable', reason: 'invalid_output' };
      case 'hang':
        await new Promise((resolve) => setTimeout(resolve, reply.ms));
        return { kind: 'unavailable', reason: 'timeout' };
    }
  }
}

/**
 * A complete, valid model answer, with the awkward parts left to the caller.
 *
 * Every field has to be present for the contract to accept it, and a test that
 * spelled all twelve out each time would hide which one it was actually about.
 */
export function exampleOutput(over: Partial<ModelOutput> = {}): ModelOutput {
  return {
    state: 'ready',
    action: 'expense',
    summary: 'הוצאה בסופר',
    confidence: 'high',
    evidence: { amountText: '120 שקל', dateText: 'היום', counterpartyText: 'בסופר' },
    amountMinor: 12_000,
    date: '2026-09-24',
    dueDate: null,
    accountId: null,
    lenderText: null,
    categoryId: null,
    missing: [],
    reason: 'המשפט אומר כמה שולם, איפה ומתי.',
    ...over,
  };
}

/**
 * A reply chosen by what the sentence says, rather than by call order.
 *
 * The ordered `SequencedAIProvider` is right for a unit test, which drives one case.
 * A browser journey is different: it walks several screens in one session, and
 * each one needs the answer that belongs to *its* sentence. Matching on the text
 * makes each journey independent of every other journey's call count, which is
 * the difference between a suite that can be reordered and one that cannot.
 *
 * Deterministic in the strict sense: the same text always produces the same
 * reply, with no clock, no randomness and no network. That is what lets it stand
 * in for a provider in CI while the rest of the path — the action, the server's
 * verification, the form, the command, the document — stays entirely real.
 */
export interface ScriptRule {
  /** Matched against the person's text. First rule that matches wins. */
  readonly when: RegExp;
  readonly reply: PreparedReply;
}

export class ScriptedAIProvider implements AIProvider {
  readonly name = 'scripted';

  private readonly rules: readonly ScriptRule[];
  private readonly fallback: PreparedReply;
  private readonly seen: AnalysisRequest[] = [];

  constructor(rules: readonly ScriptRule[], fallback: PreparedReply) {
    this.rules = rules;
    this.fallback = fallback;
  }

  get requests(): readonly AnalysisRequest[] {
    return this.seen;
  }

  async analyse(request: AnalysisRequest): Promise<AnalysisOutcome> {
    this.seen.push(request);
    const rule = this.rules.find((candidate) => candidate.when.test(request.text));
    const reply = rule?.reply ?? this.fallback;

    switch (reply.kind) {
      case 'answer':
        return { kind: 'answered', output: reply.output };
      case 'unavailable':
        return { kind: 'unavailable', reason: reply.reason };
      case 'malformed':
        return { kind: 'unavailable', reason: 'invalid_output' };
      case 'hang':
        await new Promise((resolve) => setTimeout(resolve, reply.ms));
        return { kind: 'unavailable', reason: 'timeout' };
    }
  }
}
