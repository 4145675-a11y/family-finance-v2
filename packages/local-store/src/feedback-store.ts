import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';

import {
  FEEDBACK_HOURLY_LIMIT,
  buildFeedbackRecord,
  feedbackRecordSchema,
  feedbackReference,
  type FeedbackBuild,
  type FeedbackRecord,
  type FeedbackSubmission,
} from '@family-finance/contracts';

import { safeJoin } from './paths';

/**
 * Feedback on the file backend (ADR-0047 § 6).
 *
 * One file per note, in `<data>/feedback/`, beside the household document and
 * never inside it. A note is not money: it has no place in a backup or an
 * export of the family's data, and keeping it out of the document means a
 * restore can neither lose one nor bring a stranger's back.
 *
 * Files are written with `wx`, so an existing note is never overwritten — the
 * same guarantee the reviewer relies on when a status is recorded by hand.
 * File names are references this module generated, joined through `safeJoin`.
 */

export const FEEDBACK_DIRECTORY = 'feedback';

/** A reference is also a file name: `fb-YYYYMMDD-HHMMSS-xxxxxx.json`. */
const FILE_NAME = /^(fb-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-[0-9a-f]{6})\.json$/u;

export class FeedbackLimitError extends Error {
  constructor() {
    super('feedback limit reached');
    this.name = 'FeedbackLimitError';
  }
}

export interface LocalFeedbackStoreOptions {
  /** The data root (`StorePaths.root`). */
  readonly root: string;
  /** Called before every operation; the passkey lock on the file backend. */
  readonly guard: () => void | Promise<void>;
  readonly now?: () => Date;
  readonly randomHex?: () => string;
}

export class LocalFeedbackStore {
  private readonly directory: string;
  private readonly now: () => Date;
  private readonly randomHex: () => string;
  /** One send at a time, so the hourly count cannot be raced inside the process. */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: LocalFeedbackStoreOptions) {
    this.directory = safeJoin(options.root, FEEDBACK_DIRECTORY);
    this.now = options.now ?? (() => new Date());
    this.randomHex = options.randomHex ?? (() => randomBytes(3).toString('hex'));
  }

  /** Stores one note and returns its reference. */
  async submit(submission: FeedbackSubmission, build: FeedbackBuild): Promise<string> {
    const run = this.chain.then(async () => {
      await this.options.guard();
      await mkdir(this.directory, { recursive: true });

      const at = this.now();
      const recent = (await this.references()).filter(
        (entry) => at.getTime() - entry.at.getTime() < 60 * 60 * 1000,
      );
      if (recent.length >= FEEDBACK_HOURLY_LIMIT) throw new FeedbackLimitError();

      const reference = feedbackReference(at, this.randomHex());
      const record = buildFeedbackRecord(submission, {
        reference,
        createdAt: at.toISOString(),
        build,
      });
      await writeFile(
        safeJoin(this.directory, `${reference}.json`),
        `${JSON.stringify(record, null, 2)}\n`,
        { encoding: 'utf8', flag: 'wx' },
      );
      return reference;
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** Every note on disk, newest first. A file that does not parse is skipped, not trusted. */
  async list(): Promise<FeedbackRecord[]> {
    await this.options.guard();
    const records: FeedbackRecord[] = [];
    for (const entry of await this.references()) {
      const raw = await readFile(safeJoin(this.directory, entry.file), 'utf8');
      const parsed = feedbackRecordSchema.safeParse(safeJson(raw));
      if (parsed.success && parsed.data.reference === entry.reference)
        records.push(parsed.data);
    }
    return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private async references(): Promise<{ file: string; reference: string; at: Date }[]> {
    let names: string[];
    try {
      names = await readdir(this.directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const entries: { file: string; reference: string; at: Date }[] = [];
    for (const name of names) {
      const match = FILE_NAME.exec(name);
      if (match === null) continue;
      const [, reference, y, mo, d, h, mi, s] = match;
      entries.push({
        file: name,
        reference: reference ?? '',
        at: new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`),
      });
    }
    return entries;
  }
}

/** JSON.parse that answers `undefined` for a file that is not JSON. */
function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}
