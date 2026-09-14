import { redirect } from 'next/navigation';

import { ActionForm, TextField } from '../../components/form';
import { Card } from '../../components/ui';
import { signInAction } from '../../lib/actions/auth';
import { activeBackend } from '../../lib/auth/backend';
import { currentUser } from '../../lib/auth/supabase';
import { accountScreen } from '../../lib/copy/security';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: accountScreen.reauthTitle,
};

/**
 * Recent authentication for the database backend: the password again.
 *
 * Signing in anew gives the session a fresh authentication event, which is
 * what `assertRecentlyVerified` reads from the token's claims. Nothing is
 * remembered on this side; the auth server is the witness.
 */
export default async function ReauthPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  if (activeBackend() !== 'supabase') redirect('/');
  const user = await currentUser();
  const { next } = await searchParams;
  if (user === null) redirect(`/login?next=${encodeURIComponent(next ?? '/')}`);

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 p-6">
      <h1 className="px-1 text-[24px] leading-tight font-bold">{accountScreen.reauthTitle}</h1>
      <Card>
        <p className="text-text-secondary">{accountScreen.reauthIntro}</p>
        {user.email !== null ? (
          <p className="mt-2 text-small text-text-secondary">
            {accountScreen.signedInAs(user.email)}
          </p>
        ) : null}
        <div className="mt-5">
          <ActionForm action={signInAction} submitLabel={accountScreen.reauthConfirm}>
            <input type="hidden" name="next" value={next ?? '/'} />
            <input type="hidden" name="email" value={user.email ?? ''} />
            <TextField
              name="password"
              label={accountScreen.password}
              type="password"
              autoComplete="current-password"
              maxLength={256}
            />
          </ActionForm>
        </div>
      </Card>
    </main>
  );
}
