import Link from 'next/link';

import { AppShell } from '../../components/app-shell';
import { NoHousehold, StatusChips } from '../../components/screen';
import { Badge, Card, DataTable, Figure, Notice } from '../../components/ui';
import { UploadForm } from '../../components/upload-form';
import { screens } from '../../lib/copy/screens';
import { requireUnlocked } from '../../lib/auth/guard';
import { loadDashboardView } from '../../lib/dashboard/load';
import { sweepExpiredUploads } from '../../lib/store/retention';

/**
 * Uploading a financial document.
 *
 * The first thing on the page is the promise, and it is there because it is the
 * question a person actually has: what happens to my bank statement when I put it
 * here. The answer — it is read on this machine, it goes nowhere, and nothing
 * enters the accounts until you say so — appears before the file picker, not
 * after it.
 *
 * The second thing is what is supported, stated plainly including what is not: an
 * old `.xls` and a scanned PDF both fail, and a family who knows that in advance
 * spends thirty seconds instead of ten minutes.
 */

export const dynamic = 'force-dynamic';

export default async function UploadPage() {
  /*
   * The lock first, before anything touches the store.
   *
   * This page is the one screen that does work of its own before reading the
   * household, and that ordering was a real bug: with the database backend and no
   * session, the sweep asked for a store, got an authentication error, and a
   * signed-out visitor met a server error page instead of the sign-in screen —
   * on a destination that is in the main navigation. `requireUnlocked` redirects,
   * which is what a person should experience, and it has to run first for that to
   * be true.
   */
  await requireUnlocked();

  // 05-ARCHITECTURE-DATA.md § Imports gives an undecided upload 24 hours. The
  // immediate deletions happen where the decision is made; this is the file
  // somebody uploaded and then closed the tab on.
  await sweepExpiredUploads();

  const view = await loadDashboardView();

  if (view.document === null || view.snapshot === null) {
    return (
      <NoHousehold
        active="/upload"
        title={screens.upload.title}
        reason={view.descriptor.reason}
      />
    );
  }

  const { document, snapshot } = view;
  const accounts = document.accounts
    .filter((account) => account.closedAt === null)
    .map((account) => ({ value: account.id, label: account.name }));

  const history = [...document.importBatches].reverse().slice(0, 15);

  const statusTone: Record<string, 'neutral' | 'success' | 'attention' | 'danger'> = {
    needs_review: 'attention',
    approved: 'success',
    rejected: 'neutral',
    failed: 'danger',
    reversed: 'neutral',
    extracting: 'neutral',
  };

  const statusLabel: Record<string, string> = {
    needs_review: screens.review.pending,
    approved: screens.review.approved,
    rejected: screens.review.rejected,
    failed: screens.review.failed,
    reversed: screens.review.reversed,
    extracting: screens.upload.reading,
  };

  return (
    <AppShell
      source={view.descriptor}
      active="/upload"
      title={screens.upload.title}
      subtitle={screens.upload.subtitle}
      status={<StatusChips snapshot={snapshot} />}
    >
      <Notice tone="primary" title={screens.upload.promise}>
        {screens.upload.notScanned}
      </Notice>

      <Card>
        <UploadForm accounts={accounts} hasBusiness={document.businesses.length > 0} />
      </Card>

      <Card title={screens.upload.accepts}>
        <ul className="flex list-inside list-disc flex-col gap-1.5 text-text-secondary">
          <li>{screens.upload.limits}</li>
          <li>{screens.upload.xlsNote}</li>
          <li>{screens.upload.scanNote}</li>
        </ul>
      </Card>

      <Card title={screens.upload.history}>
        {history.length === 0 ? (
          <p className="text-text-secondary">{screens.upload.noHistory}</p>
        ) : (
          <DataTable
            caption={screens.upload.history}
            columns={[
              screens.review.file,
              screens.review.documentType,
              screens.approvals.rows(0).replace(/\d+\s*/, ''),
              screens.common.confirm,
            ]}
            rows={history.map((batch) => ({
              key: batch.id,
              cells: [
                <Link
                  key="name"
                  href={`/imports/${batch.id}`}
                  className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
                >
                  {batch.file.displayName}
                </Link>,
                screens.review.documentTypes[batch.documentType] ?? batch.documentType,
                <Figure key="rows">{batch.summary.rowsProposed}</Figure>,
                <Badge key="status" tone={statusTone[batch.status] ?? 'neutral'}>
                  {statusLabel[batch.status] ?? batch.status}
                </Badge>,
              ],
            }))}
          />
        )}
      </Card>
    </AppShell>
  );
}
