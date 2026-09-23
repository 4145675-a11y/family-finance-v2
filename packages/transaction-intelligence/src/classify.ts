import type {
  ClassificationSignal,
  ClassificationSuggestion,
  ConfidenceLevel,
  LearnedRule,
  TransactionClass,
} from '@family-finance/contracts';
import { normaliseLenderName } from '@family-finance/contracts';

import { containsPhrase, normaliseDescription } from './normalise';
import { BUILT_IN_RULES, type BuiltInRule } from './rules';

/**
 * Deciding what a statement line is, and saying why.
 *
 * The order of precedence is the design, and it is deliberately boring:
 *
 *   1. **What this household already decided.** A confirmed household rule beats
 *      everything the product thinks it knows. A family that has said "העברה
 *      לאמא is a gift" has settled the question for their own file.
 *   2. **What the bank's words mean** — the built-in table, most specific first.
 *   3. **What the rest of the file suggests.** A charge that repeats month after
 *      month for the same amount is a standing arrangement even when the words
 *      say nothing.
 *   4. **Nothing.** An answer of `unclassified` at `low` confidence is a real
 *      answer: the row is shown, and a person says what it is.
 *
 * Two things this function will not do, however confident it is:
 *
 *   * It never touches an amount, a direction or a date. Those come from the file.
 *   * It never resolves a loan repayment to a debt it had to guess at. A row that
 *     would move a balance carries `requiresDebtChoice` until a person names the
 *     lender, and that flag is independent of confidence — a certain repayment
 *     with an unknown lender is still not safe to apply.
 */

export interface TransactionFacts {
  /** The description exactly as the file wrote it. */
  readonly description: string;
  readonly amountMinor: number;
  readonly direction: 'inflow' | 'outflow';
  readonly date: string;
  readonly reference: string | null;
  /** The bank the statement came from, when the file said. */
  readonly bankName: string | null;
  /** What kind of account the row belongs to. */
  readonly accountKind: string | null;
}

/** A debt the household has, as the classifier needs to see it. */
export interface DebtHint {
  readonly id: string;
  readonly creditorName: string;
  readonly status: 'active' | 'settled' | 'written_off';
}

export interface ClassificationContext {
  /** This household's confirmed rules. Only enabled ones are consulted. */
  readonly householdRules: readonly LearnedRule[];
  readonly debts: readonly DebtHint[];
  /**
   * The other rows in the same file.
   *
   * Used only to notice repetition. Never to change one row's amount or date
   * because of another's.
   */
  readonly siblings?: readonly {
    readonly description: string;
    readonly amountMinor: number;
    readonly date: string;
  }[];
  /** The account this file was attached to, for matching account-scoped rules. */
  readonly accountId?: string | null;
}

/** A row repeating at least this many times in the file is a pattern. */
const RECURRING_THRESHOLD = 3;

function matchesBuiltIn(rule: BuiltInRule, folded: string, facts: TransactionFacts): boolean {
  if (rule.direction !== null && rule.direction !== facts.direction) return false;
  if (rule.banks !== undefined && rule.banks.length > 0) {
    const bank = normaliseDescription(facts.bankName ?? '');
    if (!rule.banks.some((candidate) => bank.includes(normaliseDescription(candidate)))) {
      return false;
    }
  }
  return rule.phrases.some((phrase) => containsPhrase(folded, phrase));
}

/**
 * The debt a repayment line names, when it names exactly one.
 *
 * "exactly one" is the whole safety property. A line mentioning a lender the
 * household has one debt with can be offered with that debt filled in; a line
 * mentioning none, or matching two, is offered with nothing filled in and a flag
 * saying a person has to choose. Nothing is picked because it was the closest.
 */
function resolveDebt(
  folded: string,
  debts: readonly DebtHint[],
): { debtId: string | null; matched: number } {
  const candidates = debts.filter((debt) => debt.status === 'active');
  const hits = candidates.filter((debt) => {
    const name = normaliseLenderName(debt.creditorName);
    if (name.length < 3) return false;
    return containsPhrase(folded, name) || folded.includes(name);
  });
  return { debtId: hits.length === 1 ? (hits[0]?.id ?? null) : null, matched: hits.length };
}

/** The counterparty a line names after "העברה ל" and friends. */
function readCounterparty(rawDescription: string): string | null {
  const cleaned = rawDescription.replace(/\s+/g, ' ').trim();
  const patterns = [
    /(?:העברה|תשלום|חיוב)\s+ל(?:כבוד\s+)?(.{2,60})$/u,
    /(?:זיכוי|העברה)\s+מ(.{2,60})$/u,
    /לפקודת\s+(.{2,60})$/u,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(cleaned);
    const captured = match?.[1]?.trim();
    if (captured !== undefined && captured.length >= 2) return captured.slice(0, 160);
  }
  return null;
}

function countRepeats(
  facts: TransactionFacts,
  siblings: ClassificationContext['siblings'],
): number {
  if (siblings === undefined) return 0;
  const folded = normaliseDescription(facts.description);
  return siblings.filter(
    (sibling) =>
      normaliseDescription(sibling.description) === folded &&
      sibling.amountMinor === facts.amountMinor,
  ).length;
}

/** The fallback: what an unrecognised line is, by direction alone. */
function fallbackClass(direction: 'inflow' | 'outflow'): TransactionClass {
  return direction === 'inflow' ? 'refund' : 'purchase';
}

export function classifyTransaction(
  facts: TransactionFacts,
  context: ClassificationContext,
): ClassificationSuggestion {
  const folded = normaliseDescription(facts.description);
  const counterparty = readCounterparty(facts.description);

  // 1. What this household already decided.
  for (const rule of context.householdRules) {
    if (!rule.enabled) continue;
    if (rule.matcher.direction !== null && rule.matcher.direction !== facts.direction) continue;
    if (
      rule.matcher.accountId !== null &&
      context.accountId !== undefined &&
      rule.matcher.accountId !== context.accountId
    ) {
      continue;
    }
    if (!containsPhrase(folded, rule.matcher.descriptionContains)) continue;

    const isRepayment = rule.class === 'loan_repayment';
    return {
      class: rule.class,
      budgetCategoryKey: rule.budgetCategoryKey,
      counterparty: rule.counterparty ?? counterparty,
      suggestedDebtId: isRepayment ? rule.debtId : null,
      requiresDebtChoice: isRepayment && rule.debtId === null,
      confidence: 'high',
      explanation: `לפי כלל שהגדרתם: ${rule.label}.`,
      ruleId: rule.id,
      fromHouseholdRule: true,
      signals: ['household_rule', 'description'],
    };
  }

  // 2. What the bank's words mean.
  for (const rule of BUILT_IN_RULES) {
    if (!matchesBuiltIn(rule, folded, facts)) continue;

    const signals: ClassificationSignal[] = ['description'];
    if (rule.direction !== null) signals.push('direction');
    if (rule.banks !== undefined) signals.push('bank');

    if (rule.class === 'loan_repayment') {
      const { debtId, matched } = resolveDebt(folded, context.debts);
      return {
        class: 'loan_repayment',
        budgetCategoryKey: rule.budgetCategoryKey,
        counterparty,
        suggestedDebtId: debtId,
        // Named exactly one lender → offered filled in. Named none or several →
        // a person chooses. Either way no balance moves without an approval.
        requiresDebtChoice: debtId === null,
        confidence: rule.confidence,
        explanation:
          debtId !== null
            ? `${rule.explanation} זוהתה הלוואה אחת בשם הזה.`
            : matched > 1
              ? `${rule.explanation} יש יותר מהלוואה אחת שמתאימה לשם.`
              : rule.explanation,
        ruleId: rule.id,
        fromHouseholdRule: false,
        signals,
      };
    }

    return {
      class: rule.class,
      budgetCategoryKey: rule.budgetCategoryKey,
      counterparty,
      suggestedDebtId: null,
      requiresDebtChoice: false,
      confidence: rule.confidence,
      explanation: rule.explanation,
      ruleId: rule.id,
      fromHouseholdRule: false,
      signals,
    };
  }

  // 3. What the rest of the file suggests.
  const repeats = countRepeats(facts, context.siblings);
  if (repeats >= RECURRING_THRESHOLD && facts.direction === 'outflow') {
    return {
      class: 'standing_order',
      budgetCategoryKey: null,
      counterparty,
      suggestedDebtId: null,
      requiresDebtChoice: false,
      confidence: 'medium',
      explanation: 'אותו תיאור ואותו סכום חוזרים בקובץ — נראה כמו תשלום קבוע.',
      ruleId: 'pattern.recurring',
      fromHouseholdRule: false,
      signals: ['recurring', 'amount', 'description'],
    };
  }

  // 4. Nothing. Which is an answer.
  const confidence: ConfidenceLevel = counterparty === null ? 'low' : 'medium';
  return {
    class: counterparty === null ? 'unclassified' : fallbackClass(facts.direction),
    budgetCategoryKey: null,
    counterparty,
    suggestedDebtId: null,
    requiresDebtChoice: false,
    confidence,
    explanation:
      counterparty === null
        ? 'לא זיהינו מה השורה הזאת. צריך לומר מה זה.'
        : `השורה נוקבת בשם: ${counterparty}. מה זה בדיוק — צריך לאשר.`,
    ruleId: 'fallback.unrecognised',
    fromHouseholdRule: false,
    signals: counterparty === null ? ['description'] : ['description', 'direction'],
  };
}

/**
 * Classifies a whole file, so that repetition inside it can be seen.
 *
 * Each row is still classified independently; the siblings are read only to count
 * repeats, never to change a row's own values.
 */
export function classifyBatch(
  rows: readonly TransactionFacts[],
  context: Omit<ClassificationContext, 'siblings'>,
): readonly ClassificationSuggestion[] {
  const siblings = rows.map((row) => ({
    description: row.description,
    amountMinor: row.amountMinor,
    date: row.date,
  }));
  return rows.map((row) => classifyTransaction(row, { ...context, siblings }));
}
