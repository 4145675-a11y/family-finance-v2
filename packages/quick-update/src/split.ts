import { readAmount } from './amount';

/**
 * One sentence, or several updates said in one breath.
 *
 * "שילמתי 120 בסופר ו-50 בדלק" is two things that happened. "קניתי לחם וחלב
 * ב-30 שקל" is one. The difference is not the word "ו" — it is whether each
 * side carries **a sum of its own**.
 *
 * That test is the whole rule, and it is deliberately conservative: a split that
 * should not have happened creates a second record for money that was spent
 * once, which is worse than a sentence a person has to enter twice. So a
 * candidate split is kept only when *every* part reads as an amount, and the
 * original sentence is returned otherwise.
 */

/**
 * Where a sentence may be cut.
 *
 * A comma with a digit on **both** sides is a thousands separator: "3,000" is one
 * number, and cutting there reads three thousand shekels as three. That is the
 * exact quiet wrongness this module exists to prevent, so the comma is the one
 * mark with a condition on it. Anywhere else — "בסופר,50", "120, בדלק" — it is a
 * cut, and a semicolon or a plus always is.
 */
const PUNCTUATION = /(?<!\d),|,(?!\d)|[;+]/u;

/**
 * Digits that belong to a day rather than to a sum: 10/10/2026, 3.9, 15/08.
 *
 * Taken out before a part is asked whether it names its own amount. Without
 * this, "לפירעון ב־10/10/2026" reads as an amount of ten and the sentence it
 * belongs to gets cut in half — losing the repayment date and keeping a number
 * that was never a sum. The reader itself removes the date before reading an
 * amount for the same reason (`interpret.ts`); this is that rule, applied one
 * step earlier.
 */
const DATE_LIKE = /\d{1,4}[./]\d{1,2}(?:[./]\d{2,4})?/gu;

/** The sum a part names in its own right, or null when it names none. */
function sumOf(part: string): number | null {
  return readAmount(part.replace(DATE_LIKE, ' '))?.amountMinor ?? null;
}

/**
 * The joining words, each as a whole word with a space in front.
 *
 * `\b` is useless here: JavaScript defines a word boundary against `[A-Za-z0-9_]`
 * only, so every Hebrew letter counts as a non-word character and a boundary
 * never falls where it is meant to. A leading space is the honest test.
 */
const JOINERS: readonly string[] = [' ו-', ' וגם ', ' וכן '];

export function splitUpdates(text: string): readonly string[] {
  const trimmed = text.trim();
  if (trimmed === '') return [];

  /*
   * A joining word becomes a semicolon rather than a comma, because a comma
   * between two digits is not a cut. "בסופר ב-3/9 ו-50 בדלק" would otherwise turn
   * into "...3/9,50..." and stop being a cut at all, quietly merging two updates
   * back into one.
   */
  let marked = trimmed;
  for (const joiner of JOINERS) marked = marked.split(joiner).join(';');

  const parts = marked
    .split(PUNCTUATION)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length < 2) return [trimmed];

  // Every part must name its own sum, or this was one sentence with a comma.
  const everyPartHasAmount = parts.every((part) => sumOf(part) !== null);
  if (!everyPartHasAmount) return [trimmed];

  /*
   * And the parts must not all be reading the *same* sum. "שילמתי 120, בסופר
   * 120" is one payment described twice as far as this module is concerned, and
   * splitting it would double it. Distinctness is cheap insurance.
   */
  const sums = new Set(parts.map((part) => sumOf(part)));
  if (sums.size < parts.length) return [trimmed];

  return parts;
}
