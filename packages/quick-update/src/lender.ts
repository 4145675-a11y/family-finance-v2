import { containsPhrase, normaliseDescription } from '@family-finance/transaction-intelligence';

/**
 * A lender as the matcher needs to see it.
 *
 * The classifier's own `LenderHint` carries no aliases, and widening it there
 * would ripple through the import screens for a field only this matcher reads.
 * So the extra spelling list is declared here, optional, and a caller that has
 * none simply does not pass one.
 */
export interface LenderHint {
  readonly id: string;
  readonly creditorName: string;
  readonly status: 'active' | 'settled' | 'written_off';
  /** Other spellings the household has recorded the same lender under. */
  readonly aliases?: readonly string[];
}

/**
 * Which lender a piece of text names — the one algorithm, used by both readers.
 *
 * It lives on its own for a reason that is not tidiness. Two ways of deciding
 * which lender a sentence means would eventually disagree, and the disagreement
 * would show up as money moving against the wrong card. So the rule-based reader
 * and the smart one call this, and there is nowhere else that matches a lender.
 *
 * The rule it applies is the one the import screen already holds to:
 *
 *   * **exactly one** active lender whose recorded name — or one of the other
 *     spellings the household has used for it — appears in the text: that one;
 *   * **none**: null, and the screen asks. A name that matches nothing never
 *     creates a lender;
 *   * **more than one**: null, and the screen asks which. Nothing is picked for
 *     being the closest.
 *
 * Aliases matter more than they look. A household that recorded "גמ״ח אור החיים"
 * once and "גמח אור החיים" another time has one lender and two spellings, and a
 * matcher that only knew the newest would fail to find the card that already
 * exists — which is the failure that opens a duplicate.
 */

export interface LenderMatch {
  /** The one lender the text names, when it names exactly one. */
  readonly debtId: string | null;
  /** How many it could have meant. 0 and 2 both mean "ask". */
  readonly candidates: number;
  /** The matching lenders' display names, for a disambiguation question. */
  readonly names: readonly string[];
}

/** Every spelling a lender is known by, in the folded form used for matching. */
function spellingsOf(debt: LenderHint): string[] {
  const all = [debt.creditorName, ...(debt.aliases ?? [])];
  return all.map((name) => normaliseDescription(name)).filter((name) => name.length >= 3);
}

/**
 * The lender a text names, if exactly one.
 *
 * `text` is untrusted: it is either the family's own sentence or a fragment a
 * model quoted out of it. Neither is ever treated as an identifier — the only
 * thing that comes out of here is an id this household already has.
 */
export function matchLender(text: string, debts: readonly LenderHint[]): LenderMatch {
  const folded = normaliseDescription(text);
  if (folded === '') return { debtId: null, candidates: 0, names: [] };

  const active = debts.filter((debt) => debt.status === 'active');
  const hits = active.filter((debt) =>
    spellingsOf(debt).some((name) => containsPhrase(folded, name) || folded.includes(name)),
  );

  return {
    debtId: hits.length === 1 ? (hits[0]?.id ?? null) : null,
    candidates: hits.length,
    names: hits.map((debt) => debt.creditorName),
  };
}
