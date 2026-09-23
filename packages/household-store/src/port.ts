import type { StoreDocument } from '@family-finance/local-store';
import type {
  CommandContext,
  CommandResult,
  CreateHouseholdInput,
  HouseholdView,
} from '@family-finance/local-store';

/**
 * The one door between the application and a household's data — as a contract.
 *
 * `HouseholdStore` in local-store has been that door since M7, backed by a JSON
 * file. This is its surface, written down, so a second implementation backed by
 * Supabase can stand behind the same door and the forty callers cannot tell —
 * and, more to the point, cannot reach past it to a file or a table.
 *
 * Reads return a `HouseholdView` or the validated document; writes go through
 * `run`, which applies one pure command atomically. The contract deliberately
 * exposes nothing about where the data lives.
 */
export interface HouseholdStorePort {
  /** True when this person has a household to read. */
  exists(): Promise<boolean>;
  /** Creates the household. The only operation that works before setup. */
  create(input: CreateHouseholdInput, now?: string): Promise<string>;
  readDocument(): Promise<StoreDocument>;
  readDocumentOrNull(): Promise<StoreDocument | null>;
  view(asOf?: string): Promise<HouseholdView | null>;
  context(now?: string): Promise<CommandContext>;
  run<T>(
    command: (document: StoreDocument, context: CommandContext) => CommandResult<T>,
    options?: {
      readonly now?: string;
      readonly expectedRevision?: string;
      /** Told whether the command found the action already recorded. */
      readonly report?: (outcome: { readonly alreadyRecorded: boolean }) => void;
    },
  ): Promise<T>;
  /** Replaces everything. Restore only, and not every backend supports it. */
  replaceDocument(document: StoreDocument): Promise<void>;
  /** The temporary area an upload passes through, and where a backup is written. */
  readonly store: UploadArea;
  /** Which backend stands behind the door. For screens that must say so. */
  readonly backend: 'local_json' | 'supabase';
}

/**
 * Where uploaded bytes wait between arrival and parsing, and where a backup is
 * written. The file store keeps them on disk for a day; a hosted deployment
 * keeps nothing at all.
 */
export interface UploadArea {
  storeUpload(
    bytes: Uint8Array,
    extension: string,
  ): Promise<{ storedId: string; sha256: string }>;
  deleteUpload(storedId: string, extension: string): Promise<void>;
  staleUploads(olderThanMs: number, now?: number): Promise<string[]>;
  removeUploadByName(name: string): Promise<void>;
  writeBackup(name: string, content: string): Promise<string>;
}

/**
 * Something the database refused or could not do, reduced to a code the
 * application can name in the family's language. The original database error
 * — which may carry identifiers — is never attached.
 */
export class PersistenceError extends Error {
  readonly code: PersistenceErrorCode;

  constructor(code: PersistenceErrorCode, message: string) {
    super(message);
    this.name = 'PersistenceError';
    this.code = code;
  }
}

export type PersistenceErrorCode =
  | 'not_authenticated'
  | 'not_a_member'
  | 'permission_denied'
  | 'unsupported_in_backend'
  | 'invalid_document'
  | 'invitation_invalid'
  | 'schema_outdated'
  | 'unavailable';

/** The household changed under a command. Same name as the file store's, so callers treat them alike. */
export class ConcurrentModificationError extends Error {
  constructor(message = 'the household changed since it was read') {
    super(message);
    this.name = 'ConcurrentModificationError';
  }
}

/** No household yet. Same name as the file store's, for the same reason. */
export class StoreNotInitialisedError extends Error {
  constructor(message = 'no household has been set up') {
    super(message);
    this.name = 'StoreNotInitialisedError';
  }
}
