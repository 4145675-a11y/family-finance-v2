import { redirect } from 'next/navigation';

import { ActionForm, TextAreaField, TextField } from '../../components/form';
import { Card } from '../../components/ui';
import { acceptInvitationAction } from '../../lib/actions/auth';
import { requestHouseholdAction } from '../../lib/actions/platform';
import { activeBackend } from '../../lib/auth/backend';
import { requestsEnabled } from '../../lib/auth/platform';
import { currentUser } from '../../lib/auth/supabase';
import { platform } from '../../lib/copy/platform';
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
 *
 * This is also the door for somebody who has no invitation, which is why the
 * page says plainly where one comes from. When the platform owner has opened
 * requests, a form to ask for a household appears underneath — and asking
 * creates nothing at all. The database refuses a request while they are closed,
 * so a page left open across the moment they shut cannot smuggle one through.
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

      <Card>
        <p className="text-text-secondary">{platform.doorClosed}</p>
      </Card>

      {!(await requestsEnabled()) ? null : (
        <Card title={platform.requestTitle}>
          <p className="text-text-secondary">{platform.doorRequest}</p>
          <div className="mt-4">
            <ActionForm action={requestHouseholdAction} submitLabel={platform.request}>
              <>
                <TextField
                  name="householdName"
                  label={platform.fieldHouseholdName}
                  maxLength={120}
                />
                <TextAreaField name="note" label={platform.fieldNote} rows={2} />
              </>
            </ActionForm>
          </div>
        </Card>
      )}
    </main>
  );
}
