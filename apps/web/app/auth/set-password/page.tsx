import { redirect } from 'next/navigation';

import { ActionForm, TextField } from '../../../components/form';
import { Card } from '../../../components/ui';
import { setPasswordAction } from '../../../lib/actions/auth';
import { activeBackend } from '../../../lib/auth/backend';
import { currentUser } from '../../../lib/auth/supabase';
import { accountScreen } from '../../../lib/copy/security';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: accountScreen.setPasswordTitle,
};

/**
 * A new password for the signed-in person.
 *
 * Reached from an invitation or recovery link (the callback route created the
 * session) or by choice. Without a session there is nothing to set it on.
 */
export default async function SetPasswordPage() {
  if (activeBackend() !== 'supabase') redirect('/');
  const user = await currentUser();
  if (user === null) redirect('/login?next=%2Fauth%2Fset-password');

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 p-6">
      <h1 className="px-1 text-[24px] leading-tight font-bold">
        {accountScreen.setPasswordTitle}
      </h1>
      <Card>
        <p className="text-text-secondary">{accountScreen.setPasswordIntro}</p>
        {user.email !== null ? (
          <p className="mt-2 text-small text-text-secondary">
            {accountScreen.signedInAs(user.email)}
          </p>
        ) : null}
        <div className="mt-5">
          <ActionForm action={setPasswordAction} submitLabel={accountScreen.setPasswordSubmit}>
            <TextField
              name="password"
              label={accountScreen.newPassword}
              type="password"
              autoComplete="new-password"
              maxLength={256}
            />
          </ActionForm>
        </div>
      </Card>
    </main>
  );
}
