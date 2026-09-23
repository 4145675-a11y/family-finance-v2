import 'server-only';

import type { Debt, DebtEventKind, DueDate } from '@family-finance/contracts';
import { normaliseLenderName } from '@family-finance/contracts';
import { replayDebtBalances } from '@family-finance/finance-engine';
import type { StoreDocument } from '@family-finance/local-store';

/**
 * Lenders, assembled from the debts and the events.
 *
 * A lender is not a stored row. It is the creditor name a household's debts are
 * recorded under, folded so that "גמ״ח אור החיים" and "גמח אור החיים" are one
 * lender rather than two. Building it this way rather than as a table means there
 * is no second place a name can live and disagree with the debts themselves.
 *
 * Every balance on this page is replayed from the events by `replayDebtBalances`.
 * None is stored, so none can drift: the number shown and the lines that explain
 * it are computed from the same list, in the same pass.
 */

export interface LedgerLine {
  readonly eventId: string;
  readonly debtId: string;
  readonly debtName: string;
  readonly kind: DebtEventKind;
  readonly occurredOn: string;
  readonly amountMinor: number;
  /** How this line moved the balance: +1, -1 or 0. */
  readonly direction: 1 | -1 | 0;
  /** The running balance after this line, in the order the events happened. */
  readonly balanceAfterMinor: number;
  readonly note: string | null;
  /** The import this line came from, when it came from a file. */
  readonly importBatchId: string | null;
}

export interface LenderCard {
  /** Folded name, used as the identifier in a URL. */
  readonly key: string;
  /** The name to show: the spelling of the lender's oldest debt. */
  readonly displayName: string;
  /** Other spellings the same lender is recorded under. */
  readonly aliases: readonly string[];
  readonly debts: readonly Debt[];
  readonly activeDebtCount: number;
  readonly currentBalanceMinor: number;
  readonly currency: string;
  /** The soonest due date that has not passed, across this lender's debts. */
  readonly nextDue: DueDate | null;
  /** Due dates that need a person to resolve them. */
  readonly dueDatesNeedingReview: readonly { debtId: string; due: DueDate }[];
  readonly ledger: readonly LedgerLine[];
}

/** How each kind of event moves a balance, as a sign. */
function directionOf(
  kind: DebtEventKind,
  correction: 'increase' | 'decrease' | null,
): 1 | -1 | 0 {
  if (kind === 'balance_correction') return correction === 'increase' ? 1 : -1;
  switch (kind) {
    case 'opening_balance':
    case 'new_principal':
    case 'interest_charge':
    case 'fee_charge':
      return 1;
    case 'principal_payment':
    case 'write_off':
      return -1;
    case 'interest_paid':
    case 'fee_paid':
    case 'note':
      return 0;
  }
}

/**
 * Orders events the way a ledger has to be read.
 *
 * By date, and within a date by the order they were recorded. Two events on the
 * same day must not swap places between one render and the next, or the running
 * balance column changes while the total does not.
 */
function chronologically(
  a: { occurredOn: string; createdAt: string; id: string },
  b: { occurredOn: string; createdAt: string; id: string },
): number {
  if (a.occurredOn !== b.occurredOn) return a.occurredOn < b.occurredOn ? -1 : 1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : 1;
}

export function lenderCards(document: StoreDocument, today: string): readonly LenderCard[] {
  const balances = replayDebtBalances(document.debtEvents, today);
  const grouped = new Map<string, Debt[]>();

  for (const debt of document.debts) {
    const key = normaliseLenderName(debt.creditorName);
    const bucket = grouped.get(key);
    if (bucket === undefined) grouped.set(key, [debt]);
    else bucket.push(debt);
  }

  const cards: LenderCard[] = [];

  for (const [key, debts] of grouped) {
    const ordered = [...debts].sort((a, b) =>
      a.openedOn === b.openedOn ? (a.id < b.id ? -1 : 1) : a.openedOn < b.openedOn ? -1 : 1,
    );
    const first = ordered[0];
    if (first === undefined) continue;

    const names = [...new Set(ordered.map((debt) => debt.creditorName.trim()))];
    const debtIds = new Set(ordered.map((debt) => debt.id));

    const events = document.debtEvents
      .filter((event) => debtIds.has(event.debtId))
      .sort(chronologically);

    // The running balance is accumulated per debt, so a lender with two debts
    // shows each line against the debt it actually belongs to.
    const running = new Map<string, number>();
    const ledger: LedgerLine[] = events.map((event) => {
      const direction = directionOf(event.kind, event.correctionEffect);
      const before = running.get(event.debtId) ?? 0;
      const after = Math.max(0, before + direction * event.amountMinor);
      running.set(event.debtId, after);
      return {
        eventId: event.id,
        debtId: event.debtId,
        debtName:
          ordered.find((debt) => debt.id === event.debtId)?.creditorName ?? first.creditorName,
        kind: event.kind,
        occurredOn: event.occurredOn,
        amountMinor: event.amountMinor,
        direction,
        balanceAfterMinor: after,
        note: event.note,
        importBatchId: event.importBatchId,
      };
    });

    const withDates = ordered
      .map((debt) => ({ debtId: debt.id, due: debt.dueDate }))
      .filter((entry): entry is { debtId: string; due: DueDate } => entry.due !== undefined);

    const upcoming = withDates
      .filter((entry) => entry.due.gregorian !== null && entry.due.gregorian >= today)
      .sort((a, b) => ((a.due.gregorian ?? '') < (b.due.gregorian ?? '') ? -1 : 1));

    cards.push({
      key,
      displayName: first.creditorName.trim(),
      aliases: names.filter((name) => name !== first.creditorName.trim()),
      debts: ordered,
      activeDebtCount: ordered.filter((debt) => debt.status === 'active').length,
      currentBalanceMinor: ordered.reduce(
        (total, debt) => total + (balances.get(debt.id) ?? 0),
        0,
      ),
      currency: first.currency,
      nextDue: upcoming[0]?.due ?? null,
      dueDatesNeedingReview: withDates.filter((entry) => entry.due.reviewReason !== null),
      // Newest first: what happened last is what a person is looking for.
      ledger: [...ledger].reverse(),
    });
  }

  // Most owed first. A lender owed nothing is still listed, at the end, because
  // a settled history is part of the record.
  return cards.sort((a, b) =>
    b.currentBalanceMinor === a.currentBalanceMinor
      ? a.displayName.localeCompare(b.displayName, 'he')
      : b.currentBalanceMinor - a.currentBalanceMinor,
  );
}

export function lenderCard(
  document: StoreDocument,
  today: string,
  key: string,
): LenderCard | null {
  return lenderCards(document, today).find((card) => card.key === key) ?? null;
}
