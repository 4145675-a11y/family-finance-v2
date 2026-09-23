import type { DueDate } from '@family-finance/contracts';
import { formatGregorian, formatHebrewDate } from '@family-finance/hebrew-calendar';

import { Badge } from './ui';

/**
 * A due date, shown in both calendars at once.
 *
 * The product rule is that neither calendar is a translation of the other: the
 * family wrote one of them, and the other is there so the same day can be found
 * on a phone calendar or said out loud at the table. So both are always printed,
 * and the one the family actually used is named first.
 *
 * A date that could not be read is not shown as a date. It is shown as the text
 * the file contained, with the reason it was not accepted, and it stays that way
 * until a person decides — never quietly resolved to something plausible.
 */

/** Hebrew for each reason a date was refused. Names the problem, not the fix. */
const REVIEW_REASON: Record<NonNullable<DueDate['reviewReason']>, string> = {
  uncertainty_marker: 'התאריך נכתב כהערכה, ולכן לא נקבע תאריך',
  ambiguous_adar: 'שנה מעוברת — צריך לומר אדר א׳ או אדר ב׳',
  adar_in_non_leap_year: 'בשנה הזו יש אדר אחד בלבד',
  day_not_in_month: 'היום הזה אינו קיים בחודש הזה בשנה הזו',
  unreadable_date: 'לא הצלחנו לקרוא את התאריך',
};

export function DueDateLines({ due }: { due: DueDate | undefined }) {
  if (due === undefined) return null;

  if (due.gregorian === null) {
    if (due.reviewReason === null && due.sourceText === null) return null;
    return (
      <div className="flex flex-col gap-1">
        {due.sourceText === null ? null : (
          <p className="text-text-secondary">
            <span className="font-medium">מה שכתוב בקובץ:</span> {due.sourceText}
          </p>
        )}
        {due.reviewReason === null ? null : (
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="attention">לבדיקה</Badge>
            <span className="text-text-secondary">{REVIEW_REASON[due.reviewReason]}</span>
          </div>
        )}
      </div>
    );
  }

  const hebrew = due.hebrew === null ? null : formatHebrewDate(due.hebrew);
  const gregorian = formatGregorian(due.gregorian);

  return (
    <div className="flex flex-col gap-1">
      {hebrew === null ? null : (
        <p>
          <span className="text-text-secondary">עברי:</span>{' '}
          <span className="font-medium">{hebrew}</span>
        </p>
      )}
      <p>
        <span className="text-text-secondary">לועזי:</span>{' '}
        <span className="font-medium">{gregorian}</span>
      </p>
      {due.sourceText === null || due.sourceText === hebrew ? null : (
        <p className="text-small text-text-secondary">מהקובץ: {due.sourceText}</p>
      )}
      {due.recursAnnually ? <Badge tone="neutral">חוזר כל שנה עברית</Badge> : null}
    </div>
  );
}

/** One line, for a table cell or a list row. */
export function DueDateInline({ due }: { due: DueDate | undefined }) {
  if (due === undefined || due.gregorian === null) {
    return <span className="text-text-secondary">—</span>;
  }
  const hebrew = due.hebrew === null ? null : formatHebrewDate(due.hebrew);
  const gregorian = formatGregorian(due.gregorian);
  return (
    <span>
      {hebrew === null ? null : <span className="font-medium">{hebrew}</span>}
      {hebrew === null ? null : <span className="text-text-secondary"> · </span>}
      <span>{gregorian}</span>
    </span>
  );
}
