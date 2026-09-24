import { describe, expect, test } from 'vitest';

import {
  CONTRACT_VERSION,
  MODEL_OUTPUT_JSON_SCHEMA,
  aiProposalSchema,
  parseModelOutput,
  unavailableProposal,
} from './contract';
import { exampleOutput } from './scripted';

/**
 * The door a remote answer comes through.
 *
 * Everything below is one question asked several ways: can something that is not
 * a valid proposal get past `parseModelOutput`. A model is a remote system
 * returning text, and this repository's rule for remote systems is that text
 * which has not been parsed is not data. If any of these cases returned a partly
 * populated object, the verification layer downstream would be checking fields
 * that had never been checked for being fields at all.
 */

describe('parseModelOutput accepts a well-formed answer', () => {
  test('an object', () => {
    expect(parseModelOutput(exampleOutput())).not.toBeNull();
  });

  test('and the same thing as a JSON string, which is what arrives over the wire', () => {
    expect(parseModelOutput(JSON.stringify(exampleOutput()))).not.toBeNull();
  });

  test('keeping the exact amount, without going through a float', () => {
    const output = parseModelOutput(JSON.stringify(exampleOutput({ amountMinor: 300_007 })));
    expect(output?.amountMinor).toBe(300_007);
  });
});

describe('parseModelOutput refuses everything else', () => {
  test('text that is not JSON', () => {
    expect(parseModelOutput('אני לא JSON')).toBeNull();
  });

  test('JSON that is not an object', () => {
    expect(parseModelOutput('[1,2,3]')).toBeNull();
    expect(parseModelOutput('"ready"')).toBeNull();
    expect(parseModelOutput('null')).toBeNull();
  });

  test('truncated JSON, which is what a token limit produces', () => {
    expect(parseModelOutput('{"state":"ready","action":"exp')).toBeNull();
  });

  test('a missing field', () => {
    // Built by deletion rather than by destructuring, so nothing is bound and
    // then ignored — the linter is right that an unused binding is a smell.
    const withoutAmount: Record<string, unknown> = { ...exampleOutput() };
    delete withoutAmount['amountMinor'];
    expect(parseModelOutput(withoutAmount)).toBeNull();
  });

  test('an extra field, because a schema that tolerates one is not a contract', () => {
    expect(parseModelOutput({ ...exampleOutput(), transferTo: 'somebody' })).toBeNull();
  });

  test('a state the contract does not have', () => {
    expect(parseModelOutput(exampleOutput({ state: 'saved' as never }))).toBeNull();
  });

  test('an action the contract does not have', () => {
    expect(parseModelOutput(exampleOutput({ action: 'wire_transfer' as never }))).toBeNull();
  });

  test('a negative amount', () => {
    expect(parseModelOutput(exampleOutput({ amountMinor: -12_000 }))).toBeNull();
  });

  test('an amount with a fraction of an agora', () => {
    expect(parseModelOutput(exampleOutput({ amountMinor: 12_000.5 }))).toBeNull();
  });

  test('an amount as a string, which is how a model quietly loses precision', () => {
    expect(parseModelOutput(exampleOutput({ amountMinor: '12000' as never }))).toBeNull();
  });

  test('a date that is not a date shape', () => {
    expect(parseModelOutput(exampleOutput({ date: '24/09/2026' }))).toBeNull();
    expect(parseModelOutput(exampleOutput({ date: 'היום' }))).toBeNull();
  });

  test('more than three questions, because three is already too many to answer', () => {
    const missing = [
      { field: 'amount' as const, question: 'א' },
      { field: 'date' as const, question: 'ב' },
      { field: 'account' as const, question: 'ג' },
      { field: 'lender' as const, question: 'ד' },
    ];
    expect(parseModelOutput(exampleOutput({ missing }))).toBeNull();
  });

  test('an empty summary', () => {
    expect(parseModelOutput(exampleOutput({ summary: '   ' }))).toBeNull();
  });
});

describe('the JSON schema sent to the provider', () => {
  test('forbids extra properties, which is what makes strict mode strict', () => {
    expect(MODEL_OUTPUT_JSON_SCHEMA.additionalProperties).toBe(false);
    expect(MODEL_OUTPUT_JSON_SCHEMA.properties.evidence.additionalProperties).toBe(false);
  });

  test('requires every property it declares', () => {
    const declared = Object.keys(MODEL_OUTPUT_JSON_SCHEMA.properties);
    expect([...MODEL_OUTPUT_JSON_SCHEMA.required].sort()).toEqual(declared.sort());
  });

  test('and matches the schema the answer is parsed with', () => {
    // Two definitions of one contract is how they drift. If a field is added to
    // one and not the other, this fails before anything reaches a provider.
    const sent = Object.keys(MODEL_OUTPUT_JSON_SCHEMA.properties).sort();
    const parsed = Object.keys(exampleOutput()).sort();
    expect(sent).toEqual(parsed);
  });

  test('says nothing about whether a proposal may be confirmed', () => {
    // The one field a model must not be able to set.
    expect(Object.keys(MODEL_OUTPUT_JSON_SCHEMA.properties)).not.toContain('safeToConfirm');
  });
});

describe('the proposal the application carries', () => {
  test('cannot be safe to confirm unless it is ready', () => {
    const proposal = {
      ...unavailableProposal('timeout'),
      state: 'needs_clarification' as const,
      safeToConfirm: true,
      unavailableReason: null,
    };
    expect(aiProposalSchema.safeParse(proposal).success).toBe(false);
  });

  test('cannot be unavailable without saying why', () => {
    const proposal = { ...unavailableProposal('timeout'), unavailableReason: null };
    expect(aiProposalSchema.safeParse(proposal).success).toBe(false);
  });

  test('an unavailable proposal is never confirmable, whatever the reason', () => {
    for (const reason of [
      'not_configured',
      'timeout',
      'provider_error',
      'rate_limited',
      'invalid_output',
      'empty_input',
    ] as const) {
      const proposal = unavailableProposal(reason);
      expect(aiProposalSchema.safeParse(proposal).success).toBe(true);
      expect(proposal.safeToConfirm).toBe(false);
      expect(proposal.amountMinor).toBeNull();
    }
  });

  test('carries the contract version, so an old shape can be recognised', () => {
    expect(unavailableProposal('timeout').version).toBe(CONTRACT_VERSION);
  });
});
