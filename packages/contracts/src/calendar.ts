import { z } from 'zod';

import { businessDateSchema } from './money';

/**
 * A date the family may have written in either calendar.
 *
 * 02-FINANCIAL-RULES.md § מוסכמות makes the civil day in Asia/Jerusalem the unit
 * business rules run on, so the Gregorian date stays canonical: it is what sorts,
 * what compares, what a reminder fires on. The Hebrew parts sit beside it so the
 * date can be shown the way it was meant — "ז׳ טבת תשפ״ז" — rather than
 * translated into a form the writer did not use.
 *
 * Three things are kept that a single date field would lose:
 *
 *   * **which calendar led.** A date entered as Hebrew recurs by the Hebrew year.
 *     The same civil day entered as Gregorian does not.
 *   * **the original text.** Whatever the cell said survives the import, so a
 *     person can always check the reading against the source.
 *   * **a refusal.** A date that was hedged, impossible or unreadable is recorded
 *     as the reason it was not accepted, never as a date. `AI לא מחשב` and
 *     `uncertain לא safe` are the same rule seen from two sides: a value nobody
 *     is sure of must not become one the system acts on.
 *
 * The arithmetic itself lives in `@family-finance/hebrew-calendar`, over
 * `@hebcal/core`. Nothing here computes a calendar.
 */

/** `@hebcal/core` month numbering: NISAN=1 … ADAR_I=12, ADAR_II=13. */
export const hebrewMonthNumberSchema = z.number().int().min(1).max(13);

export const hebrewDateSchema = z.object({
  day: z.number().int().min(1).max(30),
  month: hebrewMonthNumberSchema,
  year: z.number().int().min(1).max(9_999),
});
export type HebrewDateParts = z.infer<typeof hebrewDateSchema>;

/**
 * Why a cell that looked like a date was not turned into one.
 *
 * Mirrors `DateReviewReason` in `@family-finance/hebrew-calendar`. Kept as its
 * own enum here because this is the value that gets persisted, and a stored
 * reason must not change meaning when the parser is revised.
 */
export const dueDateReviewReasonSchema = z.enum([
  'uncertainty_marker',
  'ambiguous_adar',
  'adar_in_non_leap_year',
  'day_not_in_month',
  'unreadable_date',
]);
export type DueDateReviewReason = z.infer<typeof dueDateReviewReasonSchema>;

/** Which Adar an annual Hebrew rule means, in a year that has two. */
export const adarChoiceSchema = z.enum(['adar_i', 'adar_ii']);
export type AdarChoice = z.infer<typeof adarChoiceSchema>;

/** What an annual Hebrew rule does in a year whose month is a day short. */
export const missingDayChoiceSchema = z.enum(['last_day_of_month', 'first_day_of_next_month']);
export type MissingDayChoice = z.infer<typeof missingDayChoiceSchema>;

export const dueDateSchema = z
  .object({
    /** Canonical. Null when the cell held no date, or held one that was refused. */
    gregorian: businessDateSchema.nullable(),
    /** The same day in the Hebrew calendar. Null when there is no date. */
    hebrew: hebrewDateSchema.nullable(),
    /** True when the family expressed the date in the Hebrew calendar. */
    isHebrew: z.boolean(),
    /** The cell as it was written. Kept for audit; never re-parsed. */
    sourceText: z.string().trim().max(500).nullable(),
    /** Set when, and only when, there is no date because one was refused. */
    reviewReason: dueDateReviewReasonSchema.nullable(),
    /** An obligation that returns on the same Hebrew day and month every year. */
    recursAnnually: z.boolean(),
    /** Answers the household gave once, so the question is not asked every year. */
    adarChoice: adarChoiceSchema.nullable(),
    missingDayChoice: missingDayChoiceSchema.nullable(),
  })
  .refine((date) => date.gregorian === null || date.reviewReason === null, {
    message: 'a date and a reason it could not be read are different answers',
    path: ['reviewReason'],
  })
  .refine((date) => date.gregorian !== null || date.hebrew === null, {
    message: 'a Hebrew date without its civil day cannot be sorted or compared',
    path: ['hebrew'],
  })
  .refine((date) => !date.recursAnnually || date.gregorian !== null, {
    message: 'a recurrence is a rule about a date, so it needs one',
    path: ['recursAnnually'],
  })
  .refine((date) => !date.isHebrew || date.hebrew !== null || date.reviewReason !== null, {
    message: 'a date said to be Hebrew carries its Hebrew parts, or the reason it does not',
    path: ['isHebrew'],
  });
export type DueDate = z.infer<typeof dueDateSchema>;

/** The value for a cell that held nothing. */
export const EMPTY_DUE_DATE: DueDate = {
  gregorian: null,
  hebrew: null,
  isHebrew: false,
  sourceText: null,
  reviewReason: null,
  recursAnnually: false,
  adarChoice: null,
  missingDayChoice: null,
};

/**
 * Another spelling of a lender the household already has.
 *
 * A lender is identified by the creditor name its debts are recorded under.
 * Spreadsheets spell the same lender several ways, so an alias maps one of those
 * spellings onto the canonical name. Aliases are only ever created by a person
 * confirming a match on the review screen — nothing infers one, because a wrong
 * alias silently merges two creditors, which 02-FINANCIAL-RULES.md forbids.
 */
export const lenderAliasSchema = z.object({
  id: z.uuid(),
  householdId: z.uuid(),
  canonicalName: z.string().trim().min(1).max(160),
  /** Folded for lookup: lower case, collapsed whitespace, no geresh or quotes. */
  aliasNormalised: z.string().trim().min(1).max(160),
  aliasDisplay: z.string().trim().min(1).max(160),
  createdBy: z.uuid(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type LenderAlias = z.infer<typeof lenderAliasSchema>;

/**
 * Folds a lender name for comparison.
 *
 * Case, surrounding whitespace, geresh and quotation marks differ between two
 * spellings of the same name and mean nothing; everything else is kept, because
 * stripping more would start merging names that are genuinely different.
 */
export function normaliseLenderName(name: string): string {
  return name
    .normalize('NFKC')
    .replace(/[׳״‘’“”'"`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('he-IL');
}
