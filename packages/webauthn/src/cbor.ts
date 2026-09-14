import { WebAuthnError } from './bytes';

/**
 * Just enough CBOR to read what an authenticator sends.
 *
 * WebAuthn encodes the attestation object and the credential public key in CBOR
 * (RFC 8949), so something has to decode it. That something is written here
 * rather than installed, for the same reason the document parsers are
 * (ADR-0025): this code runs on bytes an attacker can choose, and a general
 * decoder brings a general attack surface — indefinite-length streams, tags,
 * big floats, arbitrary nesting — none of which an authenticator response
 * legitimately contains.
 *
 * So the subset is deliberate and small: unsigned integers, negative integers,
 * byte strings, text strings, definite-length arrays and maps, and the simple
 * values. Everything else is refused by name. Depth and item counts are bounded,
 * so a hostile payload cannot exhaust the stack or the heap before it is
 * rejected.
 */

export type CborValue =
  number | string | Uint8Array | boolean | null | CborValue[] | Map<number | string, CborValue>;

/** Bounds. A real authenticator response sits far inside every one of these. */
const MAX_DEPTH = 16;
const MAX_ITEMS = 1024;
const MAX_BYTE_STRING = 8192;
const MAX_TEXT_STRING = 4096;

interface Cursor {
  readonly bytes: Uint8Array;
  offset: number;
  depth: number;
}

function byteAt(cursor: Cursor): number {
  const value = cursor.bytes[cursor.offset];
  if (value === undefined) {
    throw new WebAuthnError('cbor_truncated', 'the CBOR value ends before it is complete');
  }
  cursor.offset += 1;
  return value;
}

/**
 * Reads the argument that follows a major type.
 *
 * Indefinite length (additional information 31) is refused rather than
 * supported: an authenticator does not emit it, and accepting it would mean
 * accepting a stream whose end an attacker chooses.
 */
function readArgument(cursor: Cursor, additional: number): number {
  if (additional < 24) return additional;

  if (additional === 24) return byteAt(cursor);
  if (additional === 25) return (byteAt(cursor) << 8) | byteAt(cursor);
  if (additional === 26) {
    // Assembled with multiplication rather than shifts: `<< 24` is signed in
    // JavaScript and would turn a large length into a negative number.
    const a = byteAt(cursor);
    const b = byteAt(cursor);
    const c = byteAt(cursor);
    const d = byteAt(cursor);
    return a * 0x1000000 + b * 0x10000 + c * 0x100 + d;
  }
  if (additional === 27) {
    const high =
      byteAt(cursor) * 0x1000000 +
      byteAt(cursor) * 0x10000 +
      byteAt(cursor) * 0x100 +
      byteAt(cursor);
    const low =
      byteAt(cursor) * 0x1000000 +
      byteAt(cursor) * 0x10000 +
      byteAt(cursor) * 0x100 +
      byteAt(cursor);
    const value = high * 0x100000000 + low;
    if (!Number.isSafeInteger(value)) {
      throw new WebAuthnError(
        'cbor_unsupported',
        'the CBOR integer is too large to read exactly',
      );
    }
    return value;
  }

  throw new WebAuthnError(
    'cbor_unsupported',
    `CBOR additional information ${additional} is not supported here`,
  );
}

function readValue(cursor: Cursor): CborValue {
  if (cursor.depth > MAX_DEPTH) {
    throw new WebAuthnError('cbor_too_deep', 'the CBOR value nests deeper than is allowed');
  }

  const initial = byteAt(cursor);
  const major = initial >> 5;
  const additional = initial & 0x1f;

  if (major === 0) return readArgument(cursor, additional);

  if (major === 1) {
    // A CBOR negative integer encodes -1 - n. COSE key labels use this.
    return -1 - readArgument(cursor, additional);
  }

  if (major === 2 || major === 3) {
    const length = readArgument(cursor, additional);
    const limit = major === 2 ? MAX_BYTE_STRING : MAX_TEXT_STRING;
    if (length > limit) {
      throw new WebAuthnError('cbor_too_large', 'the CBOR string is longer than is allowed');
    }
    if (cursor.offset + length > cursor.bytes.length) {
      throw new WebAuthnError('cbor_truncated', 'the CBOR string ends before it is complete');
    }
    const slice = cursor.bytes.subarray(cursor.offset, cursor.offset + length);
    cursor.offset += length;

    if (major === 2) return slice.slice();
    // `fatal` so that invalid UTF-8 is an error rather than replacement characters.
    return new TextDecoder('utf-8', { fatal: true }).decode(slice);
  }

  if (major === 4) {
    const length = readArgument(cursor, additional);
    if (length > MAX_ITEMS) {
      throw new WebAuthnError(
        'cbor_too_large',
        'the CBOR array holds more items than is allowed',
      );
    }
    const out: CborValue[] = [];
    cursor.depth += 1;
    for (let index = 0; index < length; index += 1) out.push(readValue(cursor));
    cursor.depth -= 1;
    return out;
  }

  if (major === 5) {
    const length = readArgument(cursor, additional);
    if (length > MAX_ITEMS) {
      throw new WebAuthnError('cbor_too_large', 'the CBOR map holds more keys than is allowed');
    }
    const out = new Map<number | string, CborValue>();
    cursor.depth += 1;
    for (let index = 0; index < length; index += 1) {
      const key = readValue(cursor);
      if (typeof key !== 'number' && typeof key !== 'string') {
        throw new WebAuthnError(
          'cbor_unsupported',
          'a CBOR map key must be an integer or text',
        );
      }
      // A repeated key is not a valid CBOR map, and silently keeping the last one
      // would let a payload smuggle a second `alg` past whatever read the first.
      if (out.has(key)) {
        throw new WebAuthnError('cbor_duplicate_key', 'the CBOR map repeats a key');
      }
      out.set(key, readValue(cursor));
    }
    cursor.depth -= 1;
    return out;
  }

  if (major === 7) {
    if (additional === 20) return false;
    if (additional === 21) return true;
    if (additional === 22) return null;
    throw new WebAuthnError(
      'cbor_unsupported',
      'only false, true and null are supported among the CBOR simple values',
    );
  }

  throw new WebAuthnError('cbor_unsupported', `CBOR major type ${major} is not supported here`);
}

/** Decodes one value and reports where it ended. */
export function decodeCborValue(bytes: Uint8Array): { value: CborValue; bytesRead: number } {
  const cursor: Cursor = { bytes, offset: 0, depth: 0 };
  const value = readValue(cursor);
  return { value, bytesRead: cursor.offset };
}

/**
 * Decodes one value and insists it was the whole input.
 *
 * Trailing bytes mean the sender and the receiver disagree about where the
 * message ends, which is the shape of a smuggling attack rather than a mistake
 * to tolerate.
 */
export function decodeCbor(bytes: Uint8Array): CborValue {
  const { value, bytesRead } = decodeCborValue(bytes);
  if (bytesRead !== bytes.length) {
    throw new WebAuthnError(
      'cbor_trailing_data',
      'there are unread bytes after the CBOR value',
    );
  }
  return value;
}

export function cborMap(value: CborValue, what: string): Map<number | string, CborValue> {
  if (!(value instanceof Map)) {
    throw new WebAuthnError('cbor_shape', `${what} is not a CBOR map`);
  }
  return value;
}

export function cborBytes(value: CborValue | undefined, what: string): Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new WebAuthnError('cbor_shape', `${what} is not a CBOR byte string`);
  }
  return value;
}

export function cborInteger(value: CborValue | undefined, what: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new WebAuthnError('cbor_shape', `${what} is not a CBOR integer`);
  }
  return value;
}
