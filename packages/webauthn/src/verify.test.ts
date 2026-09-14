import { describe, expect, test } from 'vitest';

import { WebAuthnError, fromBase64Url, toBase64Url } from './bytes';
import { decodeCbor, cborMap, cborBytes } from './cbor';
import { encodeCbor, type Encodable } from './fixtures/cbor-encode';
import { SoftwareAuthenticator, type TestAlgorithm } from './fixtures/authenticator';
import { createChallenge, verifyAssertion, verifyRegistration } from './verify';

/**
 * The verifier, exercised against a real authenticator.
 *
 * Every response here is genuine: real key pairs, real signatures, real CBOR.
 * What is being tested is not that the happy path works — that is the easy half
 * — but that each individual check *fails* when it should. A verifier where one
 * check has quietly stopped running still passes every happy-path test, and the
 * failure is invisible until somebody exploits it.
 *
 * These are protocol tests. They are not a Windows Hello ceremony; no biometric
 * sensor is involved and none is claimed.
 */

const EXPECTED = {
  challenge: '',
  origin: 'http://localhost:3100',
  rpId: 'localhost',
};

function expected(challenge: string) {
  return { ...EXPECTED, challenge };
}

/** Registers an authenticator and returns what a store would have kept. */
function enrol(authenticator: SoftwareAuthenticator) {
  const challenge = createChallenge();
  const result = verifyRegistration(authenticator.register({ challenge }), expected(challenge));
  return {
    credentialId: result.credentialId,
    publicKeyCose: result.publicKeyCose,
    signCount: result.signCount,
  };
}

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof WebAuthnError ? error.code : `unexpected:${String(error)}`;
  }
  return 'no_error';
}

describe('challenges', () => {
  test('a challenge is 32 random bytes and never repeats', () => {
    const seen = new Set<string>();
    for (let index = 0; index < 200; index += 1) {
      const challenge = createChallenge();
      expect(fromBase64Url(challenge)).toHaveLength(32);
      expect(seen.has(challenge)).toBe(false);
      seen.add(challenge);
    }
  });
});

describe.each<TestAlgorithm>(['ES256', 'RS256', 'Ed25519'])(
  'registration with %s',
  (algorithm) => {
    test('a correct ceremony is accepted and yields a usable credential', () => {
      const authenticator = new SoftwareAuthenticator(algorithm);
      const challenge = createChallenge();

      const result = verifyRegistration(
        authenticator.register({ challenge }),
        expected(challenge),
      );

      expect(result.credentialId).toBe(authenticator.credentialIdText);
      expect(result.publicKeyCose).toBe(authenticator.publicKeyCose);
      expect(result.flags.userVerified).toBe(true);
      expect(result.attestationFormat).toBe('none');
      expect(result.aaguid).toBeNull();
    });

    test('the credential it produced can then sign an assertion', () => {
      const authenticator = new SoftwareAuthenticator(algorithm);
      const credential = enrol(authenticator);
      const challenge = createChallenge();

      const assertion = verifyAssertion(
        authenticator.authenticate({ challenge }),
        credential,
        expected(challenge),
      );

      expect(assertion.credentialId).toBe(credential.credentialId);
      expect(assertion.flags.userVerified).toBe(true);
    });
  },
);

describe('registration refuses what it must refuse', () => {
  const authenticator = new SoftwareAuthenticator();

  test('a response answering a different challenge', () => {
    const issued = createChallenge();
    const response = authenticator.register({ challenge: createChallenge() });
    expect(codeOf(() => verifyRegistration(response, expected(issued)))).toBe(
      'challenge_mismatch',
    );
  });

  test('a response from another origin', () => {
    const challenge = createChallenge();
    const response = authenticator.register({ challenge, origin: 'http://evil.example:3100' });
    expect(codeOf(() => verifyRegistration(response, expected(challenge)))).toBe(
      'origin_mismatch',
    );
  });

  test('a response from the same host on another port', () => {
    const challenge = createChallenge();
    const response = authenticator.register({ challenge, origin: 'http://localhost:3101' });
    expect(codeOf(() => verifyRegistration(response, expected(challenge)))).toBe(
      'origin_mismatch',
    );
  });

  test('a response from 127.0.0.1 when localhost was expected', () => {
    // The two are not interchangeable, and the product's whole origin decision
    // rests on their being told apart.
    const challenge = createChallenge();
    const response = authenticator.register({ challenge, origin: 'http://127.0.0.1:3100' });
    expect(codeOf(() => verifyRegistration(response, expected(challenge)))).toBe(
      'origin_mismatch',
    );
  });

  test('a response signed for another relying party', () => {
    const challenge = createChallenge();
    const response = authenticator.register({ challenge, rpId: 'example.com' });
    expect(codeOf(() => verifyRegistration(response, expected(challenge)))).toBe(
      'rp_id_mismatch',
    );
  });

  test('a response where nobody was verified', () => {
    const challenge = createChallenge();
    const response = authenticator.register({ challenge, userVerified: false });
    expect(codeOf(() => verifyRegistration(response, expected(challenge)))).toBe(
      'user_not_verified',
    );
  });

  test('a response where nobody was even present', () => {
    const challenge = createChallenge();
    const response = authenticator.register({
      challenge,
      userPresent: false,
      userVerified: false,
    });
    expect(codeOf(() => verifyRegistration(response, expected(challenge)))).toBe(
      'user_not_present',
    );
  });

  test('an assertion replayed as a registration', () => {
    const challenge = createChallenge();
    const response = authenticator.register({ challenge, type: 'webauthn.get' });
    expect(codeOf(() => verifyRegistration(response, expected(challenge)))).toBe(
      'wrong_ceremony_type',
    );
  });

  test('a ceremony run inside a frame from another origin', () => {
    const challenge = createChallenge();
    const response = authenticator.register({ challenge, crossOrigin: true });
    expect(codeOf(() => verifyRegistration(response, expected(challenge)))).toBe(
      'cross_origin',
    );
  });
});

describe('authentication refuses what it must refuse', () => {
  test('an unknown credential is refused before any signature is checked', () => {
    const enrolled = new SoftwareAuthenticator();
    const stranger = new SoftwareAuthenticator();
    const credential = enrol(enrolled);
    const challenge = createChallenge();

    expect(
      codeOf(() =>
        verifyAssertion(stranger.authenticate({ challenge }), credential, expected(challenge)),
      ),
    ).toBe('unknown_credential');
  });

  test('a signature made by a different key with the right credential id', () => {
    // The most important negative case: everything matches except the maths.
    const enrolled = new SoftwareAuthenticator();
    const impostor = new SoftwareAuthenticator();
    const credential = enrol(enrolled);
    const challenge = createChallenge();

    const response = {
      ...impostor.authenticate({ challenge }),
      credentialId: credential.credentialId,
    };

    expect(codeOf(() => verifyAssertion(response, credential, expected(challenge)))).toBe(
      'bad_signature',
    );
  });

  test('a tampered authenticator data invalidates the signature', () => {
    const authenticator = new SoftwareAuthenticator();
    const credential = enrol(authenticator);
    const challenge = createChallenge();
    const response = authenticator.authenticate({ challenge });

    const bytes = fromBase64Url(response.authenticatorData);
    bytes[33] = (bytes[33] ?? 0) | 0x10;

    expect(
      codeOf(() =>
        verifyAssertion(
          { ...response, authenticatorData: toBase64Url(bytes) },
          credential,
          expected(challenge),
        ),
      ),
    ).toBe('bad_signature');
  });

  test('a challenge issued for someone else', () => {
    const authenticator = new SoftwareAuthenticator();
    const credential = enrol(authenticator);
    const issued = createChallenge();

    expect(
      codeOf(() =>
        verifyAssertion(
          authenticator.authenticate({ challenge: createChallenge() }),
          credential,
          expected(issued),
        ),
      ),
    ).toBe('challenge_mismatch');
  });

  test('an assertion from the wrong origin', () => {
    const authenticator = new SoftwareAuthenticator();
    const credential = enrol(authenticator);
    const challenge = createChallenge();

    expect(
      codeOf(() =>
        verifyAssertion(
          authenticator.authenticate({ challenge, origin: 'http://127.0.0.1:3100' }),
          credential,
          expected(challenge),
        ),
      ),
    ).toBe('origin_mismatch');
  });

  test('an assertion signed for another relying party', () => {
    const authenticator = new SoftwareAuthenticator();
    const credential = enrol(authenticator);
    const challenge = createChallenge();

    expect(
      codeOf(() =>
        verifyAssertion(
          authenticator.authenticate({ challenge, rpId: 'example.com' }),
          credential,
          expected(challenge),
        ),
      ),
    ).toBe('rp_id_mismatch');
  });

  test('an assertion without user verification', () => {
    const authenticator = new SoftwareAuthenticator();
    const credential = enrol(authenticator);
    const challenge = createChallenge();

    expect(
      codeOf(() =>
        verifyAssertion(
          authenticator.authenticate({ challenge, userVerified: false }),
          credential,
          expected(challenge),
        ),
      ),
    ).toBe('user_not_verified');
  });

  test('a registration replayed as an assertion', () => {
    const authenticator = new SoftwareAuthenticator();
    const credential = enrol(authenticator);
    const challenge = createChallenge();

    expect(
      codeOf(() =>
        verifyAssertion(
          authenticator.authenticate({ challenge, type: 'webauthn.create' }),
          credential,
          expected(challenge),
        ),
      ),
    ).toBe('wrong_ceremony_type');
  });
});

describe('the signature counter', () => {
  test('an authenticator that keeps no counter is accepted', () => {
    const authenticator = new SoftwareAuthenticator();
    const credential = enrol(authenticator);
    const challenge = createChallenge();

    const result = verifyAssertion(
      authenticator.authenticate({ challenge, signCount: 0 }),
      credential,
      expected(challenge),
    );
    expect(result.signCount).toBe(0);
  });

  test('a counter that advances is accepted and reported', () => {
    const authenticator = new SoftwareAuthenticator();
    const credential = { ...enrol(authenticator), signCount: 7 };
    const challenge = createChallenge();

    const result = verifyAssertion(
      authenticator.authenticate({ challenge, signCount: 8 }),
      credential,
      expected(challenge),
    );
    expect(result.signCount).toBe(8);
  });

  test('a counter that stands still is refused as a possible clone', () => {
    const authenticator = new SoftwareAuthenticator();
    const credential = { ...enrol(authenticator), signCount: 7 };
    const challenge = createChallenge();

    expect(
      codeOf(() =>
        verifyAssertion(
          authenticator.authenticate({ challenge, signCount: 7 }),
          credential,
          expected(challenge),
        ),
      ),
    ).toBe('sign_count_regressed');
  });

  test('a counter that goes backwards is refused', () => {
    const authenticator = new SoftwareAuthenticator();
    const credential = { ...enrol(authenticator), signCount: 9 };
    const challenge = createChallenge();

    expect(
      codeOf(() =>
        verifyAssertion(
          authenticator.authenticate({ challenge, signCount: 3 }),
          credential,
          expected(challenge),
        ),
      ),
    ).toBe('sign_count_regressed');
  });
});

describe('malformed input is refused rather than guessed at', () => {
  test('an attestation object that is not CBOR', () => {
    const challenge = createChallenge();
    expect(
      codeOf(() =>
        verifyRegistration(
          { attestationObject: 'AAAA', clientDataJson: toBase64Url(new Uint8Array(4)) },
          expected(challenge),
        ),
      ),
    ).not.toBe('no_error');
  });

  test('client data that is not JSON', () => {
    const authenticator = new SoftwareAuthenticator();
    const challenge = createChallenge();
    const response = authenticator.register({ challenge });

    expect(
      codeOf(() =>
        verifyRegistration(
          { ...response, clientDataJson: toBase64Url(new TextEncoder().encode('not json')) },
          expected(challenge),
        ),
      ),
    ).toBe('malformed_client_data');
  });

  test('a registration carrying no credential', () => {
    const authenticator = new SoftwareAuthenticator();
    const challenge = createChallenge();
    const response = authenticator.register({ challenge });

    // Rebuild the attestation object with the attested-credential flag cleared
    // and the credential stripped, which is what a bare assertion looks like.
    const attestation = cborMap(
      decodeCbor(fromBase64Url(response.attestationObject)),
      'attestation',
    );
    const authData = cborBytes(attestation.get('authData'), 'authData').slice(0, 37);
    authData[32] = (authData[32] ?? 0) & ~0x40;

    const rebuilt = encodeCbor(
      new Map<number | string, Encodable>([
        ['fmt', 'none'],
        ['attStmt', new Map<number | string, Encodable>()],
        ['authData', authData],
      ]),
    );

    expect(
      codeOf(() =>
        verifyRegistration(
          { ...response, attestationObject: toBase64Url(rebuilt) },
          expected(challenge),
        ),
      ),
    ).toBe('no_credential');
  });

  test('authenticator data shorter than its own header', () => {
    const authenticator = new SoftwareAuthenticator();
    const credential = enrol(authenticator);
    const challenge = createChallenge();
    const response = authenticator.authenticate({ challenge });

    expect(
      codeOf(() =>
        verifyAssertion(
          { ...response, authenticatorData: toBase64Url(new Uint8Array(10)) },
          credential,
          expected(challenge),
        ),
      ),
    ).toBe('malformed_authenticator_data');
  });

  test('a signature that is not a signature', () => {
    const authenticator = new SoftwareAuthenticator();
    const credential = enrol(authenticator);
    const challenge = createChallenge();
    const response = authenticator.authenticate({ challenge });

    expect(
      codeOf(() =>
        verifyAssertion(
          { ...response, signature: toBase64Url(new Uint8Array([1, 2, 3])) },
          credential,
          expected(challenge),
        ),
      ),
    ).toBe('bad_signature');
  });
});
