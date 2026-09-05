import type { ImportFileKind } from '@family-finance/contracts';

import { LIMITS, MalformedDocumentError } from './limits';

/**
 * What a file actually is, decided from its bytes.
 *
 * 07-SECURITY-PRIVACY.md does not let an extension decide how a file is parsed.
 * An extension is a claim made by whoever named the file; the first bytes are what
 * the file is. Every branch of the importer keys off the result of this module,
 * so renaming `payload.exe` to `statement.csv` changes nothing about how it is
 * handled.
 *
 * The check is deliberately narrow. Three formats are accepted and everything
 * else is refused by name, rather than "sniffed" into a best guess — a permissive
 * detector is how a parser ends up being handed something it was never written
 * for.
 */

export interface DetectedFile {
  readonly kind: ImportFileKind;
  /** Why we believe that, for the audit trail and the reviewer's summary. */
  readonly evidence: string;
}

/** The extensions the upload control offers, mapped to what they should contain. */
export const ACCEPTED_EXTENSIONS: Readonly<Record<string, ImportFileKind>> = {
  '.xlsx': 'xlsx',
  '.csv': 'csv',
  '.pdf': 'pdf',
};

/** MIME types a browser is likely to declare for those files. */
export const ACCEPTED_MIME_TYPES: readonly string[] = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/csv',
  'text/plain',
  'application/pdf',
  'application/octet-stream',
];

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

const ZIP_LOCAL_HEADER = [0x50, 0x4b, 0x03, 0x04];
/** An empty archive, and the "spanned" marker. Neither is a workbook. */
const ZIP_EMPTY = [0x50, 0x4b, 0x05, 0x06];
const ZIP_SPANNED = [0x50, 0x4b, 0x07, 0x08];
const PDF_HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
/** OLE2 compound file: the old `.xls`, and also `.doc`, `.msi` and friends. */
const OLE2_HEADER = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const MZ_HEADER = [0x4d, 0x5a]; // Windows executable
const ELF_HEADER = [0x7f, 0x45, 0x4c, 0x46];
const RTF_HEADER = [0x7b, 0x5c, 0x72, 0x74, 0x66]; // {\rtf

/**
 * A byte that no text file this product accepts should contain.
 *
 * A CSV is text. A NUL byte in the first few kilobytes means the file is binary,
 * whatever it is named, and binary content must never reach the CSV reader.
 */
function looksBinary(bytes: Uint8Array): boolean {
  const window = Math.min(bytes.length, 8192);
  for (let index = 0; index < window; index += 1) {
    if (bytes[index] === 0x00) return true;
  }
  return false;
}

/**
 * Decides what the bytes are.
 *
 * `declaredName` is used for one thing only: choosing between the text formats
 * once the bytes have already been shown to be text. It never overrides them.
 */
export function detectFile(bytes: Uint8Array, declaredName: string): DetectedFile {
  if (bytes.length === 0) {
    throw new MalformedDocumentError('malformed_document', 'the file is empty');
  }
  if (bytes.length > LIMITS.maxFileBytes) {
    throw new MalformedDocumentError(
      'unsupported_file_type',
      `the file is larger than ${LIMITS.maxFileBytes} bytes`,
    );
  }

  if (startsWith(bytes, MZ_HEADER) || startsWith(bytes, ELF_HEADER)) {
    throw new MalformedDocumentError('unsupported_file_type', 'the file is a program');
  }

  if (startsWith(bytes, OLE2_HEADER)) {
    // The legacy binary `.xls`, among others. There is no maintained parser for it
    // inside this project's dependency policy, and guessing at a proprietary
    // binary format in a money application is not a trade worth making. Refused by
    // name, with the workaround stated, rather than half-read.
    throw new MalformedDocumentError(
      'unsupported_file_type',
      'the old binary Excel format (.xls) is not read; save the file as .xlsx',
    );
  }

  if (startsWith(bytes, RTF_HEADER)) {
    throw new MalformedDocumentError('unsupported_file_type', 'rich text is not a data file');
  }

  if (startsWith(bytes, PDF_HEADER)) {
    return { kind: 'pdf', evidence: 'the file begins with the PDF marker' };
  }

  if (startsWith(bytes, ZIP_EMPTY) || startsWith(bytes, ZIP_SPANNED)) {
    throw new MalformedDocumentError('malformed_archive', 'the archive holds nothing to read');
  }

  if (startsWith(bytes, ZIP_LOCAL_HEADER)) {
    return { kind: 'xlsx', evidence: 'the file is an Office Open XML archive' };
  }

  if (looksBinary(bytes)) {
    throw new MalformedDocumentError(
      'signature_mismatch',
      'the file is binary but is not a format this product reads',
    );
  }

  const extension = extensionOf(declaredName);
  if (extension === '.csv' || extension === '.txt' || extension === '') {
    return { kind: 'csv', evidence: 'the file is plain text' };
  }

  throw new MalformedDocumentError(
    'signature_mismatch',
    `plain text was not expected for a ${extension} file`,
  );
}

/** The lowercased extension, dot included. Empty when the name carries none. */
export function extensionOf(name: string): string {
  const lastDot = name.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === name.length - 1) return '';
  return name.slice(lastDot).toLowerCase();
}

/**
 * Control characters, written as escapes.
 *
 * A literal control character in source is invisible to a reviewer, which is
 * exactly the wrong property for a security filter.
 */
// eslint-disable-next-line no-control-regex -- removing control characters requires naming them
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;

/** Characters Windows and POSIX both treat as structural in a path. */
const PATH_PUNCTUATION = /[<>:"|?*\\/]/g;

/**
 * A file name safe to show and safe to store beside.
 *
 * Path separators, traversal segments, control characters and leading dots are all
 * removed. This name is never used to build a path — storage is keyed by a
 * generated identifier — so this is defence in depth for the display layer rather
 * than the only thing standing between an upload and the filesystem.
 */
export function sanitiseFileName(name: string): string {
  const withoutPath = name.split(/[\\/]/g).pop() ?? '';
  const cleaned = withoutPath
    .replace(CONTROL_CHARACTERS, '')
    .replace(PATH_PUNCTUATION, '')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+/, '')
    .trim();
  const limited = cleaned.slice(0, 120);
  return limited.length > 0 ? limited : 'document';
}
