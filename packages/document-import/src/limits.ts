/**
 * Every bound the importer refuses to cross.
 *
 * A financial document arrives from outside the product, and outside means a file
 * that may be hostile, corrupt, or simply enormous by accident. 07-SECURITY-PRIVACY.md
 * requires size and content limits on upload; this module is where every one of
 * them is written down once, with the reason, so a limit can be reviewed rather
 * than discovered in a stack trace.
 *
 * The numbers are chosen against real documents: a year of one bank account is a
 * few hundred rows and well under a megabyte; a twelve-month card statement PDF is
 * a few dozen pages. Each limit is comfortably above what a household produces and
 * far below what would exhaust memory.
 */

export const LIMITS = {
  /** Largest upload accepted, in bytes. Twenty megabytes. */
  maxFileBytes: 20 * 1024 * 1024,

  /**
   * Largest total size after decompression, in bytes.
   *
   * An `.xlsx` is a ZIP. A forty-kilobyte archive can expand to gigabytes of XML —
   * a decompression bomb. Extraction stops the moment the running total passes
   * this, so a bomb costs bounded memory instead of the process.
   */
  maxInflatedBytes: 120 * 1024 * 1024,

  /**
   * Largest expansion ratio permitted for any single archive member.
   *
   * Ordinary spreadsheet XML compresses around 10–20×. Two hundred is far above
   * anything legitimate and far below what a bomb needs.
   */
  maxCompressionRatio: 200,

  /** Members in one archive. A workbook has tens, not thousands. */
  maxArchiveEntries: 512,

  /** Sheets read from one workbook. */
  maxSheets: 40,

  /** Rows read from one sheet. */
  maxRowsPerSheet: 20_000,

  /** Columns read from one row. */
  maxColumnsPerRow: 256,

  /** Characters kept from a single cell. Longer text is truncated, and said so. */
  maxCellChars: 2_000,

  /** Pages read from one PDF. */
  maxPdfPages: 300,

  /** Indirect objects parsed from one PDF. */
  maxPdfObjects: 200_000,

  /** Characters of text kept from one PDF page. */
  maxPdfPageChars: 200_000,

  /** Rows carried forward as proposals from a single document. */
  maxProposalsPerBatch: 5_000,

  /** Bytes of a CSV read as text. */
  maxCsvBytes: 20 * 1024 * 1024,

  /** Wall-clock budget for one extraction, in milliseconds. */
  extractionBudgetMs: 20_000,
} as const;

export type Limits = typeof LIMITS;

/** Raised when a document asks for more than {@link LIMITS} allows. */
export class LimitExceededError extends Error {
  readonly limit: keyof Limits;

  constructor(limit: keyof Limits, detail: string) {
    super(`import limit ${limit} exceeded: ${detail}`);
    this.name = 'LimitExceededError';
    this.limit = limit;
  }
}

/** Raised when a document is not the thing it claims to be, or cannot be read. */
export class MalformedDocumentError extends Error {
  readonly code:
    | 'signature_mismatch'
    | 'malformed_archive'
    | 'malformed_document'
    | 'encrypted_file'
    | 'macro_enabled_file'
    | 'unsupported_file_type';

  constructor(code: MalformedDocumentError['code'], detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'MalformedDocumentError';
    this.code = code;
  }
}

/**
 * A deadline for one extraction.
 *
 * Parsing is synchronous and CPU-bound, so a timer cannot interrupt it. Instead
 * the parsers ask this between units of work — per row, per page, per archive
 * member — which bounds the damage a pathological file can do without pretending
 * that arbitrary code was made interruptible.
 */
export class Deadline {
  private readonly endsAt: number;

  constructor(
    budgetMs: number = LIMITS.extractionBudgetMs,
    private readonly now: () => number = Date.now,
  ) {
    this.endsAt = now() + budgetMs;
  }

  expired(): boolean {
    return this.now() >= this.endsAt;
  }

  /** Throws once the budget is gone. Called between units of work. */
  check(): void {
    if (this.expired()) {
      throw new LimitExceededError('extractionBudgetMs', 'extraction took too long');
    }
  }
}
