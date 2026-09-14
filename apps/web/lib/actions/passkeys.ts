'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import {
  WebAuthnError,
  createChallenge,
  toBase64Url,
  utf8,
  verifyAssertion,
  verifyRegistration,
} from '@family-finance/webauthn';

import { authScreen } from '../copy/security';
import {
  AuthError,
  MAX_CREDENTIALS,
  addCredential,
  closeAllSessions,
  consumeChallenge,
  issueChallenge,
  isProtected,
  logged,
  markReverified,
  openSession,
  recordCredentialUse,
  removeCredential,
  type StoredPasskey,
} from '../auth/model';
import { configuredAuthOrigin } from '../auth/origin';
import {
  assertRecentlyVerified,
  endCurrentSession,
  sessionContext,
  setSessionCookie,
} from '../auth/session';
import { hashToken, mutateAuthState, newSessionToken, readAuthState } from '../auth/store';
import { failed, succeeded, FieldReader, type FormState } from '../forms';

/**
 * The WebAuthn ceremonies, as server actions.
 *
 * Every export of a `'use server'` module is an endpoint the browser can call,
 * so each one here begins by deciding whether it is allowed to run at all
 * rather than trusting the screen that offered it:
 *
 *   - enrolling the *first* passkey is open, because a machine with no passkey
 *     has nothing to check against and somebody has to be able to start;
 *   - enrolling a *further* passkey needs a session that used Windows Hello in
 *     the last few minutes, because adding a key is how you would keep access
 *     you should have lost;
 *   - signing in is open by definition, and is rate-limited by the ceremony
 *     itself — every attempt needs a challenge this server issued, and each
 *     challenge works exactly once;
 *   - removing a passkey and changing the lock settings need re-authentication.
 *
 * Nothing here logs an authenticator response, a signature, a challenge value or
 * a session token. The authentication log records that a thing happened and a
 * short reason code, which is what an audit needs and is not a second copy of
 * the material it is auditing.
 */

/** What a begin-ceremony call hands the browser. */
export interface CeremonyOptions {
  readonly challengeId: string;
  readonly challenge: string;
  readonly rpId: string;
  readonly userHandle: string;
  readonly userName: string;
  readonly timeoutMs: number;
  /** Credential ids the browser should offer, or exclude. */
  readonly credentialIds: readonly string[];
}

export type CeremonyStart =
  | { readonly ok: true; readonly options: CeremonyOptions }
  | { readonly ok: false; readonly message: string };

export type CeremonyOutcome =
  | { readonly ok: true; readonly message: string }
  | { readonly ok: false; readonly message: string };

const registrationPayloadSchema = z.object({
  challengeId: z.uuid(),
  credentialId: z.string().min(1).max(2000),
  attestationObject: z.string().min(1).max(20_000),
  clientDataJson: z.string().min(1).max(8000),
  label: z.string().trim().min(1).max(80),
  backedUp: z.boolean(),
});

const assertionPayloadSchema = z.object({
  challengeId: z.uuid(),
  credentialId: z.string().min(1).max(2000),
  authenticatorData: z.string().min(1).max(8000),
  clientDataJson: z.string().min(1).max(8000),
  signature: z.string().min(1).max(8000),
  userHandle: z.string().max(2000).nullable(),
});

export type RegistrationPayload = z.infer<typeof registrationPayloadSchema>;
export type AssertionPayload = z.infer<typeof assertionPayloadSchema>;

/** How long the browser gives the person to answer Windows Hello. */
const CEREMONY_TIMEOUT_MS = 90_000;

/**
 * Turns a refusal into a Hebrew sentence.
 *
 * The specific reason is deliberately *not* shown for a failed sign-in. Telling
 * an attacker whether the credential was unknown, the signature wrong or the
 * challenge stale is telling them which half of their attempt to fix; the
 * reason code goes to the authentication log, where the household can read it.
 */
function explain(error: unknown): string {
  if (error instanceof AuthError) {
    return authScreen.errors[error.code] ?? authScreen.errors['generic'] ?? '';
  }
  if (error instanceof WebAuthnError) {
    return authScreen.errors['ceremony_failed'] ?? '';
  }
  return authScreen.errors['generic'] ?? '';
}

function reasonCode(error: unknown): string {
  if (error instanceof AuthError || error instanceof WebAuthnError) return error.code;
  return 'unexpected';
}

async function expectedCeremony() {
  const origin = configuredAuthOrigin();
  return { origin: origin.origin, rpId: origin.rpId };
}

// ---------------------------------------------------------------------------
// Enrolment
// ---------------------------------------------------------------------------

export async function beginEnrolmentAction(): Promise<CeremonyStart> {
  const origin = configuredAuthOrigin();
  if (!origin.usable) {
    return { ok: false, message: authScreen.errors['origin_unusable'] ?? '' };
  }

  const state = await readAuthState();

  // The first passkey may be enrolled by whoever is at the machine. A further
  // one may not: adding a key is how somebody who should have lost access keeps
  // it, so it is treated as a sensitive action.
  if (isProtected(state)) {
    try {
      await assertRecentlyVerified('passkey_add');
    } catch (error) {
      return { ok: false, message: explain(error) };
    }
  }
  if (state.credentials.length >= MAX_CREDENTIALS) {
    return { ok: false, message: authScreen.errors['too_many_passkeys'] ?? '' };
  }

  const value = createChallenge();
  const challengeId = await mutateAuthState((current, now) => {
    const issued = issueChallenge(current, { value, purpose: 'registration' }, now);
    return { state: issued.state, value: issued.challenge.id };
  });

  return {
    ok: true,
    options: {
      challengeId,
      challenge: value,
      rpId: origin.rpId,
      // A random identifier, not a name or an address: whoever holds the
      // authenticator can read this back, so it carries nothing personal.
      userHandle: toBase64Url(utf8(state.userHandle)),
      userName: authScreen.credentialUserName,
      timeoutMs: CEREMONY_TIMEOUT_MS,
      // Offered as `excludeCredentials`, so the same authenticator cannot be
      // enrolled twice and quietly become two keys with one lock.
      credentialIds: state.credentials.map((credential) => credential.credentialId),
    },
  };
}

export async function finishEnrolmentAction(payload: unknown): Promise<CeremonyOutcome> {
  const parsed = registrationPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, message: authScreen.errors['generic'] ?? '' };
  }

  const expected = await expectedCeremony();

  try {
    const alreadyProtected = isProtected(await readAuthState());
    if (alreadyProtected) await assertRecentlyVerified('passkey_add');

    await mutateAuthState((state, now) => {
      const { state: consumed, challenge } = consumeChallenge(
        state,
        { id: parsed.data.challengeId, purpose: 'registration' },
        now,
      );

      const result = verifyRegistration(
        {
          attestationObject: parsed.data.attestationObject,
          clientDataJson: parsed.data.clientDataJson,
        },
        { ...expected, challenge: challenge.value },
      );

      const credential: StoredPasskey = {
        credentialId: result.credentialId,
        publicKeyCose: result.publicKeyCose,
        algorithm: result.algorithm,
        signCount: result.signCount,
        aaguid: result.aaguid,
        label: parsed.data.label,
        backedUp: result.flags.backedUp,
        createdAt: now,
        lastUsedAt: null,
      };

      return {
        state: logged(addCredential(consumed, credential, now), 'passkey_enrolled', now, {
          credentialId: credential.credentialId,
        }),
        value: undefined,
      };
    });
  } catch (error) {
    const code = reasonCode(error);
    await mutateAuthState((state, now) => ({
      state: logged(state, 'sign_in_failed', now, { reason: code }),
      value: undefined,
    }));
    return { ok: false, message: explain(error) };
  }

  revalidatePath('/security');
  revalidatePath('/settings');
  return { ok: true, message: authScreen.enrolled };
}

// ---------------------------------------------------------------------------
// Signing in
// ---------------------------------------------------------------------------

export async function beginSignInAction(): Promise<CeremonyStart> {
  const origin = configuredAuthOrigin();
  if (!origin.usable) {
    return { ok: false, message: authScreen.errors['origin_unusable'] ?? '' };
  }

  const state = await readAuthState();
  if (!isProtected(state)) {
    return { ok: false, message: authScreen.errors['no_passkey'] ?? '' };
  }

  const value = createChallenge();
  const challengeId = await mutateAuthState((current, now) => {
    const issued = issueChallenge(current, { value, purpose: 'authentication' }, now);
    return { state: issued.state, value: issued.challenge.id };
  });

  return {
    ok: true,
    options: {
      challengeId,
      challenge: value,
      rpId: origin.rpId,
      userHandle: toBase64Url(utf8(state.userHandle)),
      userName: authScreen.credentialUserName,
      timeoutMs: CEREMONY_TIMEOUT_MS,
      credentialIds: state.credentials.map((credential) => credential.credentialId),
    },
  };
}

export async function finishSignInAction(payload: unknown): Promise<CeremonyOutcome> {
  const parsed = assertionPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, message: authScreen.errors['generic'] ?? '' };
  }

  const expected = await expectedCeremony();
  const token = newSessionToken();

  try {
    await mutateAuthState((state, now) => {
      const { state: consumed, challenge } = consumeChallenge(
        state,
        { id: parsed.data.challengeId, purpose: 'authentication' },
        now,
      );

      const credential = consumed.credentials.find(
        (candidate) => candidate.credentialId === parsed.data.credentialId,
      );
      if (credential === undefined) {
        throw new AuthError('unknown_passkey', 'that passkey is not registered here');
      }

      const result = verifyAssertion(
        {
          credentialId: parsed.data.credentialId,
          authenticatorData: parsed.data.authenticatorData,
          clientDataJson: parsed.data.clientDataJson,
          signature: parsed.data.signature,
          userHandle: parsed.data.userHandle,
        },
        {
          credentialId: credential.credentialId,
          publicKeyCose: credential.publicKeyCose,
          signCount: credential.signCount,
        },
        { ...expected, challenge: challenge.value },
      );

      const used = recordCredentialUse(
        consumed,
        credential.credentialId,
        result.signCount,
        now,
      );
      const opened = openSession(
        used,
        { tokenHash: hashToken(token), credentialId: credential.credentialId },
        now,
      );

      return {
        state: logged(opened.state, 'signed_in', now, {
          credentialId: credential.credentialId,
        }),
        value: undefined,
      };
    });
  } catch (error) {
    const code = reasonCode(error);
    await mutateAuthState((state, now) => ({
      state: logged(state, 'sign_in_failed', now, { reason: code }),
      value: undefined,
    }));
    return { ok: false, message: explain(error) };
  }

  await setSessionCookie(token);
  return { ok: true, message: authScreen.signedIn };
}

// ---------------------------------------------------------------------------
// Re-authentication before a sensitive action
// ---------------------------------------------------------------------------

export async function beginReauthenticationAction(actionKey: string): Promise<CeremonyStart> {
  const origin = configuredAuthOrigin();
  if (!origin.usable) {
    return { ok: false, message: authScreen.errors['origin_unusable'] ?? '' };
  }

  const context = await sessionContext();
  if (context.session === null) {
    return { ok: false, message: authScreen.errors['locked'] ?? '' };
  }

  const value = createChallenge();
  const sessionId = context.session.id;
  const key = actionKey.slice(0, 60);

  const challengeId = await mutateAuthState((current, now) => {
    const issued = issueChallenge(
      current,
      { value, purpose: 'reauthentication', sessionId, actionKey: key },
      now,
    );
    return { state: issued.state, value: issued.challenge.id };
  });

  return {
    ok: true,
    options: {
      challengeId,
      challenge: value,
      rpId: origin.rpId,
      userHandle: toBase64Url(utf8(context.state.userHandle)),
      userName: authScreen.credentialUserName,
      timeoutMs: CEREMONY_TIMEOUT_MS,
      credentialIds: context.state.credentials.map((credential) => credential.credentialId),
    },
  };
}

export async function finishReauthenticationAction(payload: unknown): Promise<CeremonyOutcome> {
  const parsed = assertionPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, message: authScreen.errors['generic'] ?? '' };
  }

  const expected = await expectedCeremony();
  const context = await sessionContext();
  if (context.session === null) {
    return { ok: false, message: authScreen.errors['locked'] ?? '' };
  }
  const sessionId = context.session.id;

  try {
    await mutateAuthState((state, now) => {
      // Bound to this session: a challenge minted for one browser must not be
      // answerable by another.
      const { state: consumed, challenge } = consumeChallenge(
        state,
        { id: parsed.data.challengeId, purpose: 'reauthentication', sessionId },
        now,
      );

      const credential = consumed.credentials.find(
        (candidate) => candidate.credentialId === parsed.data.credentialId,
      );
      if (credential === undefined) {
        throw new AuthError('unknown_passkey', 'that passkey is not registered here');
      }

      const result = verifyAssertion(
        {
          credentialId: parsed.data.credentialId,
          authenticatorData: parsed.data.authenticatorData,
          clientDataJson: parsed.data.clientDataJson,
          signature: parsed.data.signature,
          userHandle: parsed.data.userHandle,
        },
        {
          credentialId: credential.credentialId,
          publicKeyCose: credential.publicKeyCose,
          signCount: credential.signCount,
        },
        { ...expected, challenge: challenge.value },
      );

      const used = recordCredentialUse(
        consumed,
        credential.credentialId,
        result.signCount,
        now,
      );
      return {
        state: logged(markReverified(used, sessionId, now), 'reauthenticated', now, {
          credentialId: credential.credentialId,
          reason: challenge.actionKey,
        }),
        value: undefined,
      };
    });
  } catch (error) {
    const code = reasonCode(error);
    await mutateAuthState((state, now) => ({
      state: logged(state, 'reauthentication_failed', now, { reason: code }),
      value: undefined,
    }));
    return { ok: false, message: explain(error) };
  }

  return { ok: true, message: authScreen.reauthenticated };
}

// ---------------------------------------------------------------------------
// Managing what is enrolled
// ---------------------------------------------------------------------------

export async function signOutAction(): Promise<void> {
  await endCurrentSession();
  revalidatePath('/', 'layout');
}

export async function removePasskeyAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const reader = new FieldReader(data);
  const credentialId = reader.text('credentialId', 'מפתח', { max: 2000 });
  if (!reader.ok) return failed(authScreen.errors['generic'] ?? '', reader.errors);

  try {
    await assertRecentlyVerified('passkey_remove');

    await mutateAuthState((state, now) => {
      const remaining = state.credentials.filter(
        (candidate) => candidate.credentialId !== credentialId,
      );

      // Removing the last passkey unlocks the application, which is a decision
      // the family may legitimately make — but it must be the plain meaning of
      // the button, so the screen says so and this refuses to do it silently.
      if (remaining.length === 0 && state.credentials.length === 1) {
        throw new AuthError('last_passkey', 'this is the only passkey left');
      }

      return {
        state: logged(removeCredential(state, credentialId, now), 'passkey_removed', now, {
          credentialId,
        }),
        value: undefined,
      };
    });
  } catch (error) {
    return failed(explain(error));
  }

  revalidatePath('/security');
  return succeeded(authScreen.removed);
}

/**
 * Removes the last passkey, which turns the lock off.
 *
 * Separated from removing any other key because the consequence is different:
 * afterwards the application opens without asking. The screen states that in as
 * many words before this can be reached, and it still needs Windows Hello first.
 */
export async function turnOffLockAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const reader = new FieldReader(data);
  const confirmed = reader.boolean('confirm');
  if (!confirmed) {
    return failed(authScreen.errors['confirm_required'] ?? '');
  }

  try {
    await assertRecentlyVerified('lock_off');

    await mutateAuthState((state, now) => ({
      state: logged(
        closeAllSessions({ ...state, credentials: [] }, now),
        'passkey_removed',
        now,
        { reason: 'lock_turned_off' },
      ),
      value: undefined,
    }));
  } catch (error) {
    return failed(explain(error));
  }

  await endCurrentSession();
  revalidatePath('/', 'layout');
  return succeeded(authScreen.lockOff);
}

export async function updateLockSettingsAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const reader = new FieldReader(data);
  const idleTimeoutMinutes = reader.integer('idleTimeoutMinutes', 'זמן נעילה', {
    min: 1,
    max: 480,
    required: true,
  });
  if (!reader.ok || idleTimeoutMinutes === null) {
    return failed(authScreen.errors['bad_timeout'] ?? '', reader.errors);
  }

  try {
    await assertRecentlyVerified('lock_settings');

    await mutateAuthState((state, now) => ({
      state: logged({ ...state, idleTimeoutMinutes }, 'settings_changed', now, {
        reason: `idle_${idleTimeoutMinutes}m`,
      }),
      value: undefined,
    }));
  } catch (error) {
    return failed(explain(error));
  }

  revalidatePath('/security');
  return succeeded(authScreen.settingsSaved);
}
