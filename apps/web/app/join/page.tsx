import { redirect } from 'next/navigation';

import { ActionForm, TextField } from '../../components/form';
import { Card } from '../../components/ui';
import { acceptInvitationAction } from '../../lib/actions/auth';
import { activeBackend } from '../../lib/auth/backend';
import { currentUser } from '../../lib/auth/supabase';
import { accountScreen } from '../../lib/copy/security';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: accountScreen.joinTitle,
};

/**
 * Joining a household with an invitation code, as the signed-in person.
 *
 * The code arrives by hand — the person who created it shows or sends it —
 * and is redeemed once by `accept_household_invitation()`, which checks
 * expiry, revocation and single use before granting membership.
 */
export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  if (activeBackend() !== 'supabase') redirect('/');
  const { token } = await searchParams;
  if ((await currentUser()) === null) {
    const target = token === undefined ? '/join' : `/join?token=${encodeURIComponent(token)}`;
    redirect(`/login?next=${encodeURIComponent(target)}`);
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 p-6">
      <h1 className="px-1 text-[24px] leading-tight font-bold">{accountScreen.joinTitle}</h1>
      <Card>
        <p className="text-text-secondary">{accountScreen.joinIntro}</p>
        <div className="mt-5">
          <ActionForm action={acceptInvitationAction} submitLabel={accountScreen.join}>
            <TextField
              name="token"
              label={accountScreen.joinCode}
              defaultValue={token ?? ''}
              autoComplete="off"
              maxLength={200}
            />
          </ActionForm>
        </div>
      </Card>
    </main>
  );
}
