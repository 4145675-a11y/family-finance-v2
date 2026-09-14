/**
 * Byte handling for the WebAuthn protocol.
 *
 * Everything WebAuthn sends across the wire is base64url — never base64, never
 * hex — and the difference is not cosmetic: a `+` decoded where a `-` was meant
 * produces a public key that verifies nothing, and the failure looks like a
 * broken authenticator rather than a broken decoder.
 *
 * Comparisons of anything an attacker controls are constant-time. A challenge
 * compared with `===` leaks its prefix through timing, and a challenge is the
 * only thing standing between a replayed assertion and an unlocked household.
 */

export class WebAuthnError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'WebAuthnError';
    this.code = code;
  }
}

const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Encodes bytes as base64url with no padding, which is what WebAuthn uses. */
export function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0;
    const b = bytes[index + 1];
    const c = bytes[index + 2];

    out += BASE64URL_ALPHABET[a >> 2];
    out += BASE64URL_ALPHABET[((a & 0x03) << 4) | ((b ?? 0) >> 4)];
    if (b === undefined) break;
    out += BASE64URL_ALPHABET[((b & 0x0f) << 2) | ((c ?? 0) >> 6)];
    if (c === undefined) break;
    out += BASE64URL_ALPHABET[c & 0x3f];
  }
  return out;
}

/**
 * Decodes base64url.
 *
 * Standard base64 is accepted too, because a client library that pads or that
 * uses `+/` is common enough that refusing it would produce an unexplainable
 * failure. What is *not* accepted is a character outside both alphabets: that is
 * corrupt input, and guessing at it would be guessing at a public key.
 */
export function fromBase64Url(text: string): Uint8Array {
  const normalised = text.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');

  if (!/^[A-Za-z0-9+/]*$/.test(normalised)) {
    throw new WebAuthnError('malformed_base64url', 'the value is not base64url');
  }
  if (normalised.length % 4 === 1) {
    throw new WebAuthnError('malformed_base64url', 'the value is a truncated base64url string');
  }

  const lookup = new Map<string, number>();
  for (let index = 0; index < 64; index += 1) {
    const character = BASE64URL_ALPHABET[index];
    if (character !== undefined) lookup.set(character, index);
  }
  lookup.set('+', 62);
  lookup.set('/', 63);

  const bytes = new Uint8Array(Math.floor((normalised.length * 3) / 4));
  let written = 0;
  let buffer = 0;
  let bits = 0;

  for (const character of normalised) {
    const value = lookup.get(character);
    if (value === undefined) {
      throw new WebAuthnError('malformed_base64url', 'the value is not base64url');
    }
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[written] = (buffer >> bits) & 0xff;
      written += 1;
    }
  }

  return bytes.subarray(0, written);
}

/** True when two byte strings are identical, in time independent of the content. */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  // The length is not secret and comparing it first is what keeps the loop bounded.
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

/** True when two base64url strings decode to the same bytes. Constant-time. */
export function base64UrlEqual(a: string, b: string): boolean {
  try {
    return bytesEqual(fromBase64Url(a), fromBase64Url(b));
  } catch {
    return false;
  }
}

export function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}
