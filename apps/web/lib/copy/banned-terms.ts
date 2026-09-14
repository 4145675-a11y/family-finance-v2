/**
 * Words this product does not say to a family.
 *
 * Two lists, for two different failures.
 *
 * The first is economist vocabulary. Every term in it is correct, and every term
 * in it makes a person under debt pressure feel that the app is for someone else.
 * "נזילות" is a fine word in a finance department and a wall in a kitchen.
 *
 * The second is blame. 03-UX-SPEC.md § Microcopy is explicit — "אפס האשמה" — and
 * the difference between "חרגתם" and "יצא יותר ממה שתכננו" is the difference
 * between a family that opens the app tomorrow and one that does not.
 *
 * This module is the rule table, so it necessarily contains the very strings it
 * forbids. It and its test are excluded from the scan for that reason, and the
 * blind spot is closed the same way `ADR-0005` closes it for the forbidden-artifact
 * scan: tone.test.ts asserts every rule fires on a positive fixture and stays
 * silent on a clean one.
 */

export interface BannedTerm {
  readonly term: string;
  readonly kind: 'jargon' | 'blame';
  readonly instead: string;
}

export const BANNED_TERMS: readonly BannedTerm[] = [
  // Economist vocabulary.
  { term: 'נזילות', kind: 'jargon', instead: 'כמה כסף יש עכשיו' },
  { term: 'תזרים', kind: 'jargon', instead: 'מה נכנס ומה יוצא' },
  { term: 'נקודת שפל', kind: 'jargon', instead: 'היום שבו יישאר הכי מעט כסף' },
  { term: 'רזרבה', kind: 'jargon', instead: 'כסף שמשאירים בצד' },
  { term: 'התחייבויות ודאיות', kind: 'jargon', instead: 'תשלומים שחייבים לרדת' },
  { term: 'פער מימון', kind: 'jargon', instead: 'חסר כסף כדי לעבור את החודש' },
  { term: 'תרחיש שמרני', kind: 'jargon', instead: 'אם ייכנס רק הכסף שבטוח שיגיע' },
  { term: 'תרחיש סביר', kind: 'jargon', instead: 'אם ייכנס גם הכסף שכנראה יגיע' },
  { term: 'איכות נתונים', kind: 'jargon', instead: 'עד כמה התמונה אמינה' },
  { term: 'נתונים חסרים', kind: 'jargon', instead: 'בואו נשלים כמה פרטים' },
  { term: 'מידע לא מעודכן', kind: 'jargon', instead: 'כדאי לעדכן כדי לראות תמונה נכונה' },
  { term: 'הקצאת כסף', kind: 'jargon', instead: 'לאן הכסף הולך קודם' },
  { term: 'מפל', kind: 'jargon', instead: 'סדר התשלומים' },
  { term: 'אינדיקטור', kind: 'jargon', instead: 'סימן' },
  // "מדד" alone is not listed: it is a substring of ordinary words such as
  // "נמדד", and a rule that fires on those would be worked around rather than
  // obeyed. The specific jargon phrases above carry the weight instead.
  { term: 'תשואה', kind: 'jargon', instead: 'רווח' },
  { term: 'הון עצמי', kind: 'jargon', instead: 'מה שיש לנו' },
  { term: 'מצב התנהלות', kind: 'jargon', instead: 'איפה אנחנו עומדים' },
  { term: 'פעולה מומלצת', kind: 'jargon', instead: 'מה כדאי לעשות עכשיו' },
  { term: 'חריגה', kind: 'jargon', instead: 'יצא יותר ממה שתכננו' },

  // Blame.
  { term: 'חרגתם', kind: 'blame', instead: 'יצא יותר ממה שתכננתם' },
  { term: 'לא הזנתם', kind: 'blame', instead: 'בואו נשלים' },
  { term: 'בזבזתם', kind: 'blame', instead: 'יצא יותר ממה שתכננתם' },
  { term: 'שגיתם', kind: 'blame', instead: 'אפשר לתקן' },
  { term: 'אינה תקינה', kind: 'blame', instead: 'אפשר לשפר' },
  { term: 'נכשלתם', kind: 'blame', instead: 'החודש היה צפוף' },
  { term: 'אשמת', kind: 'blame', instead: '' },
];

/** Every banned term found in a piece of user-facing text. */
export function findBannedTerms(text: string): BannedTerm[] {
  return BANNED_TERMS.filter((entry) => text.includes(entry.term));
}
