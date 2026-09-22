import type { BusinessDate } from '@family-finance/contracts';
import { HDate, gematriya, months } from '@hebcal/core';

/**
 * The Hebrew calendar, as a first-class date system beside the Gregorian one.
 *
 * Two rules from 02-FINANCIAL-RULES.md § מוסכמות carry over unchanged: business
 * dates are civil days in Asia/Jerusalem, and a date that cannot be read is never
 * guessed. Everything here exists to keep those two true across two calendars.
 *
 * Why a wrapper rather than calls to `@hebcal/core` at the call sites: the library
 * is correct about the calendar and deliberately permissive about input, and that
 * combination is dangerous for a due date. Two behaviours were measured (not
 * assumed) against 6.9.3 and are contained here:
 *
 *   1. `new HDate(30, KISLEV, 5784)` does not throw. Kislev has 29 days that year,
 *      and the constructor silently returns 1 Tevet — a different day, in a
 *      different month, with no signal. A reminder built on that would fire on the
 *      wrong date and nothing would say so.
 *   2. In a year with one Adar, "אדר", "אדר א׳" and "אדר ב׳" all resolve to the
 *      same month. The library is right that they name the same days; it is still
 *      an input the family did not mean to be interpreted for them.
 *
 * So every conversion in this file validates first and refuses rather than
 * rounds. `HebrewDateError` is the only way a bad date leaves this module.
 */

/** The household's civil day boundary. Matches finance-engine's HOUSEHOLD_TIME_ZONE. */
export const HOUSEHOLD_TIME_ZONE = 'Asia/Jerusalem';

/** Hebrew years are written without the thousands digit: תשפ״ז is 5787. */
const HEBREW_MILLENNIUM = 5_000;

export class HebrewDateError extends Error {}

/**
 * A Hebrew date, fully resolved.
 *
 * `month` is the `@hebcal/core` month number (NISAN=1 … ADAR_I=12, ADAR_II=13).
 * A resolved date never carries an unspecified Adar: by the time a value has this
 * shape, the ambiguity has been settled or refused.
 */
export interface HebrewDate {
  readonly day: number;
  readonly month: number;
  readonly year: number;
}

/** Combining marks. `@hebcal/core` renders month names pointed; storage and UI want them plain. */
const NIKUD = /[֑-ׇ]/g;

export function stripNikud(text: string): string {
  return text.normalize('NFD').replace(NIKUD, '').normalize('NFC');
}

/** True when the year has thirteen months, and therefore two Adars. */
export function isHebrewLeapYear(year: number): boolean {
  return HDate.isLeapYear(year);
}

/** How many days the month actually has in that year. Cheshvan and Kislev vary. */
export function daysInHebrewMonth(month: number, year: number): number {
  return HDate.daysInMonth(month, year);
}

/**
 * Every spelling of a Hebrew month this application accepts, matched exactly.
 *
 * Deliberately not `HDate.monthFromName`. That function matches loosely, and on
 * a debt file the cost is silent nonsense: measured against 6.9.3 it answers
 * Cheshvan for "חוב", Tishrei for "תשלום", Nisan for "בנק" and Kislev for
 * "כשאפשר". Those words are the ordinary vocabulary of the documents this
 * importer reads, so a fuzzy match would invent due dates out of sentences.
 *
 * An exact table costs one line per spelling and cannot do that.
 */
const MONTH_NAMES: ReadonlyMap<string, number> = new Map([
  ['תשרי', months.TISHREI],
  ['חשון', months.CHESHVAN],
  ['חשוון', months.CHESHVAN],
  ['מרחשון', months.CHESHVAN],
  ['מרחשוון', months.CHESHVAN],
  ['כסלו', months.KISLEV],
  ['כיסלו', months.KISLEV],
  ['טבת', months.TEVET],
  ['שבט', months.SHVAT],
  ['אדר', months.ADAR_I],
  ['ניסן', months.NISAN],
  ['אייר', months.IYYAR],
  ['איר', months.IYYAR],
  ['סיון', months.SIVAN],
  ['סיוון', months.SIVAN],
  ['תמוז', months.TAMUZ],
  ['אב', months.AV],
  ['מנחם אב', months.AV],
  ['אלול', months.ELUL],
]);

/**
 * The month number a name refers to in a given year, or null when the name does
 * not name a month.
 *
 * A bare "אדר" answers the single Adar, which is month 12 in a plain year. Which
 * Adar a bare name means in a *leap* year is not decided here: `parseDueDateText`
 * refuses that input rather than choosing one.
 */
export function hebrewMonthNumber(name: string, year: number): number | null {
  const cleaned = stripNikud(name)
    .replace(/[׳״'"]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length === 0) return null;

  const qualifiedAdar = /^אדר\s+(א|ב|ראשון|שני)$/u.exec(cleaned);
  if (qualifiedAdar !== null) {
    // A plain year has one Adar, whatever the writer called it. Whether naming
    // Adar I or Adar II in such a year is acceptable at all is a question for
    // the parser, which can refuse; this function only reports the month.
    if (!isHebrewLeapYear(year)) return months.ADAR_I;
    const which = qualifiedAdar[1];
    return which === 'א' || which === 'ראשון' ? months.ADAR_I : months.ADAR_II;
  }

  return MONTH_NAMES.get(cleaned) ?? null;
}

/** Rejects a date the Hebrew calendar does not contain, instead of moving it. */
export function assertHebrewDate(date: HebrewDate): HebrewDate {
  const { day, month, year } = date;
  if (!Number.isInteger(year) || year < 1 || year > 9_999) {
    throw new HebrewDateError(`hebrew year out of range: ${year}`);
  }
  const monthCount = HDate.monthsInYear(year);
  if (!Number.isInteger(month) || month < 1 || month > 13) {
    throw new HebrewDateError(`hebrew month out of range: ${month}`);
  }
  if (month === months.ADAR_II && monthCount === 12) {
    throw new HebrewDateError(`year ${year} has one Adar, so Adar II does not exist in it`);
  }
  const maxDay = daysInHebrewMonth(month, year);
  if (!Number.isInteger(day) || day < 1 || day > maxDay) {
    // The measured silent-rollover case. Refusing is the whole point.
    throw new HebrewDateError(
      `day ${day} does not exist in month ${month} of year ${year}, which has ${maxDay} days`,
    );
  }
  return date;
}

function toBusinessDate(date: Date): BusinessDate {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** The civil day a Hebrew date falls on. Throws rather than move an impossible date. */
export function hebrewToGregorian(date: HebrewDate): BusinessDate {
  const valid = assertHebrewDate(date);
  return toBusinessDate(new HDate(valid.day, valid.month, valid.year).greg());
}

/** The Hebrew date a civil day falls on. */
export function gregorianToHebrew(date: BusinessDate): HebrewDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match === null) {
    throw new HebrewDateError(`expected a YYYY-MM-DD business date, got "${date}"`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const civil = new Date(year, month - 1, day);
  if (
    civil.getFullYear() !== year ||
    civil.getMonth() !== month - 1 ||
    civil.getDate() !== day
  ) {
    throw new HebrewDateError(`"${date}" is not a real calendar date`);
  }
  const hebrew = new HDate(civil);
  return { day: hebrew.getDate(), month: hebrew.getMonth(), year: hebrew.getFullYear() };
}

/** The month's Hebrew name, unpointed: "טבת", "אדר א׳". */
export function hebrewMonthName(month: number, year: number): string {
  const rendered = stripNikud(new HDate(1, month, year).render('he'));
  // render('he') is "1 טבת, 5786"; the name is what sits between them.
  const name = rendered
    .replace(/^\d+\s+/, '')
    .replace(/,.*$/, '')
    .trim();
  return name;
}

/** "ז׳ טבת תשפ״ז" — the form the family writes and reads. */
export function formatHebrewDate(date: HebrewDate): string {
  const valid = assertHebrewDate(date);
  const day = gematriya(valid.day);
  const month = hebrewMonthName(valid.month, valid.year);
  const year = gematriya(valid.year % HEBREW_MILLENNIUM);
  return `${day} ${month} ${year}`;
}

/** "17/12/2026" — the Gregorian form used throughout the Israeli UI. */
export function formatGregorian(date: BusinessDate): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match === null) throw new HebrewDateError(`expected a business date, got "${date}"`);
  return `${match[3]}/${match[2]}/${match[1]}`;
}

const israelDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: HOUSEHOLD_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Today's civil day in Israel.
 *
 * The Hebrew day changes at nightfall rather than at midnight. This function
 * answers the civil question — which calendar day it is in Jerusalem — because
 * that is what a due date, a reminder window and a ledger entry are dated by.
 */
export function todayInIsrael(now: Date = new Date()): BusinessDate {
  return israelDateFormatter.format(now) as BusinessDate;
}
