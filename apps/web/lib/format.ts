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
 * Formatting never changes a value — it only decides how the same integer is read.
 */

/**
 * Unicode isolate characters.
 *
 * A number embedded in a Hebrew sentence has to be isolated or the bidi algorithm
 * reorders the characters around it — "נשארו 620 ₪" can render with the currency
 * on the wrong side, which in a money app reads as a different number. `<bdi>`
 * does this in markup; these do it inside a plain string, which is what a
 * sentence built in the copy layer needs.
 */
const FIRST_STRONG_ISOLATE = '⁨';
const POP_DIRECTIONAL_ISOLATE = '⁩';

/** Non-breaking space, so an amount never wraps away from its currency. */
const NARROW_GAP = ' ';

/** Real minus sign. A hyphen is a typographic accident that reads as a dash. */
const MINUS = '−';

/**
 * Digit grouping only.
 *
 * `he-IL` is not used here on purpose. Its currency formatter injects RTL and LTR
 * marks around the number and the symbol, which is exactly the noise that made
 * amounts render as "‏427,500.00 ‏₪" on the running screen. Direction is handled
 * once, by the `<bdi dir="ltr">` around the whole run, so the string itself stays
 * clean: digits, a space, a symbol.
 */
const groupers = new Map<number, Intl.NumberFormat>();

function grouperFor(fractionDigits: number): Intl.NumberFormat {
  const existing = groupers.get(fractionDigits);
  if (existing) return existing;

  const created = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
    useGrouping: true,
  });
  groupers.set(fractionDigits, created);
  return created;
}

const CURRENCY_SYMBOL: Readonly<Record<string, string>> = {
  ILS: '₪',
  USD: '$',
  EUR: '€',
};

function symbolFor(currency: string): string {
  return CURRENCY_SYMBOL[currency] ?? currency;
}

/**
 * The canonical money string.
 *
 * `427,500 ₪` · `3,500 ₪` · `150 ₪` · `1,234.56 ₪` · `−22,130 ₪`
 *
 * Agorot appear only when they carry information. A household budget written to
 * the last agora reads as an accounting ledger, and two zeros after every figure
 * on a dashboard is most of what made the screens feel like software rather than
 * a family's own picture. The exact minor units are untouched underneath.
 */
export function formatMoney(amountMinor: number, currency = 'ILS'): string {
  if (!Number.isFinite(amountMinor)) {
    throw new Error(`cannot format a non-finite amount: ${amountMinor}`);
  }
  if (!Number.isInteger(amountMinor)) {
    throw new Error(`money must arrive as integer minor units, got ${amountMinor}`);
  }

  const negative = amountMinor < 0;
  const absolute = Math.abs(amountMinor);
  const hasAgorot = absolute % 100 !== 0;
  const digits = grouperFor(hasAgorot ? 2 : 0).format(absolute / 100);

  return `${negative ? MINUS : ''}${digits}${NARROW_GAP}${symbolFor(currency)}`;
}

/**
 * A signed figure with an explicit sign, for a change over a period.
 *
 * A debt that fell shows a minus. 03-UX-SPEC.md wants the direction of a change
 * legible at a glance, and "−1,000 ₪" carries that where "1,000 less" does not.
 */
export function formatSignedMoney(amountMinor: number, currency = 'ILS'): string {
  const formatted = formatMoney(Math.abs(amountMinor), currency);
  if (amountMinor === 0) return formatted;
  return amountMinor < 0 ? `${MINUS}${formatted}` : `+${formatted}`;
}

/** Wraps a run so the surrounding right-to-left text cannot reorder it. */
export function isolate(text: string): string {
  return `${FIRST_STRONG_ISOLATE}${text}${POP_DIRECTIONAL_ISOLATE}`;
}

/** A money amount ready to sit inside a Hebrew sentence. */
export function money(amountMinor: number, currency = 'ILS'): string {
  return isolate(formatMoney(amountMinor, currency));
}

/** A whole number ready to sit inside a Hebrew sentence. */
export function count(value: number): string {
  return isolate(grouperFor(0).format(value));
}

/** Basis points as a percentage: `1250` → `12.5%`. */
export function formatBasisPoints(rateBp: number): string {
  const percent = rateBp / 100;
  const digits = Number.isInteger(percent) ? 0 : 1;
  return `${grouperFor(digits).format(percent)}%`;
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
 * `2026-10-10` → `10.10.2026`.
 *
 * A due date carries its year, where `formatBusinessDate` deliberately drops it:
 * most records are about this month, and a repayment day is the opposite case —
 * it is often next year, and the year is exactly what a family is checking.
 * Numeric rather than spelled out so the whole day fits on one line of a card.
 */
export function formatDueDate(date: string): string {
  const [year, month, day] = date.split('-');
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`not a business date: ${date}`);
  }
  return `${day}.${month}.${year}`;
}

/**
 * `2026-08-15` → `יום שבת`.
 *
 * The Hebrew locale already includes the word "יום", so callers must not add
 * their own — that produced "עד יום יום שבת" on a running screen.
 */
export function formatWeekday(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`not a business date: ${date}`);
  }
  return new Intl.DateTimeFormat('he-IL', { weekday: 'long' }).format(
    new Date(Date.UTC(year, month - 1, day)),
  );
}

/**
 * An instant, as a person reads it: `15/08/26, 14:32`.
 *
 * Used where the exact moment is the point — an audit line, a sign-in record —
 * rather than for the dates on money, which are business dates and are formatted
 * without a time because they do not have one.
 */
export function formatDateTime(instant: string): string {
  return new Date(instant).toLocaleString('he-IL', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

/**
 * "מעודכן להיום" / "עודכן לפני 3 ימים".
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

/**
 * A stored amount as the text a person edits.
 *
 * The one place minor units become a decimal for a form field. Screens are
 * forbidden from doing this inline — `screens.test.ts` enforces it — because a
 * conversion scattered across twenty components is a conversion that will
 * eventually be done differently in one of them.
 *
 * String surgery rather than division: `-1` agora is `-0.01`, not
 * `-0.009999999999999998`.
 */
export function toAmountInput(amountMinor: number | null | undefined): string {
  if (amountMinor === null || amountMinor === undefined) return '';
  if (!Number.isInteger(amountMinor)) {
    throw new Error(`an editable amount must be integer minor units, got ${amountMinor}`);
  }

  const negative = amountMinor < 0;
  const digits = String(Math.abs(amountMinor)).padStart(3, '0');
  return `${negative ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}
