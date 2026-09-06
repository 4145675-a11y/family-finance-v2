import 'server-only';

import { householdStore } from './server';

/**
 * Sweeping away uploaded originals nobody decided about.
 *
 * 05-ARCHITECTURE-DATA.md § Imports: "קובץ לא מאושר נמחק בתוך 24 שעות;
 * מאושר/נדחה נמחק מיד". The immediate half is handled where the decision is made
 * — approving, rejecting or reversing a batch deletes its file. This is the other
 * half: the file somebody uploaded, looked at, and closed the tab on.
 *
 * The record of the upload is never swept. Name, size, type and hash stay in the
 * import history, because that is what an audit needs and it is not a copy of the
 * family's statement.
 *
 * It runs when the upload screen is opened rather than on a timer. A timer in a
 * local application is a process that has to be alive to be correct, and this one
 * does not: the sweep is cheap, idempotent, and the upload screen is exactly
 * where a stale file matters.
 */

/** How long an undecided upload may sit. */
export const RETENTION_MS = 24 * 60 * 60 * 1000;

export interface SweepResult {
  readonly removed: number;
  /** Batches whose file is gone but which are still waiting for a decision. */
  readonly expiredBatches: number;
}

/**
 * Deletes stored originals older than the window.
 *
 * A file still referenced by a batch that is waiting for review is deleted too
 * once it is old enough — the rule is about the bytes, not about the decision.
 * The review screen still works: the proposals were extracted at upload time and
 * live in the document, and the raw text of every row is stored with it.
 */
export async function sweepExpiredUploads(now = Date.now()): Promise<SweepResult> {
  const store = householdStore();

  if (!(await store.exists())) return { removed: 0, expiredBatches: 0 };

  let stale: string[];
  try {
    stale = await store.store.staleUploads(RETENTION_MS, now);
  } catch {
    // A sweep that cannot list is not a reason to fail the page it runs on.
    return { removed: 0, expiredBatches: 0 };
  }

  if (stale.length === 0) return { removed: 0, expiredBatches: 0 };

  const document = await store.readDocumentOrNull();
  const waitingIds = new Set(
    (document?.importBatches ?? [])
      .filter((batch) => batch.status === 'needs_review')
      .map((batch) => batch.file.storedId),
  );

  let removed = 0;
  let expiredBatches = 0;

  for (const name of stale) {
    // The stored name is `<uuid><extension>`; the identifier is the first 36.
    const storedId = name.slice(0, 36);
    try {
      await store.store.removeUploadByName(name);
      removed += 1;
      if (waitingIds.has(storedId)) expiredBatches += 1;
    } catch {
      // One file that will not delete must not stop the rest.
    }
  }

  return { removed, expiredBatches };
}
