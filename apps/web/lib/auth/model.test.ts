import { describe, expect, test } from 'vitest';

import {
  ABSOLUTE_SESSION_HOURS,
  AuthError,
  MAX_CREDENTIALS,
  addCredential,
  authStateSchema,
  closeAllSessions,
  closeSession,
  consumeChallenge,
  emptyAuthState,
  isProtected,
  issueChallenge,
  logged,
  markReverified,
  openSession,
  recordCredentialUse,
  removeCredential,
  sessionVerdict,
  touchSession,
  verifiedRecently,
  type AuthState,
  type StoredPasskey,
} from './model';
import { describeOrigin, isIpAddressHost, requestIsAtAuthOrigin } from './origin';

/**
 * The policy half of the lock.
 *
 * The protocol tests in `packages/webauthn` prove a signature is checked. These
 * prove the rules around it: that a challenge works once, that a session stops
 * being a session, and that removing a passkey removes the access it gave.
 *
 * Every one of them is a rule that a real login flow would still appear to obey
 * if it were broken, which is why they are tested rather than reasoned about.
 */

const T0 = '2026-09-07T09:00:00.000Z';
const later = (minutes: number, from = T0): string =>
  new Date(Date.parse(from) + minutes * 60 * 1000).toISOString();

function blank(): AuthState {
  return emptyAuthState('http://localhost:3100', 'localhost', T0);
}

function passkey(overrides: Partial<StoredPasskey> = {}): StoredPasskey {
  return {
    credentialId: 'credential-one',
    publicKeyCose: 'cose',
    algorithm: -7,
    signCount: 0,
    aaguid: null,
    label: 'המחשב בבית',
    backedUp: false,
    createdAt: T0,
    lastUsedAt: null,
    ...overrides,
  };
}

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof AuthError ? error.code : `unexpected:${String(error)}`;
  }
  return 'no_error';
}

describe('an empty state', () => {
  test('is a valid document', () => {
    expect(authStateSchema.safeParse(blank()).success).toBe(true);
  });

  test('is not protected, because there is nothing to check against', () => {
    expect(isProtected(blank())).toBe(false);
  });

  test('carries a user handle that is not a name, an address or a household', () => {
    const state = blank();
    expect(state.userHandle.length).toBeGreaterThanOrEqual(16);
    expect(state.userHandle).not.toContain('@');
  });

  test('becomes protected the moment a passkey exists', () => {
    expect(isProtected(addCredential(blank(), passkey(), T0))).toBe(true);
  });
});

describe('challenges are single-use', () => {
  test('a challenge can be consumed once', () => {
    const issued = issueChallenge(blank(), { value: 'abc', purpose: 'authentication' }, T0);
    const consumed = consumeChallenge(
      issued.state,
      { id: issued.challenge.id, purpose: 'authentication' },
      T0,
    );
    expect(consumed.challenge.value).toBe('abc');
    expect(consumed.state.challenges).toHaveLength(0);
  });

  test('the same challenge cannot be consumed twice', () => {
    // This is the replay defence. A captured assertion is a perfectly valid
    // assertion; what stops it is that the challenge it answers is gone.
    const issued = issueChallenge(blank(), { value: 'abc', purpose: 'authentication' }, T0);
    const first = consumeChallenge(
      issued.state,
      { id: issued.challenge.id, purpose: 'authentication' },
      T0,
    );

    expect(
      codeOf(() =>
        consumeChallenge(
          first.state,
          { id: issued.challenge.id, purpose: 'authentication' },
          T0,
        ),
      ),
    ).toBe('unknown_challenge');
  });

  test('an expired challenge is refused', () => {
    const issued = issueChallenge(blank(), { value: 'abc', purpose: 'authentication' }, T0);
    expect(
      codeOf(() =>
        consumeChallenge(
          issued.state,
          { id: issued.challenge.id, purpose: 'authentication' },
          later(3),
        ),
      ),
    ).toBe('challenge_expired');
  });

  test('a challenge issued for one purpose cannot be used for another', () => {
    const issued = issueChallenge(blank(), { value: 'abc', purpose: 'registration' }, T0);
    expect(
      codeOf(() =>
        consumeChallenge(
          issued.state,
          { id: issued.challenge.id, purpose: 'authentication' },
          T0,
        ),
      ),
    ).toBe('wrong_challenge_purpose');
  });

  test('a re-authentication challenge belongs to the session it was issued to', () => {
    const sessionId = crypto.randomUUID();
    const issued = issueChallenge(
      blank(),
      { value: 'abc', purpose: 'reauthentication', sessionId, actionKey: 'backup_restore' },
      T0,
    );

    expect(
      codeOf(() =>
        consumeChallenge(
          issued.state,
          {
            id: issued.challenge.id,
            purpose: 'reauthentication',
            sessionId: crypto.randomUUID(),
          },
          T0,
        ),
      ),
    ).toBe('wrong_challenge_session');

    const right = consumeChallenge(
      issued.state,
      { id: issued.challenge.id, purpose: 'reauthentication', sessionId },
      T0,
    );
    expect(right.challenge.actionKey).toBe('backup_restore');
  });

  test('an unknown challenge id is refused rather than ignored', () => {
    expect(
      codeOf(() =>
        consumeChallenge(blank(), { id: crypto.randomUUID(), purpose: 'authentication' }, T0),
      ),
    ).toBe('unknown_challenge');
  });

  test('issuing a challenge sweeps ones that have run out', () => {
    const first = issueChallenge(blank(), { value: 'one', purpose: 'authentication' }, T0);
    const second = issueChallenge(
      first.state,
      { value: 'two', purpose: 'authentication' },
      later(5),
    );
    expect(second.state.challenges).toHaveLength(1);
    expect(second.state.challenges[0]?.value).toBe('two');
  });
});

describe('sessions expire', () => {
  const withKey = addCredential(blank(), passkey(), T0);
  const opened = openSession(
    withKey,
    { tokenHash: 'a'.repeat(64), credentialId: 'credential-one' },
    T0,
  );

  test('a fresh session is active', () => {
    expect(sessionVerdict(opened.state, opened.session, T0)).toBe('active');
  });

  test('a session is still active just before the idle limit', () => {
    expect(sessionVerdict(opened.state, opened.session, later(14))).toBe('active');
  });

  test('a session goes idle after the configured quiet period', () => {
    expect(sessionVerdict(opened.state, opened.session, later(15))).toBe('idle');
  });

  test('activity keeps a session alive', () => {
    const touched = touchSession(opened.state, opened.session.id, later(14));
    const session = touched.sessions.find((candidate) => candidate.id === opened.session.id);
    expect(sessionVerdict(touched, session, later(20))).toBe('active');
  });

  test('but activity cannot keep it alive past the absolute ceiling', () => {
    // A tab left open and nudged every ten minutes must still lock eventually.
    let state = opened.state;
    for (let hour = 1; hour <= ABSOLUTE_SESSION_HOURS; hour += 1) {
      state = touchSession(state, opened.session.id, later(hour * 60));
    }
    const session = state.sessions.find((candidate) => candidate.id === opened.session.id);
    expect(sessionVerdict(state, session, later(ABSOLUTE_SESSION_HOURS * 60))).toBe('expired');
  });

  test('a shorter configured timeout is honoured', () => {
    const strict = { ...opened.state, idleTimeoutMinutes: 2 };
    expect(sessionVerdict(strict, opened.session, later(3))).toBe('idle');
  });

  test('a cookie naming no session is simply unknown', () => {
    expect(sessionVerdict(opened.state, undefined, T0)).toBe('unknown');
  });

  test('signing out ends that session and no other', () => {
    const second = openSession(
      opened.state,
      { tokenHash: 'b'.repeat(64), credentialId: 'credential-one' },
      T0,
    );
    const closed = closeSession(second.state, opened.session.id, T0);
    expect(closed.sessions.map((session) => session.id)).toEqual([second.session.id]);
  });

  test('closing every session leaves none', () => {
    expect(closeAllSessions(opened.state, T0).sessions).toHaveLength(0);
  });
});

describe('sensitive actions need a recent check', () => {
  const withKey = addCredential(blank(), passkey(), T0);
  const opened = openSession(
    withKey,
    { tokenHash: 'c'.repeat(64), credentialId: 'credential-one' },
    T0,
  );

  test('immediately after signing in, a sensitive action may proceed', () => {
    expect(verifiedRecently(opened.session, T0)).toBe(true);
  });

  test('a few minutes later it may not', () => {
    expect(verifiedRecently(opened.session, later(6))).toBe(false);
  });

  test('being active is not the same as being verified', () => {
    // The distinction the whole re-authentication rule rests on: a session that
    // has been clicking around is alive, and that is not authorisation to export
    // everything.
    const touched = touchSession(opened.state, opened.session.id, later(10));
    const session = touched.sessions.find((candidate) => candidate.id === opened.session.id);
    expect(sessionVerdict(touched, session, later(10))).toBe('active');
    expect(verifiedRecently(session!, later(10))).toBe(false);
  });

  test('re-verifying restores it without opening a new session', () => {
    const reverified = markReverified(opened.state, opened.session.id, later(30));
    const session = reverified.sessions.find((candidate) => candidate.id === opened.session.id);
    expect(session?.id).toBe(opened.session.id);
    expect(verifiedRecently(session!, later(31))).toBe(true);
  });
});

describe('passkeys', () => {
  test('the same passkey cannot be enrolled twice', () => {
    const state = addCredential(blank(), passkey(), T0);
    expect(codeOf(() => addCredential(state, passkey(), T0))).toBe('passkey_already_enrolled');
  });

  test('there is a limit on how many may be enrolled', () => {
    let state = blank();
    for (let index = 0; index < MAX_CREDENTIALS; index += 1) {
      state = addCredential(state, passkey({ credentialId: `credential-${index}` }), T0);
    }
    expect(codeOf(() => addCredential(state, passkey({ credentialId: 'one-more' }), T0))).toBe(
      'too_many_passkeys',
    );
  });

  test('removing an unknown passkey is refused rather than ignored', () => {
    expect(codeOf(() => removeCredential(blank(), 'nothing', T0))).toBe('unknown_passkey');
  });

  test('removing a passkey ends the sessions it opened', () => {
    // Otherwise removal would be removal in name only: the browser that was
    // already signed in with it would keep working.
    let state = addCredential(blank(), passkey(), T0);
    state = addCredential(state, passkey({ credentialId: 'credential-two' }), T0);

    const first = openSession(
      state,
      { tokenHash: 'd'.repeat(64), credentialId: 'credential-one' },
      T0,
    );
    const second = openSession(
      first.state,
      { tokenHash: 'e'.repeat(64), credentialId: 'credential-two' },
      T0,
    );

    const removed = removeCredential(second.state, 'credential-one', T0);
    expect(removed.sessions.map((session) => session.credentialId)).toEqual(['credential-two']);
  });

  test('the signature counter is recorded so a copy can be spotted next time', () => {
    const state = addCredential(blank(), passkey(), T0);
    const used = recordCredentialUse(state, 'credential-one', 12, later(1));
    expect(used.credentials[0]?.signCount).toBe(12);
    expect(used.credentials[0]?.lastUsedAt).toBe(later(1));
  });
});

describe('the log', () => {
  test('records what happened without recording what was in it', () => {
    const state = logged(blank(), 'signed_in', T0, { credentialId: 'credential-one' });
    const entry = state.log[0];

    expect(entry?.event).toBe('signed_in');
    // The only fields that exist are the ones an auditor needs. There is nowhere
    // to put a signature, a challenge or a token even by accident.
    expect(Object.keys(entry ?? {}).sort()).toEqual([
      'at',
      'credentialId',
      'event',
      'id',
      'reason',
    ]);
  });

  test('a failed attempt records a reason code and no detail', () => {
    const state = logged(blank(), 'sign_in_failed', T0, { reason: 'bad_signature' });
    expect(state.log[0]?.reason).toBe('bad_signature');
    expect(state.log[0]?.credentialId).toBeNull();
  });

  test('stays bounded rather than growing without limit', () => {
    let state = blank();
    for (let index = 0; index < 1100; index += 1) {
      state = logged(state, 'signed_in', T0);
    }
    expect(state.log).toHaveLength(1000);
    expect(authStateSchema.safeParse(state).success).toBe(true);
  });
});

describe('which address a passkey can live at', () => {
  test('an IPv4 host is an address, not a domain', () => {
    expect(isIpAddressHost('127.0.0.1')).toBe(true);
    expect(isIpAddressHost('192.168.1.20')).toBe(true);
  });

  test('a bracketed IPv6 host is too', () => {
    expect(isIpAddressHost('[::1]')).toBe(true);
  });

  test('localhost is a name', () => {
    expect(isIpAddressHost('localhost')).toBe(false);
  });

  test('http://localhost:3100 can carry a passkey', () => {
    const origin = describeOrigin('http://localhost:3100');
    expect(origin.usable).toBe(true);
    expect(origin.rpId).toBe('localhost');
    expect(origin.origin).toBe('http://localhost:3100');
    expect(origin.host).toBe('localhost:3100');
  });

  test('http://127.0.0.1:3100 cannot, and says why', () => {
    // Measured, not assumed: Chromium refuses every relying party id on an
    // IP-address origin. The product states this rather than letting the
    // ceremony fail with a browser error.
    const origin = describeOrigin('http://127.0.0.1:3100');
    expect(origin.usable).toBe(false);
    expect(origin.reason).toBe('ip_address');
  });

  test('plain http on any other host cannot', () => {
    const origin = describeOrigin('http://finance.example:3100');
    expect(origin.usable).toBe(false);
    expect(origin.reason).toBe('insecure');
  });

  test('https on a real name can', () => {
    expect(describeOrigin('https://finance.example').usable).toBe(true);
  });

  test('a nonsense value is refused rather than half-accepted', () => {
    expect(describeOrigin('not a url').usable).toBe(false);
  });

  test('the port is part of the identity', () => {
    expect(describeOrigin('http://localhost:3100').host).not.toBe(
      describeOrigin('http://localhost:3101').host,
    );
  });

  test('a request at the wrong host is recognised as such', () => {
    expect(requestIsAtAuthOrigin('localhost:3100')).toBe(true);
    expect(requestIsAtAuthOrigin('127.0.0.1:3100')).toBe(false);
    expect(requestIsAtAuthOrigin(null)).toBe(false);
  });
});
