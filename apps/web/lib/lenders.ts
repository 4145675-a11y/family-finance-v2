import 'server-only';

import type {
  Debt,
  DebtEventKind,
  DebtRepaymentDemand,
  DueDate,
} from '@family-finance/contracts';
import { normaliseLenderName } from '@family-finance/contracts';
import { finalBalanceOf, replayDebtLedger } from '@family-finance/finance-engine';
import type { StoreDocument } from '@family-finance/local-store';

/**
 * Lenders, assembled from the debts and the events.
 *
 * A lender is not a stored row. It is the creditor name a household's debts are
 * recorded under, folded so that "גמ״ח אור החיים" and "גמח אור החיים" are one
 * lender rather than two. Building it this way rather than as a table means there
 * is no second place a name can live and disagree with the debts themselves.
 *
 * **No balance is calculated here.** Every figure on the card comes from the
 * finance engine: `replayDebtLedger` walks the events and `finalBalanceOf` says
 * what is left at the end, both over the same signed delta the totals use. This
 * file once did its own arithmetic and clamped at every step while the engine
 * clamped once at the end — so a debt that had dipped below zero and recovered
 * showed one number in the heading and another in the last row of the column
 * beneath it. There is now one calculation, and the heading is the last row by
 * construction.
 */

export interface LedgerLine {
  readonly eventId: string;
  readonly debtId: string;
  readonly debtName: string;
  readonly kind: DebtEventKind;
  readonly occurredOn: string;
  readonly amountMinor: number;
  /**
   * How this line moved the balance, signed, from the engine's own delta.
   *
   * Carried rather than recomputed: the screen shows a sign beside the amount,
   * and deriving that sign here would be the second opinion this file exists to
   * no longer hold.
   */
  readonly deltaMinor: number;
  /** The running balance after this line, straight from `replayDebtLedger`. */
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
  /**
   * Every time this lender asked to be repaid, newest first.
   *
   * Kept apart from `ledger` deliberately. A demand moved no money, so putting
   * it in a column whose last row has to equal the balance above it would either
   * corrupt that sum or add a row that means nothing in it. The screen shows the
   * two side by side and says which is which.
   */
  readonly demands: readonly DebtRepaymentDemand[];
  readonly ledger: readonly LedgerLine[];
}

/**
 * Orders lines the way a ledger has to be read.
 *
 * By date, then by identifier — the same tie-break `replayDebtLedger` uses, so
 * merging two of a lender's debts into one list cannot reorder either of them
 * against the running balance the engine computed for it.
 */
function chronologically(a: LedgerLine, b: LedgerLine): number {
  if (a.occurredOn !== b.occurredOn) return a.occurredOn < b.occurredOn ? -1 : 1;
  return a.eventId < b.eventId ? -1 : 1;
}

/**
 * This lender's repayment demands, newest first.
 *
 * Ordered by the day the lender asked, then by when it was written down, so two
 * demands recorded on the same day keep the order they were entered in. A
 * closed debt's demands are included: a lender who came back after the loan was
 * settled is the case this record exists for, and dropping those rows would
 * quietly delete the only trace of it.
 */
function demandsFor(
  document: StoreDocument,
  debts: readonly Debt[],
): readonly DebtRepaymentDemand[] {
  const ids = new Set(debts.map((debt) => debt.id));
  return document.repaymentDemands
    .filter((demand) => ids.has(demand.debtId))
    .sort((a, b) => {
      if (a.demandedOn !== b.demandedOn) return a.demandedOn < b.demandedOn ? 1 : -1;
      if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
      return a.id < b.id ? 1 : -1;
    });
}

export function lenderCards(document: StoreDocument, today: string): readonly LenderCard[] {
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

    /*
     * The history, and the balance under the lender's name, from one place.
     *
     * `replayDebtLedger` is the engine's own walk over the events — the same
     * delta function the totals use, clamped the same way. Nothing here adds up
     * an event, so there is no second arithmetic that could disagree with the
     * first. This file previously did its own sum and clamped at every step; the
     * two then differed on any debt that had dipped below zero and recovered.
     */
    // The note and the import a line came from live on the stored event; the
    // engine works with the financial facts alone.
    const storedById = new Map(document.debtEvents.map((event) => [event.id, event]));

    const ledger: LedgerLine[] = ordered
      .flatMap((debt) =>
        replayDebtLedger(document.debtEvents, debt.id, today).map((line) => {
          const stored = storedById.get(line.event.id);
          return {
            eventId: line.event.id,
            debtId: line.event.debtId,
            debtName: debt.creditorName,
            kind: line.event.kind,
            occurredOn: line.event.occurredOn,
            amountMinor: line.event.amountMinor,
            deltaMinor: line.deltaMinor,
            balanceAfterMinor: line.balanceAfterMinor,
            note: stored?.note ?? null,
            importBatchId: stored?.importBatchId ?? null,
          };
        }),
      )
      // One lender may hold more than one debt; the card lists them together, in
      // the same order the engine walked each of them.
      .sort(chronologically);

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
      /*
       * The lender's balance is the sum of each debt's final balance, and each
       * of those is `finalBalanceOf` over the very lines shown below it. The
       * heading and the last row of the column are therefore the same number by
       * construction rather than by agreement.
       */
      currentBalanceMinor: ordered.reduce(
        (total, debt) =>
          total + finalBalanceOf(replayDebtLedger(document.debtEvents, debt.id, today)),
        0,
      ),
      currency: first.currency,
      nextDue: upcoming[0]?.due ?? null,
      dueDatesNeedingReview: withDates.filter((entry) => entry.due.reviewReason !== null),
      // Newest first: what happened last is what a person is looking for.
      ledger: [...ledger].reverse(),
      demands: demandsFor(document, ordered),
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
