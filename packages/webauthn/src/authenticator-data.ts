import { WebAuthnError, toBase64Url } from './bytes';
import { readCoseKey, type CosePublicKey } from './cose';

/**
 * Authenticator data — the structure every WebAuthn decision rests on.
 *
 * §6.1 of the WebAuthn specification lays it out as a fixed prefix followed by
 * optional parts:
 *
 *   32 bytes  rpIdHash    SHA-256 of the RP ID the authenticator believes it is
 *                         talking to. This is what makes a credential unusable
 *                         on another site, and it is checked, not assumed.
 *    1 byte   flags       UP, UV, BE, BS, AT, ED
 *    4 bytes  signCount   big-endian
 *   16 bytes  aaguid      only when AT is set
 *    2 bytes  credential id length, then the id
 *            the credential public key, as COSE
 *            extension outputs, as CBOR
 *
 * The flags are read into named booleans because `flags & 0x04` at a call site
 * is exactly the kind of thing that gets inverted during a refactor, and the
 * flag in question — user verification — is the difference between "Windows
 * Hello checked who this is" and "something was plugged in".
 */

export interface AuthenticatorFlags {
  /** Someone physically interacted with the authenticator. */
  readonly userPresent: boolean;
  /** The authenticator verified *who* that someone is: a PIN, a face, a finger. */
  readonly userVerified: boolean;
  /** The credential may be backed up (multi-device). */
  readonly backupEligible: boolean;
  /** The credential is currently backed up. */
  readonly backedUp: boolean;
  /** Attested credential data is present. Only on registration. */
  readonly attestedCredentialData: boolean;
  /** Extension outputs are present. */
  readonly extensionData: boolean;
}

export interface AttestedCredential {
  readonly aaguid: Uint8Array;
  readonly credentialId: Uint8Array;
  readonly publicKey: CosePublicKey;
  /** The COSE key exactly as sent, kept so it can be stored and re-read. */
  readonly cosePublicKey: Uint8Array;
}

export interface AuthenticatorData {
  readonly rpIdHash: Uint8Array;
  readonly flags: AuthenticatorFlags;
  readonly signCount: number;
  readonly attested: AttestedCredential | null;
}

const FLAG = {
  userPresent: 0x01,
  userVerified: 0x04,
  backupEligible: 0x08,
  backedUp: 0x10,
  attestedCredentialData: 0x40,
  extensionData: 0x80,
} as const;

export function parseAuthenticatorData(bytes: Uint8Array): AuthenticatorData {
  if (bytes.length < 37) {
    throw new WebAuthnError(
      'malformed_authenticator_data',
      'the authenticator data is shorter than its fixed header',
    );
  }

  const rpIdHash = bytes.subarray(0, 32).slice();
  const raw = bytes[32] ?? 0;
  const flags: AuthenticatorFlags = {
    userPresent: (raw & FLAG.userPresent) !== 0,
    userVerified: (raw & FLAG.userVerified) !== 0,
    backupEligible: (raw & FLAG.backupEligible) !== 0,
    backedUp: (raw & FLAG.backedUp) !== 0,
    attestedCredentialData: (raw & FLAG.attestedCredentialData) !== 0,
    extensionData: (raw & FLAG.extensionData) !== 0,
  };

  // Big-endian, and assembled by multiplication so the top bit does not make it
  // negative the way `<< 24` would.
  const signCount =
    (bytes[33] ?? 0) * 0x1000000 +
    (bytes[34] ?? 0) * 0x10000 +
    (bytes[35] ?? 0) * 0x100 +
    (bytes[36] ?? 0);

  if (!flags.attestedCredentialData) {
    return { rpIdHash, flags, signCount, attested: null };
  }

  if (bytes.length < 55) {
    throw new WebAuthnError(
      'malformed_authenticator_data',
      'the attested credential data is truncated',
    );
  }

  const aaguid = bytes.subarray(37, 53).slice();
  const idLength = ((bytes[53] ?? 0) << 8) | (bytes[54] ?? 0);

  // The specification caps a credential id at 1023 bytes.
  if (idLength === 0 || idLength > 1023) {
    throw new WebAuthnError(
      'malformed_authenticator_data',
      'the credential id length is invalid',
    );
  }
  if (bytes.length < 55 + idLength) {
    throw new WebAuthnError('malformed_authenticator_data', 'the credential id is truncated');
  }

  const credentialId = bytes.subarray(55, 55 + idLength).slice();
  const { key, cose } = readCoseKey(bytes.subarray(55 + idLength));

  return {
    rpIdHash,
    flags,
    signCount,
    attested: { aaguid, credentialId, publicKey: key, cosePublicKey: cose },
  };
}

/** The AAGUID as the usual dashed form, or null when the authenticator sent none. */
export function formatAaguid(aaguid: Uint8Array): string | null {
  if (aaguid.length !== 16 || aaguid.every((byte) => byte === 0)) return null;
  const hex = [...aaguid].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const credentialIdText = (credentialId: Uint8Array): string => toBase64Url(credentialId);
