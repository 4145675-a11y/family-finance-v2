import 'server-only';

import {
  exampleOutput,
  type ScriptRule,
  type PreparedReply,
} from '@family-finance/ai-proposal';

/**
 * The answers the browser suite's reader gives.
 *
 * Every journey in `e2e/specs/ai-quick-update.spec.ts` types one of these
 * sentences and gets the reply below it — deterministically, with no key, no
 * network and no cost. Everything downstream is the real product: the action,
 * the server's re-verification, the review screen, the confirmation, the
 * canonical command, and the document on disk.
 *
 * Kept here rather than in the suite because the server is what builds a
 * provider, and the browser drives a built server. It is reachable only when
 * `FAMILY_FINANCE_AI_PROVIDER=scripted`, which a production process refuses.
 *
 * The replies are deliberately awkward. A script where every answer is clean
 * would prove the happy path and nothing else, and the whole safety argument
 * lives in the other cases: an invented lender, a stale account, a future date,
 * an amount with a fraction, and a sentence that tries to give orders.
 */

/** Ids that do not exist in any household. The verifier must reject them. */
const INVENTED_DEBT = '00000000-0000-4000-8000-00000000dead';
const INVENTED_ACCOUNT = '00000000-0000-4000-8000-00000000beef';

export function e2eScriptRules(): readonly ScriptRule[] {
  return [
    /*
     * A clean expense: the ordinary case, and the one a person sees first.
     *
     * Its own shop, deliberately. The deterministic suite records against
     * "בסופר", and two specs writing the same merchant would make each one's
     * counts depend on the other's ordering.
     */
    {
      when: /שילמתי .*במכולת/u,
      reply: {
        kind: 'answer',
        output: exampleOutput({
          summary: 'הוצאה במכולת',
          amountMinor: 12_000,
          date: null,
          categoryId: 'food',
          evidence: { amountText: '120 שקל', dateText: 'היום', counterpartyText: 'במכולת' },
          reason: 'המשפט אומר כמה שולם, על מה ומתי.',
        }),
      },
    },

    // A repayment that names no lender: one focused question, and no write.
    {
      when: /החזרתי/u,
      reply: {
        kind: 'answer',
        output: exampleOutput({
          state: 'needs_clarification',
          action: 'debt_repayment',
          summary: 'החזר הלוואה',
          confidence: 'medium',
          amountMinor: 300_000,
          date: null,
          debtId: null,
          categoryId: null,
          evidence: { amountText: '3,000', dateText: null, counterpartyText: null },
          missing: [{ field: 'lender', question: 'לאיזו הלוואה ההחזר שייך?' }],
          reason: 'המשפט אומר שהוחזר כסף, אבל לא לאיזו הלוואה.',
        }),
      },
    },

    /*
     * A model naming a lender this household does not have.
     *
     * The single most important case in this file: a well-formed answer, high
     * confidence, `ready` — and an id that exists nowhere. It must come out of
     * the verifier as a question, and it must never create a lender.
     */
    {
      when: /לקחתי .*הלוואה/u,
      reply: {
        kind: 'answer',
        output: exampleOutput({
          action: 'new_debt',
          summary: 'הלוואה חדשה',
          amountMinor: 800_000,
          date: null,
          debtId: INVENTED_DEBT,
          categoryId: null,
          evidence: { amountText: '8,000', dateText: 'היום', counterpartyText: 'מדוד' },
          reason: 'המשפט אומר שנלקחה הלוואה.',
        }),
      },
    },

    // A model naming an account that is not this household's.
    {
      when: /משכורת/u,
      reply: {
        kind: 'answer',
        output: exampleOutput({
          action: 'income',
          summary: 'משכורת שנכנסה',
          amountMinor: 500_000,
          date: null,
          accountId: INVENTED_ACCOUNT,
          categoryId: null,
          evidence: { amountText: '5,000', dateText: null, counterpartyText: 'משכורת' },
          reason: 'המשפט אומר שנכנס כסף.',
        }),
      },
    },

    /*
     * A sentence giving orders.
     *
     * The reader is told to treat the text as data, and here it does — it reads
     * the words as a sentence about money and returns an ordinary proposal. What
     * the test proves is the part after that: a proposal is not a record, and
     * nothing is written until a person confirms.
     */
    {
      when: /התעלם|ignore all/iu,
      reply: {
        kind: 'answer',
        output: exampleOutput({
          state: 'not_understood',
          action: 'unknown',
          summary: 'לא הבנו מה לרשום',
          confidence: 'low',
          amountMinor: null,
          date: null,
          evidence: { amountText: null, dateText: null, counterpartyText: null },
          missing: [],
          reason: 'המשפט אינו מתאר פעולה כספית.',
        }),
      },
    },

    // An amount with a fraction of an agora: not a stored amount.
    {
      when: /אגורה וחצי/u,
      reply: {
        kind: 'answer',
        output: exampleOutput({
          amountMinor: 12_000.5 as unknown as number,
          date: null,
          evidence: { amountText: '120.005', dateText: null, counterpartyText: 'בקיוסק' },
        }),
      },
    },

    // A day that has not happened yet.
    {
      when: /בשנה הבאה/u,
      reply: {
        kind: 'answer',
        output: exampleOutput({
          amountMinor: 5_000,
          date: '2099-01-01',
          evidence: { amountText: '50', dateText: 'בשנה הבאה', counterpartyText: 'בקיוסק' },
        }),
      },
    },

    // The provider is reachable and refuses.
    {
      when: /תקלה/u,
      reply: { kind: 'unavailable', reason: 'provider_error' },
    },
  ];
}

/** What an unrecognised sentence gets: an honest "not understood". */
export function e2eFallback(): PreparedReply {
  return {
    kind: 'answer',
    output: exampleOutput({
      state: 'not_understood',
      action: 'unknown',
      summary: 'לא הבנו מה לרשום',
      confidence: 'low',
      amountMinor: null,
      date: null,
      evidence: { amountText: null, dateText: null, counterpartyText: null },
      reason: 'לא זיהינו פעולה כספית במשפט.',
    }),
  };
}
