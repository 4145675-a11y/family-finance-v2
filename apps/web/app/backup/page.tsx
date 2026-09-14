import { AppShell } from '../../components/app-shell';
import { ReauthGate } from '../../components/reauth-gate';
import { RestorePanel } from '../../components/restore-panel';
import { NoHousehold } from '../../components/screen';
import { Card, Figure, LinkButton, Notice, SectionTitle, StatRow } from '../../components/ui';
import { ActionForm } from '../../components/form';
import { createBackupAction } from '../../lib/actions/backup';
import { screens } from '../../lib/copy/screens';
import { loadDashboardView } from '../../lib/dashboard/load';
import { activeBackend } from '../../lib/auth/backend';
import { accountScreen } from '../../lib/copy/security';
import { dataDirectory } from '../../lib/store/server';

/**
 * Backup and restore.
 *
 * The page says three things before it offers a button: what goes into a backup,
 * where it is kept, and that restoring replaces everything. A family that has
 * never lost data does not read this page carefully, and the one time they need
 * it they will be in a hurry — so the warnings are short, above the controls, and
 * unavoidable.
 *
 * Restore is two steps by design. The first reads the file and reports what is in
 * it; the second replaces the household, and only after the word "שחזור" has been
 * typed. Nothing is overwritten in between.
 */

export const dynamic = 'force-dynamic';

export default async function BackupPage() {
  const view = await loadDashboardView();
  const backend = activeBackend();

  if (view.document === null) {
    return (
      <NoHousehold
        active="/more"
        title={screens.backup.title}
        reason={view.descriptor.reason}
      />
    );
  }

  const { document } = view;
  const counts: readonly [string, number][] = [
    ['accounts', document.accounts.length],
    ['transactions', document.transactions.length],
    ['debts', document.debts.length],
    ['budgets', document.budgets.length],
    ['importBatches', document.importBatches.length],
    ['tasks', document.tasks.length],
    ['auditEntries', document.audit.length],
  ];

  return (
    <AppShell active="/more" title={screens.backup.title} subtitle={screens.backup.subtitle}>
      <Card title={screens.backup.whatTitle}>
        <p className="text-text-secondary">{screens.backup.whatBody}</p>
        <div className="mt-4">
          {counts.map(([key, value]) => (
            <StatRow
              key={key}
              label={screens.backup.counts[key] ?? key}
              value={<Figure>{value}</Figure>}
            />
          ))}
        </div>
      </Card>

      <Card title={screens.backup.whereTitle}>
        <p className="text-text-secondary">{screens.backup.whereBody}</p>
        <p className="mt-2 text-small text-text-secondary">
          <bdi dir="ltr">{dataDirectory() ?? accountScreen.storedInDatabase}</bdi>
        </p>
        <div className="mt-4">
          <ReauthGate actionKey="backup_create" returnTo="/backup">
            {backend === 'supabase' ? (
              // A hosted server keeps nothing on its own disk: the backup goes
              // straight to the person's device (ADR-0032).
              <div>
                <p className="mb-3 text-small text-text-secondary">
                  {accountScreen.backupDownloadIntro}
                </p>
                <LinkButton href="/api/export/backup.json">
                  {accountScreen.backupDownload}
                </LinkButton>
              </div>
            ) : (
              <ActionForm action={createBackupAction} submitLabel={screens.backup.create}>
                <></>
              </ActionForm>
            )}
          </ReauthGate>
        </div>
      </Card>

      <SectionTitle>{screens.backup.restoreTitle}</SectionTitle>
      {backend === 'supabase' ? (
        <Notice tone="attention">{accountScreen.restoreUnavailable}</Notice>
      ) : (
        <>
          <Notice tone="attention">{screens.backup.restoreWarning}</Notice>
          <Card>
            <ReauthGate actionKey="backup_restore" returnTo="/backup">
              <RestorePanel />
            </ReauthGate>
          </Card>
        </>
      )}
    </AppShell>
  );
}
