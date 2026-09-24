import { z } from 'zod';

/**
 * What a model is allowed to say, and nothing else.
 *
 * Two schemas live here and they are deliberately not the same one:
 *
 *   * `modelOutputSchema` — what comes back over the wire. Narrow, flat, and
 *     everything nullable rather than optional, because that is the subset a
 *     strict JSON schema can express and because a missing key and a null key
 *     must not mean different things.
 *   * `aiProposalSchema` — what the application passes around afterwards. It
 *     carries fields the model is **not** permitted to decide: whether the
 *     proposal is safe to confirm, and whether the service was available at all.
 *
 * The separation is the whole safety argument. A model that could set
 * `safeToConfirm` would be deciding, and this one only ever suggests.
 *
 * `CONTRACT_VERSION` is carried on every proposal so a screen rendering an old
 * shape after a deploy can say so instead of misreading it.
 */

export const CONTRACT_VERSION = 1 as const;

/**
 * What a sentence can be asking to record.
 *
 * The same list the deterministic reader uses, plus `transfer` and `note`, which
 * a person says out loud and the rule-based parser does not try to read. Nothing
 * here is new financial behaviour: every one of them already has a command.
 */
export const aiActionSchema = z.enum([
  'expense',
  'income',
  'transfer',
  'new_debt',
  'debt_repayment',
  'balance',
  'note',
  'unknown',
]);
export type AiAction = z.infer<typeof aiActionSchema>;

/** A fact the sentence did not supply, and the one question that would get it. */
export const missingFieldSchema = z.enum([
  'amount',
  'date',
  'account',
  'lender',
  'direction',
  'description',
]);
export type MissingField = z.infer<typeof missingFieldSchema>;

export const aiConfidenceSchema = z.enum(['high', 'medium', 'low']);
export type AiConfidence = z.infer<typeof aiConfidenceSchema>;

/**
 * The state a reading ended in.
 *
 * `unavailable` is a **server** state. A model cannot report that it could not
 * be reached, so it is not in the model's own schema — it is set here when the
 * provider is unconfigured, timed out, rate-limited or answered with something
 * that did not parse.
 */
export const aiProposalStateSchema = z.enum([
  'ready',
  'needs_clarification',
  'not_understood',
  'unavailable',
]);
export type AiProposalState = z.infer<typeof aiProposalStateSchema>;

/** Why a reading is unavailable, in codes a screen can turn into Hebrew. */
export const aiUnavailableReasonSchema = z.enum([
  /** No key is configured on this deployment. The honest, common case. */
  'not_configured',
  /** The provider did not answer in time. */
  'timeout',
  /** The provider answered with an error. */
  'provider_error',
  /** This household has asked too many times in the last hour. */
  'rate_limited',
  /** The answer did not match the contract, or named something that does not exist. */
  'invalid_output',
  /** Nothing was typed. */
  'empty_input',
]);
export type AiUnavailableReason = z.infer<typeof aiUnavailableReasonSchema>;

/**
 * The exact words the reading was taken from.
 *
 * Quoted back so a person checking the proposal can see *which part of their own
 * sentence* produced each figure. It is the difference between "we think 120"
 * and "we read 120 from the words «120 שקל»", and it is what makes an error
 * obvious rather than plausible.
 */
export const aiEvidenceSchema = z.object({
  amountText: z.string().max(80).nullable(),
  dateText: z.string().max(80).nullable(),
  counterpartyText: z.string().max(120).nullable(),
});
export type AiEvidence = z.infer<typeof aiEvidenceSchema>;

/**
 * What the model returns. Every field required, every optional one nullable.
 *
 * Strict structured output has no notion of an absent key, so "did not find an
 * amount" is `null` and never a missing property. Read it back with
 * `parseModelOutput`, which is the only door.
 */
export const modelOutputSchema = z
  .object({
    state: z.enum(['ready', 'needs_clarification', 'not_understood']),
    action: aiActionSchema,
    /** One short Hebrew sentence. Never a number on its own. */
    summary: z.string().trim().min(1).max(200),
    confidence: aiConfidenceSchema,
    evidence: aiEvidenceSchema,
    /** Agorot. An integer, never a float, never negative. */
    amountMinor: z.number().int().min(0).max(1_000_000_000_000).nullable(),
    /** Canonical Gregorian, `YYYY-MM-DD`. Re-validated on the server. */
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/u)
      .nullable(),
    /** A stable id from the context. Never a name, never invented. */
    accountId: z.string().max(64).nullable(),
    debtId: z.string().max(64).nullable(),
    categoryId: z.string().max(64).nullable(),
    missing: z
      .array(
        z.object({
          field: missingFieldSchema,
          /** The one question, in Hebrew. */
          question: z.string().trim().min(1).max(160),
        }),
      )
      .max(3),
    /** Why this reading, in Hebrew, for a person rather than for a log. */
    reason: z.string().trim().min(1).max(300),
  })
  .strict();
export type ModelOutput = z.infer<typeof modelOutputSchema>;

/**
 * The same shape as a JSON Schema, for the provider to send.
 *
 * Written out rather than generated, because what is sent to a provider is part
 * of the contract and a generator makes it something nobody reads. Strict mode
 * wants every property in `required` and `additionalProperties: false`
 * everywhere; the shape below is kept deliberately flat so it stays inside the
 * supported subset.
 */
export const MODEL_OUTPUT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'state',
    'action',
    'summary',
    'confidence',
    'evidence',
    'amountMinor',
    'date',
    'accountId',
    'debtId',
    'categoryId',
    'missing',
    'reason',
  ],
  properties: {
    state: {
      type: 'string',
      enum: ['ready', 'needs_clarification', 'not_understood'],
      description:
        'ready only when every fact needed to record the action is present and certain.',
    },
    action: { type: 'string', enum: aiActionSchema.options },
    summary: {
      type: 'string',
      description: 'One short Hebrew sentence describing the action.',
    },
    confidence: { type: 'string', enum: aiConfidenceSchema.options },
    evidence: {
      type: 'object',
      additionalProperties: false,
      required: ['amountText', 'dateText', 'counterpartyText'],
      properties: {
        amountText: {
          type: ['string', 'null'],
          description: 'The exact substring the amount was read from. Never paraphrased.',
        },
        dateText: {
          type: ['string', 'null'],
          description: 'The exact substring the date was read from.',
        },
        counterpartyText: {
          type: ['string', 'null'],
          description: 'The exact substring naming the shop, lender or payer.',
        },
      },
    },
    amountMinor: {
      type: ['integer', 'null'],
      description:
        'The amount in agorot: 120 shekels is 12000. Never rounded, never guessed, null when the text did not say.',
    },
    date: {
      type: ['string', 'null'],
      description: 'The date as YYYY-MM-DD. Null when the text named no day.',
    },
    accountId: {
      type: ['string', 'null'],
      description: 'An id copied exactly from the accounts list. Never a name, never invented.',
    },
    debtId: {
      type: ['string', 'null'],
      description:
        'An id copied exactly from the lenders list, and only when the text names exactly one of them.',
    },
    categoryId: {
      type: ['string', 'null'],
      description: 'An id copied exactly from the categories list.',
    },
    missing: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['field', 'question'],
        properties: {
          field: { type: 'string', enum: missingFieldSchema.options },
          question: { type: 'string', description: 'One short question in Hebrew.' },
        },
      },
    },
    reason: {
      type: 'string',
      description: 'Why this reading, in Hebrew, one or two sentences.',
    },
  },
} as const;

/**
 * The proposal the application works with.
 *
 * Everything the model said, plus the two things only the server may say.
 */
export const aiProposalSchema = z
  .object({
    version: z.literal(CONTRACT_VERSION),
    state: aiProposalStateSchema,
    action: aiActionSchema,
    summary: z.string(),
    confidence: aiConfidenceSchema,
    evidence: aiEvidenceSchema,
    amountMinor: z.number().int().min(0).nullable(),
    date: z.string().nullable(),
    /** The Hebrew form of `date`, when there is one. Filled by the server. */
    hebrewDate: z.string().nullable(),
    accountId: z.string().nullable(),
    debtId: z.string().nullable(),
    categoryId: z.string().nullable(),
    missing: z.array(z.object({ field: missingFieldSchema, question: z.string() })),
    reason: z.string(),
    /**
     * Whether a person may press confirm.
     *
     * Decided by the server, after re-checking every id against this household
     * and every figure against the money rules. A model saying `ready` is an
     * opinion; this is the answer.
     */
    safeToConfirm: z.boolean(),
    /** Set when, and only when, the state is `unavailable`. */
    unavailableReason: aiUnavailableReasonSchema.nullable(),
  })
  .strict()
  .refine(
    (proposal) => proposal.state !== 'unavailable' || proposal.unavailableReason !== null,
    {
      message: 'an unavailable proposal must say why',
      path: ['unavailableReason'],
    },
  )
  .refine((proposal) => !proposal.safeToConfirm || proposal.state === 'ready', {
    message: 'only a ready proposal can be safe to confirm',
    path: ['safeToConfirm'],
  });
export type AiProposal = z.infer<typeof aiProposalSchema>;

/**
 * Reads what came back from a provider.
 *
 * The one door, and it treats the answer as hostile: a model is a remote system
 * returning text, and text that has not been parsed is not data. Anything that
 * does not fit comes back as `null` and the caller turns that into
 * `invalid_output` — never into a partially-trusted object.
 */
export function parseModelOutput(raw: unknown): ModelOutput | null {
  const candidate =
    typeof raw === 'string'
      ? (() => {
          try {
            return JSON.parse(raw) as unknown;
          } catch {
            return null;
          }
        })()
      : raw;
  if (candidate === null) return null;
  const result = modelOutputSchema.safeParse(candidate);
  return result.success ? result.data : null;
}

/** The proposal shown when there is nothing to show, for whatever reason. */
export function unavailableProposal(reason: AiUnavailableReason): AiProposal {
  return {
    version: CONTRACT_VERSION,
    state: 'unavailable',
    action: 'unknown',
    summary: '',
    confidence: 'low',
    evidence: { amountText: null, dateText: null, counterpartyText: null },
    amountMinor: null,
    date: null,
    hebrewDate: null,
    accountId: null,
    debtId: null,
    categoryId: null,
    missing: [],
    reason: '',
    safeToConfirm: false,
    unavailableReason: reason,
  };
}
