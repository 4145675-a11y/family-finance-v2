/**
 * Formatting for Hebrew, right-to-left screens.
 *
 * 04-DESIGN-SYSTEM.md is specific about numbers inside Hebrew text: they need
 * their own direction and correct bidi isolation, and the currency symbol must
 * not flip. Getting this wrong does not look like a bug — it looks like a wrong
 * number, which in a financial application is worse.
 *
 * Every formatter here takes minor units, because that is the only representation
 * the engine produces. There is deliberately no function that accepts a decimal
 * amount: a float reaching a screen means a float existed somewhere upstream.
 */

const currencyFormatters = new Map<string, Intl.NumberFormat>();

function formatterFor(currency: string): Intl.NumberFormat {
  const existing = currencyFormatters.get(currency);
  if (existing) return existing;

  const created = new Intl.NumberFormat('he-IL', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  currencyFormatters.set(currency, created);
  return created;
}

/** `12345` → `‎₪123.45‎`. The value is exact: minor units divided, never rounded. */
export function formatMoney(amountMinor: number, currency = 'ILS'): string {
  if (!Number.isFinite(amountMinor)) {
    throw new Error(`cannot format a non-finite amount: ${amountMinor}`);
  }
  return formatterFor(currency).format(amountMinor / 100);
}

/**
 * A signed figure with an explicit sign, for a change over a period.
 *
 * A debt that fell shows a minus. 03-UX-SPEC.md wants the direction of a change
 * legible at a glance, and "−1,000" carries that where "1,000 less" does not.
 */
export function formatSignedMoney(amountMinor: number, currency = 'ILS'): string {
  const formatted = formatMoney(Math.abs(amountMinor), currency);
  if (amountMinor === 0) return formatted;
  return amountMinor < 0 ? `−${formatted}` : `+${formatted}`;
}

/** Basis points as a percentage: `1250` → `12.5%`. */
export function formatBasisPoints(rateBp: number): string {
  return new Intl.NumberFormat('he-IL', {
    style: 'percent',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(rateBp / 10_000);
}

/** `2026-08-15` → `15 באוגוסט`. Day and month only: the year is rarely the point. */
export function formatBusinessDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`not a business date: ${date}`);
  }
  return new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long' }).format(
    new Date(Date.UTC(year, month - 1, day)),
  );
}

/**
 * "עודכן היום" / "עודכן לפני 3 ימים".
 *
 * Freshness is the first thing on the home screen, so it is phrased the way a
 * person would say it rather than as a timestamp they have to decode.
 */
export function formatFreshness(ageDays: number | null): string {
  if (ageDays === null) return 'לא אומת מעולם';
  if (ageDays <= 0) return 'עודכן היום';
  if (ageDays === 1) return 'עודכן אתמול';
  return `עודכן לפני ${ageDays} ימים`;
}

export const CONFIDENCE_LABEL: Readonly<Record<'low' | 'medium' | 'high', string>> = {
  low: 'אמינות נמוכה',
  medium: 'אמינות בינונית',
  high: 'אמינות גבוהה',
};

export const MODE_LABEL: Readonly<Record<string, string>> = {
  emergency: 'חירום',
  stabilization: 'ייצוב',
  stop_new_debt: 'עצירת חוב חדש',
  repayment: 'פירעון',
  buffer_building: 'בניית כרית',
  growth: 'צמיחה',
};

export const STATUS_LABEL: Readonly<Record<string, string>> = {
  safe: 'בטוח',
  conditional: 'מותנה',
  not_safe: 'לא בטוח',
  insufficient_data: 'אין מספיק נתונים',
};
