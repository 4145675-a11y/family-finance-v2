import type {
  BudgetCategoryKey,
  CreateLearnedRuleInput,
  TransactionClass,
} from '@family-finance/contracts';

import { normaliseDescription } from './normalise';

/**
 * Turning one correction into a rule the household can keep.
 *
 * Offered, never taken. A family that fixes a row is asked whether the fix should
 * apply next time, and only a yes creates a rule. The alternative — learning from
 * every correction automatically — quietly accumulates rules nobody chose and
 * then surprises them months later with a classification they cannot trace.
 *
 * The matcher is built from the *folded* description, and it is the distinctive
 * part of it rather than the whole line. A statement line usually carries a
 * reference number or a date fragment that is unique to that one row; a rule
 * matching the entire line would match exactly once and never again. So the
 * numbers are dropped and the words are kept.
 *
 * Nothing here decides a rule is safe. The rule it produces still has to be saved
 * by a person, and every row it later matches still arrives as a suggestion that
 * an approval has to pass through.
 */

export interface CorrectionInput {
  /** The description of the row that was corrected, as the file wrote it. */
  readonly description: string;
  readonly direction: 'inflow' | 'outflow';
  /** The class the person chose. */
  readonly class: TransactionClass;
  readonly budgetCategoryKey: BudgetCategoryKey | null;
  readonly counterparty: string | null;
  /** The debt they attached it to, when they did. */
  readonly debtId: string | null;
  /** Restrict the rule to the account the row was on. */
  readonly accountId: string | null;
  /** True when the household wants the rule to apply to both directions. */
  readonly anyDirection?: boolean;
}

/** Words too common to identify anything on their own. */
const STOP_WORDS: ReadonlySet<string> = new Set([
  'של',
  'על',
  'את',
  'עם',
  'ל',
  'מ',
  'ב',
  'ו',
  'אל',
  'מן',
  'זה',
  'הוא',
]);

/** A token that is only digits, or a date fragment, identifies one row and no more. */
function isIdentifying(token: string): boolean {
  if (token.length < 2) return false;
  if (STOP_WORDS.has(token)) return false;
  if (/^\d+$/.test(token)) return false;
  // Mixed word-and-number tokens, such as a reference, are dropped too.
  if (/\d/.test(token)) return false;
  return true;
}

/**
 * The distinctive words of a description, as a matcher.
 *
 * At most four words: enough to be specific, few enough that the next month's
 * line — which will differ in its reference and its date — still matches.
 */
export function matcherTextFrom(description: string): string {
  const folded = normaliseDescription(description);
  const words = folded.split(' ').filter(isIdentifying);
  return words.slice(0, 4).join(' ');
}

/**
 * The rule a correction would create, or null when the row has nothing durable
 * to match on.
 *
 * Returning null matters: a line that is only a reference number cannot produce a
 * rule, and inventing one from its digits would make a rule that matches that
 * single row for ever and teaches the household nothing.
 */
export function ruleFromCorrection(input: CorrectionInput): CreateLearnedRuleInput | null {
  const descriptionContains = matcherTextFrom(input.description);
  if (descriptionContains.length < 2) return null;

  return {
    label: `${descriptionContains} → ${input.class}`.slice(0, 120),
    matcher: {
      descriptionContains,
      direction: input.anyDirection === true ? null : input.direction,
      accountId: input.accountId,
    },
    class: input.class,
    budgetCategoryKey: input.budgetCategoryKey,
    counterparty: input.counterparty,
    debtId: input.class === 'loan_repayment' ? input.debtId : null,
  };
}
