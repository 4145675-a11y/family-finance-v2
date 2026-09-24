import { describe, expect, test } from 'vitest';

import { matchLender, type LenderHint } from './lender';

/**
 * Which lender a sentence means — the one matcher, tested once.
 *
 * Both readers resolve a lender through this function and neither has its own
 * copy, which is the whole reason it exists: two ways of deciding which card a
 * sentence means would eventually disagree, and the disagreement would be money
 * moving against the wrong lender.
 *
 * The important cases are the refusals. Finding the right card is pleasant; the
 * behaviour a family depends on is that words fitting two cards find neither, and
 * words fitting none invent nothing. Everything here is synthetic — no real
 * lender's name appears in this repository.
 */

const AVREHIM: LenderHint = {
  id: '11111111-1111-4111-8111-111111111111',
  creditorName: 'גמח אברכים',
  status: 'active',
};

/** The same lender, written two ways, as a household actually records it. */
const QUOTED: LenderHint = {
  id: '22222222-2222-4222-8222-222222222222',
  creditorName: 'גמ"ח אור',
  status: 'active',
  aliases: ['גמח אור'],
};

const FAMILY: LenderHint = {
  id: '33333333-3333-4333-8333-333333333333',
  creditorName: 'משפחת לוי',
  status: 'active',
};

/** A branch whose name contains its parent's, so naming one names both. */
const BRANCH: LenderHint = {
  id: '44444444-4444-4444-8444-444444444444',
  creditorName: 'גמח אור החיים',
  status: 'active',
};

describe('one card, found', () => {
  test('a sentence naming a lender resolves to that lender', () => {
    const match = matchLender('החזרתי 300 שקל לגמח אברכים', [AVREHIM, FAMILY]);
    expect(match.debtId).toBe(AVREHIM.id);
    expect(match.candidates).toBe(1);
    expect(match.names).toEqual(['גמח אברכים']);
  });

  test('a Hebrew prefix glued to the name is still the name', () => {
    // "מגמח אברכים" is "מ" + the name, which is how people write.
    expect(matchLender('קיבלתי עוד 3,000 מגמח אברכים', [AVREHIM]).debtId).toBe(AVREHIM.id);
  });

  test('the words alone, with no sentence around them, resolve too', () => {
    // This is the path a quoted fragment from a reader takes.
    expect(matchLender('גמח אברכים', [AVREHIM]).debtId).toBe(AVREHIM.id);
  });
});

describe('another spelling of the same lender', () => {
  test('an alias finds the card the household already has', () => {
    const match = matchLender('החזרתי 200 לגמח אור', [QUOTED]);
    expect(match.debtId).toBe(QUOTED.id);
    expect(match.candidates).toBe(1);
    // The name it reports is the card's own, not the spelling the sentence used:
    // one lender's records stay filed under one name.
    expect(match.names).toEqual(['גמ"ח אור']);
  });

  test('and the card name itself still finds it', () => {
    expect(matchLender('החזרתי 200 לגמ"ח אור', [QUOTED]).debtId).toBe(QUOTED.id);
  });
});

describe('words that fit more than one card', () => {
  test('two lenders fitting at once resolve to neither', () => {
    // Naming the branch names the parent too.
    const match = matchLender('החזרתי 200 לגמח אור החיים', [QUOTED, BRANCH]);
    expect(match.debtId).toBeNull();
    expect(match.candidates).toBe(2);
    // Both are reported, so a screen can ask which rather than guess.
    expect(match.names).toHaveLength(2);
  });
});

describe('words that fit no card', () => {
  test('an unknown name resolves to nothing at all', () => {
    const match = matchLender('קיבלתי עוד 3,000 ממלווה שאינו קיים', [AVREHIM, FAMILY]);
    expect(match.debtId).toBeNull();
    expect(match.candidates).toBe(0);
    expect(match.names).toEqual([]);
  });

  test('an empty sentence resolves to nothing', () => {
    expect(matchLender('', [AVREHIM])).toEqual({ debtId: null, candidates: 0, names: [] });
  });

  test('a household with no lenders resolves to nothing', () => {
    expect(matchLender('החזרתי 200 לגמח אברכים', []).debtId).toBeNull();
  });
});

describe('a lender that is no longer owed', () => {
  test('a settled card is not matched', () => {
    const settled: LenderHint = { ...AVREHIM, status: 'settled' };
    const match = matchLender('החזרתי 200 לגמח אברכים', [settled]);
    expect(match.debtId).toBeNull();
    expect(match.candidates).toBe(0);
  });

  test('a written-off card is not matched either', () => {
    const written: LenderHint = { ...AVREHIM, status: 'written_off' };
    expect(matchLender('החזרתי 200 לגמח אברכים', [written]).debtId).toBeNull();
  });

  test('but an active card beside a settled one still is', () => {
    const settled: LenderHint = { ...BRANCH, status: 'settled' };
    const match = matchLender('החזרתי 200 לגמח אור החיים', [QUOTED, settled]);
    // Only the active one can fit, so what would be ambiguous is not.
    expect(match.debtId).toBe(QUOTED.id);
    expect(match.candidates).toBe(1);
  });
});

describe('the same words always read the same way', () => {
  test('matching is deterministic', () => {
    const first = matchLender('החזרתי 200 לגמח אברכים', [AVREHIM, QUOTED, FAMILY]);
    const second = matchLender('החזרתי 200 לגמח אברכים', [AVREHIM, QUOTED, FAMILY]);
    expect(first).toEqual(second);
  });
});
