import type { BusinessDate } from '@family-finance/contracts';

/**
 * Calendar arithmetic in the household's time zone.
 *
 * 02-FINANCIAL-RULES.md § מוסכמות: instants are stored UTC, business rules run in
 * Asia/Jerusalem. Those are two different questions and mixing them produces the
 * classic month-end bug — a charge made late on the 31st in Jerusalem landing in
 * the next month once it is read back as UTC.
 *
 * Two rules keep this correct:
 *
 *  1. Converting an instant to a business date is the only operation that knows
 *     about a time zone, and it asks Intl rather than doing offset arithmetic.
 *     Israel's DST transitions move, so a hard-coded offset is wrong twice a year.
 *  2. Once a date is a `YYYY-MM-DD` business date, all arithmetic happens on UTC
 *     midnight. UTC has no DST, so "add one day" is always exactly 24 hours and a
 *     forecast never gains or loses a day in March or October.
 */

export const HOUSEHOLD_TIME_ZONE = 'Asia/Jerusalem';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

export class DateError extends Error {}

function assertBusinessDate(date: string): BusinessDate {
  if (!DATE_PATTERN.test(date)) {
    throw new DateError(`expected a YYYY-MM-DD business date, got "${date}"`);
  }
  const utc = toUtcMidnight(date);
  // Rejects 2026-02-30, which matches the pattern but is not a day.
  if (fromUtcMidnight(utc) !== date) {
    throw new DateError(`"${date}" is not a real calendar date`);
  }
  return date;
}

function toUtcMidnight(date: BusinessDate): number {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  return Date.UTC(year, month - 1, day);
}

function fromUtcMidnight(ms: number): BusinessDate {
  return new Date(ms).toISOString().slice(0, 10);
}

const businessDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: HOUSEHOLD_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * The business date an instant falls on, in the household's time zone.
 *
 * `en-CA` formats as YYYY-MM-DD, which is the shape business dates are stored in.
 */
export function businessDateOf(instant: string, timeZone = HOUSEHOLD_TIME_ZONE): BusinessDate {
  const parsed = new Date(instant);
  if (Number.isNaN(parsed.getTime())) {
    throw new DateError(`not a valid instant: "${instant}"`);
  }
  const formatter =
    timeZone === HOUSEHOLD_TIME_ZONE
      ? businessDateFormatter
      : new Intl.DateTimeFormat('en-CA', {
          timeZone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        });
  return assertBusinessDate(formatter.format(parsed));
}

export function addDays(date: BusinessDate, days: number): BusinessDate {
  assertBusinessDate(date);
  if (!Number.isInteger(days)) throw new DateError(`days must be an integer, got ${days}`);
  return fromUtcMidnight(toUtcMidnight(date) + days * MS_PER_DAY);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: BusinessDate, to: BusinessDate): number {
  assertBusinessDate(from);
  assertBusinessDate(to);
  return (toUtcMidnight(to) - toUtcMidnight(from)) / MS_PER_DAY;
}

export function compareDates(a: BusinessDate, b: BusinessDate): number {
  assertBusinessDate(a);
  assertBusinessDate(b);
  return a < b ? -1 : a > b ? 1 : 0;
}

export function isOnOrBefore(a: BusinessDate, b: BusinessDate): boolean {
  return compareDates(a, b) <= 0;
}

export function isOnOrAfter(a: BusinessDate, b: BusinessDate): boolean {
  return compareDates(a, b) >= 0;
}

/**
 * Last day of the month containing `date`.
 *
 * Day 0 of the following month is the last day of this one, which handles 30- and
 * 31-day months and February in a leap year without a table.
 */
export function endOfMonth(date: BusinessDate): BusinessDate {
  assertBusinessDate(date);
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return fromUtcMidnight(Date.UTC(year, month, 0));
}

export function startOfMonth(date: BusinessDate): BusinessDate {
  assertBusinessDate(date);
  return `${date.slice(0, 7)}-01`;
}

/**
 * The day a monthly obligation falls due in the month of `reference`.
 *
 * A debt due on the 31st has no 31st in February. Clamping to the last day of the
 * month is the behaviour every lender applies, and it keeps the payment inside
 * the month it belongs to instead of silently moving it into the next one.
 */
export function dueDateInMonth(reference: BusinessDate, dayOfMonth: number): BusinessDate {
  assertBusinessDate(reference);
  if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
    throw new DateError(`day of month must be 1-31, got ${dayOfMonth}`);
  }
  const last = endOfMonth(reference);
  const lastDay = Number(last.slice(8, 10));
  const day = Math.min(dayOfMonth, lastDay);
  return `${reference.slice(0, 7)}-${String(day).padStart(2, '0')}`;
}

/** Every date from `from` to `to` inclusive. Empty when `to` precedes `from`. */
export function eachDay(from: BusinessDate, to: BusinessDate): BusinessDate[] {
  const span = daysBetween(from, to);
  if (span < 0) return [];
  const days: BusinessDate[] = [];
  for (let offset = 0; offset <= span; offset += 1) days.push(addDays(from, offset));
  return days;
}

export { assertBusinessDate };
