import { WebAuthnError, concatBytes } from './bytes';
import { cborBytes, cborInteger, cborMap, decodeCborValue, type CborValue } from './cbor';

/**
 * COSE public keys, turned into something Node's crypto can verify with.
 *
 * An authenticator hands back its public key as a COSE_Key (RFC 8152): a CBOR
 * map of small integer labels. Node verifies with a `KeyObject`, which wants
 * SubjectPublicKeyInfo in DER. This module is the bridge, and it is written by
 * hand for the same reason as the CBOR decoder — the input is attacker-chosen,
 * and a DER encoder that accepts anything is a DER encoder that accepts trouble.
 *
 * Three algorithms are supported, and the list is closed:
 *
 *   ES256  (-7)    ECDSA on P-256 with SHA-256 — what most platform
 *                  authenticators and every security key produce.
 *   RS256  (-257)  RSASSA-PKCS1-v1_5 with SHA-256 — what Windows Hello backed
 *                  by a TPM commonly produces, so it is not optional here.
 *   EdDSA  (-8)    Ed25519.
 *
 * Anything else is refused by name rather than attempted. An algorithm we cannot
 * verify correctly must never be one we verify approximately.
 */

export type CoseAlgorithm = -7 | -8 | -257;

export const SUPPORTED_ALGORITHMS: readonly CoseAlgorithm[] = [-7, -257, -8];

/** COSE key label numbers, named so the code below reads as the spec does. */
const LABEL = {
  kty: 1,
  alg: 3,
  crv: -1,
  x: -2,
  y: -3,
  rsaModulus: -1,
  rsaExponent: -2,
  okpX: -2,
} as const;

const KEY_TYPE = { okp: 1, ec2: 2, rsa: 3 } as const;
/** The only elliptic curve accepted: P-256, COSE curve 1. */
const P256 = 1;
/** The only Edwards curve accepted: Ed25519, COSE curve 6. */
const ED25519 = 6;

// --- a very small DER writer -----------------------------------------------

function derLength(length: number): Uint8Array {
  if (length < 0x80) return Uint8Array.from([length]);

  const digits: number[] = [];
  let remaining = length;
  while (remaining > 0) {
    digits.unshift(remaining & 0xff);
    remaining = Math.floor(remaining / 256);
  }
  return Uint8Array.from([0x80 | digits.length, ...digits]);
}

function derTagged(tag: number, content: Uint8Array): Uint8Array {
  return concatBytes(Uint8Array.from([tag]), derLength(content.length), content);
}

const derSequence = (...parts: readonly Uint8Array[]): Uint8Array =>
  derTagged(0x30, concatBytes(...parts));

/** A BIT STRING with no unused trailing bits, which is all DER keys need. */
const derBitString = (content: Uint8Array): Uint8Array =>
  derTagged(0x03, concatBytes(Uint8Array.from([0x00]), content));

/**
 * A DER INTEGER holding a non-negative number given as big-endian bytes.
 *
 * Leading zero bytes are stripped, and one is added back when the top bit is
 * set — without it the value would be read as negative, and an RSA modulus read
 * as negative verifies nothing.
 */
function derUnsignedInteger(bytes: Uint8Array): Uint8Array {
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0x00) start += 1;
  const trimmed = bytes.subarray(start);
  const needsPad = (trimmed[0] ?? 0) >= 0x80;
  return derTagged(
    0x02,
    needsPad ? concatBytes(Uint8Array.from([0x00]), trimmed) : trimmed.slice(),
  );
}

const OID_EC_PUBLIC_KEY = Uint8Array.from([
  0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
]);
const OID_P256 = Uint8Array.from([0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07]);
const OID_RSA = Uint8Array.from([
  0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01,
]);
const OID_ED25519 = Uint8Array.from([0x06, 0x03, 0x2b, 0x65, 0x70]);
const DER_NULL = Uint8Array.from([0x05, 0x00]);

// --- COSE -> SPKI -----------------------------------------------------------

export interface CosePublicKey {
  readonly algorithm: CoseAlgorithm;
  /** SubjectPublicKeyInfo, DER encoded. */
  readonly spki: Uint8Array;
}

function requireLength(bytes: Uint8Array, length: number, what: string): Uint8Array {
  if (bytes.length !== length) {
    throw new WebAuthnError('cose_bad_key', `${what} must be exactly ${length} bytes`);
  }
  return bytes;
}

/**
 * Reads a COSE_Key and produces the DER a verifier can import.
 *
 * The declared algorithm and the key type have to agree. A key that says RS256
 * while carrying an EC point is not a key with a typo in it; it is an attempt to
 * have the two halves of the verification read different things.
 */
export function coseToPublicKey(cose: CborValue): CosePublicKey {
  const map = cborMap(cose, 'the credential public key');
  const kty = cborInteger(map.get(LABEL.kty), 'the COSE key type');
  const alg = cborInteger(map.get(LABEL.alg), 'the COSE algorithm');

  if (!SUPPORTED_ALGORITHMS.includes(alg as CoseAlgorithm)) {
    throw new WebAuthnError(
      'unsupported_algorithm',
      `this build does not verify COSE algorithm ${alg}`,
    );
  }
  const algorithm = alg as CoseAlgorithm;

  if (algorithm === -7) {
    if (kty !== KEY_TYPE.ec2) {
      throw new WebAuthnError('cose_bad_key', 'ES256 requires an EC2 key');
    }
    if (cborInteger(map.get(LABEL.crv), 'the COSE curve') !== P256) {
      throw new WebAuthnError('cose_bad_key', 'ES256 requires the P-256 curve');
    }
    const x = requireLength(cborBytes(map.get(LABEL.x), 'the COSE x coordinate'), 32, 'x');
    const y = requireLength(cborBytes(map.get(LABEL.y), 'the COSE y coordinate'), 32, 'y');

    // 0x04 marks an uncompressed point, which is the only form used here.
    const point = concatBytes(Uint8Array.from([0x04]), x, y);
    return {
      algorithm,
      spki: derSequence(derSequence(OID_EC_PUBLIC_KEY, OID_P256), derBitString(point)),
    };
  }

  if (algorithm === -257) {
    if (kty !== KEY_TYPE.rsa) {
      throw new WebAuthnError('cose_bad_key', 'RS256 requires an RSA key');
    }
    const modulus = cborBytes(map.get(LABEL.rsaModulus), 'the RSA modulus');
    const exponent = cborBytes(map.get(LABEL.rsaExponent), 'the RSA exponent');
    if (modulus.length < 256) {
      // Below 2048 bits the signature is not worth verifying.
      throw new WebAuthnError('cose_bad_key', 'the RSA key is smaller than 2048 bits');
    }

    const rsaKey = derSequence(derUnsignedInteger(modulus), derUnsignedInteger(exponent));
    return {
      algorithm,
      spki: derSequence(derSequence(OID_RSA, DER_NULL), derBitString(rsaKey)),
    };
  }

  if (kty !== KEY_TYPE.okp) {
    throw new WebAuthnError('cose_bad_key', 'EdDSA requires an OKP key');
  }
  if (cborInteger(map.get(LABEL.crv), 'the COSE curve') !== ED25519) {
    throw new WebAuthnError('cose_bad_key', 'EdDSA requires the Ed25519 curve');
  }
  const x = requireLength(cborBytes(map.get(LABEL.okpX), 'the Ed25519 public key'), 32, 'x');

  return {
    algorithm,
    spki: derSequence(derSequence(OID_ED25519), derBitString(x)),
  };
}

/**
 * Reads the COSE key that sits at the end of an attested credential.
 *
 * The key is followed by the extension outputs when the authenticator sent any,
 * so the decoder reports where the key ended rather than insisting it was the
 * whole remainder.
 */
export function readCoseKey(bytes: Uint8Array): {
  key: CosePublicKey;
  cose: Uint8Array;
  bytesRead: number;
} {
  const { value, bytesRead } = decodeCborValue(bytes);
  return { key: coseToPublicKey(value), cose: bytes.subarray(0, bytesRead).slice(), bytesRead };
}
