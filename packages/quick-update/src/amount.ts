/**
 * The sum a Hebrew sentence names, in minor units.
 *
 * Two ways a family writes an amount, and both have to work:
 *
 *   * digits — `120`, `120.50`, `1,200`, `‎1200₪`;
 *   * words — `מאה עשרים`, `אלף`, `חמש מאות`, `שלוש מאות וחמישים`.
 *
 * What it never does is produce a number the sentence did not contain. A
 * sentence with no amount returns `null`, and the screen asks. A default of zero
 * would be a figure nobody said, written into a ledger.
 *
 * The result is an integer count of agorot, because that is the only
 * representation money has anywhere in this product (02-FINANCIAL-RULES.md).
 */

/** The units, in the forms a person actually says or writes. */
const ONES: ReadonlyMap<string, number> = new Map([
  ['אפס', 0],
  ['אחד', 1],
  ['אחת', 1],
  ['שתיים', 2],
  ['שניים', 2],
  ['שתי', 2],
  ['שני', 2],
  ['שלוש', 3],
  ['שלושה', 3],
  ['ארבע', 4],
  ['ארבעה', 4],
  ['חמש', 5],
  ['חמישה', 5],
  ['שש', 6],
  ['שישה', 6],
  ['שבע', 7],
  ['שבעה', 7],
  ['שמונה', 8],
  ['תשע', 9],
  ['תשעה', 9],
  ['עשר', 10],
  ['עשרה', 10],
]);

const TEENS: ReadonlyMap<string, number> = new Map([
  ['אחד עשר', 11],
  ['אחת עשרה', 11],
  ['שנים עשר', 12],
  ['שתים עשרה', 12],
  ['שלושה עשר', 13],
  ['שלוש עשרה', 13],
  ['ארבעה עשר', 14],
  ['ארבע עשרה', 14],
  ['חמישה עשר', 15],
  ['חמש עשרה', 15],
  ['שישה עשר', 16],
  ['שש עשרה', 16],
  ['שבעה עשר', 17],
  ['שבע עשרה', 17],
  ['שמונה עשר', 18],
  ['שמונה עשרה', 18],
  ['תשעה עשר', 19],
  ['תשע עשרה', 19],
]);

const TENS: ReadonlyMap<string, number> = new Map([
  ['עשרים', 20],
  ['שלושים', 30],
  ['ארבעים', 40],
  ['חמישים', 50],
  ['שישים', 60],
  ['שבעים', 70],
  ['שמונים', 80],
  ['תשעים', 90],
]);

const HUNDRED = new Set(['מאה', 'מאות']);
const THOUSAND = new Set(['אלף', 'אלפים']);

/** The words that mean "shekels" and carry no value of their own. */
export const CURRENCY_WORDS: readonly string[] = [
  'שקל',
  'שקלים',
  'ש"ח',
  'שח',
  '₪',
  'שקלים חדשים',
];

export interface AmountReading {
  /** The sum, in agorot. Always a non-negative integer. */
  readonly amountMinor: number;
  /** The exact text the sum was read from, so it can be removed from the rest. */
  readonly matchedText: string;
  readonly source: 'digits' | 'words';
}

/**
 * Digits, with an optional thousands separator and an optional two decimals.
 *
 * Anchored on a word boundary at both ends so that the `3` of "ב-3 לחודש" is not
 * read as three shekels when it is a day of the month. The caller removes a date
 * before asking for an amount, which is what makes that safe.
 */
const DIGITS = /(?<![\d.,])(\d{1,3}(?:,\d{3})+|\d+)(?:[.](\d{1,2}))?(?![\d.,])/u;

function fromDigits(text: string): AmountReading | null {
  const match = DIGITS.exec(text);
  if (match === null) return null;
  const whole = (match[1] ?? '').replace(/,/g, '');
  const fraction = (match[2] ?? '').padEnd(2, '0');
  const major = Number.parseInt(whole, 10);
  if (!Number.isFinite(major)) return null;
  const minor = major * 100 + Number.parseInt(fraction === '' ? '0' : fraction, 10);
  return { amountMinor: minor, matchedText: match[0], source: 'digits' };
}

/**
 * A run of number words, read left to right the way Hebrew says them.
 *
 * "שלוש מאות וחמישים" is 3 → ×100 → 350. "אלף מאתיים" is 1000 + 200. The
 * accumulator holds the part being built and `total` the parts already closed by
 * a multiplier, which is the standard way to read this and does not need a
 * grammar.
 *
 * Deliberately bounded at 9,999. Beyond that a person writes digits, and a
 * words-only reading of a large sum is exactly where a silent misreading would
 * cost the most.
 */
const WORD_LIMIT = 9_999;

function fromWords(text: string): AmountReading | null {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  let best: AmountReading | null = null;

  for (let start = 0; start < words.length; start += 1) {
    let total = 0;
    let current = 0;
    let seen = false;
    let end = start;

    for (let index = start; index < words.length; index += 1) {
      const word = stripConjunction(words[index] ?? '');
      const pair = `${word} ${stripConjunction(words[index + 1] ?? '')}`.trim();

      const teen = TEENS.get(pair);
      if (teen !== undefined) {
        current += teen;
        seen = true;
        index += 1;
        end = index + 1;
        continue;
      }
      const ten = TENS.get(word);
      if (ten !== undefined) {
        current += ten;
        seen = true;
        end = index + 1;
        continue;
      }
      const one = ONES.get(word);
      if (one !== undefined) {
        current += one;
        seen = true;
        end = index + 1;
        continue;
      }
      if (word === 'מאתיים') {
        total += 200;
        current = 0;
        seen = true;
        end = index + 1;
        continue;
      }
      if (word === 'אלפיים') {
        total += 2_000;
        current = 0;
        seen = true;
        end = index + 1;
        continue;
      }
      if (HUNDRED.has(word)) {
        total += (current === 0 ? 1 : current) * 100;
        current = 0;
        seen = true;
        end = index + 1;
        continue;
      }
      if (THOUSAND.has(word)) {
        total = (total + (current === 0 ? 1 : current)) * 1_000;
        current = 0;
        seen = true;
        end = index + 1;
        continue;
      }
      break;
    }

    const value = total + current;
    if (!seen || value <= 0 || value > WORD_LIMIT) continue;
    const matchedText = words.slice(start, end).join(' ');
    if (best === null || value > best.amountMinor) {
      best = { amountMinor: value * 100, matchedText, source: 'words' };
    }
  }

  return best;
}

/** "ו" joined to a number word: "וחמישים" is still fifty. */
function stripConjunction(word: string): string {
  if (word.length > 3 && word.startsWith('ו')) {
    const without = word.slice(1);
    if (
      ONES.has(without) ||
      TENS.has(without) ||
      HUNDRED.has(without) ||
      THOUSAND.has(without)
    ) {
      return without;
    }
    if (without === 'מאתיים' || without === 'אלפיים') return without;
  }
  return word;
}

/**
 * The amount in a sentence, digits first.
 *
 * Digits win when both are present, because a sentence carrying both — "שילמתי
 * 120 שקל, שלוש פעמים" — means the digits and the words are counting something
 * else.
 */
export function readAmount(text: string): AmountReading | null {
  return fromDigits(text) ?? fromWords(text);
}
