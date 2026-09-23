export { containsPhrase, normaliseDescription } from './normalise';

export { BUILT_IN_RULES, COUNTERPARTY_PREFIXES, type BuiltInRule } from './rules';

export {
  classifyBatch,
  classifyTransaction,
  type ClassificationContext,
  type DebtHint,
  type TransactionFacts,
} from './classify';

export { ruleFromCorrection, type CorrectionInput } from './learn';
