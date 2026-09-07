'use server';

import {
  BackupError,
  backupFileName,
  createBackup,
  documentToRestore,
  previewRestore,
  serialiseBackup,
} from '@family-finance/local-store';

import { assertRecentlyVerified } from '../auth/session';
import { failed, succeeded, type FormState } from '../forms';
import { householdStore } from '../store/server';
import { describe, refreshMoneyScreens } from './errors';

/**
 * Carrying the data out and bringing it back.
 *
 * Restore is deliberately two actions rather than one. The first reads the file
 * and reports what is in it; the second replaces the household with it. A single
 * "restore" button that swallows a file and overwrites everything is the wrong
 * shape for an operation whose failure mode is losing a family's financial
 * history.
 */

const MAX_BACKUP_BYTES = 200 * 1024 * 1024;

export interface RestorePreviewState extends FormState {
  readonly preview?: {
    readonly createdAt: string;
    readonly householdName: string;
    readonly accounts: number;
    readonly transactions: number;
    readonly debts: number;
    readonly budgets: number;
    readonly importBatches: number;
    readonly tasks: number;
    readonly auditEntries: number;
    readonly earliestTransaction: string | null;
    readonly latestTransaction: string | null;
    readonly currentHouseholdName: string | null;
    readonly currentTransactions: number | null;
  };
  /** The verified backup text, carried back so the confirm step re-verifies it. */
  readonly payload?: string;
}

/** Writes a backup into the project's backup folder and returns its name. */
export async function createBackupAction(
  _previous: FormState,
  _data: FormData,
): Promise<FormState> {
  /* A backup is every figure the household has, in one file that leaves the
     application. Being signed in an hour ago is not authorisation for that. */
  try {
    await assertRecentlyVerified('backup_create');
  } catch (error) {
    return describe(error);
  }

  const store = householdStore();

  try {
    const document = await store.readDocument();
    const now = new Date().toISOString();
    const name = backupFileName(now);
    await store.store.writeBackup(name, serialiseBackup(createBackup(document, now)));
    return succeeded(`הגיבוי נשמר בשם ${name}.`, name);
  } catch {
    return failed('לא הצלחנו ליצור גיבוי.');
  }
}

const BACKUP_MESSAGES: Readonly<Record<BackupError['code'], string>> = {
  not_a_backup: 'הקובץ הזה לא נוצר על ידי האפליקציה.',
  unreadable_json: 'לא הצלחנו לקרוא את הקובץ. ייתכן שההורדה נקטעה.',
  checksum_mismatch: 'הקובץ השתנה מאז שנוצר, ולכן לא נשחזר ממנו.',
  unsupported_envelope: 'הגיבוי נוצר בגרסה חדשה יותר של האפליקציה.',
  unsupported_format: 'הגיבוי שומר נתונים בפורמט שהגרסה הזו לא יודעת לקרוא.',
  invalid_document: 'הנתונים בתוך הגיבוי אינם תקינים.',
};

export async function previewRestoreAction(
  _previous: RestorePreviewState,
  data: FormData,
): Promise<RestorePreviewState> {
  const file = data.get('backup');
  if (!(file instanceof File) || file.size === 0) {
    return { ...failed('בואו נבחר קובץ גיבוי.'), errors: [] };
  }
  if (file.size > MAX_BACKUP_BYTES) {
    return { ...failed('הקובץ גדול מדי.'), errors: [] };
  }

  const text = await file.text();
  const store = householdStore();
  const current = await store.readDocumentOrNull();

  try {
    const preview = previewRestore(text, current);
    return {
      status: 'success',
      message: 'הגיבוי נקרא ואומת. עוד לא שינינו כלום.',
      errors: [],
      preview: {
        createdAt: preview.createdAt,
        householdName: preview.summary.householdName,
        accounts: preview.summary.accounts,
        transactions: preview.summary.transactions,
        debts: preview.summary.debts,
        budgets: preview.summary.budgets,
        importBatches: preview.summary.importBatches,
        tasks: preview.summary.tasks,
        auditEntries: preview.summary.auditEntries,
        earliestTransaction: preview.summary.earliestTransaction,
        latestTransaction: preview.summary.latestTransaction,
        currentHouseholdName: preview.current?.householdName ?? null,
        currentTransactions: preview.current?.transactions ?? null,
      },
      payload: text,
    };
  } catch (error) {
    if (error instanceof BackupError) {
      return { ...failed(BACKUP_MESSAGES[error.code]), errors: [] };
    }
    return { ...failed('לא הצלחנו לקרוא את הגיבוי.'), errors: [] };
  }
}

/**
 * Applies a restore.
 *
 * The payload is verified again here rather than trusted from the preview step:
 * the two are separate requests, and a value that travelled through a form is not
 * evidence of anything by the time it comes back.
 */
export async function applyRestoreAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const payload = data.get('payload');
  const confirmation = data.get('confirm');

  if (typeof payload !== 'string' || payload.length === 0) {
    return failed('אין קובץ לשחזור. אפשר לבחור אותו שוב.');
  }
  if (confirmation !== 'שחזור') {
    return failed('כדי לאשר, יש להקליד את המילה "שחזור" בשדה האישור.');
  }

  /* Restoring overwrites everything. The typed confirmation proves intent; this
     proves it is still the same person at the keyboard. */
  try {
    await assertRecentlyVerified('backup_restore');
  } catch (error) {
    return describe(error);
  }

  const store = householdStore();

  try {
    const current = await store.readDocumentOrNull();
    const preview = previewRestore(payload, current);
    await store.replaceDocument(documentToRestore(preview));
  } catch (error) {
    if (error instanceof BackupError) return failed(BACKUP_MESSAGES[error.code]);
    return failed('השחזור לא הושלם. שום דבר לא הוחלף.');
  }

  refreshMoneyScreens();
  return succeeded('השחזור הושלם. הנתונים הקודמים נשמרו בהיסטוריה המקומית.');
}
