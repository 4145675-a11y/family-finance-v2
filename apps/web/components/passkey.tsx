'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { authScreen } from '../lib/copy/security';
import {
  beginEnrolmentAction,
  beginReauthenticationAction,
  beginSignInAction,
  finishEnrolmentAction,
  finishReauthenticationAction,
  finishSignInAction,
  type CeremonyOptions,
} from '../lib/actions/passkeys';

/**
 * The part of the ceremony that must run in the browser.
 *
 * `navigator.credentials` exists only here, so this component is the bridge: it
 * asks the server for a challenge, hands the browser the options, and sends the
 * authenticator's answer back to be verified. It decides nothing. Every check
 * that matters happens on the server against a challenge the server issued, and
 * this file could be rewritten by whoever is at the keyboard without changing
 * what is true.
 *
 * That is the whole reason it looks so thin. A lock implemented in a client
 * component is not a lock.
 */

/*
 * The buffer type is spelled out because WebAuthn's `BufferSource` will not
 * accept a view over a possibly-shared buffer, which is what the convenient
 * constructors produce.
 */
function toBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function toBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

type Status = 'idle' | 'working' | 'done' | 'error';

/** True when this browser can offer a passkey at all. */
function usePasskeySupport(): boolean | null {
  const [supported, setSupported] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      if (typeof PublicKeyCredential === 'undefined') {
        if (!cancelled) setSupported(false);
        return;
      }
      try {
        const available =
          await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
        if (!cancelled) setSupported(available);
      } catch {
        // A browser that refuses to answer is a browser that cannot be relied
        // on for this, which is the same answer as "no" for our purposes.
        if (!cancelled) setSupported(false);
      }
    };

    void check();
    return () => {
      cancelled = true;
    };
  }, []);

  return supported;
}

function descriptorsFor(ids: readonly string[]): PublicKeyCredentialDescriptor[] {
  return ids.map((id) => ({ id: toBytes(id), type: 'public-key' as const }));
}

/**
 * Runs the assertion half of the ceremony.
 *
 * `userVerification: 'required'` is not negotiable and is repeated on the server:
 * the browser is asked for it, and a response that arrives without the verified
 * flag is refused regardless of what was asked.
 */
async function getAssertion(options: CeremonyOptions) {
  const credential = (await navigator.credentials.get({
    publicKey: {
      challenge: toBytes(options.challenge),
      rpId: options.rpId,
      timeout: options.timeoutMs,
      userVerification: 'required',
      // Named explicitly rather than left discoverable, so a browser holding
      // passkeys for other sites does not offer them here.
      allowCredentials: descriptorsFor(options.credentialIds),
    },
  })) as PublicKeyCredential | null;

  if (credential === null) throw new Error('cancelled');
  const response = credential.response as AuthenticatorAssertionResponse;

  return {
    challengeId: options.challengeId,
    credentialId: credential.id,
    authenticatorData: toBase64Url(response.authenticatorData),
    clientDataJson: toBase64Url(response.clientDataJSON),
    signature: toBase64Url(response.signature),
    userHandle: response.userHandle === null ? null : toBase64Url(response.userHandle),
  };
}

/** The one place a ceremony failure becomes a Hebrew sentence. */
function describeCeremonyFailure(error: unknown): string {
  if (
    error instanceof Error &&
    (error.name === 'NotAllowedError' || error.message === 'cancelled')
  ) {
    return authScreen.errors['cancelled'] ?? '';
  }
  if (error instanceof Error && error.name === 'SecurityError') {
    return authScreen.errors['origin_unusable'] ?? '';
  }
  return authScreen.errors['ceremony_failed'] ?? '';
}

function Message({ status, text }: { status: Status; text: string }) {
  if (text === '') return null;
  return (
    <p
      role={status === 'error' ? 'alert' : 'status'}
      className={`mt-3 text-small ${status === 'error' ? 'text-danger' : 'text-text-secondary'}`}
    >
      {text}
    </p>
  );
}

const BUTTON =
  'inline-flex min-h-11 items-center justify-center rounded-lg bg-brand px-5 py-2.5 font-medium text-white transition-colors hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-60';

export function PasskeySignIn() {
  const router = useRouter();
  const supported = usePasskeySupport();
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');

  const run = async () => {
    setStatus('working');
    setMessage(authScreen.signingIn);

    try {
      const start = await beginSignInAction();
      if (!start.ok) {
        setStatus('error');
        setMessage(start.message);
        return;
      }

      const payload = await getAssertion(start.options);
      const outcome = await finishSignInAction(payload);

      if (!outcome.ok) {
        setStatus('error');
        setMessage(outcome.message);
        return;
      }

      setStatus('done');
      setMessage(outcome.message);
      /*
       * Navigate, then refresh. The session cookie was set by the server action,
       * so the push alone could still be served from a payload rendered while
       * the application was locked; the refresh is what makes every server
       * component fetch again now that there is a session behind the request.
       */
      router.push('/');
      router.refresh();
    } catch (error) {
      setStatus('error');
      setMessage(describeCeremonyFailure(error));
    }
  };

  if (supported === false) {
    return (
      <div>
        <h2 className="text-h3 font-semibold">{authScreen.unsupportedTitle}</h2>
        <p className="mt-2 text-text-secondary">{authScreen.unsupportedExplain}</p>
        <p className="mt-2 text-text-secondary">{authScreen.unsupportedNext}</p>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        className={BUTTON}
        onClick={() => void run()}
        disabled={status === 'working'}
      >
        {status === 'working' ? authScreen.signingIn : authScreen.signIn}
      </button>
      <Message status={status} text={message} />
    </div>
  );
}

export function PasskeyEnrol({ label = authScreen.enrol }: { label?: string }) {
  const router = useRouter();
  const supported = usePasskeySupport();
  const [name, setName] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');

  const run = async () => {
    const trimmed = name.trim();
    if (trimmed === '') {
      setStatus('error');
      setMessage(authScreen.enrolLabelHint);
      return;
    }

    setStatus('working');
    setMessage(authScreen.enrolling);

    try {
      const start = await beginEnrolmentAction();
      if (!start.ok) {
        setStatus('error');
        setMessage(start.message);
        return;
      }

      const options = start.options;
      const credential = (await navigator.credentials.create({
        publicKey: {
          challenge: toBytes(options.challenge),
          rp: { id: options.rpId, name: options.userName },
          user: {
            id: toBytes(options.userHandle),
            name: options.userName,
            displayName: trimmed,
          },
          // ES256 first, then RS256, which is what a TPM-backed Windows Hello
          // commonly produces. Both are verified for real on the server.
          pubKeyCredParams: [
            { type: 'public-key', alg: -7 },
            { type: 'public-key', alg: -257 },
          ],
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            userVerification: 'required',
            residentKey: 'preferred',
          },
          // The same authenticator must not be enrolled twice.
          excludeCredentials: descriptorsFor(options.credentialIds),
          timeout: options.timeoutMs,
          // Nothing is claimed about the make of the authenticator, so nothing
          // is asked for. See the note in the verifier.
          attestation: 'none',
        },
      })) as PublicKeyCredential | null;

      if (credential === null) throw new Error('cancelled');
      const response = credential.response as AuthenticatorAttestationResponse;

      const outcome = await finishEnrolmentAction({
        challengeId: options.challengeId,
        credentialId: credential.id,
        attestationObject: toBase64Url(response.attestationObject),
        clientDataJson: toBase64Url(response.clientDataJSON),
        label: trimmed,
        backedUp: false,
      });

      if (!outcome.ok) {
        setStatus('error');
        setMessage(outcome.message);
        return;
      }

      setStatus('done');
      setMessage(outcome.message);
      router.push('/security');
      router.refresh();
    } catch (error) {
      setStatus('error');
      setMessage(describeCeremonyFailure(error));
    }
  };

  if (supported === false) {
    return (
      <div>
        <h3 className="font-semibold">{authScreen.unsupportedTitle}</h3>
        <p className="mt-2 text-text-secondary">{authScreen.unsupportedExplain}</p>
        <p className="mt-2 text-text-secondary">{authScreen.unsupportedNext}</p>
      </div>
    );
  }

  return (
    <div>
      <label className="block text-small font-medium" htmlFor="passkey-label">
        {authScreen.enrolLabel}
      </label>
      <p className="mt-1 text-small text-text-secondary" id="passkey-label-hint">
        {authScreen.enrolLabelHint}
      </p>
      <input
        id="passkey-label"
        aria-describedby="passkey-label-hint"
        className="mt-2 min-h-11 w-full rounded-lg border border-border bg-surface px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        value={name}
        maxLength={80}
        onChange={(event) => setName(event.target.value)}
      />
      <button
        type="button"
        className={`${BUTTON} mt-4`}
        onClick={() => void run()}
        disabled={status === 'working'}
      >
        {status === 'working' ? authScreen.enrolling : label}
      </button>
      <Message status={status} text={message} />
    </div>
  );
}

/**
 * Asks for Windows Hello again before a sensitive action.
 *
 * The button does not perform the action. It re-verifies, and the screen it sits
 * on re-renders with the action now available — so the server decides, twice,
 * whether the action may run.
 */
export function ReauthenticateButton({ actionKey }: { actionKey: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');

  const run = async () => {
    setStatus('working');
    setMessage(authScreen.signingIn);

    try {
      const start = await beginReauthenticationAction(actionKey);
      if (!start.ok) {
        setStatus('error');
        setMessage(start.message);
        return;
      }

      const outcome = await finishReauthenticationAction(await getAssertion(start.options));
      if (!outcome.ok) {
        setStatus('error');
        setMessage(outcome.message);
        return;
      }

      setStatus('done');
      setMessage(outcome.message);
      // The screen re-renders with the gate now open; the server decides again
      // whether the action may run, so this only changes what is offered.
      router.refresh();
    } catch (error) {
      setStatus('error');
      setMessage(describeCeremonyFailure(error));
    }
  };

  return (
    <div>
      <p className="text-text-secondary">{authScreen.reauthIntro}</p>
      <p className="mt-1 font-medium">{authScreen.reauthActions[actionKey] ?? ''}</p>
      <button
        type="button"
        className={`${BUTTON} mt-4`}
        onClick={() => void run()}
        disabled={status === 'working'}
      >
        {status === 'working' ? authScreen.signingIn : authScreen.reauthAction}
      </button>
      <Message status={status} text={message} />
    </div>
  );
}
