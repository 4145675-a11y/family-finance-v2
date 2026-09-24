export {
  CONTRACT_VERSION,
  MODEL_OUTPUT_JSON_SCHEMA,
  aiActionSchema,
  aiConfidenceSchema,
  aiProposalSchema,
  aiProposalStateSchema,
  aiUnavailableReasonSchema,
  missingFieldSchema,
  modelOutputSchema,
  parseModelOutput,
  unavailableProposal,
  type AiAction,
  type AiConfidence,
  type AiEvidence,
  type AiProposal,
  type AiProposalState,
  type AiUnavailableReason,
  type MissingField,
  type ModelOutput,
} from './contract';

export type { AIProvider, AnalysisOutcome, AnalysisRequest, ContextChoice } from './provider';

export {
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_MODEL,
  DEFAULT_TIMEOUT_MS,
  OpenAIProvider,
  readOutputText,
  type OpenAIProviderOptions,
} from './openai';

export {
  SequencedAIProvider,
  ScriptedAIProvider,
  exampleOutput,
  type SequencedAIProviderOptions,
  type PreparedReply,
  type ScriptRule,
} from './scripted';

export { INSTRUCTIONS, buildInput } from './prompt';
