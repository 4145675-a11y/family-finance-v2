import type { BusinessDate } from '@family-finance/contracts';
import { gematriyaStrToNum, months } from '@hebcal/core';

import {
  HebrewDateError,
  assertHebrewDate,
  daysInHebrewMonth,
  gregorianToHebrew,
  hebrewMonthNumber,
  hebrewToGregorian,
  isHebrewLeapYear,
  stripNikud,
  type HebrewDate,
} from './calendar';

/**
 * Reading a due date out of a cell a person wrote.
 *
 * The cell is free text. It may hold a Hebrew date, a Gregorian date, a date with
 * a sentence around it ("לתשלום ד׳ שבט תשפ״ז"), a note with no date at all, or a
 * date the writer was not sure about ("בערך כ׳ אדר").
 *
 * The rule that governs all of it: **a date that is not certain is not a date.**
 * 02-FINANCIAL-RULES.md forbids treating an uncertain value as safe, so anything
 * hedged, impossible or unreadable comes back as `needs_review` with a reason,
 * and never as a resolved date. The reviewer decides; this module does not guess.
 *
 * Whatever is not part of the date is returned as `note`, so the sentence the
 * family wrote survives the import instead of being thrown away.
 */

/** Why a cell that looked like a date was not turned into one. */
export type DateReviewReason =
  /** "בערך", "משוער", "around" — the writer hedged, so the value is not a date. */
  | 'uncertainty_marker'
  /** A leap year has two Adars and the cell named neither. */
  | 'ambiguous_adar'
  /** Adar I or Adar II named in a year that has a single Adar. */
  | 'adar_in_non_leap_year'
  /** e.g. ל׳ כסלו in a year whose Kislev has 29 days. */
  | 'day_not_in_month'
  /** A month name and something around it, but no day or year that reads. */
  | 'unreadable_date';

export type DateParseResult =
  | {
      readonly outcome: 'resolved';
      readonly source: 'hebrew' | 'gregorian';
      readonly hebrew: HebrewDate;
      readonly gregorian: BusinessDate;
      readonly originalText: string;
      readonly note: string | null;
    }
  | {
      readonly outcome: 'needs_review';
      readonly reason: DateReviewReason;
      readonly originalText: string;
      readonly note: string | null;
    }
  | {
      readonly outcome: 'no_date';
      readonly originalText: string;
      readonly note: string | null;
    };

/**
 * Words that turn a date into an estimate.
 *
 * Their presence is decisive: a hedged date is sent to review even when the rest
 * of the cell parses perfectly, because the number would otherwise drive a
 * reminder the family never committed to.
 */
const UNCERTAINTY_MARKERS: readonly string[] = [
  'בערך',
  'בסביבות',
  'משוער',
  'משוערת',
  'אולי',
  'לא בטוח',
  'להעריך',
  'around',
  'approx',
  'approximately',
  'estimated',
  'estimate',
  'circa',
  'tbd',
];

const HEBREW_LETTERS = /^[א-ת]+$/;
const GERESH_CLASS = /[׳‘’']/g;
const GERSHAYIM_CLASS = /[״“”"]/g;
const MARKS = /[׳״]/g;

/** Normalises the several apostrophes and quotation marks Hebrew dates are typed with. */
function normaliseMarks(text: string): string {
  return text.replace(GERESH_CLASS, '׳').replace(GERSHAYIM_CLASS, '״');
}

function lettersOnly(token: string): string {
  return token.replace(MARKS, '');
}

/** A Hebrew numeral token such as ז׳, ט״ו or תשפ״ז, or null when it is a word. */
function gematriaValue(token: string): number | null {
  const bare = lettersOnly(token);
  if (bare.length === 0 || !HEBREW_LETTERS.test(bare)) return null;
  try {
    const value = gematriyaStrToNum(bare);
    return typeof value === 'number' && value > 0 ? value : null;
  } catch {
    return null;
  }
}

const GREGORIAN = /(\d{1,2})[./-](\d{1,2})[./-](\d{4})/;

function joinNote(parts: readonly string[]): string | null {
  const note = parts.join(' ').replace(/\s+/g, ' ').trim();
  return note.length === 0 ? null : note;
}

function hasUncertaintyMarker(text: string): boolean {
  const haystack = text.toLowerCase();
  return UNCERTAINTY_MARKERS.some((marker) => haystack.includes(marker.toLowerCase()));
}

/**
 * Reads a cell into a date, a review reason, or nothing.
 *
 * @param text the cell exactly as it was written; it is echoed back as `originalText`
 */
export function parseDueDateText(text: string): DateParseResult {
  const originalText = text;
  const cleaned = normaliseMarks(stripNikud(text)).replace(/\s+/g, ' ').trim();

  if (cleaned.length === 0) {
    return { outcome: 'no_date', originalText, note: null };
  }

  const hedged = hasUncertaintyMarker(cleaned);

  const gregorianMatch = GREGORIAN.exec(cleaned);
  if (gregorianMatch !== null) {
    const note = joinNote([cleaned.replace(gregorianMatch[0], ' ')]);
    if (hedged) {
      return { outcome: 'needs_review', reason: 'uncertainty_marker', originalText, note };
    }
    const day = Number(gregorianMatch[1]);
    const month = Number(gregorianMatch[2]);
    const year = Number(gregorianMatch[3]);
    const candidate = new Date(year, month - 1, day);
    if (
      candidate.getFullYear() !== year ||
      candidate.getMonth() !== month - 1 ||
      candidate.getDate() !== day
    ) {
      return { outcome: 'needs_review', reason: 'unreadable_date', originalText, note };
    }
    const gregorian =
      `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` as BusinessDate;
    return {
      outcome: 'resolved',
      source: 'gregorian',
      hebrew: gregorianToHebrew(gregorian),
      gregorian,
      originalText,
      note,
    };
  }

  return parseHebrew(cleaned, originalText, hedged);
}

interface MonthHit {
  readonly startIndex: number;
  readonly endIndex: number;
  readonly name: string;
  /** True when the text said "אדר" without saying which one. */
  readonly adarUnspecified: boolean;
  /** Adar I or Adar II named explicitly. */
  readonly adarQualified: boolean;
}

/** Finds the month name, including the two-token forms "אדר א׳" and "אדר ב׳". */
function findMonth(tokens: readonly string[]): MonthHit | null {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined) continue;
    const bare = lettersOnly(token);
    if (bare.length < 2) continue;

    if (bare === 'אדר') {
      const next = tokens[index + 1];
      if (next !== undefined) {
        const qualifier = lettersOnly(next);
        if (qualifier === 'א' || qualifier === 'ב') {
          return {
            startIndex: index,
            endIndex: index + 1,
            name: `אדר ${qualifier}`,
            adarUnspecified: false,
            adarQualified: true,
          };
        }
      }
      return {
        startIndex: index,
        endIndex: index,
        name: 'אדר',
        adarUnspecified: true,
        adarQualified: false,
      };
    }

    // Any other month name the library recognises, checked in a year that has
    // twelve months so that no Adar special case can leak in here.
    if (hebrewMonthNumber(bare, 5_786) !== null) {
      return {
        startIndex: index,
        endIndex: index,
        name: bare,
        adarUnspecified: false,
        adarQualified: false,
      };
    }
  }
  return null;
}

function parseHebrew(cleaned: string, originalText: string, hedged: boolean): DateParseResult {
  const tokens = cleaned.split(' ').filter((token) => token.length > 0);
  const month = findMonth(tokens);
  if (month === null) {
    // No month name: the cell is a note, not a date.
    return { outcome: 'no_date', originalText, note: joinNote(tokens) };
  }

  const before = tokens.slice(0, month.startIndex);
  const after = tokens.slice(month.endIndex + 1);

  // The day is the last numeral before the month; the year the first after it.
  let dayToken: string | null = null;
  let dayAt = -1;
  for (let index = before.length - 1; index >= 0; index -= 1) {
    const token = before[index];
    if (token === undefined) continue;
    if (/^\d{1,2}$/.test(token) || gematriaValue(token) !== null) {
      dayToken = token;
      dayAt = index;
      break;
    }
  }

  let yearToken: string | null = null;
  let yearAt = -1;
  for (let index = 0; index < after.length; index += 1) {
    const token = after[index];
    if (token === undefined) continue;
    if (/^\d{4}$/.test(token) || gematriaValue(token) !== null) {
      yearToken = token;
      yearAt = index;
      break;
    }
  }

  const note = joinNote([
    ...before.filter((_, index) => index !== dayAt),
    ...after.filter((_, index) => index !== yearAt),
  ]);

  if (hedged) {
    return { outcome: 'needs_review', reason: 'uncertainty_marker', originalText, note };
  }
  if (dayToken === null || yearToken === null) {
    return { outcome: 'needs_review', reason: 'unreadable_date', originalText, note };
  }

  const day = /^\d{1,2}$/.test(dayToken) ? Number(dayToken) : (gematriaValue(dayToken) ?? 0);
  const rawYear = /^\d{4}$/.test(yearToken)
    ? Number(yearToken)
    : (gematriaValue(yearToken) ?? 0);
  const year = rawYear < 1_000 ? rawYear + 5_000 : rawYear;
  if (day <= 0 || year <= 0) {
    return { outcome: 'needs_review', reason: 'unreadable_date', originalText, note };
  }

  // Adar, decided by the year rather than by us.
  const leap = isHebrewLeapYear(year);
  if (month.adarUnspecified && leap) {
    return { outcome: 'needs_review', reason: 'ambiguous_adar', originalText, note };
  }
  if (month.adarQualified && !leap) {
    return { outcome: 'needs_review', reason: 'adar_in_non_leap_year', originalText, note };
  }

  const monthNumber = month.adarUnspecified
    ? months.ADAR_I
    : hebrewMonthNumber(month.name, year);
  if (monthNumber === null) {
    return { outcome: 'needs_review', reason: 'unreadable_date', originalText, note };
  }

  if (day > daysInHebrewMonth(monthNumber, year)) {
    return { outcome: 'needs_review', reason: 'day_not_in_month', originalText, note };
  }

  const hebrew: HebrewDate = { day, month: monthNumber, year };
  try {
    assertHebrewDate(hebrew);
    return {
      outcome: 'resolved',
      source: 'hebrew',
      hebrew,
      gregorian: hebrewToGregorian(hebrew),
      originalText,
      note,
    };
  } catch (error) {
    if (error instanceof HebrewDateError) {
      return { outcome: 'needs_review', reason: 'day_not_in_month', originalText, note };
    }
    throw error;
  }
}
