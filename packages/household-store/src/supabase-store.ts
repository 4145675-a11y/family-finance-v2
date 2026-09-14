import { createHash, randomUUID } from 'node:crypto';

import {
  viewOf,
  type CommandContext,
  type CommandResult,
  type CreateHouseholdInput,
  type HouseholdView,
  type StoreDocument,
} from '@family-finance/local-store';

import {
  changesBetween,
  documentFromLoaded,
  invitationsFromLoaded,
  isEmptyChangeSet,
  type HouseholdInvitation,
} from './document-mapping';
import {
  ConcurrentModificationError,
  PersistenceError,
  StoreNotInitialisedError,
  type HouseholdStorePort,
  type UploadArea,
} from './port';
import { TransportError, type HouseholdTransport } from './transport';

/**
 * The household store, backed by Supabase.
 *
 * The same door as the file-backed `HouseholdStore`, behind which the pure
 * commands run unchanged. What differs is where the document comes from and
 * where the result goes: `load_household_document()` and
 * `apply_household_changes()`, both executed as the signed-in person, so that
 * row-level security — not this class — decides what they may read and write.
 *
 * One instance serves one person and one household for one request. It holds
 * no cache: every read is a fresh load, every `run` loads, applies the command
 * and sends the difference with the version it read, and a household that
 * moved in between is a `ConcurrentModificationError` rather than a silent
 * overwrite.
 */
export class SupabaseHouseholdStore implements HouseholdStorePort {
  readonly backend = 'supabase' as const;
  readonly store: UploadArea = new TransientUploadArea();

  private householdId: string | null;

  constructor(
    private readonly transport: HouseholdTransport,
    private readonly actorProfileId: string,
    householdId: string | null,
  ) {
    this.householdId = householdId;
  }

  /** The household this store reads, once one exists. */
  get currentHouseholdId(): string | null {
    return this.householdId;
  }

  async exists(): Promise<boolean> {
    if (this.householdId !== null) return true;
    const memberships = await this.guarded(() => this.transport.memberships());
    const first = memberships[0];
    if (first === undefined) return false;
    this.householdId = first.householdId;
    return true;
  }

  async create(input: CreateHouseholdInput): Promise<string> {
    if (await this.exists()) {
      throw new PersistenceError(
        'unsupported_in_backend',
        'this person already has a household',
      );
    }
    const id = await this.guarded(() =>
      this.transport.createHousehold({
        name: input.householdName.trim(),
        profileDisplayName: input.profileName.trim(),
        currency: input.currency ?? 'ILS',
        timeZone: input.timeZone ?? 'Asia/Jerusalem',
      }),
    );
    this.householdId = id;
    return id;
  }

  async readDocument(): Promise<StoreDocument> {
    return (await this.load()).document;
  }

  async readDocumentOrNull(): Promise<StoreDocument | null> {
    if (!(await this.exists())) return null;
    return (await this.load()).document;
  }

  async view(asOf = new Date().toISOString()): Promise<HouseholdView | null> {
    const document = await this.readDocumentOrNull();
    return document === null ? null : viewOf(document, asOf);
  }

  /** The identity every command is attributed to: the signed-in person. */
  async context(now = new Date().toISOString()): Promise<CommandContext> {
    return { actorProfileId: this.actorProfileId, now };
  }

  async run<T>(
    command: (document: StoreDocument, context: CommandContext) => CommandResult<T>,
    options: { readonly now?: string; readonly expectedRevision?: string } = {},
  ): Promise<T> {
    const now = options.now ?? new Date().toISOString();
    const { document, version } = await this.load();
    if (
      options.expectedRevision !== undefined &&
      options.expectedRevision !== String(version)
    ) {
      throw new ConcurrentModificationError();
    }

    const outcome = command(document, { actorProfileId: this.actorProfileId, now });
    const changes = changesBetween(document, outcome.document, this.actorProfileId);
    if (isEmptyChangeSet(changes)) return outcome.value;

    await this.guarded(() => this.transport.apply(this.requireHousehold(), version, changes));
    return outcome.value;
  }

  async replaceDocument(): Promise<void> {
    throw new PersistenceError(
      'unsupported_in_backend',
      'restoring a backup over the database is not supported; money records are never replaced (ADR-0032)',
    );
  }

  /** Invitations of the household, for the members screen. */
  async invitations(): Promise<HouseholdInvitation[]> {
    const householdId = await this.resolveHousehold();
    const loaded = await this.guarded(() => this.transport.load(householdId));
    if (loaded === null) throw new StoreNotInitialisedError();
    return invitationsFromLoaded(loaded);
  }

  /** Mints an invitation. The token is shown once and never stored. */
  async invite(email: string): Promise<string> {
    const householdId = await this.resolveHousehold();
    return this.guarded(() => this.transport.createInvitation(householdId, email));
  }

  async acceptInvitation(token: string): Promise<string> {
    const householdId = await this.guarded(() => this.transport.acceptInvitation(token));
    this.householdId = householdId;
    return householdId;
  }

  private requireHousehold(): string {
    if (this.householdId === null) throw new StoreNotInitialisedError();
    return this.householdId;
  }

  /**
   * The household, looked up when this store has not read anything yet. A
   * store lives for one request and starts empty; the first call on it — a
   * read, or an invitation — is what resolves the membership.
   */
  private async resolveHousehold(): Promise<string> {
    if (this.householdId === null && !(await this.exists())) {
      throw new StoreNotInitialisedError();
    }
    return this.requireHousehold();
  }

  private async load(): Promise<{ document: StoreDocument; version: number }> {
    if (this.householdId === null && !(await this.exists())) {
      throw new StoreNotInitialisedError();
    }
    const loaded = await this.guarded(() => this.transport.load(this.requireHousehold()));
    if (loaded === null) throw new StoreNotInitialisedError();
    const document = documentFromLoaded(loaded);
    return { document, version: document.household.version };
  }

  /** Turns a transport failure into the error the application already knows how to name. */
  private async guarded<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof TransportError) {
        switch (error.failure) {
          case 'version_conflict':
            throw new ConcurrentModificationError();
          case 'not_a_member':
            throw new PersistenceError('not_a_member', error.message);
          case 'not_authenticated':
            throw new PersistenceError('not_authenticated', error.message);
          case 'permission_denied':
            throw new PersistenceError('permission_denied', error.message);
          case 'invitation_invalid':
            throw new PersistenceError('invitation_invalid', error.message);
          default:
            throw new PersistenceError('unavailable', error.message);
        }
      }
      throw error;
    }
  }
}

/**
 * The upload area of a hosted deployment: nothing is kept.
 *
 * An uploaded document is parsed from memory the moment it arrives, and the
 * import batch records its name, size and hash. A server that other people can
 * reach does not keep a family's bank statement on its disk for a day; the
 * retention sweep therefore always finds nothing, which is the point.
 */
export class TransientUploadArea implements UploadArea {
  async storeUpload(bytes: Uint8Array): Promise<{ storedId: string; sha256: string }> {
    return { storedId: randomUUID(), sha256: createHash('sha256').update(bytes).digest('hex') };
  }

  async deleteUpload(): Promise<void> {
    return undefined;
  }

  async staleUploads(): Promise<string[]> {
    return [];
  }

  async removeUploadByName(): Promise<void> {
    return undefined;
  }

  async writeBackup(): Promise<string> {
    throw new PersistenceError(
      'unsupported_in_backend',
      'a hosted deployment does not write backups to its own disk; the backup is downloaded instead',
    );
  }
}
