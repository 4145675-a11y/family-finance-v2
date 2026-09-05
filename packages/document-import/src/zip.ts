import { inflateRawSync } from 'node:zlib';

import { LIMITS, LimitExceededError, MalformedDocumentError, type Deadline } from './limits';

/**
 * A ZIP reader, written rather than installed.
 *
 * An `.xlsx` is a ZIP archive of XML parts, so reading one starts here. This is
 * about two hundred lines of well-specified format handling, and writing it buys
 * three things a general-purpose library would not give:
 *
 *  1. Every limit in `limits.ts` applies during decompression, not after it, so a
 *     decompression bomb costs bounded memory instead of the process.
 *  2. Nothing is ever written to disk and no entry name is ever used as a path, so
 *     the "zip slip" traversal class cannot occur — there is no extraction step to
 *     traverse with.
 *  3. The dependency policy in `ADR-0006` stays intact: no new runtime dependency
 *     enters a project that handles a family's financial documents.
 *
 * Only what a workbook needs is implemented: stored and deflated entries, read
 * from the central directory. Encryption, spanning and ZIP64 archives above four
 * gigabytes are refused by name rather than half-supported.
 */

export interface ZipEntry {
  /** The name as recorded in the archive. Used for lookup, never as a path. */
  readonly name: string;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly compressionMethod: number;
  readonly localHeaderOffset: number;
  readonly encrypted: boolean;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const ZIP64_EOCD_LOCATOR_SIGNATURE = 0x07064b50;

/** Maximum size of the trailing comment the end-of-directory record may carry. */
const MAX_EOCD_SEARCH = 66_000;

function readU16(view: DataView, offset: number): number {
  if (offset + 2 > view.byteLength) {
    throw new MalformedDocumentError('malformed_archive', 'archive ends inside a header');
  }
  return view.getUint16(offset, true);
}

function readU32(view: DataView, offset: number): number {
  if (offset + 4 > view.byteLength) {
    throw new MalformedDocumentError('malformed_archive', 'archive ends inside a header');
  }
  return view.getUint32(offset, true);
}

/**
 * Entry names are stored as UTF-8 when bit 11 of the flags is set, and in the
 * archive's code page otherwise. Every part name inside an Office document is
 * ASCII, so decoding as UTF-8 is correct for the files this reader opens and
 * harmless for the rest — a mis-decoded name simply fails to match a lookup.
 */
const nameDecoder = new TextDecoder('utf-8', { fatal: false });

/** Reads the central directory. No entry data is decompressed here. */
export function readZipDirectory(bytes: Uint8Array): readonly ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const eocdOffset = findEndOfCentralDirectory(view, bytes.byteLength);
  const entryCount = readU16(view, eocdOffset + 10);
  const directorySize = readU32(view, eocdOffset + 12);
  const directoryOffset = readU32(view, eocdOffset + 16);

  if (entryCount > LIMITS.maxArchiveEntries) {
    throw new LimitExceededError('maxArchiveEntries', `${entryCount} entries`);
  }
  if (directoryOffset + directorySize > bytes.byteLength) {
    throw new MalformedDocumentError(
      'malformed_archive',
      'the directory points past the end of the file',
    );
  }

  const entries: ZipEntry[] = [];
  let cursor = directoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (readU32(view, cursor) !== CENTRAL_SIGNATURE) {
      throw new MalformedDocumentError('malformed_archive', 'a directory entry is corrupt');
    }

    const flags = readU16(view, cursor + 8);
    const compressionMethod = readU16(view, cursor + 10);
    const compressedSize = readU32(view, cursor + 20);
    const uncompressedSize = readU32(view, cursor + 24);
    const nameLength = readU16(view, cursor + 28);
    const extraLength = readU16(view, cursor + 30);
    const commentLength = readU16(view, cursor + 32);
    const localHeaderOffset = readU32(view, cursor + 42);

    const nameStart = cursor + 46;
    if (nameStart + nameLength > bytes.byteLength) {
      throw new MalformedDocumentError('malformed_archive', 'an entry name runs off the end');
    }
    const name = nameDecoder.decode(bytes.subarray(nameStart, nameStart + nameLength));

    entries.push({
      name,
      compressedSize,
      uncompressedSize,
      compressionMethod,
      localHeaderOffset,
      // Bit 0 of the general-purpose flags means the entry is encrypted.
      encrypted: (flags & 0x0001) !== 0,
    });

    cursor = nameStart + nameLength + extraLength + commentLength;
  }

  return entries;
}

function findEndOfCentralDirectory(view: DataView, length: number): number {
  const searchFrom = Math.max(0, length - MAX_EOCD_SEARCH);
  for (let offset = length - 22; offset >= searchFrom; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) {
      // A ZIP64 locator immediately before the record means the archive uses the
      // 64-bit extensions. A workbook never needs them; refusing is honest.
      if (offset >= 20 && view.getUint32(offset - 20, true) === ZIP64_EOCD_LOCATOR_SIGNATURE) {
        throw new MalformedDocumentError(
          'malformed_archive',
          'ZIP64 archives are not read by this importer',
        );
      }
      return offset;
    }
  }
  throw new MalformedDocumentError('malformed_archive', 'no end-of-directory record was found');
}

/**
 * A budget shared across every entry read from one archive.
 *
 * Held by the caller rather than per-entry, because a bomb built from a thousand
 * small members is the same attack as one built from a single huge member.
 */
export class InflationBudget {
  private used = 0;

  constructor(private readonly capacity: number = LIMITS.maxInflatedBytes) {}

  remaining(): number {
    return Math.max(0, this.capacity - this.used);
  }

  spend(bytes: number): void {
    this.used += bytes;
    if (this.used > this.capacity) {
      throw new LimitExceededError('maxInflatedBytes', `${this.used} bytes decompressed`);
    }
  }
}

/**
 * Decompresses one entry.
 *
 * Three guards apply before a byte is inflated: the entry must not be encrypted,
 * its declared expansion ratio must be plausible, and the remaining archive-wide
 * budget must cover it. `maxOutputLength` then makes the guarantee real — zlib
 * itself stops rather than trusting the declared size, which an attacker controls.
 */
export function readZipEntry(
  bytes: Uint8Array,
  entry: ZipEntry,
  budget: InflationBudget,
  deadline: Deadline,
): Uint8Array {
  deadline.check();

  if (entry.encrypted) {
    throw new MalformedDocumentError(
      'encrypted_file',
      'the document is password protected, so it cannot be read',
    );
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (readU32(view, entry.localHeaderOffset) !== LOCAL_SIGNATURE) {
    throw new MalformedDocumentError('malformed_archive', `entry ${entry.name} is corrupt`);
  }

  const nameLength = readU16(view, entry.localHeaderOffset + 26);
  const extraLength = readU16(view, entry.localHeaderOffset + 28);
  const dataStart = entry.localHeaderOffset + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;

  if (dataEnd > bytes.byteLength) {
    throw new MalformedDocumentError(
      'malformed_archive',
      `entry ${entry.name} runs past the end of the file`,
    );
  }

  if (
    entry.compressedSize > 0 &&
    entry.uncompressedSize / entry.compressedSize > LIMITS.maxCompressionRatio
  ) {
    throw new LimitExceededError(
      'maxCompressionRatio',
      `${entry.name} claims to expand ${Math.round(entry.uncompressedSize / entry.compressedSize)}×`,
    );
  }

  const allowance = budget.remaining();
  if (allowance === 0) {
    throw new LimitExceededError('maxInflatedBytes', 'the archive expands to too much data');
  }

  const raw = bytes.subarray(dataStart, dataEnd);

  if (entry.compressionMethod === 0) {
    budget.spend(raw.byteLength);
    return raw;
  }

  if (entry.compressionMethod !== 8) {
    throw new MalformedDocumentError(
      'malformed_archive',
      `entry ${entry.name} uses an unsupported compression method`,
    );
  }

  let inflated: Buffer;
  try {
    inflated = inflateRawSync(raw, { maxOutputLength: allowance });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('maxOutputLength')) {
      throw new LimitExceededError(
        'maxInflatedBytes',
        `${entry.name} expands beyond the budget`,
      );
    }
    throw new MalformedDocumentError(
      'malformed_archive',
      `entry ${entry.name} could not be decompressed`,
    );
  }

  budget.spend(inflated.byteLength);
  return new Uint8Array(inflated.buffer, inflated.byteOffset, inflated.byteLength);
}

/** Finds one entry by exact name. Case-sensitive, as the format specifies. */
export function findEntry(entries: readonly ZipEntry[], name: string): ZipEntry | undefined {
  return entries.find((entry) => entry.name === name);
}
