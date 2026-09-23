import { describe, expect, test } from 'vitest';

import { containsPhrase, normaliseDescription } from './normalise';

describe('normaliseDescription — the four spellings of one charge', () => {
  /*
   * The line the requirement names, written the ways a bank actually writes it.
   * All four have to fold to the same string, or the rule table needs a row per
   * spelling and breaks the day a bank moves a space.
   */
  test.each([
    ['ע. מסלול מורחב'],
    ['ע.מסלול מורחב'],
    ['ע׳ מסלול מורחב'],
    ["ע' מסלול מורחב"],
    ['ע . מסלול   מורחב'],
  ])('"%s" folds to the same text', (written) => {
    expect(normaliseDescription(written)).toBe(normaliseDescription('ע. מסלול מורחב'));
  });

  test('the abbreviation becomes the word it stands for', () => {
    expect(normaliseDescription('ע. מסלול מורחב')).toContain('עמלה');
  });

  test('"עמלת מסלול" and "ע. מסלול" both carry the fee word', () => {
    expect(normaliseDescription('עמלת מסלול מורחב')).toContain('עמל');
    expect(normaliseDescription('ע. מסלול מורחב')).toContain('עמל');
  });
});

describe('normaliseDescription — what folding removes', () => {
  test('vowel points are gone', () => {
    const pointed = 'מַשְׂכּוֹרֶת';
    expect(normaliseDescription(pointed)).toBe(normaliseDescription('משכורת'));
  });

  test('bidi control characters are gone', () => {
    expect(normaliseDescription('‎חיוב הלוואה‏')).toBe(normaliseDescription('חיוב הלוואה'));
  });

  test('punctuation becomes space and runs of space collapse', () => {
    expect(normaliseDescription('חיוב/הלוואה   (בנק)')).toBe(
      normaliseDescription('חיוב הלוואה בנק'),
    );
  });

  test('final letters fold, so a truncated field still matches', () => {
    // ם and מ are the same letter in different positions.
    expect(normaliseDescription('תשלום')).toBe(normaliseDescription('תשלומ'));
  });

  test('digits are kept, because they tell two similar lines apart', () => {
    expect(normaliseDescription('הלוואה 12345')).toContain('12345');
    expect(normaliseDescription('הלוואה 12345')).not.toBe(normaliseDescription('הלוואה 99999'));
  });

  test('folding is idempotent, so a stored rule still matches', () => {
    const once = normaliseDescription('ע. מסלול מורחב');
    expect(normaliseDescription(once)).toBe(once);
  });

  test('an empty description folds to nothing rather than throwing', () => {
    expect(normaliseDescription('')).toBe('');
    expect(normaliseDescription('   ')).toBe('');
  });
});

describe('normaliseDescription — the abbreviations a statement uses', () => {
  test.each([
    ['הו"ק לחשמל', 'הוראת קבע'],
    ['הוק לחשמל', 'הוראת קבע'],
    ['העב. לחשבון', 'העברה'],
    ['הלו. לרכב', 'הלוואה'],
    ['משכ. חודש 9', 'משכורת'],
  ])('"%s" expands to contain "%s"', (written, expected) => {
    expect(normaliseDescription(written)).toContain(normaliseDescription(expected));
  });

  test('an abbreviation inside a longer word is left alone', () => {
    // "עמוק" begins with the letters of an abbreviation but is a word.
    const folded = normaliseDescription('משהו עמוק');
    expect(folded).toContain('עמוק');
    expect(folded).not.toContain('עמלה');
  });
});

describe('containsPhrase', () => {
  const folded = normaliseDescription('ע. מסלול מורחב');

  test('finds a multi-word phrase', () => {
    expect(containsPhrase(folded, 'עמלה מסלול')).toBe(true);
    expect(containsPhrase(folded, 'מסלול מורחב')).toBe(true);
  });

  test('does not find words that are not there', () => {
    expect(containsPhrase(folded, 'הלוואה')).toBe(false);
  });

  test('does not match an arbitrary substring of a word', () => {
    // "לול" sits inside "מסלול" and is not a word of the line.
    expect(containsPhrase(folded, 'לול')).toBe(false);
    expect(containsPhrase(folded, 'מסל')).toBe(false);
  });

  /*
   * The one difference a match tolerates is a single attached Hebrew prefix,
   * because that is how the language writes "in", "to" and "from". The cost is
   * stated rather than hidden: a needle that happens to be a longer word minus
   * its first letter will match that word. Rule phrases are authored, so this is
   * a cost we control; the alternative — missing "לחשמל" and "בכספומט" — is a
   * classifier that cannot read ordinary Hebrew.
   */
  test('tolerates one attached prefix, which is how Hebrew writes "in" and "to"', () => {
    const line = normaliseDescription('משיכה בכספומט לחשמל');
    expect(containsPhrase(line, 'כספומט')).toBe(true);
    expect(containsPhrase(line, 'חשמל')).toBe(true);
  });

  test('a two-letter needle gets no prefix tolerance', () => {
    // Otherwise "שק" would match "משק", which is a different word entirely.
    expect(containsPhrase(normaliseDescription('משק בית'), 'שק')).toBe(false);
  });

  test('an empty needle matches nothing', () => {
    expect(containsPhrase(folded, '')).toBe(false);
  });

  test('the needle is folded too, so a rule may be stored unfolded', () => {
    expect(containsPhrase(folded, 'ע. מסלול')).toBe(true);
  });
});
