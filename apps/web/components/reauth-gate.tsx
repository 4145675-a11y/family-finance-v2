import type { ReactNode } from 'react';

import { ReauthenticateButton } from './passkey';
import { LinkButton, Notice } from './ui';
import { activeBackend } from '../lib/auth/backend';
import { sessionContext } from '../lib/auth/session';
import { recentlyAuthenticated } from '../lib/auth/supabase';
import { accountScreen } from '../lib/copy/security';
import { authScreen } from '../lib/copy/security';

/**
 * Shows a control only when Windows Hello has been used recently.
 *
 * The server refuses the underlying action either way — this is not the check,
 * and removing it would change nothing about what is possible. What it changes
 * is what a person experiences: without it they fill in a restore form, type the
 * confirmation word, press the button and are told no. The prompt belongs
 * before the work, not after it.
 *
 * When the lock is off entirely there is nothing to ask for, and the children
 * render as they always did.
 */
export async function ReauthGate({
  actionKey,
  children,
  returnTo = '/',
}: {
  actionKey: string;
  children: ReactNode;
  /** Where the password screen sends the person back to. */
  returnTo?: string;
}) {
  // Database backend: recent authentication is a recent password entry, and
  // the way to provide one is the password screen.
  if (activeBackend() === 'supabase') {
    if (await recentlyAuthenticated()) return <>{children}</>;
    return (
      <div>
        <Notice tone="attention" title={accountScreen.reauthTitle}>
          <p>{accountScreen.reauthNeeded}</p>
        </Notice>
        <div className="mt-4">
          <LinkButton href={`/reauth?next=${encodeURIComponent(returnTo)}`}>
            {accountScreen.reauthConfirm}
          </LinkButton>
        </div>
      </div>
    );
  }
  const context = await sessionContext();

  if (!context.locked || context.recentlyVerified) return <>{children}</>;

  return (
    <div>
      <Notice tone="attention" title={authScreen.reauthTitle}>
        <p>{authScreen.reauthNeeded}</p>
      </Notice>
      <div className="mt-4">
        <ReauthenticateButton actionKey={actionKey} />
      </div>
    </div>
  );
}
