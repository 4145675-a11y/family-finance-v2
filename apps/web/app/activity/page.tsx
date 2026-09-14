import { AppShell } from '../../components/app-shell';
import { NoHousehold, StatusChips } from '../../components/screen';
import { Card, DataTable, EmptyPrompt, Figure } from '../../components/ui';
import { screens } from '../../lib/copy/screens';
import { loadDashboardView } from '../../lib/dashboard/load';

/**
 * The audit trail, in the family's language.
 *
 * 07-SECURITY-PRIVACY.md § Audit makes this append-only, and the screen shows it
 * that way: newest first, no editing, no deleting, no filtering that could hide
 * something. What it does not show is the reduced field images — those exist for
 * an investigation, and putting raw record fragments on a screen would turn a
 * safety feature into noise.
 *
 * The answer this page exists to give is "why is this number different from
 * yesterday", and it gives it by listing what was done and when.
 */

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 120;

export default async function ActivityPage() {
  const view = await loadDashboardView();

  if (view.document === null || view.snapshot === null) {
    return (
      <NoHousehold
        active="/activity"
        title={screens.activity.title}
        reason={view.descriptor.reason}
      />
    );
  }

  const { document, snapshot } = view;
  const entries = [...document.audit].reverse().slice(0, PAGE_SIZE);

  const actorName = (profileId: string | null): string =>
    profileId === null
      ? screens.common.none
      : (document.profiles.find((profile) => profile.id === profileId)?.displayName ??
        screens.common.none);

  return (
    <AppShell
      source={view.descriptor}
      active="/activity"
      title={screens.activity.title}
      subtitle={screens.activity.subtitle}
      status={<StatusChips snapshot={snapshot} />}
    >
      {entries.length === 0 ? (
        <EmptyPrompt title={screens.activity.empty} body={screens.entry.subtitle} />
      ) : (
        <Card>
          <DataTable
            caption={screens.activity.title}
            columns={[screens.entry.date, screens.activity.title, screens.tasks.who]}
            rows={entries.map((entry) => ({
              key: entry.id,
              cells: [
                <Figure key="when">
                  {new Date(entry.occurredAt).toLocaleString('he-IL', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                </Figure>,
                screens.activity.actions[entry.action] ?? entry.action,
                actorName(entry.actorProfileId),
              ],
            }))}
          />
          {document.audit.length > PAGE_SIZE ? (
            <p className="mt-3 text-small text-text-secondary">
              {screens.approvals.rows(document.audit.length)}
            </p>
          ) : null}
        </Card>
      )}
    </AppShell>
  );
}
