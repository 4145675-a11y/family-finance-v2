import type { BusinessDate } from '@family-finance/contracts';
import { months } from '@hebcal/core';

import {
  daysInHebrewMonth,
  hebrewToGregorian,
  isHebrewLeapYear,
  type HebrewDate,
} from './calendar';

/**
 * A due date that comes round every Hebrew year.
 *
 * A yahrzeit-style obligation — "every year on ז׳ טבת" — is a Hebrew day and
 * month, not a Gregorian one, and it lands on a different civil day each year.
 * The rule therefore stores the Hebrew day and month, and the civil date is
 * derived per year rather than stored.
 *
 * Two years in nineteen do not contain the day the rule names, and the calendar
 * offers no single right answer:
 *
 *   * **Adar.** A leap year has Adar I and Adar II. A rule made in a plain year
 *     names an Adar that splits in two; a rule made in a leap year names an Adar
 *     that merges back into one. Custom differs by community and by what the
 *     obligation is.
 *   * **A day that is not there.** Cheshvan and Kislev have 29 days in some years
 *     and 30 in others, so a rule on the 30th has no day to land on in a year
 *     where the month is short.
 *
 * Both are resolved by asking, never by picking. `resolveAnnualHebrewDate`
 * returns `needs_choice` with the options spelled out, and only produces a date
 * once the household has said which one it means. The choice is then stored on
 * the rule, so the same question is asked once and not every year.
 */

export interface HebrewAnnualRule {
  readonly day: number;
  /** NISAN=1 … ADAR_I=12, ADAR_II=13, as the source date was written. */
  readonly month: number;
}

/** Which Adar the household meant, once they have said. */
export type AdarChoice = 'adar_i' | 'adar_ii';

/** What to do in a year where the month is one day short of the rule. */
export type MissingDayChoice = 'last_day_of_month' | 'first_day_of_next_month';

export interface RecurrenceChoices {
  readonly adar?: AdarChoice;
  readonly missingDay?: MissingDayChoice;
}

export type RecurrenceAmbiguity =
  /** The rule names Adar; the target year has two of them. */
  | 'adar_splits_in_leap_year'
  /** The rule names Adar I or Adar II; the target year has a single Adar. */
  | 'adar_merges_in_plain_year'
  /** The rule's day does not exist in that month that year. */
  | 'day_missing_in_year';

export interface RecurrenceOption {
  readonly choice: AdarChoice | MissingDayChoice;
  readonly hebrew: HebrewDate;
  readonly gregorian: BusinessDate;
}

export type RecurrenceResolution =
  | {
      readonly outcome: 'resolved';
      readonly hebrew: HebrewDate;
      readonly gregorian: BusinessDate;
    }
  | {
      readonly outcome: 'needs_choice';
      readonly ambiguity: RecurrenceAmbiguity;
      readonly options: readonly RecurrenceOption[];
    };

const ADAR_MONTHS: readonly number[] = [months.ADAR_I, months.ADAR_II];

function option(choice: AdarChoice | MissingDayChoice, hebrew: HebrewDate): RecurrenceOption {
  return { choice, hebrew, gregorian: hebrewToGregorian(hebrew) };
}

/**
 * The occurrence of an annual Hebrew rule in one Hebrew year.
 *
 * @param rule   the Hebrew day and month the obligation falls on
 * @param year   the Hebrew year to place it in, e.g. 5787
 * @param choices answers the household has already given for Adar and short months
 */
export function resolveAnnualHebrewDate(
  rule: HebrewAnnualRule,
  year: number,
  choices: RecurrenceChoices = {},
): RecurrenceResolution {
  const leap = isHebrewLeapYear(year);
  const ruleIsAdar = ADAR_MONTHS.includes(rule.month);

  let month = rule.month;

  if (ruleIsAdar) {
    if (leap) {
      // One Adar became two. Which one carries the obligation is a decision.
      if (choices.adar === undefined) {
        return {
          outcome: 'needs_choice',
          ambiguity: 'adar_splits_in_leap_year',
          options: adarOptions(rule.day, year),
        };
      }
      month = choices.adar === 'adar_i' ? months.ADAR_I : months.ADAR_II;
    } else {
      // Two Adars became one. A rule written for Adar II has no Adar II to use.
      if (rule.month === months.ADAR_II && choices.adar === undefined) {
        return {
          outcome: 'needs_choice',
          ambiguity: 'adar_merges_in_plain_year',
          options: [
            option('adar_i', {
              day: clampDay(rule.day, months.ADAR_I, year),
              month: months.ADAR_I,
              year,
            }),
          ],
        };
      }
      month = months.ADAR_I;
    }
  }

  const available = daysInHebrewMonth(month, year);
  if (rule.day > available) {
    if (choices.missingDay === undefined) {
      return {
        outcome: 'needs_choice',
        ambiguity: 'day_missing_in_year',
        options: missingDayOptions(month, year, available),
      };
    }
    if (choices.missingDay === 'last_day_of_month') {
      const hebrew: HebrewDate = { day: available, month, year };
      return { outcome: 'resolved', hebrew, gregorian: hebrewToGregorian(hebrew) };
    }
    const next = nextMonth(month, year);
    const hebrew: HebrewDate = { day: 1, month: next.month, year: next.year };
    return { outcome: 'resolved', hebrew, gregorian: hebrewToGregorian(hebrew) };
  }

  const hebrew: HebrewDate = { day: rule.day, month, year };
  return { outcome: 'resolved', hebrew, gregorian: hebrewToGregorian(hebrew) };
}

function clampDay(day: number, month: number, year: number): number {
  return Math.min(day, daysInHebrewMonth(month, year));
}

function adarOptions(day: number, year: number): readonly RecurrenceOption[] {
  return [
    option('adar_i', { day: clampDay(day, months.ADAR_I, year), month: months.ADAR_I, year }),
    option('adar_ii', {
      day: clampDay(day, months.ADAR_II, year),
      month: months.ADAR_II,
      year,
    }),
  ];
}

function missingDayOptions(
  month: number,
  year: number,
  available: number,
): readonly RecurrenceOption[] {
  const next = nextMonth(month, year);
  return [
    option('last_day_of_month', { day: available, month, year }),
    option('first_day_of_next_month', { day: 1, month: next.month, year: next.year }),
  ];
}

/**
 * The month after this one, in Hebrew-calendar order.
 *
 * The year's months run Tishrei(7)…Elul(6), so Elul rolls into the next year's
 * Tishrei and Adar rolls into Nisan — with Adar II in between in a leap year.
 */
function nextMonth(month: number, year: number): { month: number; year: number } {
  if (month === months.ELUL) return { month: months.TISHREI, year: year + 1 };
  if (month === months.ADAR_I) {
    return isHebrewLeapYear(year)
      ? { month: months.ADAR_II, year }
      : { month: months.NISAN, year };
  }
  if (month === months.ADAR_II) return { month: months.NISAN, year };
  return { month: month + 1, year };
}

/** The Hebrew day and month a date recurs on, for storing a rule from a date. */
export function annualRuleFrom(date: HebrewDate): HebrewAnnualRule {
  return { day: date.day, month: date.month };
}
