import { redirect } from 'next/navigation';

import { ActionForm, TextField } from '../../../components/form';
import { Card } from '../../../components/ui';
import { requestPasswordResetAction } from '../../../lib/actions/auth';
import { activeBackend } from '../../../lib/auth/backend';
import { accountScreen } from '../../../lib/copy/security';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: accountScreen.forgotTitle,
};

/**
 * Asking for a recovery link. The screen answers the same way whether or not
 * the address is known — the action makes sure of that.
 */
export default function ForgotPasswordPage() {
  if (activeBackend() !== 'supabase') redirect('/');

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 p-6">
      <h1 className="px-1 text-[24px] leading-tight font-bold">{accountScreen.forgotTitle}</h1>
      <Card>
        <p className="text-text-secondary">{accountScreen.forgotIntro}</p>
        <div className="mt-5">
          <ActionForm
            action={requestPasswordResetAction}
            submitLabel={accountScreen.forgotSubmit}
          >
            <TextField
              name="email"
              label={accountScreen.email}
              type="email"
              autoComplete="username"
              maxLength={254}
            />
          </ActionForm>
        </div>
      </Card>
    </main>
  );
}
