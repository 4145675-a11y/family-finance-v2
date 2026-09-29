import { redirect } from 'next/navigation';

import { AppShell } from '../../components/app-shell';
import { ActionForm, HiddenValue, TextField } from '../../components/form';
import { Badge, Card, DataTable, Notice, StatRow } from '../../components/ui';
import {
  approveRequestAction,
  createHouseholdForOwnerAction,
  declineRequestAction,
  setHouseholdDisabledAction,
  setRequestsEnabledAction,
} from '../../lib/actions/platform';
import { activeBackend } from '../../lib/auth/backend';
import { requireUnlocked } from '../../lib/auth/guard';
import {
  householdOverview,
  householdRequests,
  isPlatformOwner,
  requestsEnabled,
} from '../../lib/auth/platform';
import { platform } from '../../lib/copy/platform';
import { formatDateTime } from '../../lib/format';

/**
 * The platform owner's screen: which households exist, and who staffs them.
 *
 * Reachable only by the platform owner, and the redirect below is the **least**
 * of the reasons. Every action this page renders calls a database function that
 * checks `app.is_platform_admin()` for itself, and every table it reads is
 * behind a policy that does the same. If this file rendered for everybody, an
 * ordinary person would see an empty list and every button would refuse them.
 *
 * What it deliberately does not show is money. The role exists to decide which
 * families the service has, not to look inside them — so the overview is names
 * and counts, and it comes from a function that returns no financial column at
 * all.
 */

export const dynamic = 'force-dynamic';

export const metadata = { title: platform.title };

export default async function AdminPage() {
  if (activeBackend() !== 'supabase') redirect('/');
  await requireUnlocked();
  if (!(await isPlatformOwner())) redirect('/');

  const [households, requests, requestsOpen] = await Promise.all([
    householdOverview(),
    householdRequests(),
    requestsEnabled(),
  ]);
  const pending = requests.filter((request) => request.status === 'pending');

  return (
    <AppShell active="/more" title={platform.title} subtitle={platform.subtitle}>
      <Card title={platform.createTitle}>
        <p className="text-text-secondary">{platform.createIntro}</p>
        <div className="mt-4">
          <ActionForm action={createHouseholdForOwnerAction} submitLabel={platform.create}>
            <>
              <TextField
                name="householdName"
                label={platform.fieldHouseholdName}
                maxLength={120}
              />
              <TextField
                name="ownerEmail"
                label={platform.fieldOwnerEmail}
                type="email"
                autoComplete="off"
                maxLength={254}
              />
            </>
          </ActionForm>
        </div>
      </Card>

      <Card title={platform.listTitle}>
        {households.length === 0 ? (
          <p className="text-text-secondary">{platform.listEmpty}</p>
        ) : (
          households.map((household) => (
            <div
              key={household.householdId}
              className="border-b border-border py-3 last:border-b-0"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{household.name}</span>
                {household.disabledAt === null ? null : (
                  <Badge tone="attention">{platform.disabled}</Badge>
                )}
              </div>
              <p className="mt-1 text-small text-text-secondary">
                {platform.members(household.memberCount)} ·{' '}
                {platform.owners(household.ownerCount)} ·{' '}
                {platform.pending(household.pendingInvites)}
              </p>
              <div className="mt-2">
                <ActionForm
                  action={setHouseholdDisabledAction}
                  submitLabel={
                    household.disabledAt === null ? platform.disable : platform.enable
                  }
                  tone="secondary"
                >
                  <>
                    <HiddenValue name="householdId" value={household.householdId} />
                    <HiddenValue
                      name="disabled"
                      value={household.disabledAt === null ? 'true' : 'false'}
                    />
                  </>
                </ActionForm>
              </div>
            </div>
          ))
        )}
      </Card>

      <Card title={platform.requestsTitle}>
        <p className="text-text-secondary">{platform.requestsIntro}</p>
        <StatRow
          label={requestsOpen ? platform.requestsOpen : platform.requestsClosedNow}
          value=""
        />
        <div className="mt-3">
          <ActionForm
            action={setRequestsEnabledAction}
            submitLabel={requestsOpen ? platform.closeRequests : platform.openRequests}
            tone="secondary"
          >
            <HiddenValue name="enabled" value={requestsOpen ? 'false' : 'true'} />
          </ActionForm>
        </div>

        {pending.length === 0 ? (
          <p className="mt-4 text-text-secondary">{platform.noRequests}</p>
        ) : (
          <div className="mt-4 flex flex-col gap-4">
            {pending.map((request) => (
              <Notice key={request.id} tone="attention" title={request.householdName}>
                {request.note === null ? null : <p>{request.note}</p>}
                <p className="text-small text-text-secondary">
                  {formatDateTime(request.createdAt)}
                </p>
                <div className="mt-3 flex flex-wrap gap-3">
                  <ActionForm action={approveRequestAction} submitLabel={platform.approve}>
                    <>
                      <HiddenValue name="requestId" value={request.id} />
                      <TextField
                        name="ownerEmail"
                        label={platform.fieldOwnerEmail}
                        type="email"
                        required={false}
                        autoComplete="off"
                        maxLength={254}
                      />
                    </>
                  </ActionForm>
                  <ActionForm
                    action={declineRequestAction}
                    submitLabel={platform.decline}
                    tone="secondary"
                  >
                    <HiddenValue name="requestId" value={request.id} />
                  </ActionForm>
                </div>
              </Notice>
            ))}
          </div>
        )}
      </Card>

      {requests.length === 0 ? null : (
        <Card title={platform.requestsTitle}>
          <DataTable
            caption={platform.requestsTitle}
            columns={[platform.fieldHouseholdName, 'מצב', 'נשלחה']}
            rows={requests.map((request) => ({
              key: request.id,
              cells: [
                <span key="name">{request.householdName}</span>,
                <span key="status">
                  {request.status === 'pending'
                    ? platform.statusPending
                    : request.status === 'approved'
                      ? platform.statusApproved
                      : platform.statusDeclined}
                </span>,
                <span key="at">{formatDateTime(request.createdAt)}</span>,
              ],
            }))}
          />
        </Card>
      )}
    </AppShell>
  );
}
