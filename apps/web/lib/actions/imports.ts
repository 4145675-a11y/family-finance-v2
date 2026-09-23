'use server';

import {
  LimitExceededError,
  MalformedDocumentError,
  extensionOf,
  extractDocument,
  sanitiseFileName,
  type ImportWarningCode,
} from '@family-finance/document-import';
import {
  approveBatch,
  rejectBatch,
  reverseBatch,
  reviewAll,
  reviewProposal,
  stageExtraction,
  stageFailure,
} from '@family-finance/local-store';
import type { ProposedPayload } from '@family-finance/contracts';
import { todayInIsrael } from '@family-finance/hebrew-calendar';
import { revalidatePath } from 'next/cache';

import { gemach } from '../copy/gemach';
import { FieldReader, failed, succeeded, type FormState } from '../forms';
import { householdStore } from '../store/server';
import { describe, refreshImportScreens, refreshMoneyScreens } from './errors';

/**
 * Uploading a document, reviewing what it said, and deciding.
 *
 * The upload action is where an untrusted file first meets the product, so the
 * order of operations is the security design and not an implementation detail:
 *
 *  1. read the bytes into memory, bounded by the size limit;
 *  2. decide what the file is from its bytes, never from its name;
 *  3. store it under a generated identifier;
 *  4. parse it inside the limits and the deadline;
 *  5. record proposals — which change no balance.
 *
 * A failure at any step is recorded as a failed batch rather than swallowed, so a
 * family who uploaded something and saw nothing happen has somewhere to look.
 */

/** Maps a parser failure onto the batch's failure code and a Hebrew sentence. */
function failureOf(error: unknown): {
  code:
    | 'unsupported_file_type'
    | 'signature_mismatch'
    | 'file_too_large'
    | 'encrypted_file'
    | 'macro_enabled_file'
    | 'malformed_archive'
    | 'malformed_document'
    | 'no_text_layer'
    | 'no_table_found'
    | 'limit_exceeded'
    | 'extraction_timeout';
  message: string;
} {
  if (error instanceof MalformedDocumentError) {
    switch (error.code) {
      case 'encrypted_file':
        return {
          code: 'encrypted_file',
          message: 'הקובץ מוגן בסיסמה, ולכן אי אפשר לקרוא אותו. אפשר לשמור עותק בלי סיסמה.',
        };
      case 'macro_enabled_file':
        return {
          code: 'macro_enabled_file',
          message:
            'הקובץ מכיל מאקרו. לא נפתח קובץ כזה. אפשר לשמור אותו מחדש כ־xlsx רגיל בלי מאקרו.',
        };
      case 'unsupported_file_type':
        return {
          code: 'unsupported_file_type',
          message: error.message.includes('.xlsx')
            ? 'זהו קובץ Excel בפורמט הישן. אפשר לפתוח אותו ולשמור בשם כ־xlsx.'
            : 'סוג הקובץ הזה לא נתמך. אפשר להעלות xlsx, csv או PDF.',
        };
      case 'signature_mismatch':
        return {
          code: 'signature_mismatch',
          message: 'התוכן של הקובץ אינו מתאים לסיומת שלו, ולכן לא נפתח.',
        };
      case 'malformed_archive':
        return { code: 'malformed_archive', message: 'הקובץ פגום ולא ניתן לפתיחה.' };
      case 'malformed_document':
        return {
          code: 'malformed_document',
          message: error.message.includes('no text')
            ? 'העמודים בקובץ הם תמונה בלבד, ואין בהם טקסט לקריאה.'
            : 'לא הצלחנו לקרוא את הקובץ.',
        };
    }
  }

  if (error instanceof LimitExceededError) {
    return {
      code: error.limit === 'extractionBudgetMs' ? 'extraction_timeout' : 'limit_exceeded',
      message:
        error.limit === 'extractionBudgetMs'
          ? 'קריאת הקובץ ארכה יותר מדי. אפשר לנסות קובץ קטן יותר, למשל חודש אחד.'
          : 'הקובץ גדול או מורכב מדי לקריאה. אפשר לפצל אותו לחודשים.',
    };
  }

  return { code: 'malformed_document', message: 'לא הצלחנו לקרוא את הקובץ.' };
}

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export async function uploadDocumentAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const file = data.get('document');
  if (!(file instanceof File) || file.size === 0) {
    return failed('בואו נבחר קובץ.', [{ field: 'document', message: 'לא נבחר קובץ' }]);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return failed('הקובץ גדול מדי. הגבול הוא 20 מגה־בייט.');
  }

  const reader = new FieldReader(data);
  const targetAccountId = reader.id('targetAccountId', 'חשבון');
  const scope = reader.choice(
    'scope',
    'שייך ל',
    ['household', 'business'] as const,
    'household',
  );

  const displayName = sanitiseFileName(file.name);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const store = await householdStore();

  // The extension is only used to name the stored copy; what the file *is* was
  // decided from its bytes inside `extractDocument`.
  const extension = extensionOf(displayName) || '.bin';
  const safeExtension = /^\.(xlsx|csv|pdf|txt|bin)$/.test(extension) ? extension : '.bin';

  let stored: { storedId: string; sha256: string };
  try {
    stored = await store.store.storeUpload(bytes, safeExtension);
  } catch {
    return failed('לא הצלחנו לשמור את הקובץ באופן זמני.');
  }

  const currency = (await store.readDocument()).settings.currency;

  let batchId: string;
  try {
    const extraction = extractDocument(bytes, {
      fileName: displayName,
      currency,
      scope,
      // A debt list says what is owed now, not since when. The opening balance
      // is dated today in the household's time zone — a fact, not a guess.
      importedOn: todayInIsrael(),
    });

    batchId = await store.run((document, context) =>
      stageExtraction(
        document,
        {
          extraction,
          displayName,
          storedId: stored.storedId,
          sha256: stored.sha256,
          byteSize: file.size,
          declaredMimeType: file.type === '' ? null : file.type.slice(0, 160),
          targetAccountId,
        },
        context,
      ),
    );
  } catch (error) {
    const failure = failureOf(error);
    const warnings: ImportWarningCode[] =
      failure.code === 'malformed_document' && failure.message.includes('תמונה')
        ? ['image_only_page']
        : [];

    try {
      await store.run((document, context) =>
        stageFailure(
          document,
          {
            displayName,
            storedId: stored.storedId,
            sha256: stored.sha256,
            byteSize: file.size,
            declaredMimeType: file.type === '' ? null : file.type.slice(0, 160),
            fileKind:
              safeExtension === '.pdf' ? 'pdf' : safeExtension === '.xlsx' ? 'xlsx' : 'csv',
            failureCode: failure.code,
            warnings,
          },
          context,
        ),
      );
    } catch {
      // The batch could not even be recorded. The message below is still shown.
    }

    // The bytes are of no further use, and keeping a file we cannot read is a
    // risk with no benefit.
    await store.store.deleteUpload(stored.storedId, safeExtension).catch(() => undefined);
    refreshImportScreens();
    return failed(failure.message);
  }

  refreshImportScreens();
  revalidatePath(`/imports/${batchId}`);
  return succeeded('הקובץ נקרא. שום דבר עוד לא נכנס לחשבון — בואו נעבור על מה שנמצא.', batchId);
}

export async function reviewRowAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const reader = new FieldReader(data);
  const proposalId = reader.id('proposalId', 'שורה', { required: true });
  const batchId = reader.id('batchId', 'יבוא', { required: true });
  const reviewState = reader.optionalChoice('reviewState', [
    'pending',
    'included',
    'excluded',
  ] as const);
  const targetAccountId = reader.id('targetAccountId', 'חשבון');
  const targetDebtId = reader.id('targetDebtId', 'חוב');

  if (!reader.ok || proposalId === null || batchId === null) {
    return failed('בואו נשלים כמה פרטים.', reader.errors);
  }

  try {
    await (
      await householdStore()
    ).run((document, context) =>
      reviewProposal(
        document,
        {
          proposalId,
          ...(reviewState === null ? {} : { reviewState }),
          targetAccountId,
          targetDebtId,
        },
        context,
      ),
    );
  } catch (error) {
    return describe(error);
  }

  revalidatePath(`/imports/${batchId}`);
  return succeeded('נשמר.');
}

/**
 * Joining an imported bank debit to the check it was.
 *
 * A separate action from including the row, because they are separate decisions
 * and one is much heavier than the other: including a row records an expense,
 * while matching it to a check also closes that check and reduces a debt. The
 * reviewer says which check; nothing here guesses, however confident the
 * proposal was.
 *
 * Sending an empty `checkId` clears the match, so a person who picked the wrong
 * check can take it back before approving.
 */
export async function matchCheckAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const reader = new FieldReader(data);
  const proposalId = reader.id('proposalId', 'שורה', { required: true });
  const batchId = reader.id('batchId', 'יבוא', { required: true });
  const checkId = reader.id('checkId', 'צ׳ק');

  if (!reader.ok || proposalId === null || batchId === null) {
    return failed('בואו נשלים כמה פרטים.', reader.errors);
  }

  try {
    await (
      await householdStore()
    ).run((document, context) =>
      reviewProposal(document, { proposalId, targetCheckId: checkId }, context),
    );
  } catch (error) {
    return describe(error);
  }

  revalidatePath(`/imports/${batchId}`);
  return succeeded(checkId === null ? 'השיוך בוטל.' : gemach.matchChosen);
}

/**
 * Correcting a row.
 *
 * The correction is stored beside the parsed proposal, never over it. What the
 * document said stays readable next to what the reviewer decided, which is the
 * whole reason the review is worth anything.
 */
export async function correctRowAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const reader = new FieldReader(data);
  const proposalId = reader.id('proposalId', 'שורה', { required: true });
  const batchId = reader.id('batchId', 'יבוא', { required: true });
  const amountMinor = reader.money('amountMinor', 'סכום');
  const transactionDate = reader.date('transactionDate', 'תאריך');
  const description = reader.text('description', 'תיאור', { max: 300 });
  const direction = reader.choice(
    'direction',
    'נכנס או יוצא',
    ['inflow', 'outflow'] as const,
    'outflow',
  );
  const categoryKey = reader.optionalChoice('categoryKey', [
    'food',
    'housing_and_bills',
    'transport_and_fuel',
    'health',
    'education',
    'clothing',
    'celebrations_and_gifts',
    'cash_and_small',
    'holidays',
    'other',
  ] as const);

  if (!reader.ok || proposalId === null || batchId === null) {
    return failed('בואו נשלים כמה פרטים.', reader.errors);
  }

  try {
    await (
      await householdStore()
    ).run((document, context) => {
      const existing = document.importProposals.find(
        (candidate) => candidate.id === proposalId,
      );
      if (existing === undefined || existing.proposed.kind !== 'transaction') {
        return { document, value: undefined };
      }

      const base = existing.correction ?? existing.proposed;
      if (base.kind !== 'transaction') return { document, value: undefined };

      const correction: ProposedPayload = {
        kind: 'transaction',
        value: {
          ...base.value,
          amountMinor,
          transactionDate,
          description,
          direction,
          categoryKey,
        },
      };

      return reviewProposal(
        document,
        { proposalId, correction, reviewState: 'included' },
        context,
      );
    });
  } catch (error) {
    return describe(error);
  }

  revalidatePath(`/imports/${batchId}`);
  return succeeded('התיקון נשמר. מה שהמסמך אמר נשמר לצידו.');
}

export async function reviewAllAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const reader = new FieldReader(data);
  const batchId = reader.id('batchId', 'יבוא', { required: true });
  const reviewState = reader.choice(
    'reviewState',
    'החלטה',
    ['included', 'excluded'] as const,
    'included',
  );
  const onlyPending = reader.boolean('onlyPending');
  /**
   * Restrict a bulk include to what the classifier was confident about.
   *
   * The store refuses to sweep in anything else, so this flag cannot become a
   * way of approving unread rows even if the form is submitted by hand.
   */
  const onlyHighConfidence = reader.boolean('onlyHighConfidence');

  if (!reader.ok || batchId === null) {
    return failed('בואו נשלים כמה פרטים.', reader.errors);
  }

  let touched = 0;
  try {
    touched = await (
      await householdStore()
    ).run((document, context) =>
      reviewAll(document, { batchId, reviewState, onlyPending, onlyHighConfidence }, context),
    );
  } catch (error) {
    return describe(error);
  }

  revalidatePath(`/imports/${batchId}`);
  return succeeded(
    reviewState === 'included'
      ? onlyHighConfidence
        ? `${touched} שורות ברורות סומנו להכללה. השאר ממתינות לכם.`
        : `${touched} שורות סומנו להכללה.`
      : `${touched} שורות הוצאו.`,
  );
}

export async function approveBatchAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const reader = new FieldReader(data);
  const batchId = reader.id('batchId', 'יבוא', { required: true });
  if (!reader.ok || batchId === null) return failed('לא נבחר יבוא.', reader.errors);

  const store = await householdStore();

  let created = 0;
  try {
    const outcome = await store.run((document, context) =>
      approveBatch(document, { batchId }, context),
    );
    created = outcome.transactionsCreated + outcome.balancesCreated + outcome.debtEventsCreated;
  } catch (error) {
    return describe(error);
  }

  // The file has been read and the decision made; the bytes are not kept.
  await removeStoredFile(batchId);

  refreshMoneyScreens();
  refreshImportScreens();
  revalidatePath(`/imports/${batchId}`);
  return succeeded(`אושר. ${created} רשומות נכנסו לתמונה.`);
}

export async function rejectBatchAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const reader = new FieldReader(data);
  const batchId = reader.id('batchId', 'יבוא', { required: true });
  if (!reader.ok || batchId === null) return failed('לא נבחר יבוא.', reader.errors);

  try {
    await (
      await householdStore()
    ).run((document, context) => rejectBatch(document, { batchId }, context));
  } catch (error) {
    return describe(error);
  }

  await removeStoredFile(batchId);
  refreshImportScreens();
  revalidatePath(`/imports/${batchId}`);
  return succeeded('היבוא נדחה. שום דבר לא נכנס לחשבון.');
}

export async function reverseBatchAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const reader = new FieldReader(data);
  const batchId = reader.id('batchId', 'יבוא', { required: true });
  const reason = reader.text('reason', 'למה', { max: 300 });

  if (!reader.ok || batchId === null) {
    return failed('בואו נשלים כמה פרטים.', reader.errors);
  }

  let voided = 0;
  try {
    const outcome = await (
      await householdStore()
    ).run((document, context) => reverseBatch(document, { batchId, reason }, context));
    voided = outcome.transactionsVoided;
  } catch (error) {
    return describe(error);
  }

  refreshMoneyScreens();
  refreshImportScreens();
  revalidatePath(`/imports/${batchId}`);
  return succeeded(`היבוא בוטל. ${voided} רשומות כבר לא נספרות.`);
}

/**
 * Deletes the stored original once a batch has been decided.
 *
 * 05-ARCHITECTURE-DATA.md § Imports: an approved or rejected file is deleted at
 * once. What stays is the record of it — name, size, hash — which is what an
 * audit needs and is not a copy of the family's statement.
 */
async function removeStoredFile(batchId: string): Promise<void> {
  const store = await householdStore();
  try {
    const document = await store.readDocument();
    const batch = document.importBatches.find((candidate) => candidate.id === batchId);
    if (batch === undefined) return;

    const extension =
      batch.file.fileKind === 'pdf'
        ? '.pdf'
        : batch.file.fileKind === 'xlsx'
          ? '.xlsx'
          : '.csv';
    await store.store.deleteUpload(batch.file.storedId, extension);
    await store.store.deleteUpload(batch.file.storedId, '.bin');
  } catch {
    // Losing the sweep of one temporary file must not fail an approval that has
    // already been written. The retention sweep picks it up.
  }
}
