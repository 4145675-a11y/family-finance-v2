import 'server-only';

import { BUDGET_CATEGORY_KEYS } from '@family-finance/contracts';
import {
  formatHebrewDate,
  gregorianToHebrew,
  todayInIsrael,
} from '@family-finance/hebrew-calendar';
import type { StoreDocument } from '@family-finance/local-store';
import type { AnalysisRequest, ContextChoice } from '@family-finance/ai-proposal';

import { CATEGORY_LABEL } from '../copy/classification';

/**
 * The facts a model is given. Nothing else exists as far as it is concerned.
 *
 * This file is the data-minimisation boundary, and it is written as a whitelist
 * for that reason: it names the four things that leave, rather than filtering a
 * household document down and hoping nothing was missed. A field added to the
 * document next month does not appear here by accident.
 *
 * What leaves:
 *
 *   * today, in both calendars, so "היום" resolves to a date rather than a guess;
 *   * the labels and ids of **open** accounts;
 *   * the names, aliases and ids of **active** debts;
 *   * the budget category labels, which are the same ten for every household.
 *
 * What does not leave, and is worth naming because each one would be easy to
 * include and wrong: any balance, any transaction, any amount, any date of
 * anything that happened, the household's name, anybody's name, an account's
 * institution or last four digits, a due date, an import, an audit entry, a
 * learned rule, a task, a budget figure, a settings value, or an id of anything
 * the person is not being asked to choose between.
 *
 * A lender's balance is the one that deserves an explicit note: it would help a
 * model sound confident about a repayment, and it is exactly the kind of figure
 * that must not be in a prompt. The model's job is to say *which lender the words
 * name*, and a name is enough for that.
 */

/**
 * How many choices of each kind travel.
 *
 * A cap rather than "all of them", because a household with forty lenders would
 * otherwise send forty names on every reading. The numbers are small on purpose:
 * beyond this many, a person choosing from a list is faster and safer than a
 * model picking from a long one.
 */
export const MAX_ACCOUNTS = 12;
export const MAX_LENDERS = 25;

/** An account, reduced to a label and an id. */
function accountChoices(document: StoreDocument): ContextChoice[] {
  return document.accounts
    .filter((account) => account.closedAt === null)
    .slice(0, MAX_ACCOUNTS)
    .map((account) => ({ id: account.id, label: account.name }));
}

/**
 * The active debts, grouped so one lender is one choice.
 *
 * A family with two loans from the same gemach should be offered that gemach
 * once; which of its debts a repayment lands on is a decision the confirmation
 * form makes, not the model. Aliases carry the other spellings the household has
 * used, which is what lets "גמח אור" match a card recorded as "גמ״ח אור החיים".
 */
function lenderChoices(document: StoreDocument): ContextChoice[] {
  const byName = new Map<string, { id: string; label: string; aliases: Set<string> }>();

  for (const debt of document.debts) {
    if (debt.status !== 'active') continue;
    const existing = byName.get(debt.creditorName);
    if (existing === undefined) {
      byName.set(debt.creditorName, {
        id: debt.id,
        label: debt.creditorName,
        aliases: new Set<string>(),
      });
      continue;
    }
    // A second debt with the same creditor: one choice, and the id stays the
    // first one. The confirmation form is where a specific debt is chosen.
    existing.aliases.add(debt.creditorName);
  }

  return [...byName.values()].slice(0, MAX_LENDERS).map((entry) => ({
    id: entry.id,
    label: entry.label,
    ...(entry.aliases.size === 0 ? {} : { aliases: [...entry.aliases] }),
  }));
}

/** The ten envelopes, the same for every household. Not household data at all. */
function categoryChoices(): ContextChoice[] {
  return BUDGET_CATEGORY_KEYS.map((key) => ({
    id: key,
    label: CATEGORY_LABEL[key] ?? key,
  }));
}

export interface BuildContextOptions {
  /** Today, injected so a test states it rather than depending on the clock. */
  readonly today?: string;
  /** Answers a person has already given to earlier questions. */
  readonly answered?: readonly { readonly field: string; readonly value: string }[];
}

/**
 * Builds the request. The only place a household document meets a provider.
 */
export function buildAnalysisRequest(
  text: string,
  document: StoreDocument,
  options: BuildContextOptions = {},
): AnalysisRequest {
  const today = options.today ?? todayInIsrael();

  return {
    text,
    today,
    todayHebrew: formatHebrewDate(gregorianToHebrew(today)),
    accounts: accountChoices(document),
    lenders: lenderChoices(document),
    categories: categoryChoices(),
    ...(options.answered === undefined ? {} : { answered: options.answered }),
  };
}
