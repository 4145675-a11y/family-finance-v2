import 'server-only';

import { BUDGET_CATEGORY_KEYS } from '@family-finance/contracts';
import { formatHebrewDate, gregorianToHebrew } from '@family-finance/hebrew-calendar';
import type { StoreDocument } from '@family-finance/local-store';
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
  'new_debt',
  'debt_repayment',
  'balance',
];
const REQUIRES_ACCOUNT: readonly AiAction[] = [
  'expense',
  'income',
  'transfer',
  'debt_repayment',
  'balance',
];
const REQUIRES_DEBT: readonly AiAction[] = ['debt_repayment'];

export interface VerifyContext {
  readonly document: StoreDocument;
  /** Today, so a date in the future can be refused without reading a clock here. */
  readonly today: string;
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
 * A debt id that names an active debt of this household, or null.
 *
 * A name is never accepted in its place, and a name that matches nothing never
 * creates a lender. That is the guard M1 and ADR-0035 both depend on: a balance
 * that moves against a lender who was invented on the spot is wrong in a way no
 * later correction can fully undo.
 */
function verifiedDebt(id: string | null, document: StoreDocument): string | null {
  if (id === null) return null;
  const debt = document.debts.find((row) => row.id === id && row.status === 'active');
  return debt === undefined ? null : debt.id;
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

  const amount = verifiedAmount(output.amountMinor);
  const date = canonicalDate(output.date);
  const accountId = verifiedAccount(output.accountId, document);
  const debtId = verifiedDebt(output.debtId, document);
  const categoryId = verifiedCategory(output.categoryId);

  /*
   * Which ids the model named but this household does not have.
   *
   * Tracked rather than silently dropped: a stale or invented reference is the
   * signal that the reading cannot be trusted as a whole, so it downgrades the
   * state even when every other field looks fine.
   */
  const invented =
    (output.accountId !== null && accountId === null) ||
    (output.debtId !== null && debtId === null) ||
    (output.categoryId !== null && categoryId === null);

  // A date after today is not a record of something that happened.
  const dateInFuture = date !== null && date > today;

  const missing = [...output.missing];
  const need = (key: keyof typeof QUESTION): void => {
    const entry = QUESTION[key];
    if (entry === undefined) return;
    if (missing.some((item) => item.field === entry.field)) return;
    missing.push(entry);
  };

  const action = output.action;
  if (REQUIRES_AMOUNT.includes(action) && amount.amountMinor === null) need('amount');
  if (REQUIRES_ACCOUNT.includes(action) && accountId === null) {
    /*
     * One open account and nothing to choose between: the confirmation form
     * fills it in. More than one, and a person says which — the same rule the
     * deterministic reader follows, so the two screens behave alike.
     */
    if (document.accounts.filter((row) => row.closedAt === null).length !== 1) need('account');
  }
  if (REQUIRES_DEBT.includes(action) && debtId === null) need('lender');
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
    evidence: verifiedEvidence(output),
    amountMinor: amount.amountMinor,
    // A date the sentence did not give is today, said out loud on the screen.
    date: dateInFuture ? null : (date ?? today),
    hebrewDate: hebrewFormOf(dateInFuture ? null : (date ?? today)),
    accountId,
    debtId,
    categoryId,
    missing: missing.slice(0, 3),
    reason: output.reason.slice(0, 300),
    safeToConfirm,
    unavailableReason: null,
  };
}
