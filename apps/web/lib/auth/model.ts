import { z } from 'zod';

/**
 * What the application remembers about who may open it.
 *
 * Three rules shape this file, and each of them is a decision worth being able
 * to point at later.
 *
 * *Nothing biometric is here.* A fingerprint never leaves the sensor: Windows
 * Hello checks it inside the device and the authenticator answers with a
 * signature. What is stored is a public key and an identifier — the same things
 * a web server stores about a TLS client — and there is no field in this schema
 * that could hold a template, an image, or a score even if something tried to
 * put one there.
 *
 * *A challenge is single-use and short-lived.* It is issued, stored, and removed
 * the moment it is consumed, whether the ceremony succeeded or failed. Replaying
 * a captured assertion therefore fails on the second attempt regardless of how
 * good the signature is.
 *
 * *A session is a random secret we never keep.* The cookie holds the token; this
 * file holds only its SHA-256. Reading the file cannot produce a token that
 * opens anything, which matters because the file sits in the same directory as
 * the household's money.
 *
 * Everything here is a pure function of state and a timestamp. The clock is
 * passed in for the same reason the finance engine takes `asOf`: a security
 * decision that cannot be replayed cannot be reasoned about.
 */

export const AUTH_FORMAT_VERSION = 1;

/** How long a session may sit untouched before it locks itself again. */
export const DEFAULT_IDLE_TIMEOUT_MINUTES = 15;

/**
 * A hard ceiling on a session regardless of activity.
 *
 * Idle timeout alone would let a tab left open and nudged occasionally stay
 * unlocked forever.
 */
export const ABSOLUTE_SESSION_HOURS = 12;

/**
 * How recently Windows Hello must have been used before a sensitive action.
 *
 * Short enough that an unattended machine is not an authorisation, long enough
 * that restoring a backup does not mean two prompts in a row.
 */
export const REAUTH_WINDOW_MINUTES = 5;

/** How long an issued challenge stays usable. */
export const CHALLENGE_LIFETIME_MINUTES = 2;

/** The most passkeys one household may enrol. More than enough for two people and a spare. */
export const MAX_CREDENTIALS = 10;

export const challengePurposeSchema = z.enum([
  'registration',
  'authentication',
  'reauthentication',
]);
export type ChallengePurpose = z.infer<typeof challengePurposeSchema>;

export const storedCredentialSchema = z.object({
  /** base64url of the credential id the authenticator generated. */
  credentialId: z.string().min(1).max(2000),
  /** base64url of the COSE public key. A public key: it verifies, it cannot sign. */
  publicKeyCose: z.string().min(1).max(4000),
  /** COSE algorithm identifier, e.g. -7 for ES256 or -257 for RS256. */
  algorithm: z.number().int().min(-65_536).max(65_536),
  signCount: z.number().int().min(0),
  /** The authenticator model, when it reported one. Null for `attestation: none`. */
  aaguid: z.string().max(64).nullable(),
  /** What the family called it: "המחשב של יוסי". Their words, not a device string. */
  label: z.string().trim().min(1).max(80),
  /** True when the platform says the passkey is synchronised to the account. */
  backedUp: z.boolean(),
  createdAt: z.iso.datetime({ offset: true }),
  lastUsedAt: z.iso.datetime({ offset: true }).nullable(),
});
export type StoredPasskey = z.infer<typeof storedCredentialSchema>;

export const pendingChallengeSchema = z.object({
  id: z.uuid(),
  /** base64url of 32 random bytes. */
  value: z.string().min(20).max(200),
  purpose: challengePurposeSchema,
  createdAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }),
  /**
   * For a re-authentication, the session it was issued to.
   *
   * Without this, a challenge minted for one browser could be answered by
   * another and used to unlock a sensitive action in the wrong session.
   */
  sessionId: z.uuid().nullable(),
  /** What the re-authentication is for, so the screen can name it. */
  actionKey: z.string().max(60).nullable(),
});
export type PendingChallenge = z.infer<typeof pendingChallengeSchema>;

export const sessionSchema = z.object({
  id: z.uuid(),
  /** SHA-256 of the cookie value. The token itself is never written down. */
  tokenHash: z.string().length(64),
  credentialId: z.string().min(1).max(2000),
  createdAt: z.iso.datetime({ offset: true }),
  /** The last request this session made. Idle timeout is measured from here. */
  lastSeenAt: z.iso.datetime({ offset: true }),
  /** The last time Windows Hello actually verified the person. */
  verifiedAt: z.iso.datetime({ offset: true }),
});
export type AuthSession = z.infer<typeof sessionSchema>;

/**
 * The authentication log.
 *
 * Records that something happened and never what was in it. There is no field
 * for an authenticator response, a signature, a challenge value or a token, and
 * that is a deliberate limit rather than an oversight: a log that holds the
 * material it is logging about is a second copy of the secret.
 */
export const authLogEventSchema = z.enum([
  'passkey_enrolled',
  'passkey_removed',
  'passkey_renamed',
  'signed_in',
  'sign_in_failed',
  'reauthenticated',
  'reauthentication_failed',
  'signed_out',
  'session_expired',
  'settings_changed',
  'recovery_reset',
]);
export type AuthLogEvent = z.infer<typeof authLogEventSchema>;

export const authLogEntrySchema = z.object({
  id: z.uuid(),
  at: z.iso.datetime({ offset: true }),
  event: authLogEventSchema,
  /** Which passkey, when the event concerns one. */
  credentialId: z.string().max(2000).nullable(),
  /** A short machine-readable reason. Never a signature, a token or a challenge. */
  reason: z.string().max(80).nullable(),
});
export type AuthLogEntry = z.infer<typeof authLogEntrySchema>;

export const authStateSchema = z.object({
  formatVersion: z.literal(AUTH_FORMAT_VERSION),
  updatedAt: z.iso.datetime({ offset: true }),
  /** The origin these credentials were enrolled against. */
  origin: z.string().min(1).max(200),
  /** The relying party id these credentials were enrolled against. */
  rpId: z.string().min(1).max(200),
  /**
   * The WebAuthn user handle: a random identifier for this installation.
   *
   * Discoverable credentials store it on the authenticator, so it must be stable
   * and it must not be personal. Sixteen random bytes carry no name, no email and
   * no household — the specification warns against putting anything identifying
   * here, because whoever holds the authenticator can read it back.
   */
  userHandle: z.string().min(16).max(200),
  idleTimeoutMinutes: z.number().int().min(1).max(480),
  credentials: z.array(storedCredentialSchema).max(MAX_CREDENTIALS),
  challenges: z.array(pendingChallengeSchema).max(50),
  sessions: z.array(sessionSchema).max(50),
  log: z.array(authLogEntrySchema).max(2000),
});
export type AuthState = z.infer<typeof authStateSchema>;

export function emptyAuthState(origin: string, rpId: string, now: string): AuthState {
  return {
    formatVersion: AUTH_FORMAT_VERSION,
    updatedAt: now,
    origin,
    rpId,
    userHandle: crypto.randomUUID(),
    idleTimeoutMinutes: DEFAULT_IDLE_TIMEOUT_MINUTES,
    credentials: [],
    challenges: [],
    sessions: [],
    log: [],
  };
}

export class AuthError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

const minutes = (count: number): number => count * 60 * 1000;
const at = (iso: string): number => Date.parse(iso);

/** True once a passkey exists. Before that the application has nothing to lock. */
export function isProtected(state: AuthState): boolean {
  return state.credentials.length > 0;
}

/**
 * Appends a log entry, keeping the tail bounded.
 *
 * The oldest entries are dropped rather than the newest, because the question a
 * person asks of this log is "what happened recently", and an unbounded file in
 * the data directory is its own kind of problem.
 */
export function logged(
  state: AuthState,
  event: AuthLogEvent,
  now: string,
  detail: { credentialId?: string | null; reason?: string | null } = {},
): AuthState {
  const entry: AuthLogEntry = {
    id: crypto.randomUUID(),
    at: now,
    event,
    credentialId: detail.credentialId ?? null,
    reason: detail.reason ?? null,
  };
  const log = [...state.log, entry];
  return { ...state, log: log.slice(-1000), updatedAt: now };
}

// --- challenges -------------------------------------------------------------

export function issueChallenge(
  state: AuthState,
  input: {
    readonly value: string;
    readonly purpose: ChallengePurpose;
    readonly sessionId?: string | null;
    readonly actionKey?: string | null;
  },
  now: string,
): { state: AuthState; challenge: PendingChallenge } {
  const challenge: PendingChallenge = {
    id: crypto.randomUUID(),
    value: input.value,
    purpose: input.purpose,
    createdAt: now,
    expiresAt: new Date(at(now) + minutes(CHALLENGE_LIFETIME_MINUTES)).toISOString(),
    sessionId: input.sessionId ?? null,
    actionKey: input.actionKey ?? null,
  };

  // Expired challenges are swept whenever a new one is issued, so a browser that
  // starts a ceremony and walks away does not leave anything usable behind.
  const kept = state.challenges.filter((candidate) => at(candidate.expiresAt) > at(now));

  return {
    state: { ...state, challenges: [...kept, challenge].slice(-20), updatedAt: now },
    challenge,
  };
}

/**
 * Takes a challenge out of the state, or explains why it cannot be used.
 *
 * Removal happens for every outcome, including failure. That is what makes a
 * challenge single-use: an attacker who captures a valid assertion and replays
 * it finds that the challenge it answers no longer exists.
 */
export function consumeChallenge(
  state: AuthState,
  input: {
    readonly id: string;
    readonly purpose: ChallengePurpose;
    readonly sessionId?: string | null;
  },
  now: string,
): { state: AuthState; challenge: PendingChallenge } {
  const found = state.challenges.find((candidate) => candidate.id === input.id);
  const remaining = state.challenges.filter((candidate) => candidate.id !== input.id);
  const without: AuthState = { ...state, challenges: remaining, updatedAt: now };

  if (found === undefined) {
    throw new AuthError('unknown_challenge', 'that request has already been used, or expired');
  }
  if (at(found.expiresAt) <= at(now)) {
    throw new AuthError('challenge_expired', 'that request took too long, please try again');
  }
  if (found.purpose !== input.purpose) {
    throw new AuthError(
      'wrong_challenge_purpose',
      'that request was issued for something else',
    );
  }
  if (found.sessionId !== (input.sessionId ?? null)) {
    throw new AuthError('wrong_challenge_session', 'that request belongs to another session');
  }

  return { state: without, challenge: found };
}

// --- sessions ---------------------------------------------------------------

export type SessionVerdict = 'active' | 'idle' | 'expired' | 'unknown';

/** Why a session is or is not usable right now. */
export function sessionVerdict(
  state: AuthState,
  session: AuthSession | undefined,
  now: string,
): SessionVerdict {
  if (session === undefined) return 'unknown';
  if (at(now) - at(session.createdAt) >= ABSOLUTE_SESSION_HOURS * 60 * 60 * 1000) {
    return 'expired';
  }
  if (at(now) - at(session.lastSeenAt) >= minutes(state.idleTimeoutMinutes)) return 'idle';
  return 'active';
}

export function findSessionByHash(
  state: AuthState,
  tokenHash: string,
): AuthSession | undefined {
  return state.sessions.find((session) => session.tokenHash === tokenHash);
}

export function openSession(
  state: AuthState,
  input: { readonly tokenHash: string; readonly credentialId: string },
  now: string,
): { state: AuthState; session: AuthSession } {
  const session: AuthSession = {
    id: crypto.randomUUID(),
    tokenHash: input.tokenHash,
    credentialId: input.credentialId,
    createdAt: now,
    lastSeenAt: now,
    verifiedAt: now,
  };

  // Signing in sweeps whatever has already run out, so the file does not
  // accumulate sessions nobody can use.
  const live = state.sessions.filter(
    (candidate) => sessionVerdict(state, candidate, now) === 'active',
  );

  return {
    state: { ...state, sessions: [...live, session].slice(-10), updatedAt: now },
    session,
  };
}

/** Records activity, which is what the idle timeout is measured against. */
export function touchSession(state: AuthState, sessionId: string, now: string): AuthState {
  return {
    ...state,
    sessions: state.sessions.map((session) =>
      session.id === sessionId ? { ...session, lastSeenAt: now } : session,
    ),
    updatedAt: now,
  };
}

/** Records that Windows Hello verified the person again, without a new session. */
export function markReverified(state: AuthState, sessionId: string, now: string): AuthState {
  return {
    ...state,
    sessions: state.sessions.map((session) =>
      session.id === sessionId ? { ...session, verifiedAt: now, lastSeenAt: now } : session,
    ),
    updatedAt: now,
  };
}

export function closeSession(state: AuthState, sessionId: string, now: string): AuthState {
  return {
    ...state,
    sessions: state.sessions.filter((session) => session.id !== sessionId),
    updatedAt: now,
  };
}

/** Ends every session. Used when a passkey is removed or the settings change. */
export function closeAllSessions(state: AuthState, now: string): AuthState {
  return { ...state, sessions: [], updatedAt: now };
}

/**
 * True when a sensitive action may proceed without asking again.
 *
 * Being signed in is not enough. 07-SECURITY-PRIVACY.md treats exporting
 * everything and overwriting everything as different from reading a screen, and
 * an unattended unlocked laptop is exactly the case this covers.
 */
export function verifiedRecently(session: AuthSession, now: string): boolean {
  return at(now) - at(session.verifiedAt) < minutes(REAUTH_WINDOW_MINUTES);
}

// --- credentials ------------------------------------------------------------

export function addCredential(
  state: AuthState,
  credential: StoredPasskey,
  now: string,
): AuthState {
  if (state.credentials.length >= MAX_CREDENTIALS) {
    throw new AuthError(
      'too_many_passkeys',
      'there are already as many passkeys as are allowed',
    );
  }
  if (
    state.credentials.some((candidate) => candidate.credentialId === credential.credentialId)
  ) {
    throw new AuthError('passkey_already_enrolled', 'that passkey is already set up here');
  }
  return { ...state, credentials: [...state.credentials, credential], updatedAt: now };
}

export function removeCredential(
  state: AuthState,
  credentialId: string,
  now: string,
): AuthState {
  const credential = state.credentials.find(
    (candidate) => candidate.credentialId === credentialId,
  );
  if (credential === undefined) {
    throw new AuthError('unknown_passkey', 'there is no such passkey here');
  }

  return {
    ...state,
    credentials: state.credentials.filter(
      (candidate) => candidate.credentialId !== credentialId,
    ),
    // Any session opened with the removed passkey stops immediately. Removing a
    // key that is still logged in somewhere would be removal in name only.
    sessions: state.sessions.filter((session) => session.credentialId !== credentialId),
    updatedAt: now,
  };
}

export function recordCredentialUse(
  state: AuthState,
  credentialId: string,
  signCount: number,
  now: string,
): AuthState {
  return {
    ...state,
    credentials: state.credentials.map((credential) =>
      credential.credentialId === credentialId
        ? { ...credential, signCount, lastUsedAt: now }
        : credential,
    ),
    updatedAt: now,
  };
}
