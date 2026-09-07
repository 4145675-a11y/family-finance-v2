import {
  createHash,
  createSign,
  generateKeyPairSync,
  randomBytes,
  sign as cryptoSign,
  type KeyObject,
} from 'node:crypto';

import { concatBytes, fromBase64Url, toBase64Url, utf8 } from '../bytes';
import type { AssertionResponse, RegistrationResponse } from '../verify';
import { encodeCbor, type Encodable } from './cbor-encode';

/**
 * A software authenticator.
 *
 * Every response it produces is a real one: real key pairs from the system's
 * crypto library, real signatures over the real signed data, real CBOR. The only
 * thing it does not have is a person and a fingerprint sensor — so it can prove
 * that the verifier accepts a correct ceremony and rejects each specific way a
 * ceremony can be wrong, which is exactly the part a real Windows Hello prompt
 * cannot be scripted to demonstrate.
 *
 * That distinction is kept explicit in the test names and in the checkpoint: an
 * automated protocol test is not a Windows Hello ceremony, and claiming
 * otherwise would be claiming a check that never ran.
 */

export type TestAlgorithm = 'ES256' | 'RS256' | 'Ed25519';

const COSE_ALG: Readonly<Record<TestAlgorithm, number>> = {
  ES256: -7,
  RS256: -257,
  Ed25519: -8,
};

const sha256 = (bytes: Uint8Array): Uint8Array =>
  new Uint8Array(createHash('sha256').update(bytes).digest());

function generate(algorithm: TestAlgorithm): { privateKey: KeyObject; publicKey: KeyObject } {
  if (algorithm === 'ES256') {
    return generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  }
  if (algorithm === 'RS256') {
    return generateKeyPairSync('rsa', { modulusLength: 2048 });
  }
  return generateKeyPairSync('ed25519');
}

/** The public key as COSE, built from the JWK the crypto library exports. */
function coseKeyFor(algorithm: TestAlgorithm, publicKey: KeyObject): Uint8Array {
  const jwk = publicKey.export({ format: 'jwk' }) as Record<string, string>;

  if (algorithm === 'ES256') {
    return encodeCbor(
      new Map<number | string, Encodable>([
        [1, 2],
        [3, COSE_ALG.ES256],
        [-1, 1],
        [-2, fromBase64Url(jwk['x'] ?? '')],
        [-3, fromBase64Url(jwk['y'] ?? '')],
      ]),
    );
  }

  if (algorithm === 'RS256') {
    return encodeCbor(
      new Map<number | string, Encodable>([
        [1, 3],
        [3, COSE_ALG.RS256],
        [-1, fromBase64Url(jwk['n'] ?? '')],
        [-2, fromBase64Url(jwk['e'] ?? '')],
      ]),
    );
  }

  return encodeCbor(
    new Map<number | string, Encodable>([
      [1, 1],
      [3, COSE_ALG.Ed25519],
      [-1, 6],
      [-2, fromBase64Url(jwk['x'] ?? '')],
    ]),
  );
}

function signWith(
  algorithm: TestAlgorithm,
  privateKey: KeyObject,
  data: Uint8Array,
): Uint8Array {
  if (algorithm === 'Ed25519') {
    return new Uint8Array(cryptoSign(null, Buffer.from(data), privateKey));
  }
  const signer = createSign('sha256');
  signer.update(Buffer.from(data));
  return new Uint8Array(signer.sign(privateKey));
}

export interface AuthenticatorFlagOptions {
  readonly userPresent?: boolean;
  readonly userVerified?: boolean;
  readonly backupEligible?: boolean;
  readonly backedUp?: boolean;
}

export interface CeremonyOptions extends AuthenticatorFlagOptions {
  readonly challenge: string;
  readonly origin?: string;
  readonly rpId?: string;
  readonly type?: string;
  readonly signCount?: number;
  readonly crossOrigin?: boolean;
}

function flagByte(options: AuthenticatorFlagOptions, attested: boolean): number {
  let flags = 0;
  if (options.userPresent ?? true) flags |= 0x01;
  if (options.userVerified ?? true) flags |= 0x04;
  if (options.backupEligible ?? false) flags |= 0x08;
  if (options.backedUp ?? false) flags |= 0x10;
  if (attested) flags |= 0x40;
  return flags;
}

function authenticatorData(
  rpId: string,
  flags: number,
  signCount: number,
  attested: Uint8Array | null,
): Uint8Array {
  const counter = Uint8Array.from([
    (signCount >>> 24) & 0xff,
    (signCount >>> 16) & 0xff,
    (signCount >>> 8) & 0xff,
    signCount & 0xff,
  ]);
  const head = concatBytes(sha256(utf8(rpId)), Uint8Array.from([flags]), counter);
  return attested === null ? head : concatBytes(head, attested);
}

function clientDataJson(
  type: string,
  challenge: string,
  origin: string,
  crossOrigin: boolean,
): Uint8Array {
  return utf8(JSON.stringify({ type, challenge, origin, crossOrigin }));
}

export class SoftwareAuthenticator {
  readonly algorithm: TestAlgorithm;
  readonly credentialId: Uint8Array;
  readonly aaguid: Uint8Array;

  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;

  constructor(algorithm: TestAlgorithm = 'ES256') {
    this.algorithm = algorithm;
    const pair = generate(algorithm);
    this.privateKey = pair.privateKey;
    this.publicKey = pair.publicKey;
    this.credentialId = new Uint8Array(randomBytes(32));
    this.aaguid = new Uint8Array(16);
  }

  get credentialIdText(): string {
    return toBase64Url(this.credentialId);
  }

  /** The COSE public key, as the verifier would have stored it. */
  get publicKeyCose(): string {
    return toBase64Url(coseKeyFor(this.algorithm, this.publicKey));
  }

  register(options: CeremonyOptions): RegistrationResponse {
    const rpId = options.rpId ?? 'localhost';
    const cose = coseKeyFor(this.algorithm, this.publicKey);

    const attested = concatBytes(
      this.aaguid,
      Uint8Array.from([
        (this.credentialId.length >> 8) & 0xff,
        this.credentialId.length & 0xff,
      ]),
      this.credentialId,
      cose,
    );

    const authData = authenticatorData(
      rpId,
      flagByte(options, true),
      options.signCount ?? 0,
      attested,
    );

    const attestationObject = encodeCbor(
      new Map<number | string, Encodable>([
        ['fmt', 'none'],
        ['attStmt', new Map<number | string, Encodable>()],
        ['authData', authData],
      ]),
    );

    return {
      attestationObject: toBase64Url(attestationObject),
      clientDataJson: toBase64Url(
        clientDataJson(
          options.type ?? 'webauthn.create',
          options.challenge,
          options.origin ?? 'http://localhost:3100',
          options.crossOrigin ?? false,
        ),
      ),
    };
  }

  authenticate(options: CeremonyOptions): AssertionResponse {
    const rpId = options.rpId ?? 'localhost';
    const authData = authenticatorData(
      rpId,
      flagByte(options, false),
      options.signCount ?? 0,
      null,
    );
    const client = clientDataJson(
      options.type ?? 'webauthn.get',
      options.challenge,
      options.origin ?? 'http://localhost:3100',
      options.crossOrigin ?? false,
    );

    const signature = signWith(
      this.algorithm,
      this.privateKey,
      concatBytes(authData, sha256(client)),
    );

    return {
      credentialId: this.credentialIdText,
      authenticatorData: toBase64Url(authData),
      clientDataJson: toBase64Url(client),
      signature: toBase64Url(signature),
      userHandle: null,
    };
  }
}
