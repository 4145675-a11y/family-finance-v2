import { PersistenceError } from '@family-finance/household-store';
import { CommandError } from '@family-finance/local-store';
import { revalidatePath } from 'next/cache';

import { AuthError } from '../auth/model';
import { authScreen } from '../copy/security';
import { failed, type FormState } from '../forms';

/**
 * Turning a refusal into a sentence, and telling the screens to look again.
 *
 * Deliberately *not* in a `'use server'` module. Every export of one of those
 * becomes a callable endpoint, and neither of these is something a browser should
 * be able to invoke — they are helpers the actions use. Keeping them here means
 * the server-action modules export only actual actions.
 */

const MESSAGES: Readonly<Record<string, string>> = {
  unknown_account: 'החשבון שנבחר כבר לא קיים.',
  unknown_debt: 'החוב שנבחר כבר לא קיים.',
  unknown_transaction: 'הרשומה הזו כבר לא קיימת.',
  unknown_planned_item: 'הפריט הצפוי הזה כבר לא קיים.',
  unknown_task: 'המשימה הזו כבר לא קיימת.',
  unknown_budget: 'לחודש הזה עוד אין תקציב.',
  unknown_batch: 'הקובץ הזה כבר לא נמצא ברשימת ההעלאות.',
  unknown_proposal: 'השורה הזו כבר לא חלק מהיבוא.',
  no_business: 'צריך להגדיר עסק לפני שמוסיפים חשבון עסקי.',
  business_exists: 'כבר מוגדר עסק אחד למשק הבית.',
  budget_exists: 'לחודש הזה כבר יש תקציב.',
  transfer_needs_counterpart: 'להעברה יש שני צדדים. צריך לבחור גם את החשבון השני.',
  counterpart_not_allowed: 'להוצאה או להכנסה רגילה אין חשבון שני.',
  amount_required: 'הסכום חייב להיות גדול מאפס.',
  same_debt: 'חוב לא יכול לפרוע את עצמו.',
  not_a_business_account: 'הכסף צריך לצאת מחשבון של העסק.',
  not_a_household_account: 'הכסף צריך להגיע לחשבון של הבית.',
  nothing_to_reconcile: 'אין הפרש לסגור.',
  correction_needs_direction: 'צריך לציין אם התיקון מגדיל או מקטין את החוב.',
  correction_effect_not_allowed: 'רק תיקון יתרה נושא כיוון משלו.',
  batch_not_open: 'היבוא הזה כבר הוכרע ואי אפשר לשנות אותו.',
  already_approved: 'היבוא הזה כבר אושר.',
  not_approved: 'אפשר לבטל רק יבוא שאושר.',
  not_ready: 'עוד לא כל השורות הוכרעו.',
  needs_account: 'צריך לבחור לאיזה חשבון השורה שייכת.',
  needs_debt: 'צריך לבחור לאיזה חוב התשלום שייך.',
  correction_changes_kind: 'אפשר לתקן שורה, אבל לא לשנות את סוג הרשומה.',
};

/** Turns a thrown command error into a sentence a family can act on. */
export function describe(error: unknown): FormState {
  // The lock, first. A locked session reaching an action is not a saving
  // failure, and telling a family "something went wrong" when the answer is
  // "sign in again" is the difference between a fix and a mystery.
  if (error instanceof AuthError) {
    return failed(authScreen.errors[error.code] ?? authScreen.errors['locked'] ?? '');
  }
  if (error instanceof CommandError) {
    return failed(MESSAGES[error.code] ?? 'לא הצלחנו לשמור את השינוי.');
  }
  // The database refused, or cannot do this. The code is the whole story the
  // screen gets; the database's own message stays on the server.
  if (error instanceof PersistenceError) {
    return failed(PERSISTENCE_MESSAGES[error.code]);
  }

  if (error instanceof Error && error.name === 'StoreNotInitialisedError') {
    return failed('עוד לא הוקם משק בית. אפשר להתחיל בהגדרה.');
  }
  if (error instanceof Error && error.name === 'ConcurrentModificationError') {
    return failed('משהו השתנה בזמן שמילאתם את הטופס. כדאי לרענן ולנסות שוב.');
  }
  return failed('משהו השתבש בשמירה. אפשר לנסות שוב.');
}

/**
 * Every screen whose numbers can move when the truth changes.
 *
 * Revalidating is not decoration: without it a family adds an account and the
 * home screen keeps showing the old picture, which is exactly the quiet staleness
 * this product exists to avoid.
 */
const PERSISTENCE_MESSAGES: Readonly<Record<PersistenceError['code'], string>> = {
  not_authenticated: 'צריך להיכנס לחשבון כדי להמשיך.',
  not_a_member: 'החשבון הזה אינו חבר במשק הבית הזה.',
  permission_denied: 'הפעולה הזו לא מותרת בחשבון הזה.',
  unsupported_in_backend: 'הפעולה הזו לא זמינה כשהנתונים נשמרים במסד הנתונים.',
  invalid_document: 'הנתונים שנשמרו לא נקראו כמו שצריך. כדאי לרענן ולנסות שוב.',
  invitation_invalid: 'ההזמנה הזו לא תקפה יותר. אפשר לבקש הזמנה חדשה.',
  unavailable: 'מסד הנתונים לא זמין כרגע. אפשר לנסות שוב בעוד רגע.',
};

const MONEY_PATHS = [
  '/',
  '/accounts',
  '/budget',
  '/debts',
  '/forecast',
  '/business',
  '/reports',
  '/activity',
  '/approvals',
  '/entry',
  '/tasks',
];

export function refreshMoneyScreens(): void {
  for (const path of MONEY_PATHS) revalidatePath(path);
}

/** The screens that change when a file is uploaded, reviewed or decided. */
const IMPORT_PATHS = ['/upload', '/approvals', '/activity'];

export function refreshImportScreens(): void {
  for (const path of IMPORT_PATHS) revalidatePath(path);
}

/** The message shown when a command's error code has no Hebrew of its own. */
export const FALLBACK_MESSAGE = 'לא הצלחנו לשמור את השינוי.';

/** Exposed so a test can prove every code the store can throw has a sentence. */
export const ERROR_MESSAGES = MESSAGES;
