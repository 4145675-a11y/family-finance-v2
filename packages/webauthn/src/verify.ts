import { createHash, createPublicKey, randomBytes, verify as cryptoVerify } from 'node:crypto';

import {
  WebAuthnError,
  base64UrlEqual,
  bytesEqual,
  concatBytes,
  fromBase64Url,
  toBase64Url,
  utf8,
} from './bytes';
import {
  credentialIdText,
  formatAaguid,
  parseAuthenticatorData,
  type AuthenticatorFlags,
} from './authenticator-data';
import { coseToPublicKey, type CoseAlgorithm } from './cose';
import { decodeCbor, cborBytes, cborMap } from './cbor';

/**
 * Verifying what an authenticator said.
 *
 * This module holds the checks that make a passkey mean something. Skipping any
 * one of them turns the whole ceremony into decoration, so each is written out
 * explicitly rather than folded into a helper that could quietly stop running:
 *
 *   - the client data is of the expected type (`webauthn.create` / `webauthn.get`)
 *     — a registration response replayed as a login is refused;
 *   - the challenge is the one we issued, compared in constant time;
 *   - the origin is exactly the origin we expect, string for string;
 *   - the RP ID hash is SHA-256 of our RP ID;
 *   - user presence is set, and user *verification* is set, which is the
 *     difference between "a device was touched" and "Windows Hello checked who
 *     this is";
 *   - the signature verifies over the authenticator data and the hash of the
 *     client data, with the public key stored at registration;
 *   - the signature counter has not gone backwards.
 *
 * What this does not do is verify attestation. Registration is requested with
 * `attestation: "none"`, so there is no attestation statement to check and no
 * claim is made about which authenticator model produced the key. For a
 * household application on one machine that is the right trade: attestation
 * would tell us the make of the TPM and nothing about whether the right person
 * is at the keyboard. It is recorded here so nobody later mistakes silence for a
 * check that happens elsewhere.
 */

/** How long an issued challenge stays usable. Short, because it need not be long. */
export const CHALLENGE_LIFETIME_MS = 2 * 60 * 1000;

export interface ExpectedCeremony {
  /** The challenge we issued, base64url. */
  readonly challenge: string;
  /** The exact origin, e.g. `http://localhost:3100`. Compared whole. */
  readonly origin: string;
  /** The RP ID, e.g. `localhost`. Hashed and compared with the authenticator's. */
  readonly rpId: string;
}

export interface StoredCredential {
  /** base64url of the credential id. */
  readonly credentialId: string;
  /** base64url of the COSE public key, exactly as the authenticator sent it. */
  readonly publicKeyCose: string;
  readonly signCount: number;
}

export interface RegistrationResult {
  readonly credentialId: string;
  readonly publicKeyCose: string;
  readonly algorithm: CoseAlgorithm;
  readonly signCount: number;
  readonly aaguid: string | null;
  readonly flags: AuthenticatorFlags;
  /** `none` for every response this build asks for. Recorded, not trusted. */
  readonly attestationFormat: string;
}

export interface AssertionResult {
  readonly credentialId: string;
  readonly signCount: number;
  readonly flags: AuthenticatorFlags;
}

/** A fresh, unguessable challenge. 32 bytes from the system CSPRNG. */
export function createChallenge(): string {
  return toBase64Url(new Uint8Array(randomBytes(32)));
}

const sha256 = (bytes: Uint8Array): Uint8Array =>
  new Uint8Array(createHash('sha256').update(bytes).digest());

interface ClientData {
  readonly type: string;
  readonly challenge: string;
  readonly origin: string;
  readonly crossOrigin: boolean;
}

/**
 * Reads clientDataJSON.
 *
 * Parsed as JSON rather than pattern-matched, and every field the checks need
 * must be a string — a `challenge` that arrives as an object cannot be allowed
 * to compare equal to anything by accident.
 */
function parseClientData(bytes: Uint8Array): ClientData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new WebAuthnError('malformed_client_data', 'the client data is not valid JSON');
  }

  if (parsed === null || typeof parsed !== 'object') {
    throw new WebAuthnError('malformed_client_data', 'the client data is not an object');
  }

  const record = parsed as Record<string, unknown>;
  const { type, challenge, origin, crossOrigin } = record;

  if (typeof type !== 'string' || typeof challenge !== 'string' || typeof origin !== 'string') {
    throw new WebAuthnError(
      'malformed_client_data',
      'the client data is missing a required field',
    );
  }

  return {
    type,
    challenge,
    origin,
    crossOrigin: crossOrigin === true,
  };
}

/**
 * The checks shared by both ceremonies.
 *
 * Ordered so that the cheapest and least revealing failures come first, and so
 * that no check can be reached without the ones before it having passed.
 */
function verifyCommon(
  clientDataJson: Uint8Array,
  authenticatorData: Uint8Array,
  expected: ExpectedCeremony,
  expectedType: 'webauthn.create' | 'webauthn.get',
): { flags: AuthenticatorFlags; signCount: number } {
  const clientData = parseClientData(clientDataJson);

  if (clientData.type !== expectedType) {
    throw new WebAuthnError(
      'wrong_ceremony_type',
      `this response is a ${clientData.type}, not a ${expectedType}`,
    );
  }

  if (!base64UrlEqual(clientData.challenge, expected.challenge)) {
    throw new WebAuthnError('challenge_mismatch', 'the response answers a different challenge');
  }

  // Compared whole, including scheme and port. `http://localhost:3100` and
  // `http://localhost:3101` are different origins, and so are `localhost` and
  // `127.0.0.1`; treating them as interchangeable is how a local application
  // ends up accepting an assertion minted somewhere else on the machine.
  if (clientData.origin !== expected.origin) {
    throw new WebAuthnError(
      'origin_mismatch',
      `the response came from ${clientData.origin}, not ${expected.origin}`,
    );
  }

  if (clientData.crossOrigin) {
    throw new WebAuthnError(
      'cross_origin',
      'the ceremony ran inside a frame from another origin',
    );
  }

  const parsed = parseAuthenticatorData(authenticatorData);

  if (!bytesEqual(parsed.rpIdHash, sha256(utf8(expected.rpId)))) {
    throw new WebAuthnError('rp_id_mismatch', 'the authenticator signed for a different site');
  }

  if (!parsed.flags.userPresent) {
    throw new WebAuthnError('user_not_present', 'nobody interacted with the authenticator');
  }

  // Not optional, and not configurable. 07-SECURITY-PRIVACY.md's requirement is
  // that a person was verified, not that a device was present.
  if (!parsed.flags.userVerified) {
    throw new WebAuthnError(
      'user_not_verified',
      'the authenticator did not verify who was using it',
    );
  }

  return { flags: parsed.flags, signCount: parsed.signCount };
}

export interface RegistrationResponse {
  /** base64url of the attestation object. */
  readonly attestationObject: string;
  /** base64url of clientDataJSON. */
  readonly clientDataJson: string;
}

export function verifyRegistration(
  response: RegistrationResponse,
  expected: ExpectedCeremony,
): RegistrationResult {
  const clientDataJson = fromBase64Url(response.clientDataJson);
  const attestation = cborMap(
    decodeCbor(fromBase64Url(response.attestationObject)),
    'the attestation object',
  );

  const format = attestation.get('fmt');
  if (typeof format !== 'string') {
    throw new WebAuthnError('malformed_attestation', 'the attestation object has no format');
  }

  const authenticatorData = cborBytes(attestation.get('authData'), 'the authenticator data');
  const { flags } = verifyCommon(
    clientDataJson,
    authenticatorData,
    expected,
    'webauthn.create',
  );

  const parsed = parseAuthenticatorData(authenticatorData);
  if (parsed.attested === null) {
    throw new WebAuthnError(
      'no_credential',
      'the registration response carries no credential to store',
    );
  }

  // Proves the key is well-formed and of an algorithm we can actually verify
  // with, now, rather than at the first login when it is too late to say so.
  const key = coseToPublicKey(decodeCbor(parsed.attested.cosePublicKey));
  createPublicKey({ key: Buffer.from(key.spki), format: 'der', type: 'spki' });

  return {
    credentialId: credentialIdText(parsed.attested.credentialId),
    publicKeyCose: toBase64Url(parsed.attested.cosePublicKey),
    algorithm: key.algorithm,
    signCount: parsed.signCount,
    aaguid: formatAaguid(parsed.attested.aaguid),
    flags,
    attestationFormat: format,
  };
}

export interface AssertionResponse {
  /** base64url of the credential id the browser used. */
  readonly credentialId: string;
  /** base64url of the authenticator data. */
  readonly authenticatorData: string;
  /** base64url of clientDataJSON. */
  readonly clientDataJson: string;
  /** base64url of the signature. */
  readonly signature: string;
  /** base64url of the user handle, when the authenticator returned one. */
  readonly userHandle: string | null;
}

/**
 * Verifies one signature.
 *
 * Node throws on a malformed signature rather than returning false, so the throw
 * is turned into the same answer a wrong signature gives. There is nothing to
 * distinguish for a caller: neither is a valid assertion.
 */
function signatureVerifies(
  spki: Uint8Array,
  algorithm: CoseAlgorithm,
  signedData: Uint8Array,
  signature: Uint8Array,
): boolean {
  const key = createPublicKey({ key: Buffer.from(spki), format: 'der', type: 'spki' });
  try {
    // Ed25519 signs the message itself; the other two hash it with SHA-256.
    // WebAuthn's ECDSA signatures are ASN.1 DER, which is Node's default.
    const digest = algorithm === -8 ? null : 'sha256';
    return cryptoVerify(digest, Buffer.from(signedData), key, Buffer.from(signature));
  } catch {
    return false;
  }
}

export function verifyAssertion(
  response: AssertionResponse,
  credential: StoredCredential,
  expected: ExpectedCeremony,
): AssertionResult {
  // The browser must have used a credential we know. Checked before any crypto,
  // because verifying a signature against somebody else's key proves nothing.
  if (!base64UrlEqual(response.credentialId, credential.credentialId)) {
    throw new WebAuthnError('unknown_credential', 'that passkey is not registered here');
  }

  const clientDataJson = fromBase64Url(response.clientDataJson);
  const authenticatorData = fromBase64Url(response.authenticatorData);
  const { flags, signCount } = verifyCommon(
    clientDataJson,
    authenticatorData,
    expected,
    'webauthn.get',
  );

  const key = coseToPublicKey(decodeCbor(fromBase64Url(credential.publicKeyCose)));
  const signedData = concatBytes(authenticatorData, sha256(clientDataJson));

  if (
    !signatureVerifies(key.spki, key.algorithm, signedData, fromBase64Url(response.signature))
  ) {
    throw new WebAuthnError('bad_signature', 'the signature does not match the stored passkey');
  }

  /*
   * Signature counter, §6.1.1.
   *
   * An authenticator that keeps a counter increments it on every assertion, so a
   * counter that stays put or goes backwards is the published signal of a cloned
   * credential, and it is refused. Many platform authenticators — Windows Hello
   * among them — keep no counter at all and always send zero; that is not a
   * clone signal and must not be treated as one, so both-zero is accepted and
   * recorded as "this authenticator has no counter".
   */
  if (!(credential.signCount === 0 && signCount === 0) && signCount <= credential.signCount) {
    throw new WebAuthnError(
      'sign_count_regressed',
      'the passkey signature counter did not advance, which can mean the key was copied',
    );
  }

  return { credentialId: credential.credentialId, signCount, flags };
}
