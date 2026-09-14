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

/**
 * Where a ceremony has got to.
 *
 * `starting` and `waiting` are separated deliberately. Between them the browser
 * hands over to Windows, which opens its own window outside the page — and a
 * person who pressed a button and saw nothing change needs to be told to look
 * there rather than press it again.
 */
type Status = 'idle' | 'starting' | 'waiting' | 'done' | 'error';

const BUSY: readonly Status[] = ['starting', 'waiting'];

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

interface CeremonyFailure {
  readonly message: string;
  /**
   * The browser's own name for the error, when we could not account for it.
   *
   * Shown to the person rather than dropped. A failure nobody can describe is
   * still a failure they have to live with, and "something went wrong" with no
   * handle on it is not something they can report or search for.
   */
  readonly detail: string | null;
}

/**
 * The one place a ceremony failure becomes a Hebrew sentence.
 *
 * Every branch returns something. There is no path where an error is caught and
 * the screen goes back to looking idle, because that is indistinguishable from a
 * button that does nothing — which is exactly the state this component was in.
 */
function describeCeremonyFailure(
  error: unknown,
  cancelled: string,
  failed: string,
): CeremonyFailure {
  // The browser reports a refusal, a timeout and a closed prompt identically.
  if (
    error instanceof Error &&
    (error.name === 'NotAllowedError' || error.message === 'cancelled')
  ) {
    return { message: cancelled, detail: null };
  }
  if (error instanceof Error && error.name === 'SecurityError') {
    return { message: authScreen.errors['origin_unusable'] ?? '', detail: null };
  }
  if (error instanceof Error && error.name === 'InvalidStateError') {
    // The authenticator already holds a credential we excluded: already enrolled.
    return { message: authScreen.errors['passkey_already_enrolled'] ?? '', detail: null };
  }
  return {
    message: failed,
    detail: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  };
}

function Message({
  status,
  text,
  hint,
  detail,
}: {
  status: Status;
  text: string;
  hint?: string | null;
  detail?: string | null;
}) {
  if (text === '') return null;

  return (
    <div
      role={status === 'error' ? 'alert' : 'status'}
      aria-live={status === 'error' ? 'assertive' : 'polite'}
      className="mt-3"
    >
      <p
        className={`text-small font-medium ${
          status === 'error'
            ? 'text-danger'
            : status === 'done'
              ? 'text-success'
              : 'text-text-primary'
        }`}
      >
        {text}
      </p>
      {hint === undefined || hint === null || hint === '' ? null : (
        <p className="mt-1 text-small text-text-secondary">{hint}</p>
      )}
      {detail === undefined || detail === null || detail === '' ? null : (
        <p className="mt-1 text-small text-text-secondary">
          {authScreen.technicalDetail}: <bdi dir="ltr">{detail}</bdi>
        </p>
      )}
    </div>
  );
}

/*
 * The project's own button, spelled with the project's own tokens.
 *
 * The first version of this file invented `bg-brand` and `hover:bg-brand-strong`.
 * Neither exists in `globals.css`, so Tailwind emitted nothing for them and the
 * button rendered as white text on a white card: present in the DOM at full size,
 * announced correctly to a screen reader, and completely invisible to a person.
 * Every check that looked at `innerText` passed.
 *
 * Hence tokens that exist, and the same ones `SubmitButton` and `LinkButton`
 * use — so a change to the palette moves these buttons with everything else
 * instead of leaving them behind.
 */
const BUTTON_BASE =
  'inline-flex min-h-11 items-center justify-center rounded-control px-4 py-2 font-medium transition-colors disabled:opacity-60';

const BUTTON = `${BUTTON_BASE} bg-primary text-surface hover:bg-primary-hover`;

export function PasskeySignIn() {
  const router = useRouter();
  const supported = usePasskeySupport();
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');
  const [detail, setDetail] = useState<string | null>(null);

  const run = async () => {
    setStatus('starting');
    setMessage(authScreen.enrolStarting);
    setDetail(null);

    try {
      const start = await beginSignInAction();
      if (!start.ok) {
        setStatus('error');
        setMessage(start.message);
        return;
      }

      setStatus('waiting');
      setMessage(authScreen.signingIn);

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
      const failure = describeCeremonyFailure(
        error,
        authScreen.errors['cancelled'] ?? '',
        authScreen.errors['ceremony_failed'] ?? '',
      );
      setStatus('error');
      setMessage(failure.message);
      setDetail(failure.detail);
    }
  };

  if (supported === false) {
    return (
      <div>
        <h2 className="text-[18px] leading-tight font-semibold">
          {authScreen.unsupportedTitle}
        </h2>
        <p className="mt-2 text-text-secondary">{authScreen.unsupportedExplain}</p>
        <p className="mt-2 text-text-secondary">{authScreen.unsupportedNext}</p>
      </div>
    );
  }

  const busy = BUSY.includes(status);

  return (
    <div>
      <button type="button" className={BUTTON} onClick={() => void run()} disabled={busy}>
        {busy ? authScreen.signingIn : authScreen.signIn}
      </button>
      <Message
        status={status}
        text={message}
        hint={status === 'waiting' ? authScreen.enrolWaitingHint : null}
        detail={detail}
      />
    </div>
  );
}

export function PasskeyEnrol({ label = authScreen.enrol }: { label?: string }) {
  const router = useRouter();
  const supported = usePasskeySupport();
  // Pre-filled, so pressing Enter immediately is a complete action rather than
  // a validation error.
  const [name, setName] = useState<string>(authScreen.enrolDefaultLabel);
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');
  const [detail, setDetail] = useState<string | null>(null);

  const run = async () => {
    const trimmed = name.trim();
    if (trimmed === '') {
      setStatus('error');
      setMessage(authScreen.enrolLabelRequired);
      setDetail(null);
      return;
    }

    setStatus('starting');
    setMessage(authScreen.enrolStarting);
    setDetail(null);

    try {
      const start = await beginEnrolmentAction();
      if (!start.ok) {
        setStatus('error');
        setMessage(start.message);
        return;
      }

      const options = start.options;

      // Windows takes over from here and opens its own window outside the page.
      setStatus('waiting');
      setMessage(authScreen.enrolling);

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
      router.refresh();
    } catch (error) {
      const failure = describeCeremonyFailure(
        error,
        authScreen.enrolCancelled,
        authScreen.enrolFailed,
      );
      setStatus('error');
      setMessage(failure.message);
      setDetail(failure.detail);
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

  const busy = BUSY.includes(status);

  /*
   * A real form, not a button beside an input.
   *
   * That is what makes Enter in the label field start the ceremony — the
   * browser's own behaviour, rather than a key handler that has to be kept in
   * step with the button. `onSubmit` is prevented because the ceremony is not a
   * navigation; everything else about the form is left alone.
   */
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy) void run();
      }}
    >
      <label className="block text-small font-medium" htmlFor="passkey-label">
        {authScreen.enrolLabel}
      </label>
      <p className="mt-1 text-small text-text-secondary" id="passkey-label-hint">
        {authScreen.enrolLabelHint}
      </p>
      <input
        id="passkey-label"
        name="passkeyLabel"
        type="text"
        autoComplete="off"
        aria-describedby="passkey-label-hint"
        className="mt-2 min-h-11 w-full rounded-control border border-border-interactive bg-surface px-3 py-2 text-body text-text-primary"
        value={name}
        maxLength={80}
        disabled={busy}
        onChange={(event) => setName(event.target.value)}
      />

      {/* Directly below the input, in the project's own primary style, so it is
          a button a person can actually see. */}
      <div className="mt-4">
        <button type="submit" className={BUTTON} disabled={busy}>
          {busy ? authScreen.enrolling : label}
        </button>
      </div>

      <Message
        status={status}
        text={message}
        hint={status === 'waiting' ? authScreen.enrolWaitingHint : null}
        detail={detail}
      />
    </form>
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
  const [detail, setDetail] = useState<string | null>(null);

  const run = async () => {
    setStatus('starting');
    setMessage(authScreen.enrolStarting);
    setDetail(null);

    try {
      const start = await beginReauthenticationAction(actionKey);
      if (!start.ok) {
        setStatus('error');
        setMessage(start.message);
        return;
      }

      setStatus('waiting');
      setMessage(authScreen.signingIn);

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
      const failure = describeCeremonyFailure(
        error,
        authScreen.errors['cancelled'] ?? '',
        authScreen.errors['ceremony_failed'] ?? '',
      );
      setStatus('error');
      setMessage(failure.message);
      setDetail(failure.detail);
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
        disabled={BUSY.includes(status)}
      >
        {BUSY.includes(status) ? authScreen.signingIn : authScreen.reauthAction}
      </button>
      <Message
        status={status}
        text={message}
        hint={status === 'waiting' ? authScreen.enrolWaitingHint : null}
        detail={detail}
      />
    </div>
  );
}
