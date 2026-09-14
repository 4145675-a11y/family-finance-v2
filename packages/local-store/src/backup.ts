import { createHash } from 'node:crypto';

import {
  CURRENT_FORMAT_VERSION,
  READABLE_FORMAT_VERSIONS,
  parseStoreDocument,
  type StoreDocument,
} from './document';

/**
 * Carrying the household's data out, and bringing it back.
 *
 * A backup is the only feature here whose value is entirely in the bad day. So it
 * is built to be checkable rather than merely produced:
 *
 *  - the envelope states its format version, and a restore refuses a version this
 *    build does not know how to read rather than importing half of it;
 *  - the payload carries a checksum, so a truncated download or a file edited by
 *    a text editor is caught before anything is replaced;
 *  - a restore is previewed first — what is in the file, how old it is, how it
 *    compares to what is here now — and only then, on a second explicit action,
 *    applied;
 *  - nothing is overwritten until that second action, and the document being
 *    replaced is kept in the local history.
 *
 * There are no secrets in a backup because there are none in the document: the
 * store holds financial records, not credentials. That is worth stating because
 * it is a property to preserve, not an accident.
 */

/** The envelope version. Separate from the document's own format version. */
export const BACKUP_ENVELOPE_VERSION = 1;

export interface BackupEnvelope {
  readonly kind: 'family-finance-backup';
  readonly envelopeVersion: number;
  readonly createdAt: string;
  /** What produced it, for a person reading the file a year from now. */
  readonly producedBy: string;
  readonly documentFormatVersion: number;
  /** SHA-256 of the canonical payload text. */
  readonly checksum: string;
  readonly summary: BackupSummary;
  readonly document: StoreDocument;
}

export interface BackupSummary {
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
}

export class BackupError extends Error {
  readonly code:
    | 'not_a_backup'
    | 'unreadable_json'
    | 'checksum_mismatch'
    | 'unsupported_envelope'
    | 'unsupported_format'
    | 'invalid_document';

  constructor(code: BackupError['code'], message: string) {
    super(message);
    this.name = 'BackupError';
    this.code = code;
  }
}

export function summarise(document: StoreDocument): BackupSummary {
  const dates = document.transactions.map((transaction) => transaction.transactionDate).sort();
  return {
    householdName: document.household.name,
    accounts: document.accounts.length,
    transactions: document.transactions.length,
    debts: document.debts.length,
    budgets: document.budgets.length,
    importBatches: document.importBatches.length,
    tasks: document.tasks.length,
    auditEntries: document.audit.length,
    earliestTransaction: dates[0] ?? null,
    latestTransaction: dates[dates.length - 1] ?? null,
  };
}

/**
 * The canonical text the checksum is taken over.
 *
 * Keys sorted, at every depth. `JSON.stringify` preserves insertion order, and a
 * document that has been validated on the way in comes back with its keys in the
 * schema's order rather than the file's — so a checksum over the plain
 * serialisation would fail on a backup that is in fact perfectly intact. Sorting
 * makes the checksum a statement about the *content*, which is the only thing it
 * should be a statement about.
 *
 * Keeping the payload separate from the envelope means the envelope can gain a
 * field later without invalidating every backup already written.
 */
function payloadText(document: StoreDocument): string {
  return canonicalJson(document);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`);

  return `{${entries.join(',')}}`;
}

export function checksumOf(document: StoreDocument): string {
  return createHash('sha256').update(payloadText(document), 'utf8').digest('hex');
}

/**
 * The same checksum, over a document that has not been validated yet.
 *
 * Used on the way in, where the payload is whatever the file said and the point
 * is to find out whether it is intact before anything else is believed about it.
 */
export function rawChecksumOf(document: unknown): string {
  return createHash('sha256').update(canonicalJson(document), 'utf8').digest('hex');
}

export function createBackup(document: StoreDocument, now: string): BackupEnvelope {
  return {
    kind: 'family-finance-backup',
    envelopeVersion: BACKUP_ENVELOPE_VERSION,
    createdAt: now,
    producedBy: 'family-finance-control',
    documentFormatVersion: document.formatVersion,
    checksum: checksumOf(document),
    summary: summarise(document),
    document,
  };
}

export function serialiseBackup(envelope: BackupEnvelope): string {
  return `${JSON.stringify(envelope, null, 2)}\n`;
}

/** A file name that says what it is and when, without leaking anything. */
export function backupFileName(now: string): string {
  return `family-finance-backup-${now.slice(0, 19).replace(/[:]/g, '-')}.json`;
}

export interface RestorePreview {
  readonly createdAt: string;
  readonly summary: BackupSummary;
  readonly documentFormatVersion: number;
  /** What is here now, for the side-by-side the confirmation screen shows. */
  readonly current: BackupSummary | null;
  readonly document: StoreDocument;
}

/**
 * Reads a backup and says what it holds — without touching anything.
 *
 * Every failure is named. "The file is not a backup", "the file was changed since
 * it was made" and "this backup is from a newer version" are three different
 * problems with three different answers, and a single "restore failed" would tell
 * the family none of them.
 */
export function previewRestore(text: string, current: StoreDocument | null): RestorePreview {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new BackupError('unreadable_json', 'the file is not readable as a backup');
  }

  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    (parsed as { kind?: unknown }).kind !== 'family-finance-backup'
  ) {
    throw new BackupError('not_a_backup', 'this file was not produced by this application');
  }

  const envelope = parsed as Partial<BackupEnvelope>;

  if (
    typeof envelope.envelopeVersion !== 'number' ||
    envelope.envelopeVersion > BACKUP_ENVELOPE_VERSION
  ) {
    throw new BackupError(
      'unsupported_envelope',
      'this backup was made by a newer version of the application',
    );
  }

  if (
    typeof envelope.documentFormatVersion !== 'number' ||
    !READABLE_FORMAT_VERSIONS.includes(envelope.documentFormatVersion)
  ) {
    throw new BackupError(
      'unsupported_format',
      `this backup holds data in format ${String(envelope.documentFormatVersion)}, which this version cannot read`,
    );
  }

  /*
   * The checksum is verified against the file as written, before any migration.
   *
   * An older backup is checksummed over the document as it was then; upgrading it
   * first and comparing afterwards would fail every backup taken before the
   * format changed, and the failure would read as "your file is corrupt".
   */
  if (
    typeof envelope.checksum !== 'string' ||
    envelope.checksum !== rawChecksumOf(envelope.document)
  ) {
    throw new BackupError(
      'checksum_mismatch',
      'the backup does not match its own checksum, so it was changed or truncated',
    );
  }

  let document: StoreDocument;
  try {
    document = parseStoreDocument(envelope.document);
  } catch (error) {
    throw new BackupError(
      'invalid_document',
      error instanceof Error ? error.message : 'the data inside the backup is not valid',
    );
  }

  return {
    createdAt: typeof envelope.createdAt === 'string' ? envelope.createdAt : 'unknown',
    summary: summarise(document),
    documentFormatVersion: envelope.documentFormatVersion,
    current: current === null ? null : summarise(current),
    document,
  };
}

/**
 * The document a restore would install.
 *
 * Deliberately separate from applying it: the caller previews, shows the family
 * what changes, and only then writes. `formatVersion` is normalised to the
 * current one here, which is where a migration between versions would live.
 */
export function documentToRestore(preview: RestorePreview): StoreDocument {
  return { ...preview.document, formatVersion: CURRENT_FORMAT_VERSION };
}
