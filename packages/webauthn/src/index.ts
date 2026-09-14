export {
  WebAuthnError,
  base64UrlEqual,
  bytesEqual,
  concatBytes,
  fromBase64Url,
  toBase64Url,
  utf8,
} from './bytes';

export {
  cborBytes,
  cborInteger,
  cborMap,
  decodeCbor,
  decodeCborValue,
  type CborValue,
} from './cbor';

export {
  SUPPORTED_ALGORITHMS,
  coseToPublicKey,
  readCoseKey,
  type CoseAlgorithm,
  type CosePublicKey,
} from './cose';

export {
  credentialIdText,
  formatAaguid,
  parseAuthenticatorData,
  type AttestedCredential,
  type AuthenticatorData,
  type AuthenticatorFlags,
} from './authenticator-data';

export {
  CHALLENGE_LIFETIME_MS,
  createChallenge,
  verifyAssertion,
  verifyRegistration,
  type AssertionResponse,
  type AssertionResult,
  type ExpectedCeremony,
  type RegistrationResponse,
  type RegistrationResult,
  type StoredCredential,
} from './verify';
