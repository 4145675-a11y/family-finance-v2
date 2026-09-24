import { describe, expect, test } from 'vitest';

import { exampleOutput } from './scripted';
import { DEFAULT_MODEL, OpenAIProvider, readOutputText } from './openai';
import { INSTRUCTIONS, buildInput } from './prompt';
import type { AnalysisRequest } from './provider';

/**
 * The adapter, driven without a network.
 *
 * Two kinds of question here. The first is what leaves: exactly which fields are
 * in the request body, and — more importantly — which are not. The second is what
 * happens when the far end misbehaves, because every one of those cases ends up on
 * a screen and each needs a different sentence.
 *
 * No test in this file needs a key that works, makes a paid call, or reaches the
 * internet. `fetchImpl` is injected, which is the only reason the adapter takes it.
 */

const KEY = 'sk-test-not-a-real-key';

const REQUEST: AnalysisRequest = {
  text: 'היום שילמתי 120 שקל בסופר',
  today: '2026-09-24',
  todayHebrew: 'י״ב תשרי תשפ״ז',
  accounts: [{ id: 'acc-1', label: 'עובר ושב' }],
  lenders: [{ id: 'debt-1', label: 'גמח ראשון', aliases: ['גמ״ח ראשון'] }],
  categories: [{ id: 'food', label: 'אוכל' }],
};

/** A `fetch` that records what it was given and answers with whatever is passed. */
function stubFetch(answer: () => Promise<Response>): {
  impl: typeof fetch;
  calls: { url: string; init: RequestInit }[];
} {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return answer();
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function ok(body: unknown): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

function responsesBody(output: unknown): unknown {
  // The shape the Responses API returns: an array that may hold other items
  // before the message.
  return {
    output: [
      { type: 'reasoning', summary: [] },
      { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(output) }] },
    ],
  };
}

describe('what leaves this application', () => {
  test('one POST, to the Responses endpoint, with the key in a header', async () => {
    const { impl, calls } = stubFetch(() => ok(responsesBody(exampleOutput())));
    await new OpenAIProvider({ apiKey: KEY, fetchImpl: impl }).analyse(REQUEST);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.openai.com/v1/responses');
    expect(calls[0]?.init.method).toBe('POST');
    const headers = calls[0]?.init.headers as Record<string, string>;
    // In a header, never in a query string — a URL ends up in logs and referrers.
    expect(headers['authorization']).toBe(`Bearer ${KEY}`);
    expect(calls[0]?.url).not.toContain(KEY);
  });

  test('the body asks not to be stored, and sets a hard output ceiling', async () => {
    const { impl, calls } = stubFetch(() => ok(responsesBody(exampleOutput())));
    await new OpenAIProvider({ apiKey: KEY, fetchImpl: impl }).analyse(REQUEST);

    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
    expect(body['store']).toBe(false);
    expect(body['max_output_tokens']).toBeGreaterThan(0);
    expect(body['model']).toBe(DEFAULT_MODEL);
  });

  test('the answer is constrained by a strict schema', async () => {
    const { impl, calls } = stubFetch(() => ok(responsesBody(exampleOutput())));
    await new OpenAIProvider({ apiKey: KEY, fetchImpl: impl }).analyse(REQUEST);

    const body = JSON.parse(String(calls[0]?.init.body)) as {
      text: { format: { type: string; strict: boolean; name: string; schema: unknown } };
    };
    expect(body.text.format.type).toBe('json_schema');
    expect(body.text.format.strict).toBe(true);
    expect(body.text.format.name.length).toBeGreaterThan(0);
  });

  test('nothing that could reach a tool, a file, or a stored conversation', async () => {
    const { impl, calls } = stubFetch(() => ok(responsesBody(exampleOutput())));
    await new OpenAIProvider({ apiKey: KEY, fetchImpl: impl }).analyse(REQUEST);

    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
    for (const forbidden of [
      'tools',
      'tool_choice',
      'previous_response_id',
      'conversation',
      'background',
      'attachments',
      'file_ids',
      'audio',
      'modalities',
    ]) {
      expect(Object.keys(body), forbidden).not.toContain(forbidden);
    }
  });

  test('the model is overridable, for a deployment that wants another one', async () => {
    const { impl, calls } = stubFetch(() => ok(responsesBody(exampleOutput())));
    await new OpenAIProvider({
      apiKey: KEY,
      model: 'some-other-model',
      fetchImpl: impl,
    }).analyse(REQUEST);
    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
    expect(body['model']).toBe('some-other-model');
  });

  test('a provider cannot be built without a key', () => {
    expect(() => new OpenAIProvider({ apiKey: '   ' })).toThrow();
  });
});

describe('the instructions and the sentence are kept apart', () => {
  test('the rules are instructions; the sentence is input', async () => {
    const { impl, calls } = stubFetch(() => ok(responsesBody(exampleOutput())));
    await new OpenAIProvider({ apiKey: KEY, fetchImpl: impl }).analyse(REQUEST);

    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, string>;
    expect(body['instructions']).toBe(INSTRUCTIONS);
    // The person's words appear once, inside the input, inside a marker.
    expect(body['input']).toContain('<<<TEXT');
    expect(body['input']).toContain(REQUEST.text);
    expect(body['instructions']).not.toContain(REQUEST.text);
  });

  test('the input carries the closed lists and nothing beyond them', () => {
    const input = buildInput(REQUEST);
    expect(input).toContain('acc-1 = עובר ושב');
    expect(input).toContain('debt-1 = גמח ראשון');
    expect(input).toContain('food = אוכל');
    expect(input).toContain('2026-09-24');
  });
});

describe('when the far end misbehaves', () => {
  test('a timeout is a timeout, not an error', async () => {
    const impl = (() => {
      const error = new Error('aborted');
      error.name = 'TimeoutError';
      return Promise.reject(error);
    }) as unknown as typeof fetch;

    const outcome = await new OpenAIProvider({ apiKey: KEY, fetchImpl: impl }).analyse(REQUEST);
    expect(outcome).toEqual({ kind: 'unavailable', reason: 'timeout' });
  });

  test('a rate limit says so, and is not retried', async () => {
    const { impl, calls } = stubFetch(() => Promise.resolve(new Response('', { status: 429 })));
    const outcome = await new OpenAIProvider({ apiKey: KEY, fetchImpl: impl }).analyse(REQUEST);
    expect(outcome).toEqual({ kind: 'unavailable', reason: 'rate_limited' });
    // Retrying a 429 is how a rate limit becomes an outage.
    expect(calls).toHaveLength(1);
  });

  test('a refusal is not retried either', async () => {
    const { impl, calls } = stubFetch(() => Promise.resolve(new Response('', { status: 400 })));
    const outcome = await new OpenAIProvider({ apiKey: KEY, fetchImpl: impl }).analyse(REQUEST);
    expect(outcome).toEqual({ kind: 'unavailable', reason: 'provider_error' });
    expect(calls).toHaveLength(1);
  });

  test('a server error is retried once, because reading writes nothing', async () => {
    const { impl, calls } = stubFetch(() => Promise.resolve(new Response('', { status: 503 })));
    const outcome = await new OpenAIProvider({ apiKey: KEY, fetchImpl: impl }).analyse(REQUEST);
    expect(outcome).toEqual({ kind: 'unavailable', reason: 'provider_error' });
    expect(calls).toHaveLength(2);
  });

  test('an answer that is not JSON is invalid output', async () => {
    const { impl } = stubFetch(() =>
      Promise.resolve(new Response('not json', { status: 200 })),
    );
    const outcome = await new OpenAIProvider({ apiKey: KEY, fetchImpl: impl }).analyse(REQUEST);
    expect(outcome).toEqual({ kind: 'unavailable', reason: 'invalid_output' });
  });

  test('an answer whose content does not match the contract is invalid output', async () => {
    const { impl } = stubFetch(() => ok(responsesBody({ state: 'ready', extra: true })));
    const outcome = await new OpenAIProvider({ apiKey: KEY, fetchImpl: impl }).analyse(REQUEST);
    expect(outcome).toEqual({ kind: 'unavailable', reason: 'invalid_output' });
  });

  test('an answer with no message item at all is invalid output', async () => {
    const { impl } = stubFetch(() => ok({ output: [{ type: 'reasoning', summary: [] }] }));
    const outcome = await new OpenAIProvider({ apiKey: KEY, fetchImpl: impl }).analyse(REQUEST);
    expect(outcome).toEqual({ kind: 'unavailable', reason: 'invalid_output' });
  });
});

describe('what is reported, and what is not', () => {
  test('an outcome and a duration, and never the sentence or the key', async () => {
    const events: unknown[] = [];
    const { impl } = stubFetch(() => ok(responsesBody(exampleOutput())));
    await new OpenAIProvider({
      apiKey: KEY,
      fetchImpl: impl,
      report: (event) => events.push(event),
    }).analyse(REQUEST);

    expect(events).toHaveLength(1);
    const serialised = JSON.stringify(events);
    expect(serialised).not.toContain(KEY);
    expect(serialised).not.toContain(REQUEST.text);
    expect(serialised).not.toContain('בסופר');
    expect(serialised).toContain('answered');
  });

  test('a failure reports the status and still no content', async () => {
    const events: { outcome: string; status?: number }[] = [];
    const { impl } = stubFetch(() => Promise.resolve(new Response('', { status: 429 })));
    await new OpenAIProvider({
      apiKey: KEY,
      fetchImpl: impl,
      report: (event) => events.push(event),
    }).analyse(REQUEST);

    expect(events[0]?.outcome).toBe('rate_limited');
    expect(events[0]?.status).toBe(429);
    expect(JSON.stringify(events)).not.toContain(REQUEST.text);
  });
});

describe('reading the answer out of the response', () => {
  test('the message item is found, not assumed to be first', () => {
    const body = {
      output: [
        { type: 'reasoning', summary: [] },
        { type: 'message', content: [{ type: 'output_text', text: 'שלום' }] },
      ],
    };
    expect(readOutputText(body)).toBe('שלום');
  });

  test('several text parts are joined', () => {
    const body = {
      output: [
        {
          type: 'message',
          content: [
            { type: 'output_text', text: '{"a":' },
            { type: 'output_text', text: '1}' },
          ],
        },
      ],
    };
    expect(readOutputText(body)).toBe('{"a":1}');
  });

  test('the convenience field is used when the provider sends one', () => {
    expect(readOutputText({ output_text: 'שלום', output: [] })).toBe('שלום');
  });

  test('anything else is null rather than a guess', () => {
    expect(readOutputText(null)).toBeNull();
    expect(readOutputText({})).toBeNull();
    expect(readOutputText({ output: 'text' })).toBeNull();
    expect(readOutputText({ output: [{ type: 'message', content: [] }] })).toBeNull();
  });
});
