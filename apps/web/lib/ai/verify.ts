import 'server-only';

import { BUDGET_CATEGORY_KEYS } from '@family-finance/contracts';
import { formatHebrewDate, gregorianToHebrew } from '@family-finance/hebrew-calendar';
import type { StoreDocument } from '@family-finance/local-store';
import { normaliseLenderName } from '@family-finance/contracts';
import { matchLender, type LenderHint } from '@family-finance/quick-update';
import {
  CONTRACT_VERSION,
  type AiAction,
  type AiProposal,
  type ModelOutput,
} from '@family-finance/ai-proposal';

/**
 * Everything the model said, checked again from scratch.
 *
 * This is the load-bearing file. The prompt is guidance and the schema is a
 * shape; neither is a guarantee about *this household*. A model can return a
 * perfectly well-formed object naming a lender that belongs to somebody else, an
 * account that was closed last week, a date that does not exist, or an amount
 * with a decimal point in it — and the only thing standing between that and a
 * screen offering to record it is this function.
 *
 * The rule it works by: **nothing the model produced is carried forward unless
 * this file could have produced it independently.** An id has to be present in
 * the current document. An amount has to survive the money rules. A date has to
 * parse and re-format identically. A name is never enough to identify anything,
 * and never creates anything.
 *
 * What it returns is a proposal with `safeToConfirm` set by the checks below —
 * never by the model's own `state`. A model claiming `ready` about an invented
 * lender comes out of here as a clarification.
 */

/** The largest amount a single quick update may propose: one million shekels. */
export const MAX_PROPOSED_MINOR = 100_000_000;

/** Which actions need which facts before anything could be recorded. */
const REQUIRES_AMOUNT: readonly AiAction[] = [
  'expense',
  'income',
  'transfer',
  'new_principal',
  'new_debt',
  'debt_repayment',
  'balance',
];
/*
 * A top-up needs an account for the same reason an income does: the money
 * arrived somewhere, and "somewhere" is not a thing this product will guess.
 */
const REQUIRES_ACCOUNT: readonly AiAction[] = [
  'expense',
  'income',
  'transfer',
  'new_principal',
  'debt_repayment',
  'balance',
];
/** The two actions that move an existing lender's balance. */
const REQUIRES_DEBT: readonly AiAction[] = ['debt_repayment', 'new_principal'];
/** The actions where money was borrowed, and so may come due on a named day. */
const BORROWING: readonly AiAction[] = ['new_principal', 'new_debt'];

export interface VerifyContext {
  readonly document: StoreDocument;
  /** Today, so a date in the future can be refused without reading a clock here. */
  readonly today: string;
  /**
   * The family's own sentence.
   *
   * Searched for a lender when the model quoted none, so the reading is at least
   * as good as the rule-based one. Never used as an identifier.
   */
  readonly sentence?: string;
}

/**
 * A date that is a date.
 *
 * `2026-02-30` matches the pattern and is not a day. Round-tripping through
 * `Date.UTC` catches the rollover that would otherwise turn it silently into the
 * first of March — the same refusal the Hebrew calendar layer makes (ADR-0035),
 * applied to the civil form.
 */
export function canonicalDate(value: string | null): string | null {
  if (value === null) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const at = new Date(Date.UTC(year, month - 1, day));
  if (
    at.getUTCFullYear() !== year ||
    at.getUTCMonth() !== month - 1 ||
    at.getUTCDate() !== day
  ) {
    return null;
  }
  // A household's records do not extend indefinitely in either direction; a
  // reading outside this window is a misreading rather than a date.
  if (year < 2000 || year > 2100) return null;
  return at.toISOString().slice(0, 10);
}

/** The Hebrew form, or null when the civil date is not one we accepted. */
function hebrewFormOf(date: string | null): string | null {
  if (date === null) return null;
  try {
    return formatHebrewDate(gregorianToHebrew(date as never));
  } catch {
    // A date the Hebrew layer refuses is not shown in Hebrew. It is still a
    // civil date, and the proposal keeps it.
    return null;
  }
}

/** An amount that is an amount: a non-negative integer of agorot, within reason. */
function verifiedAmount(value: number | null): {
  amountMinor: number | null;
  problem: boolean;
} {
  if (value === null) return { amountMinor: null, problem: false };
  if (!Number.isInteger(value) || value < 0 || value > MAX_PROPOSED_MINOR) {
    return { amountMinor: null, problem: true };
  }
  return { amountMinor: value, problem: false };
}

/** An account id that names an open account of this household, or null. */
function verifiedAccount(id: string | null, document: StoreDocument): string | null {
  if (id === null) return null;
  const account = document.accounts.find((row) => row.id === id && row.closedAt === null);
  return account === undefined ? null : account.id;
}

/**
 * This household's lenders, with every spelling each one is recorded under.
 *
 * Two debts with the same creditor are one lender with one set of spellings, so
 * a sentence naming either spelling finds the card that already exists — which
 * is what stops a top-up opening a duplicate beside it.
 */
export function lenderHints(document: StoreDocument): LenderHint[] {
  /*
   * Grouped by the folded name, exactly as the lender cards are grouped.
   *
   * An alias is another spelling of **the same** lender — "גמ״ח אור" beside
   * "גמח אור" — and never another lender's name. Getting that wrong would make
   * every lender match every sentence, so every reading would come back
   * ambiguous and nothing would ever resolve.
   */
  const byKey = new Map<string, { id: string; display: string; spellings: Set<string> }>();

  for (const debt of document.debts) {
    if (debt.status !== 'active') continue;
    const key = normaliseLenderName(debt.creditorName);
    const name = debt.creditorName.trim();
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, { id: debt.id, display: name, spellings: new Set([name]) });
      continue;
    }
    existing.spellings.add(name);
  }

  return [...byKey.values()].map((entry) => ({
    id: entry.id,
    creditorName: entry.display,
    status: 'active' as const,
    aliases: [...entry.spellings].filter((name) => name !== entry.display),
  }));
}

/**
 * The lender the words name, resolved here and never supplied by a model.
 *
 * This is the guard M1 and ADR-0035 both depend on: a balance that moves against
 * a lender invented on the spot is wrong in a way no later correction fully
 * undoes. The model gives words; the matcher gives an id of this household, or
 * nothing.
 */
function verifiedLender(
  lenderText: string | null,
  sentence: string,
  document: StoreDocument,
): { debtId: string | null; name: string | null; candidates: number } {
  const hints = lenderHints(document);
  /*
   * The quoted fragment first, then the whole sentence. A model that named the
   * lender precisely gets the precise answer; one that quoted nothing still lets
   * the family's own words be searched, which is what the rule-based reader
   * would have done anyway.
   */
  const fromQuote = lenderText === null ? null : matchLender(lenderText, hints);
  const match =
    fromQuote !== null && fromQuote.candidates > 0 ? fromQuote : matchLender(sentence, hints);

  const name =
    match.debtId === null
      ? null
      : (document.debts.find((row) => row.id === match.debtId)?.creditorName ?? null);

  return { debtId: match.debtId, name, candidates: match.candidates };
}

/** A category key from the closed list, or null. */
function verifiedCategory(id: string | null): string | null {
  if (id === null) return null;
  return (BUDGET_CATEGORY_KEYS as readonly string[]).includes(id) ? id : null;
}

/** Evidence, trimmed and capped. Quoted text from the person's own sentence. */
function verifiedEvidence(output: ModelOutput): AiProposal['evidence'] {
  const clip = (value: string | null, max: number): string | null => {
    if (value === null) return null;
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed.slice(0, max);
  };
  return {
    amountText: clip(output.evidence.amountText, 80),
    dateText: clip(output.evidence.dateText, 80),
    counterpartyText: clip(output.evidence.counterpartyText, 120),
  };
}

/** The question to add when a verified field came back empty. */
const QUESTION: Readonly<
  Record<string, { field: AiProposal['missing'][number]['field']; question: string }>
> = {
  amount: { field: 'amount', question: 'מה הסכום?' },
  account: { field: 'account', question: 'מאיזה חשבון?' },
  lender: { field: 'lender', question: 'לאיזו הלוואה זה שייך?' },
  lender_many: { field: 'lender', question: 'לאיזה מלווה מתוך אלה?' },
  lender_new: { field: 'lender', question: 'ממי ההלוואה? ייפתח כרטיס חדש.' },
  date: { field: 'date', question: 'באיזה תאריך?' },
};

/**
 * Turns a model answer into a proposal this application is prepared to show.
 *
 * Never throws. A reading that cannot be trusted becomes a question, because a
 * question is something a person can answer and an error is not.
 */
export function verifyProposal(output: ModelOutput, context: VerifyContext): AiProposal {
  const { document, today } = context;
  const sentence = context.sentence ?? '';

  const evidence = verifiedEvidence(output);
  const amount = verifiedAmount(output.amountMinor);
  const date = canonicalDate(output.date);
  const accountId = verifiedAccount(output.accountId, document);
  const lender = verifiedLender(output.lenderText, sentence, document);
  const debtId = lender.debtId;
  const categoryId = verifiedCategory(output.categoryId);

  /*
   * "A new loan" from a lender who already has a card is a top-up, not a card.
   *
   * Decided here rather than by the reader, because it is a question about the
   * household and not about the words: the same sentence means one thing for a
   * family who has that lender and another for a family who does not. Getting it
   * wrong opens a second card beside the first and splits one lender's history
   * in two, which is the failure this whole slice exists to prevent.
   */
  const action: AiAction =
    output.action === 'new_debt' && debtId !== null ? 'new_principal' : output.action;

  /*
   * When the money comes due, which is allowed to be a day that has not arrived.
   *
   * A borrowing sentence whose only date is in the future is read as that date:
   * the sum cannot have arrived tomorrow, so the one coherent reading of
   * "לפירעון ב־10/10/2026" is the day it must go back. Doing it here rather than
   * trusting the reader keeps the two readers saying the same thing about the
   * same sentence — the rule table has one date slot and applies the same rule.
   */
  const borrowing = BORROWING.includes(action);
  const statedDue = borrowing ? canonicalDate(output.dueDate) : null;
  const futureDate = date !== null && date > today;
  const dueDate = statedDue ?? (borrowing && futureDate ? date : null);
  /** The occurrence date, once a future day has been recognised as a due date. */
  const occurred = dueDate !== null && dueDate === date ? null : date;

  /*
   * Which ids the model named but this household does not have.
   *
   * Tracked rather than silently dropped: a stale or invented reference is the
   * signal that the reading cannot be trusted as a whole, so it downgrades the
   * state even when every other field looks fine.
   */
  /*
   * An id the model named that this household does not have.
   *
   * The lender is no longer one of these: a model cannot name a lender id at
   * all, so an unmatched lender is an ordinary "we do not know which" rather
   * than evidence that the whole reading is untrustworthy.
   */
  const invented =
    (output.accountId !== null && accountId === null) ||
    (output.categoryId !== null && categoryId === null);

  // A date after today is not a record of something that happened.
  const dateInFuture = occurred !== null && occurred > today;

  const missing = [...output.missing];
  const need = (key: keyof typeof QUESTION): void => {
    const entry = QUESTION[key];
    if (entry === undefined) return;
    if (missing.some((item) => item.field === entry.field)) return;
    missing.push(entry);
  };

  if (REQUIRES_AMOUNT.includes(action) && amount.amountMinor === null) need('amount');
  if (REQUIRES_ACCOUNT.includes(action) && accountId === null) {
    /*
     * One open account and nothing to choose between: the confirmation form
     * fills it in. More than one, and a person says which — the same rule the
     * deterministic reader follows, so the two screens behave alike.
     */
    if (document.accounts.filter((row) => row.closedAt === null).length !== 1) need('account');
  }
  if (REQUIRES_DEBT.includes(action) && debtId === null) {
    need(lender.candidates > 1 ? 'lender_many' : 'lender');
  }
  /*
   * Opening a card is never something this screen does on its own. When the
   * words match nothing, the person names the lender themselves — so the
   * proposal waits for that rather than arriving ready.
   */
  if (action === 'new_debt') need('lender_new');
  if (dateInFuture) need('date');

  const unknownAction = action === 'unknown';

  const state: AiProposal['state'] = unknownAction
    ? 'not_understood'
    : missing.length > 0 || invented || amount.problem
      ? 'needs_clarification'
      : output.state === 'ready'
        ? 'ready'
        : output.state;

  /*
   * The one place `safeToConfirm` is decided.
   *
   * Every clause is a fact this file established, not something the model
   * asserted. `low` confidence is excluded on purpose: a reading the model itself
   * is unsure of is a question even when every field happens to verify.
   */
  const safeToConfirm =
    state === 'ready' &&
    !invented &&
    !amount.problem &&
    !dateInFuture &&
    output.confidence !== 'low' &&
    (!REQUIRES_AMOUNT.includes(action) || amount.amountMinor !== null) &&
    (!REQUIRES_DEBT.includes(action) || debtId !== null);

  return {
    version: CONTRACT_VERSION,
    state,
    action,
    summary: output.summary.slice(0, 200),
    confidence: output.confidence,
    evidence,
    amountMinor: amount.amountMinor,
    // A date the sentence did not give is today, said out loud on the screen.
    date: dateInFuture ? null : (occurred ?? today),
    hebrewDate: hebrewFormOf(dateInFuture ? null : (occurred ?? today)),
    dueDate,
    dueHebrewDate: hebrewFormOf(dueDate),
    accountId,
    debtId,
    lenderName: lender.name,
    // The words the sentence used for the other party, which is what a record is
    // labelled with. Quoted from the person's own text, never composed here.
    label: evidence.counterpartyText,
    lenderCandidates: lender.candidates,
    categoryId,
    missing: missing.slice(0, 3),
    reason: output.reason.slice(0, 300),
    safeToConfirm,
    unavailableReason: null,
  };
}
