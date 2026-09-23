/**
 * Folding a bank's description into something rules can match.
 *
 * Israeli statements write the same thing many ways. The same charge arrives as
 * "ע. מסלול מורחב", "ע.מסלול מורחב", "עמלת מסלול מורחב" and "ע׳ מסלול מורחב",
 * and a rule table that matched raw text would need a line for each. Worse, it
 * would silently stop matching the day a bank changed a space.
 *
 * So the text is folded once, here, and every rule matches the folded form:
 *
 *   1. **Nikud and bidi marks go.** They carry no meaning for matching and they
 *      are invisible, which makes a rule that fails because of one impossible to
 *      debug by looking.
 *   2. **Abbreviations expand.** `ע.`/`ע׳` before a word is `עמלה`; `חיוב` stays
 *      `חיוב`; `הו"ק` is `הוראת קבע`. This is the step that turns four spellings
 *      into one, and it is a table rather than a regular expression so that each
 *      entry can be read and argued with.
 *   3. **Punctuation becomes space, runs of space collapse.** After this,
 *      "ע.מסלול" and "ע. מסלול" are the same string.
 *   4. **Final letters fold.** מ/ם, נ/ן, צ/ץ, פ/ף, כ/ך differ at the end of a
 *      word and mean the same; a bank truncating a field can turn one into the
 *      other.
 *
 * Digits are kept. A card's last four and a loan's number are exactly the kind of
 * detail that tells two otherwise identical lines apart, and dropping them would
 * make a rule match rows it should not.
 *
 * Nothing here interprets. The output is a string for matching, never a value.
 */

/** Combining marks and the bidi controls Israeli exports are full of. */
const MARKS = /[\u0591-\u05C7\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/** Geresh and gershayim, in all the shapes they are typed in. */
const GERESH = /[\u05F3\u2018\u2019']/g;
const GERSHAYIM = /[\u05F4\u201C\u201D"]/g;

/** Hebrew final letters and the ordinary form each folds to. */
const FINALS: ReadonlyMap<string, string> = new Map([
  ['\u05DD', '\u05DE'],
  ['\u05DF', '\u05E0'],
  ['\u05E5', '\u05E6'],
  ['\u05E3', '\u05E4'],
  ['\u05DA', '\u05DB'],
]);

/**
 * Abbreviations a bank statement uses, and what they stand for.
 *
 * Ordered longest-first when applied, so `הו"ק` is expanded before `ה` could be
 * touched by anything else. Each entry is one abbreviation a real Israeli
 * statement writes; none is a guess about what a bank might do.
 */
const ABBREVIATIONS: readonly (readonly [string, string])[] = [
  // Fees and charges.
  ['עמל', 'עמלה'],
  ['ע', 'עמלה'],
  ['עמ', 'עמלה'],
  // Standing orders and direct debits.
  ['הוק', 'הוראת קבע'],
  ['הו"ק', 'הוראת קבע'],
  ['הוראת קבע', 'הוראת קבע'],
  // Transfers.
  ['העב', 'העברה'],
  ['העבר', 'העברה'],
  ['זיכ', 'זיכוי'],
  // Cards.
  ['כ.אשראי', 'כרטיס אשראי'],
  ['כרט', 'כרטיס'],
  ['אשר', 'אשראי'],
  // Loans.
  ['הלו', 'הלוואה'],
  ['הלוו', 'הלוואה'],
  // Interest.
  ['רבית', 'ריבית'],
  // Cash.
  ['כספומט', 'כספומט'],
  ['משיכ', 'משיכה'],
  // Accounts.
  ['חשב', 'חשבון'],
  ['חש', 'חשבון'],
  // Months and salary.
  ['משכ', 'משכורת'],
  ['שכ', 'שכר'],
];

/** Only an abbreviation standing alone, or followed by a separator, expands. */
function expandAbbreviations(text: string): string {
  let out = text;
  // Longest first: `הוראת קבע` must not be half-matched by `הו`.
  const ordered = [...ABBREVIATIONS].sort((a, b) => b[0].length - a[0].length);
  for (const [short, long] of ordered) {
    // A token that is exactly the abbreviation, optionally with a trailing dot or
    // geresh that the punctuation step has not reached yet.
    const pattern = new RegExp(
      `(^|\\s)${short.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[.\u05F3']?(?=\\s|$)`,
      'gu',
    );
    out = out.replace(pattern, `$1${long}`);
  }
  return out;
}

function foldFinals(text: string): string {
  let out = '';
  for (const character of text) out += FINALS.get(character) ?? character;
  return out;
}

/**
 * The folded form of a description, for matching.
 *
 * Idempotent: folding a folded string returns it unchanged, which is what lets a
 * stored household rule be matched against a freshly folded row.
 */
export function normaliseDescription(text: string): string {
  const withoutMarks = text.normalize('NFKC').replace(MARKS, '');
  const quotesUnified = withoutMarks.replace(GERESH, "'").replace(GERSHAYIM, '"');

  // A dot between letters is an abbreviation mark, not a sentence: turn it into a
  // space so "ע.מסלול" becomes two tokens before the abbreviation table runs.
  const spaced = quotesUnified
    .replace(/([\u05D0-\u05EA])\.([\u05D0-\u05EA])/gu, '$1 $2')
    .replace(/[\\/,;:()[\]{}*#|+_=<>!?~`@$%^&-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const expanded = expandAbbreviations(spaced);

  /*
   * The dots the abbreviation step needed are dropped now that it has run.
   * Doing it earlier would take away the mark that tells `ע.` from the word `ע`,
   * and leaving it would make "ע . מסלול" fold differently from "ע. מסלול".
   */
  return foldFinals(expanded)
    .replace(/['".]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('he-IL');
}

/**
 * The one-letter words Hebrew writes joined to the next one.
 *
 * "בכספומט" is "ב" + "כספומט" and "לחשמל" is "ל" + "חשמל". A matcher that only
 * compared whole words would miss both, and a bank writes them that way
 * constantly — so a rule for "כספומט" has to match "בכספומט" without also
 * matching every word that merely starts with those letters.
 */
const PREFIXES = new Set(['ב', 'ל', 'מ', 'ה', 'ו', 'ש', 'כ']);

/**
 * True when a word is the needle, or the needle wearing one Hebrew prefix.
 *
 * The length floor is what keeps this safe. Allowing a prefix on a two-letter
 * word would make "שק" match "משק", which is a different word entirely; at three
 * letters and up the chance of a collision is small and the gain — reading
 * ordinary Hebrew — is the whole point.
 */
function wordMatches(word: string, needleWord: string): boolean {
  if (word === needleWord) return true;
  if (needleWord.length < 3) return false;
  if (word.length !== needleWord.length + 1) return false;
  const first = word.slice(0, 1);
  return PREFIXES.has(first) && word.slice(1) === needleWord;
}

/**
 * True when the folded haystack contains the folded needle as whole words.
 *
 * Whole words rather than any substring: "הלוואה" must not match inside a longer
 * word that happens to contain it, because that is how a rule starts catching
 * rows nobody meant. A single attached prefix is the one permitted difference.
 */
export function containsPhrase(haystack: string, needle: string): boolean {
  const foldedNeedle = normaliseDescription(needle);
  if (foldedNeedle.length === 0) return false;
  const words = haystack.split(' ');
  const needleWords = foldedNeedle.split(' ');
  for (let index = 0; index + needleWords.length <= words.length; index += 1) {
    let all = true;
    for (let offset = 0; offset < needleWords.length; offset += 1) {
      const word = words[index + offset];
      const needleWord = needleWords[offset];
      if (word === undefined || needleWord === undefined || !wordMatches(word, needleWord)) {
        all = false;
        break;
      }
    }
    if (all) return true;
  }
  return false;
}
