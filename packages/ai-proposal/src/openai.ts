import { MODEL_OUTPUT_JSON_SCHEMA, parseModelOutput } from './contract';
import { buildInput, INSTRUCTIONS } from './prompt';
import type { AIProvider, AnalysisOutcome, AnalysisRequest } from './provider';

/**
 * The first real provider: OpenAI's Responses API, over `fetch`.
 *
 * No SDK. One POST, one JSON body, one answer read out of an array — and the
 * dependency cost of a client library is not worth it for that (`ADR-0025` makes
 * the same call about document parsers). It also keeps the request shape visible
 * in this file, which matters when the thing being reviewed is exactly what
 * leaves the building.
 *
 * ## What is sent
 *
 * `instructions` carries the rules, `input` carries the facts and the person's
 * sentence inside a marker. That is all. No tools, no files, no audio, no
 * conversation id, and `store: false` so the provider is asked not to retain it.
 *
 * ## What is not
 *
 * The key is a constructor argument and is never read from the environment here.
 * That is not a style preference: a package that reads `process.env` can be
 * imported into a client bundle and take a secret with it. Reading it once, in a
 * `server-only` module, is what makes the boundary checkable — and
 * `check:client-secrets` checks it.
 *
 * ## Model
 *
 * Default `gpt-6-luna` — the efficiency model of the current line, and the one
 * the documentation points at for "cost-sensitive, high-volume workloads". At
 * $0.10 per million input and $0.50 per million output tokens, one reading of a
 * short sentence with this context is well under a tenth of an agora, which is
 * the right order of magnitude for something a family may press several times a
 * day. `reasoning.effort: 'low'` because extracting a number and a date from one
 * sentence is not a reasoning problem, and effort is latency a person waits
 * through. Overridable with `OPENAI_MODEL`, so a deployment can move without a
 * release. Checked against the official model and pricing pages on 2026-09-24.
 */

const ENDPOINT = 'https://api.openai.com/v1/responses';

export const DEFAULT_MODEL = 'gpt-6-luna';

/** Long enough for a sentence, short enough that nobody stares at a spinner. */
export const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * A ceiling on the answer.
 *
 * The contract is a small flat object; a few hundred tokens covers it with room
 * for a Hebrew summary. The cap exists so a runaway answer costs a failed parse
 * rather than a bill.
 */
export const DEFAULT_MAX_OUTPUT_TOKENS = 700;

export interface OpenAIProviderOptions {
  /** Read once, in server-only code, and passed in. Never read from here. */
  readonly apiKey: string;
  readonly model?: string;
  readonly timeoutMs?: number;
  readonly maxOutputTokens?: number;
  /** Injected so a test can drive this class without a network. */
  readonly fetchImpl?: typeof fetch;
  /**
   * Somewhere to report what happened, without the content.
   *
   * Deliberately not a logger: the only things passed are an outcome, a duration
   * and a status. No prompt, no answer, no sentence, no key.
   */
  readonly report?: (event: {
    readonly outcome: string;
    readonly durationMs: number;
    readonly status?: number;
  }) => void;
}

export class OpenAIProvider implements AIProvider {
  readonly name = 'openai';

  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxOutputTokens: number;
  private readonly fetchImpl: typeof fetch;
  private readonly report: OpenAIProviderOptions['report'];

  constructor(options: OpenAIProviderOptions) {
    if (options.apiKey.trim() === '') {
      throw new Error('OpenAIProvider needs a key; construct it only when one is configured');
    }
    this.apiKey = options.apiKey;
    this.model = options.model ?? DEFAULT_MODEL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxOutputTokens = options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.report = options.report;
  }

  async analyse(request: AnalysisRequest): Promise<AnalysisOutcome> {
    const started = Date.now();

    /*
     * One retry, and only for a failure that cannot have produced an answer.
     * Safe because analysing writes nothing: the worst case of a duplicate
     * request is a duplicate proposal on a screen, and a proposal is not a
     * record. A 4xx is never retried — it will fail the same way.
     */
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await this.attempt(request);
      if (result.kind === 'answered') {
        this.report?.({ outcome: 'answered', durationMs: Date.now() - started });
        return result;
      }
      const retryable = result.reason === 'timeout' || result.retryable === true;
      if (!retryable || attempt === 1) {
        this.report?.({
          outcome: result.reason,
          durationMs: Date.now() - started,
          ...(result.status === undefined ? {} : { status: result.status }),
        });
        return { kind: 'unavailable', reason: result.reason };
      }
    }

    // Unreachable: the loop returns on both branches.
    return { kind: 'unavailable', reason: 'provider_error' };
  }

  /** One request. Never throws; every failure is a reason. */
  private async attempt(request: AnalysisRequest): Promise<
    | { kind: 'answered'; output: NonNullable<ReturnType<typeof parseModelOutput>> }
    | {
        kind: 'unavailable';
        reason: 'timeout' | 'provider_error' | 'invalid_output' | 'rate_limited';
        retryable?: boolean;
        status?: number;
      }
  > {
    let response: Response;
    try {
      response = await this.fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          instructions: INSTRUCTIONS,
          input: buildInput(request),
          // Asked not to be retained. A family's sentence about their money is
          // not training data and not a stored conversation.
          store: false,
          max_output_tokens: this.maxOutputTokens,
          reasoning: { effort: 'low' },
          text: {
            format: {
              type: 'json_schema',
              name: 'family_finance_quick_update',
              strict: true,
              schema: MODEL_OUTPUT_JSON_SCHEMA,
            },
          },
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const timedOut =
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError');
      return {
        kind: 'unavailable',
        reason: timedOut ? 'timeout' : 'provider_error',
        retryable: true,
      };
    }

    if (response.status === 429) {
      return { kind: 'unavailable', reason: 'rate_limited', status: 429 };
    }
    if (!response.ok) {
      /*
       * The body is not read. A provider error message can quote the request,
       * and the request contains the family's sentence — so the status is the
       * whole diagnostic, and a 5xx is worth one retry.
       */
      return {
        kind: 'unavailable',
        reason: 'provider_error',
        retryable: response.status >= 500,
        status: response.status,
      };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { kind: 'unavailable', reason: 'invalid_output' };
    }

    const text = readOutputText(body);
    if (text === null) return { kind: 'unavailable', reason: 'invalid_output' };

    const output = parseModelOutput(text);
    if (output === null) return { kind: 'unavailable', reason: 'invalid_output' };

    return { kind: 'answered', output };
  }
}

/**
 * The text of the answer, found rather than assumed.
 *
 * The documentation is explicit that it is not safe to reach for
 * `output[0].content[0].text`: the array can hold reasoning items and tool calls
 * before the message. So the message items are walked and their `output_text`
 * parts joined, which is what the SDK's convenience property does.
 */
export function readOutputText(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const record = body as { output_text?: unknown; output?: unknown };

  // Some responses carry the convenience field. Use it when it is a string.
  if (typeof record.output_text === 'string' && record.output_text.trim() !== '') {
    return record.output_text;
  }

  if (!Array.isArray(record.output)) return null;
  const parts: string[] = [];
  for (const item of record.output) {
    if (typeof item !== 'object' || item === null) continue;
    const entry = item as { type?: unknown; content?: unknown };
    if (entry.type !== 'message' || !Array.isArray(entry.content)) continue;
    for (const piece of entry.content) {
      if (typeof piece !== 'object' || piece === null) continue;
      const part = piece as { type?: unknown; text?: unknown };
      if (part.type === 'output_text' && typeof part.text === 'string') parts.push(part.text);
    }
  }
  const joined = parts.join('');
  return joined.trim() === '' ? null : joined;
}
