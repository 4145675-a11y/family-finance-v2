import { parseAmount, parseDate } from '@family-finance/document-import';

/**
 * Reading what a person typed.
 *
 * The same parser the importer uses reads what a family types, and that is
 * deliberate. Somebody entering an expense writes "1,234.56", or "1234.56", or
 * "₪1,234" — the same set of shapes a bank puts in a file — and having two
 * different readers for the same value is how a form ends up accepting something
 * the importer would reject.
 *
 * Everything here returns either a value or a message. No function throws: a
 * form field with a wrong value is an ordinary thing a person does, not an
 * exception, and it deserves a sentence next to the field rather than a stack
 * trace.
 */

export interface FieldError {
  readonly field: string;
  readonly message: string;
}

export type FormStatus = 'idle' | 'success' | 'error';

export interface FormState {
  readonly status: FormStatus;
  readonly message: string;
  readonly errors: readonly FieldError[];
  /** Set on success when the caller wants to name what was created. */
  readonly createdId?: string;
}

export const idleForm: FormState = { status: 'idle', message: '', errors: [] };

export function failed(message: string, errors: readonly FieldError[] = []): FormState {
  return { status: 'error', message, errors };
}

export function succeeded(message: string, createdId?: string): FormState {
  return createdId === undefined
    ? { status: 'success', message, errors: [] }
    : { status: 'success', message, errors: [], createdId };
}

export function errorFor(state: FormState, field: string): string | undefined {
  return state.errors.find((error) => error.field === field)?.message;
}

/** A collector that gathers every problem before giving up, so a person fixes all of them at once. */
export class FieldReader {
  private readonly problems: FieldError[] = [];

  constructor(private readonly data: FormData) {}

  get errors(): readonly FieldError[] {
    return this.problems;
  }

  get ok(): boolean {
    return this.problems.length === 0;
  }

  private raw(field: string): string {
    const value = this.data.get(field);
    return typeof value === 'string' ? value.trim() : '';
  }

  problem(field: string, message: string): void {
    this.problems.push({ field, message });
  }

  text(
    field: string,
    label: string,
    options: { max?: number; required?: boolean } = {},
  ): string {
    const value = this.raw(field);
    if (value.length === 0) {
      if (options.required !== false) this.problem(field, `${label} — נדרש למלא`);
      return '';
    }
    const max = options.max ?? 160;
    if (value.length > max) {
      this.problem(field, `${label} ארוך מדי. עד ${max} תווים.`);
      return value.slice(0, max);
    }
    return value;
  }

  optionalText(field: string, label: string, max = 500): string | null {
    const value = this.raw(field);
    if (value.length === 0) return null;
    if (value.length > max) {
      this.problem(field, `${label} ארוך מדי. עד ${max} תווים.`);
      return value.slice(0, max);
    }
    return value;
  }

  /**
   * A money field, read to exact minor units.
   *
   * Rejects zero for an amount that must move money: a transaction of nothing is
   * always a mistake, and accepting it puts an empty row in the family's history.
   */
  money(
    field: string,
    label: string,
    options: { allowZero?: boolean; required?: boolean } = {},
  ): number {
    const value = this.raw(field);
    if (value.length === 0) {
      if (options.required !== false) this.problem(field, `${label} — נדרש למלא סכום`);
      return 0;
    }

    const parsed = parseAmount(value);
    if (parsed === null) {
      this.problem(field, `${label} — לא הצלחנו לקרוא את הסכום. אפשר לכתוב למשל 1,250.50`);
      return 0;
    }
    if (parsed.amountMinor === 0 && options.allowZero !== true) {
      this.problem(field, `${label} — הסכום חייב להיות גדול מאפס`);
      return 0;
    }
    return parsed.amountMinor;
  }

  optionalMoney(field: string, label: string): number | null {
    const value = this.raw(field);
    if (value.length === 0) return null;
    const parsed = parseAmount(value);
    if (parsed === null) {
      this.problem(field, `${label} — לא הצלחנו לקרוא את הסכום`);
      return null;
    }
    return parsed.amountMinor;
  }

  /** A date field. The browser sends `YYYY-MM-DD`; typed Israeli dates also work. */
  date(field: string, label: string, options: { required?: boolean } = {}): string {
    const value = this.raw(field);
    if (value.length === 0) {
      if (options.required !== false) this.problem(field, `${label} — נדרש תאריך`);
      return '';
    }
    const parsed = parseDate(value);
    if (parsed === null) {
      this.problem(field, `${label} — התאריך לא ברור. אפשר לכתוב למשל 06/09/2026`);
      return '';
    }
    return parsed;
  }

  optionalDate(field: string, label: string): string | null {
    const value = this.raw(field);
    if (value.length === 0) return null;
    const parsed = parseDate(value);
    if (parsed === null) {
      this.problem(field, `${label} — התאריך לא ברור`);
      return null;
    }
    return parsed;
  }

  /** A value that must be one of a fixed set. */
  choice<T extends string>(
    field: string,
    label: string,
    allowed: readonly T[],
    fallback?: T,
  ): T {
    const value = this.raw(field);
    if (allowed.includes(value as T)) return value as T;
    if (fallback !== undefined) return fallback;
    this.problem(field, `${label} — נדרש לבחור`);
    return allowed[0] as T;
  }

  optionalChoice<T extends string>(field: string, allowed: readonly T[]): T | null {
    const value = this.raw(field);
    return allowed.includes(value as T) ? (value as T) : null;
  }

  boolean(field: string): boolean {
    const value = this.raw(field);
    return value === 'on' || value === 'true' || value === '1';
  }

  /** An identifier the form carried from a list we rendered. */
  id(field: string, label: string, options: { required?: boolean } = {}): string | null {
    const value = this.raw(field);
    if (value.length === 0) {
      if (options.required === true) this.problem(field, `${label} — נדרש לבחור`);
      return null;
    }
    if (!/^[0-9a-fA-F-]{36}$/.test(value)) {
      this.problem(field, `${label} — לא הצלחנו לזהות את הבחירה`);
      return null;
    }
    return value;
  }

  integer(
    field: string,
    label: string,
    options: { min?: number; max?: number; required?: boolean } = {},
  ): number | null {
    const value = this.raw(field);
    if (value.length === 0) {
      if (options.required === true) this.problem(field, `${label} — נדרש למלא`);
      return null;
    }
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
      this.problem(field, `${label} — נדרש מספר שלם`);
      return null;
    }
    if (options.min !== undefined && parsed < options.min) {
      this.problem(field, `${label} — לא פחות מ־${options.min}`);
      return null;
    }
    if (options.max !== undefined && parsed > options.max) {
      this.problem(field, `${label} — לא יותר מ־${options.max}`);
      return null;
    }
    return parsed;
  }

  /** A percentage typed as `18` or `18%`, kept as basis points. */
  percentBp(field: string, label: string, options: { required?: boolean } = {}): number | null {
    const value = this.raw(field).replace('%', '');
    if (value.length === 0) {
      if (options.required === true) this.problem(field, `${label} — נדרש למלא`);
      return null;
    }
    const parsed = parseAmount(value);
    if (parsed === null) {
      this.problem(field, `${label} — לא הצלחנו לקרוא את האחוז`);
      return null;
    }
    // `parseAmount` gives hundredths, which is exactly basis points for a percent.
    const bp = parsed.amountMinor;
    if (bp > 1_000_000) {
      this.problem(field, `${label} — האחוז גבוה מדי`);
      return null;
    }
    return bp;
  }
}

/** Today, in the household's calendar. */
export function todayInJerusalem(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * The identifier the form carried, for the record this action will create.
 *
 * `ActionForm` puts one on every form in the product, so an action only has to
 * pass it through. Absent — a form posted by something other than the app, or an
 * old cached page — the command mints its own and the write proceeds normally;
 * the protection is lost for that one submission rather than the action failing.
 */
export function submissionKey(data: FormData): string | undefined {
  const value = data.get('idempotencyKey');
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length >= 8 ? trimmed : undefined;
}
