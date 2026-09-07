import { redirect } from 'next/navigation';

import { Card, Disclosure } from '../../components/ui';
import { PasskeySignIn } from '../../components/passkey';
import { authScreen } from '../../lib/copy/security';
import { sessionContext } from '../../lib/auth/session';
import { configuredAuthOrigin } from '../../lib/auth/origin';

/**
 * The locked screen.
 *
 * Deliberately outside the application shell. There is no navigation, no source
 * banner, no figures and nothing to read — a locked application that still shows
 * the balance in a header is not locked, and a person who arrives here should be
 * in no doubt about what state they are in.
 *
 * It is also the one screen that must work when the browser is at the wrong
 * address. `127.0.0.1` cannot run a WebAuthn ceremony at all, so rather than
 * offering a button that would fail with a browser error, the page explains what
 * is going on and links to the address that works.
 */

export const dynamic = 'force-dynamic';

export const metadata = {
  title: authScreen.lockTitle,
};

export default async function LockPage() {
  const context = await sessionContext();
  const origin = configuredAuthOrigin();

  // Nothing to unlock, or already unlocked: the lock screen is not somewhere to
  // sit and look at.
  if (!context.locked || context.session !== null) redirect('/');

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 p-6">
      <h1 className="px-1 text-[24px] leading-tight font-bold">{authScreen.lockTitle}</h1>

      {context.atAuthOrigin ? (
        <Card>
          <p className="text-text-secondary">{authScreen.lockIntro}</p>
          <div className="mt-5">
            <PasskeySignIn />
          </div>
          <p className="mt-6 border-t border-border pt-4 text-small text-text-secondary">
            {authScreen.biometricNever}
          </p>
        </Card>
      ) : (
        <Card tone="attention">
          <h2 className="text-h3 font-semibold">{authScreen.originTitle}</h2>
          <p className="mt-2 text-text-secondary">{authScreen.originExplain}</p>
          <p className="mt-2 text-text-secondary">{authScreen.originFix(origin.origin)}</p>
          <p className="mt-2 text-small text-text-secondary">{authScreen.originSameMachine}</p>
          <div className="mt-5">
            {/* An ordinary link: this is a different origin, so it is a fresh
                document rather than a client-side navigation. */}
            <a
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-brand px-5 py-2.5 font-medium text-white transition-colors hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              href={`${origin.origin}/lock`}
            >
              {authScreen.openAtAuthOrigin}
            </a>
          </div>
        </Card>
      )}

      <Card title={authScreen.recoveryTitle}>
        <ul className="flex list-disc flex-col gap-2 pe-5 text-text-secondary">
          {authScreen.recovery.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Card>

      {/* The honest limits, on the screen where a person is deciding whether to
          trust this. Behind a disclosure because it is not what they came for,
          and on the page because they should not have to go looking. */}
      <Card>
        <Disclosure summary={authScreen.protectsTitle}>
          <ul className="flex list-disc flex-col gap-2 pe-5 text-text-secondary">
            {authScreen.protects.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <h3 className="mt-4 font-semibold">{authScreen.notProtectsTitle}</h3>
          <ul className="mt-2 flex list-disc flex-col gap-2 pe-5 text-text-secondary">
            {authScreen.notProtects.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Disclosure>
      </Card>

      <noscript>
        {/* Without scripting there is no ceremony to run, and saying so is
            better than a button that does nothing. */}
        <p className="px-1 text-small text-text-secondary">{authScreen.unsupportedExplain}</p>
      </noscript>
    </main>
  );
}
