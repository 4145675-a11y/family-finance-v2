import { describe, expect, test } from 'vitest';

import { WebAuthnError, bytesEqual, fromBase64Url, toBase64Url } from './bytes';
import { decodeCbor, decodeCborValue } from './cbor';
import { coseToPublicKey } from './cose';
import { encodeCbor, type Encodable } from './fixtures/cbor-encode';

/**
 * The decoder, and the shapes it must refuse.
 *
 * This code reads bytes chosen by whoever is at the browser, so the tests that
 * matter are the ones where the input is hostile rather than merely unusual.
 */

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof WebAuthnError ? error.code : `unexpected:${String(error)}`;
  }
  return 'no_error';
}

describe('base64url', () => {
  test('round-trips every byte value', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_value, index) => index);
    expect(bytesEqual(fromBase64Url(toBase64Url(bytes)), bytes)).toBe(true);
  });

  test('produces no padding and none of the characters base64url replaces', () => {
    const encoded = toBase64Url(Uint8Array.from([251, 255, 190, 255]));
    expect(encoded).not.toContain('=');
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
  });

  test('accepts standard base64 with padding, because clients send it', () => {
    expect(bytesEqual(fromBase64Url('AQID'), Uint8Array.from([1, 2, 3]))).toBe(true);
    expect(bytesEqual(fromBase64Url('AQI='), Uint8Array.from([1, 2]))).toBe(true);
  });

  test('refuses characters outside both alphabets', () => {
    expect(codeOf(() => fromBase64Url('abc$def'))).toBe('malformed_base64url');
  });

  test('refuses a truncated string rather than inventing a byte', () => {
    expect(codeOf(() => fromBase64Url('AQIDB'))).toBe('malformed_base64url');
  });

  test('an empty string decodes to no bytes', () => {
    expect(fromBase64Url('')).toHaveLength(0);
  });
});

describe('round trips', () => {
  const cases: readonly [string, Encodable][] = [
    ['zero', 0],
    ['a one-byte integer', 23],
    ['a two-byte integer', 300],
    ['a four-byte integer', 70_000],
    ['a large integer', 4_294_967_290],
    ['a negative integer', -7],
    ['a large negative integer', -257],
    ['text', 'webauthn'],
    ['Hebrew text', 'צ׳ק'],
    ['bytes', Uint8Array.from([0, 1, 254, 255])],
    ['an array', [1, 2, 'three']],
    ['booleans and null', [true, false, null]],
    [
      'a map with integer keys, as a COSE key has',
      new Map<number | string, Encodable>([
        [1, 2],
        [3, -7],
        [-1, 1],
      ]),
    ],
    [
      'a nested map, as an attestation object has',
      new Map<number | string, Encodable>([
        ['fmt', 'none'],
        ['attStmt', new Map<number | string, Encodable>()],
        ['authData', Uint8Array.from([1, 2, 3])],
      ]),
    ],
  ];

  test.each(cases)('%s survives encoding and decoding', (_name, value) => {
    const decoded = decodeCbor(encodeCbor(value));
    if (value instanceof Uint8Array) {
      expect(bytesEqual(decoded as Uint8Array, value)).toBe(true);
      return;
    }
    expect(decoded).toEqual(value);
  });
});

describe('the decoder refuses hostile input', () => {
  test('trailing bytes after a complete value', () => {
    expect(codeOf(() => decodeCbor(Uint8Array.from([0x01, 0x02])))).toBe('cbor_trailing_data');
  });

  test('a truncated value', () => {
    // Announces a four-byte string and provides one byte.
    expect(codeOf(() => decodeCbor(Uint8Array.from([0x64, 0x61])))).toBe('cbor_truncated');
  });

  test('an indefinite-length string, which no authenticator sends', () => {
    expect(codeOf(() => decodeCbor(Uint8Array.from([0x5f, 0xff])))).toBe('cbor_unsupported');
  });

  test('a tag, which nothing here should carry', () => {
    expect(codeOf(() => decodeCbor(Uint8Array.from([0xc0, 0x01])))).toBe('cbor_unsupported');
  });

  test('a floating-point number, because money and counters are integers', () => {
    expect(codeOf(() => decodeCbor(Uint8Array.from([0xfa, 0x00, 0x00, 0x00, 0x00])))).toBe(
      'cbor_unsupported',
    );
  });

  test('a map that repeats a key', () => {
    const bytes = Uint8Array.from([0xa2, 0x01, 0x01, 0x01, 0x02]);
    expect(codeOf(() => decodeCbor(bytes))).toBe('cbor_duplicate_key');
  });

  test('a string that claims to be enormous', () => {
    const bytes = Uint8Array.from([0x5a, 0x7f, 0xff, 0xff, 0xff]);
    expect(codeOf(() => decodeCbor(bytes))).toBe('cbor_too_large');
  });

  test('an array that claims to hold more items than are allowed', () => {
    const bytes = Uint8Array.from([0x99, 0xff, 0xff]);
    expect(codeOf(() => decodeCbor(bytes))).toBe('cbor_too_large');
  });

  test('nesting deeper than the limit', () => {
    // Twenty nested single-item arrays; the limit is sixteen.
    const bytes = Uint8Array.from([...Array.from({ length: 20 }, () => 0x81), 0x00]);
    expect(codeOf(() => decodeCbor(bytes))).toBe('cbor_too_deep');
  });

  test('invalid UTF-8 in a text string', () => {
    expect(codeOf(() => decodeCbor(Uint8Array.from([0x61, 0xff])))).not.toBe('no_error');
  });

  test('a map keyed by something other than an integer or text', () => {
    const bytes = Uint8Array.from([0xa1, 0x80, 0x01]);
    expect(codeOf(() => decodeCbor(bytes))).toBe('cbor_unsupported');
  });
});

describe('reading a value that is followed by more data', () => {
  test('reports where the value ended, which is how a COSE key is found', () => {
    const key = encodeCbor(
      new Map<number | string, Encodable>([
        [1, 2],
        [3, -7],
      ]),
    );
    const withExtensions = Uint8Array.from([...key, 0xa0]);

    const { bytesRead } = decodeCborValue(withExtensions);
    expect(bytesRead).toBe(key.length);
  });
});

describe('COSE keys', () => {
  test('an algorithm this build cannot verify is refused by name', () => {
    const key = new Map<number | string, Encodable>([
      [1, 2],
      [3, -36],
      [-1, 1],
      [-2, new Uint8Array(32)],
      [-3, new Uint8Array(32)],
    ]);
    expect(codeOf(() => coseToPublicKey(decodeCbor(encodeCbor(key))))).toBe(
      'unsupported_algorithm',
    );
  });

  test('an ES256 key on the wrong curve is refused', () => {
    const key = new Map<number | string, Encodable>([
      [1, 2],
      [3, -7],
      [-1, 2],
      [-2, new Uint8Array(32)],
      [-3, new Uint8Array(32)],
    ]);
    expect(codeOf(() => coseToPublicKey(decodeCbor(encodeCbor(key))))).toBe('cose_bad_key');
  });

  test('an ES256 label carrying an RSA key is refused', () => {
    // The declared algorithm and the key type must agree, or the two halves of
    // the verification are reading different things.
    const key = new Map<number | string, Encodable>([
      [1, 3],
      [3, -7],
      [-1, new Uint8Array(256)],
      [-2, Uint8Array.from([1, 0, 1])],
    ]);
    expect(codeOf(() => coseToPublicKey(decodeCbor(encodeCbor(key))))).toBe('cose_bad_key');
  });

  test('a coordinate of the wrong length is refused', () => {
    const key = new Map<number | string, Encodable>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, new Uint8Array(31)],
      [-3, new Uint8Array(32)],
    ]);
    expect(codeOf(() => coseToPublicKey(decodeCbor(encodeCbor(key))))).toBe('cose_bad_key');
  });

  test('an RSA key below 2048 bits is refused', () => {
    const key = new Map<number | string, Encodable>([
      [1, 3],
      [3, -257],
      [-1, new Uint8Array(128)],
      [-2, Uint8Array.from([1, 0, 1])],
    ]);
    expect(codeOf(() => coseToPublicKey(decodeCbor(encodeCbor(key))))).toBe('cose_bad_key');
  });
});
