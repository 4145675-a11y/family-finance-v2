import { parseDueDateText, type DateReviewReason } from '@family-finance/hebrew-calendar';
import type { BusinessDate } from '@family-finance/contracts';

/**
 * When a sentence says something happened.
 *
 * Three answers, and the third one matters most:
 *
 *   * `on` — the sentence named a day and it reads.
 *   * `today` — the sentence named no day at all. The screen says so in words
 *     ("נרשם להיום") so the assumption is visible and changeable.
 *   * `unclear` — the sentence named a day and it does **not** read: hedged
 *     ("בערך ג׳ טבת"), impossible (ל׳ כסלו in a 29-day Kislev), or ambiguous
 *     (Adar in a leap year). A hedged date is not a date (ADR-0035), and it
 *     must not silently become today — "today" would be a figure nobody said
 *     attached to a day nobody meant.
 *
 * `today` is passed in rather than read. The module stays pure, so the same
 * sentence gives the same answer in a test, in a browser and on a server.
 */
export type WhenReading =
  | { readonly outcome: 'on'; readonly date: BusinessDate; readonly matchedText: string }
  | { readonly outcome: 'today'; readonly date: BusinessDate }
  | {
      readonly outcome: 'unclear';
      readonly reason: DateReviewReason;
      readonly matchedText: string;
    };

/** The relative days a family actually says, and how far back each one is. */
const RELATIVE: ReadonlyMap<string, number> = new Map([
  ['היום', 0],
  ['הערב', 0],
  ['הבוקר', 0],
  ['אתמול', 1],
  ['שלשום', 2],
]);

function shift(today: BusinessDate, days: number): BusinessDate {
  const [year, month, day] = today.split('-').map((part) => Number.parseInt(part, 10));
  const at = Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1) - days * 86_400_000;
  return new Date(at).toISOString().slice(0, 10) as BusinessDate;
}

/**
 * A Gregorian day written the way a form writes it: 03/09/2026, 3.9.26, 3/9.
 *
 * Day-first, because that is how dates are written in Israel. A year is
 * optional; without one the year of `today` is used, which is right for
 * "שילמתי ב-3/9" said in September and is why the screen still shows the
 * resolved date for the person to check.
 */
const NUMERIC = /(?<![\d/.])(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?(?![\d/.])/u;

function fromNumeric(text: string, today: BusinessDate): WhenReading | null {
  const match = NUMERIC.exec(text);
  if (match === null) return null;
  const day = Number.parseInt(match[1] ?? '', 10);
  const month = Number.parseInt(match[2] ?? '', 10);
  const rawYear = match[3];
  const thisYear = Number.parseInt(today.slice(0, 4), 10);
  const year =
    rawYear === undefined
      ? thisYear
      : rawYear.length <= 2
        ? 2000 + Number.parseInt(rawYear, 10)
        : Number.parseInt(rawYear, 10);

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return { outcome: 'unclear', reason: 'unreadable_date', matchedText: match[0] };
  }
  // A day the month does not have is not a date, and must not roll over into the
  // next month the way `new Date` would.
  const at = new Date(Date.UTC(year, month - 1, day));
  if (at.getUTCMonth() !== month - 1 || at.getUTCDate() !== day) {
    return { outcome: 'unclear', reason: 'day_not_in_month', matchedText: match[0] };
  }
  return {
    outcome: 'on',
    date: at.toISOString().slice(0, 10) as BusinessDate,
    matchedText: match[0],
  };
}

/**
 * The day a sentence names.
 *
 * Order matters: the relative words first because they are unambiguous, then a
 * numeric date, then the Hebrew calendar — which brings its own refusal layer
 * and is the only one of the three that can come back "I read a date and I am
 * not prepared to call it one".
 */
export function readWhen(text: string, today: BusinessDate): WhenReading {
  /*
   * Whole words, compared directly rather than through a built pattern. "היום"
   * has to be the word and not the tail of another one, and a regular expression
   * assembled from a string is one escaping mistake away from matching a bare
   * letter — which would put every sentence on the wrong day at once.
   */
  const words = text.split(/[\s.,;:!?]+/u).filter((word) => word.length > 0);
  for (const [word, back] of RELATIVE) {
    if (words.includes(word)) {
      return { outcome: 'on', date: shift(today, back), matchedText: word };
    }
  }

  const numeric = fromNumeric(text, today);
  if (numeric !== null) return numeric;

  const hebrew = parseDueDateText(text);
  if (hebrew.outcome === 'resolved' && hebrew.source === 'hebrew') {
    return {
      outcome: 'on',
      date: hebrew.gregorian,
      matchedText: hebrew.originalText.replace(hebrew.note ?? '', '').trim(),
    };
  }
  if (hebrew.outcome === 'needs_review') {
    return { outcome: 'unclear', reason: hebrew.reason, matchedText: hebrew.originalText };
  }

  return { outcome: 'today', date: today };
}
