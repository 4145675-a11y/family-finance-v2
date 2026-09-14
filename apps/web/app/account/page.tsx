import { redirect } from 'next/navigation';

import { AppShell } from '../../components/app-shell';
import { InviteForm } from '../../components/invite-form';
import { SimpleAction } from '../../components/simple-action';
import { Card, DataTable, Notice, StatRow } from '../../components/ui';
import { signOutAction } from '../../lib/actions/auth';
import { activeBackend } from '../../lib/auth/backend';
import { requireUnlocked } from '../../lib/auth/guard';
import { currentUser } from '../../lib/auth/supabase';
import { accountScreen } from '../../lib/copy/security';
import { formatDateTime } from '../../lib/format';
import { supabaseHouseholdStore } from '../../lib/store/server';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: accountScreen.membersTitle,
};

/**
 * The account and the household's members, for the database backend.
 *
 * What the security page is for the local product — who can get in — this is
 * for the hosted one: who is signed in, who else belongs, who has been
 * invited and whether they came. Passkeys are not offered here; they are a
 * later addition on top of this identity, not a replacement for it.
 */
interface InvitationRow {
  readonly id: string;
  readonly email: string;
  readonly state: string;
  readonly expiresAt: string;
}

/** Invitations with their state decided once, against one clock reading. */
async function listInvitations(
  store: Awaited<ReturnType<typeof supabaseHouseholdStore>>,
): Promise<InvitationRow[]> {
  const now = Date.now();
  return (await store.invitations()).map((invitation) => ({
    id: invitation.id,
    email: invitation.invitedEmail,
    expiresAt: invitation.expiresAt,
    state:
      invitation.acceptedAt !== null
        ? accountScreen.invitationAccepted
        : invitation.revokedAt !== null
          ? accountScreen.invitationRevoked
          : Date.parse(invitation.expiresAt) <= now
            ? accountScreen.invitationExpired
            : accountScreen.invitationOpen,
  }));
}

export default async function AccountPage() {
  if (activeBackend() !== 'supabase') redirect('/security');
  await requireUnlocked();
  const user = await currentUser();
  if (user === null) redirect('/login');

  const store = await supabaseHouseholdStore();
  const document = await store.readDocumentOrNull();
  const invitations = document === null ? [] : await listInvitations(store);

  return (
    <AppShell active="/more" title={accountScreen.membersTitle}>
      <Card title={accountScreen.signInTitle}>
        {user.email !== null ? (
          <p className="text-text-secondary">{accountScreen.signedInAs(user.email)}</p>
        ) : null}
        <div className="mt-4">
          <SimpleAction action={signOutAction} label={accountScreen.signOut} tone="secondary" />
        </div>
      </Card>

      {document === null ? (
        <Notice tone="attention">
          <p>{accountScreen.noAccountYet}</p>
        </Notice>
      ) : (
        <>
          <Card title={accountScreen.membersTitle}>
            {document.profiles.map((profile) => (
              <StatRow key={profile.id} label={profile.displayName} value="" />
            ))}
          </Card>

          <Card title={accountScreen.inviteTitle}>
            <InviteForm />
          </Card>

          {invitations.length === 0 ? null : (
            <Card title={accountScreen.pendingInvitations}>
              <DataTable
                caption={accountScreen.pendingInvitations}
                columns={[accountScreen.inviteEmail, 'מצב', 'תוקף']}
                rows={invitations.map((invitation) => ({
                  key: invitation.id,
                  cells: [
                    <span key="email" dir="ltr">
                      {invitation.email}
                    </span>,
                    <span key="state">{invitation.state}</span>,
                    <span key="expires">{formatDateTime(invitation.expiresAt)}</span>,
                  ],
                }))}
              />
            </Card>
          )}
        </>
      )}
    </AppShell>
  );
}
