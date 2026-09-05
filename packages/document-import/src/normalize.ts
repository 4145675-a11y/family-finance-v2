/**
 * Turning what a document says into what the engine can hold.
 *
 * Two conversions live here, and both are places where a plausible-looking
 * shortcut produces a wrong number that nobody notices.
 *
 * Money. `Number.parseFloat('1234.56') * 100` is `123456.00000000001`, and the
 * error compounds across a statement. 02-FINANCIAL-RULES.md § מוסכמות makes minor
 * units the only representation, so the text is taken apart as digits — integer
 * part, fraction part — and assembled with integer arithmetic. No float ever
 * touches a shekel.
 *
 * Dates. `03/04/2026` is the third of April to an Israeli bank and the fourth of
 * March to an American one, and no amount of cleverness reads a single value
 * correctly. What can be read correctly is a *column*: if any row in it has a
 * first component above twelve, the whole column is day-first. So the order is
 * inferred once, from all the evidence, and a column that stays ambiguous says so
 * rather than guessing.
 */

/** Characters that carry no numeric meaning and appear in real exports. */
const NOISE = /[\s\u00a0\u2007\u202f\u200e\u200f\u2066-\u2069'`׳]/g;

/** Currency marks seen in Israeli statements. */
const CURRENCY_MARKS = /(₪|ש"ח|ש״ח|שח|NIS|ILS|\$|€|£)/gi;

export interface ParsedAmount {
  /** Exact minor units. Never derived through a floating-point multiplication. */
  readonly amountMinor: number;
  /** True when the text carried a minus sign, parentheses or a trailing dash. */
  readonly negative: boolean;
  /** True when the separator convention could not be decided with confidence. */
  readonly ambiguousSeparator: boolean;
  /** True when the text had more precision than agorot and was rounded. */
  readonly rounded: boolean;
}

/**
 * Reads a monetary figure written in any of the ways a statement writes them.
 *
 * Handles `1,234.56`, `1.234,56`, `(1,234.56)`, `1,234.56-`, `−1,234`, `₪1,234`
 * and `1 234,56`. Returns null when the text is not a number at all, which is how
 * a header cell or a footer label is told apart from a value.
 */
export function parseAmount(text: string): ParsedAmount | null {
  const withoutCurrency = text.replace(CURRENCY_MARKS, '');
  let working = withoutCurrency.replace(NOISE, '');

  if (working.length === 0) return null;

  let negative = false;

  // Accounting notation: a negative amount in parentheses.
  if (/^\(.*\)$/.test(working)) {
    negative = true;
    working = working.slice(1, -1);
  }

  // A leading or trailing sign. Israeli exports frequently put it last.
  if (/^[-−–—+]/.test(working)) {
    negative = negative || working[0] !== '+';
    working = working.slice(1);
  } else if (/[-−–—]$/.test(working)) {
    negative = true;
    working = working.slice(0, -1);
  }

  if (working.length === 0) return null;
  if (!/^[0-9.,]+$/.test(working)) return null;
  if (!/[0-9]/.test(working)) return null;

  const lastComma = working.lastIndexOf(',');
  const lastDot = working.lastIndexOf('.');
  const commaCount = (working.match(/,/g) ?? []).length;
  const dotCount = (working.match(/\./g) ?? []).length;

  let decimalAt = -1;
  let ambiguousSeparator = false;

  if (lastComma !== -1 && lastDot !== -1) {
    // Both present: whichever comes last is the decimal point.
    decimalAt = Math.max(lastComma, lastDot);
  } else if (lastComma !== -1 || lastDot !== -1) {
    const position = lastComma !== -1 ? lastComma : lastDot;
    const separator = lastComma !== -1 ? ',' : '.';
    const occurrences = lastComma !== -1 ? commaCount : dotCount;
    const trailingDigits = working.length - position - 1;

    if (occurrences > 1) {
      // Repeated: it can only be grouping.
      decimalAt = -1;
    } else if (trailingDigits === 3) {
      // `1,234` and `1.234` both read as one thousand two hundred and thirty-four
      // in a financial export, where amounts are written to agorot when they have
      // them. It is still a genuine ambiguity, and it is reported as one.
      //
      // Except when nothing precedes the separator but a zero: `0.005` is not a
      // grouped number, because nobody writes five as `0,005`. There the dot is
      // a decimal point and the extra digit is precision to be rounded.
      const leading = working.slice(0, position).replace(/[^0-9]/g, '');
      if (leading === '' || /^0+$/.test(leading)) {
        decimalAt = position;
      } else {
        decimalAt = -1;
        ambiguousSeparator = separator === '.';
      }
    } else if (trailingDigits >= 1 && trailingDigits <= 2) {
      decimalAt = position;
    } else if (trailingDigits === 0) {
      // A trailing separator with nothing after it carries no value.
      decimalAt = -1;
    } else {
      decimalAt = position;
    }
  }

  const digitsOnly = (value: string) => value.replace(/[^0-9]/g, '');

  const integerText = digitsOnly(decimalAt === -1 ? working : working.slice(0, decimalAt));
  const fractionText = decimalAt === -1 ? '' : digitsOnly(working.slice(decimalAt + 1));

  if (integerText.length === 0 && fractionText.length === 0) return null;
  if (integerText.length > 15) return null;

  let minor: bigint;
  let rounded = false;

  if (fractionText.length <= 2) {
    const padded = fractionText.padEnd(2, '0');
    minor = BigInt(integerText === '' ? '0' : integerText) * 100n + BigInt(padded);
  } else {
    // More precision than agorot: round half-up at the agora, per
    // 02-FINANCIAL-RULES.md § מוסכמות, using integers so the rule is exact.
    rounded = true;
    const kept = fractionText.slice(0, 2);
    const nextDigit = Number(fractionText[2] ?? '0');
    minor = BigInt(integerText === '' ? '0' : integerText) * 100n + BigInt(kept);
    if (nextDigit >= 5) minor += 1n;
  }

  if (minor > 1_000_000_000_000_000n) return null;

  return {
    amountMinor: Number(minor),
    negative,
    ambiguousSeparator,
    rounded,
  };
}

export interface DateCandidate {
  /** The first numeric component as written. */
  readonly first: number;
  readonly second: number;
  readonly year: number;
  /** True when the text was already unambiguous (ISO, or a named month). */
  readonly resolved: string | null;
}

const HEBREW_MONTHS: Readonly<Record<string, number>> = {
  ינואר: 1,
  פברואר: 2,
  מרץ: 3,
  מרס: 3,
  אפריל: 4,
  מאי: 5,
  יוני: 6,
  יולי: 7,
  אוגוסט: 8,
  ספטמבר: 9,
  אוקטובר: 10,
  נובמבר: 11,
  דצמבר: 12,
};

const ENGLISH_MONTHS: Readonly<Record<string, number>> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function isRealDate(year: number, month: number, day: number): boolean {
  if (year < 1900 || year > 2200) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

function iso(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Two-digit years: `26` is 2026, `98` is 1998. */
function expandYear(year: number): number {
  if (year >= 1000) return year;
  return year <= 69 ? 2000 + year : 1900 + year;
}

/**
 * Reads a date as far as it can be read from one value alone.
 *
 * `resolved` is set only when the text left no room for doubt. Everything else
 * comes back as two components plus a year, for the column-level resolver.
 */
export function parseDateCandidate(text: string): DateCandidate | null {
  const cleaned = text.replace(/[\u200e\u200f\u2066-\u2069]/g, '').trim();
  if (cleaned.length === 0) return null;

  const isoMatch = cleaned.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    if (!isRealDate(year, month, day)) return null;
    return { first: day, second: month, year, resolved: iso(year, month, day) };
  }

  const named = cleaned.match(
    /^(\d{1,2})\s*(?:ב|in\s)?\s*([\u0590-\u05ff]+|[A-Za-z]{3,9})\.?,?\s*(\d{2,4})?/,
  );
  if (named) {
    const day = Number(named[1]);
    const word = (named[2] ?? '').toLowerCase();
    const month =
      HEBREW_MONTHS[named[2] ?? ''] ?? ENGLISH_MONTHS[word.slice(0, 3)] ?? undefined;
    if (month !== undefined) {
      const year =
        named[3] === undefined ? new Date().getUTCFullYear() : expandYear(Number(named[3]));
      if (!isRealDate(year, month, day)) return null;
      return { first: day, second: month, year, resolved: iso(year, month, day) };
    }
  }

  const numeric = cleaned.match(/^(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2,4}))?/);
  if (numeric) {
    const first = Number(numeric[1]);
    const second = Number(numeric[2]);
    const year =
      numeric[3] === undefined ? new Date().getUTCFullYear() : expandYear(Number(numeric[3]));
    if (first < 1 || second < 1) return null;
    if (first > 31 || second > 31) return null;
    if (first > 12 && second > 12) return null;

    if (first > 12) {
      if (!isRealDate(year, second, first)) return null;
      return { first, second, year, resolved: iso(year, second, first) };
    }
    if (second > 12) {
      if (!isRealDate(year, first, second)) return null;
      return { first, second, year, resolved: iso(year, first, second) };
    }
    return { first, second, year, resolved: null };
  }

  return null;
}

export type DateOrder = 'day_first' | 'month_first';

export interface DateOrderDecision {
  readonly order: DateOrder;
  /** False when every value in the column could be read either way. */
  readonly certain: boolean;
}

/**
 * Decides the convention for a whole column.
 *
 * Any single value with a first component above twelve settles it. Where nothing
 * settles it, the default is day-first — the Israeli convention, which is what
 * this product's documents use — and `certain` is false so the review screen can
 * ask rather than assume.
 */
export function inferDateOrder(values: readonly string[]): DateOrderDecision {
  let dayFirstEvidence = 0;
  let monthFirstEvidence = 0;

  for (const value of values) {
    const candidate = parseDateCandidate(value);
    if (candidate === null) continue;
    if (candidate.first > 12) dayFirstEvidence += 1;
    else if (candidate.second > 12) monthFirstEvidence += 1;
  }

  if (dayFirstEvidence > monthFirstEvidence) return { order: 'day_first', certain: true };
  if (monthFirstEvidence > dayFirstEvidence) return { order: 'month_first', certain: true };
  return { order: 'day_first', certain: dayFirstEvidence > 0 };
}

/** Applies a decided column order to one candidate. */
export function resolveDate(candidate: DateCandidate, order: DateOrder): string | null {
  if (candidate.resolved !== null) return candidate.resolved;

  const day = order === 'day_first' ? candidate.first : candidate.second;
  const month = order === 'day_first' ? candidate.second : candidate.first;
  if (!isRealDate(candidate.year, month, day)) return null;
  return iso(candidate.year, month, day);
}

/** Convenience for the common path: parse and resolve in one step. */
export function parseDate(text: string, order: DateOrder = 'day_first'): string | null {
  const candidate = parseDateCandidate(text);
  return candidate === null ? null : resolveDate(candidate, order);
}

/**
 * Collapses the whitespace and direction marks a PDF or a spreadsheet leaves in a
 * description, without touching the letters themselves.
 */
export function cleanDescription(text: string): string {
  return text
    .replace(/[\u200e\u200f\u2066-\u2069\u00ad]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}
