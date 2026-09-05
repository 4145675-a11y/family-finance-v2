import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parseStoreDocument, type StoreDocument } from './document';
import { safeJoin, uploadFileName, type StorePaths } from './paths';

/**
 * The document on disk, and the guarantee that a write either happened or did not.
 *
 * Two mechanisms, and both exist for the same failure. A family approving an
 * import must not be able to end up with half the transactions written, and a
 * power cut in the middle of a save must not be able to leave an unreadable file
 * where their financial history used to be.
 *
 * Write: the whole document is serialised, written to a staging file, and then
 * renamed over the live one. Rename is atomic on every filesystem this runs on,
 * so a reader sees either the old document or the new one, never a partial one.
 *
 * Concurrency: every mutation runs through a promise chain, so two requests
 * arriving at once are applied one after another rather than both reading the
 * same document and one silently losing. A file lock would be needed for two
 * *processes*; the application is one process, and claiming more protection than
 * is implemented would be worse than stating this.
 */

export interface StoreSnapshot {
  readonly document: StoreDocument;
  /** SHA-256 of the serialised document, for optimistic concurrency. */
  readonly revision: string;
}

export class ConcurrentModificationError extends Error {
  constructor() {
    super('the data changed while this action was being prepared');
    this.name = 'ConcurrentModificationError';
  }
}

export class StoreNotInitialisedError extends Error {
  constructor() {
    super('no household has been set up yet');
    this.name = 'StoreNotInitialisedError';
  }
}

/** How many previous documents to keep. Enough to undo a bad day. */
const HISTORY_LIMIT = 20;

function serialise(document: StoreDocument): string {
  // Two-space indentation: the file is meant to be readable by the person whose
  // money it describes, and a diff of it should be legible.
  return `${JSON.stringify(document, null, 2)}\n`;
}

function revisionOf(serialised: string): string {
  return createHash('sha256').update(serialised, 'utf8').digest('hex');
}

export class FileStore {
  /** Serialises mutations. Every write waits for the previous one to finish. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly paths: StorePaths) {}

  async initialised(): Promise<boolean> {
    return existsSync(this.paths.document);
  }

  private async ensureDirectories(): Promise<void> {
    await mkdir(this.paths.root, { recursive: true });
    await mkdir(this.paths.history, { recursive: true });
    await mkdir(this.paths.uploads, { recursive: true });
    await mkdir(this.paths.backups, { recursive: true });
  }

  /** Reads and validates the document. Throws when there is not one yet. */
  async read(): Promise<StoreSnapshot> {
    let raw: string;
    try {
      raw = await readFile(this.paths.document, 'utf8');
    } catch {
      throw new StoreNotInitialisedError();
    }

    const document = parseStoreDocument(JSON.parse(raw) as unknown);
    return { document, revision: revisionOf(raw) };
  }

  /** Reads, or returns null when the household has not been created yet. */
  async readOrNull(): Promise<StoreSnapshot | null> {
    if (!(await this.initialised())) return null;
    return this.read();
  }

  /**
   * Applies a change.
   *
   * The mutation receives the current document and returns the next one. It runs
   * inside the queue, so it sees a document nobody else is about to overwrite, and
   * its result is validated before it replaces anything: a mutation that produces
   * an invalid document fails without touching the file.
   */
  async mutate<T>(
    apply: (
      document: StoreDocument,
    ) =>
      { document: StoreDocument; result: T } | Promise<{ document: StoreDocument; result: T }>,
    options: { readonly expectedRevision?: string } = {},
  ): Promise<{ result: T; revision: string }> {
    const run = async (): Promise<{ result: T; revision: string }> => {
      await this.ensureDirectories();
      const current = await this.read();

      if (
        options.expectedRevision !== undefined &&
        options.expectedRevision !== current.revision
      ) {
        throw new ConcurrentModificationError();
      }

      const { document, result } = await apply(current.document);

      // Validate before writing. A mutation that produced something invalid must
      // not be able to leave it on disk for the next read to choke on.
      const next = parseStoreDocument({
        ...document,
        updatedAt: new Date().toISOString(),
      });

      const serialised = serialise(next);
      await this.writeAtomically(serialised);
      await this.keepHistory(current.revision);

      return { result, revision: revisionOf(serialised) };
    };

    const chained = this.queue.then(run, run);
    // Keep the chain alive even when this mutation fails, so one error does not
    // wedge every later write.
    this.queue = chained.catch(() => undefined);
    return chained;
  }

  /** Creates the first document. Refuses to overwrite an existing household. */
  async create(document: StoreDocument): Promise<StoreSnapshot> {
    await this.ensureDirectories();
    if (await this.initialised()) {
      throw new Error('a household already exists in this data directory');
    }
    const serialised = serialise(parseStoreDocument(document));
    await this.writeAtomically(serialised);
    return { document, revision: revisionOf(serialised) };
  }

  /**
   * Replaces the whole document, keeping the previous one in history.
   *
   * Used only by restore, which is the one operation whose entire purpose is to
   * replace everything. It is deliberately separate from `mutate` so that a
   * wholesale replacement can never happen by accident inside an ordinary edit.
   */
  async replace(document: StoreDocument): Promise<StoreSnapshot> {
    await this.ensureDirectories();
    const previous = await this.readOrNull();
    const serialised = serialise(parseStoreDocument(document));
    await this.writeAtomically(serialised);
    if (previous !== null) await this.keepHistory(previous.revision);
    return { document, revision: revisionOf(serialised) };
  }

  private async writeAtomically(serialised: string): Promise<void> {
    await writeFile(this.paths.staging, serialised, { encoding: 'utf8' });
    await rename(this.paths.staging, this.paths.document);
  }

  /**
   * Keeps the document that was just replaced.
   *
   * Not a backup — a backup is something a person asks for and can carry away.
   * This is a short local history so that a mistaken bulk action has an obvious
   * way back, and it is bounded so it cannot grow without limit.
   */
  private async keepHistory(previousRevision: string): Promise<void> {
    const current = await readFile(this.paths.document, 'utf8').catch(() => null);
    if (current === null) return;

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const name = `${stamp}-${previousRevision.slice(0, 8)}.json`;
    await writeFile(safeJoin(this.paths.history, name), current, 'utf8');

    const entries = (await readdir(this.paths.history))
      .filter((entry) => entry.endsWith('.json'))
      .sort();
    for (const stale of entries.slice(0, Math.max(0, entries.length - HISTORY_LIMIT))) {
      await rm(safeJoin(this.paths.history, stale), { force: true });
    }
  }

  /**
   * Stores an uploaded original.
   *
   * The name is a generated identifier and an extension this code chose. The
   * user's file name is kept in the import batch for display and never reaches
   * the filesystem, which is how 07-SECURITY-PRIVACY.md's traversal rule is held
   * structurally rather than by escaping.
   */
  async storeUpload(
    bytes: Uint8Array,
    extension: string,
  ): Promise<{ storedId: string; sha256: string }> {
    await this.ensureDirectories();
    const storedId = randomUUID();
    const path = safeJoin(this.paths.uploads, uploadFileName(storedId, extension));
    await writeFile(path, bytes);
    return { storedId, sha256: createHash('sha256').update(bytes).digest('hex') };
  }

  async readUpload(storedId: string, extension: string): Promise<Uint8Array | null> {
    const path = safeJoin(this.paths.uploads, uploadFileName(storedId, extension));
    try {
      const buffer = await readFile(path);
      return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    } catch {
      return null;
    }
  }

  /**
   * Deletes an uploaded original.
   *
   * Called when a batch is approved, rejected or reversed. The record of the file
   * — its name, size and hash — stays in the import history; the bytes do not,
   * because keeping a family's statements around after they have been read is a
   * risk with no matching benefit.
   */
  async deleteUpload(storedId: string, extension: string): Promise<void> {
    const path = safeJoin(this.paths.uploads, uploadFileName(storedId, extension));
    await rm(path, { force: true });
  }

  /** Uploads older than the retention window, for the sweep. */
  async staleUploads(olderThanMs: number, now = Date.now()): Promise<string[]> {
    if (!existsSync(this.paths.uploads)) return [];
    const names = await readdir(this.paths.uploads);
    const stale: string[] = [];
    for (const name of names) {
      const path = join(this.paths.uploads, name);
      const info = await stat(path).catch(() => null);
      if (info !== null && now - info.mtimeMs > olderThanMs) stale.push(name);
    }
    return stale;
  }

  async removeUploadByName(name: string): Promise<void> {
    await rm(safeJoin(this.paths.uploads, name), { force: true });
  }

  async writeBackup(name: string, content: string): Promise<string> {
    await this.ensureDirectories();
    const path = safeJoin(this.paths.backups, name);
    await writeFile(path, content, 'utf8');
    return path;
  }
}
