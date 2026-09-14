import { concatBytes, utf8 } from '../bytes';

/**
 * A CBOR encoder, for building authenticator responses in tests.
 *
 * The product only ever decodes CBOR — nothing it sends is CBOR — so this is not
 * production code and does not live beside the decoder. It exists so the test
 * suite can build responses that are byte-for-byte the shape an authenticator
 * produces, rather than hand-written blobs that would only prove the decoder
 * agrees with whoever typed them.
 */

export type Encodable =
  number | string | Uint8Array | boolean | null | Encodable[] | Map<number | string, Encodable>;

function header(major: number, argument: number): Uint8Array {
  if (argument < 24) return Uint8Array.from([(major << 5) | argument]);
  if (argument < 0x100) return Uint8Array.from([(major << 5) | 24, argument]);
  if (argument < 0x10000) {
    return Uint8Array.from([(major << 5) | 25, argument >> 8, argument & 0xff]);
  }
  return Uint8Array.from([
    (major << 5) | 26,
    (argument >>> 24) & 0xff,
    (argument >>> 16) & 0xff,
    (argument >>> 8) & 0xff,
    argument & 0xff,
  ]);
}

export function encodeCbor(value: Encodable): Uint8Array {
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) throw new Error('only integers are encoded here');
    return value >= 0 ? header(0, value) : header(1, -1 - value);
  }
  if (typeof value === 'string') {
    const bytes = utf8(value);
    return concatBytes(header(3, bytes.length), bytes);
  }
  if (value instanceof Uint8Array) {
    return concatBytes(header(2, value.length), value);
  }
  if (typeof value === 'boolean') {
    return Uint8Array.from([value ? 0xf5 : 0xf4]);
  }
  if (value === null) {
    return Uint8Array.from([0xf6]);
  }
  if (Array.isArray(value)) {
    return concatBytes(header(4, value.length), ...value.map(encodeCbor));
  }

  const parts: Uint8Array[] = [header(5, value.size)];
  for (const [key, entry] of value) {
    parts.push(encodeCbor(key), encodeCbor(entry));
  }
  return concatBytes(...parts);
}
