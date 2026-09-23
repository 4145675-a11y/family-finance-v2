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
const PUNCTUATION = /[,;+]/u;

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

  let marked = trimmed;
  for (const joiner of JOINERS) marked = marked.split(joiner).join(',');

  const parts = marked
    .split(PUNCTUATION)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length < 2) return [trimmed];

  // Every part must name its own sum, or this was one sentence with a comma.
  const everyPartHasAmount = parts.every((part) => readAmount(part) !== null);
  if (!everyPartHasAmount) return [trimmed];

  /*
   * And the parts must not all be reading the *same* sum. "שילמתי 120, בסופר
   * 120" is one payment described twice as far as this module is concerned, and
   * splitting it would double it. Distinctness is cheap insurance.
   */
  const sums = new Set(parts.map((part) => readAmount(part)?.amountMinor));
  if (sums.size < parts.length) return [trimmed];

  return parts;
}
