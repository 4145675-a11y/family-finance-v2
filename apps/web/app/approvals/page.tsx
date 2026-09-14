import Link from 'next/link';

import { AppShell } from '../../components/app-shell';
import { NoHousehold, StatusChips } from '../../components/screen';
import {
  Badge,
  Card,
  EmptyPrompt,
  Figure,
  LinkButton,
  Money,
  SectionTitle,
  StatRow,
} from '../../components/ui';
import { screens } from '../../lib/copy/screens';
import { loadDashboardView } from '../../lib/dashboard/load';
import { formatBusinessDate } from '../../lib/format';

/**
 * Everything the product believes but has not been told is true.
 *
 * One screen, because "what is waiting for me" is a question a person asks about
 * the whole product rather than about a particular feature. An import waiting for
 * review and a transaction left as a draft are the same thing from the family's
 * side: something that will not count until they say so.
 */

export const dynamic = 'force-dynamic';

export default async function ApprovalsPage() {
  const view = await loadDashboardView();

  if (view.document === null || view.snapshot === null) {
    return (
      <NoHousehold
        active="/approvals"
        title={screens.approvals.title}
        reason={view.descriptor.reason}
      />
    );
  }

  const { document, snapshot } = view;

  const waiting = document.importBatches.filter((batch) => batch.status === 'needs_review');
  const drafts = document.transactions.filter((transaction) => transaction.status === 'draft');

  const accountName = (accountId: string): string =>
    document.accounts.find((account) => account.id === accountId)?.name ?? '';

  if (waiting.length === 0 && drafts.length === 0) {
    return (
      <AppShell
        source={view.descriptor}
        active="/approvals"
        title={screens.approvals.title}
        subtitle={screens.approvals.subtitle}
        status={<StatusChips snapshot={snapshot} />}
      >
        <EmptyPrompt
          title={screens.approvals.empty}
          body={screens.approvals.emptyHint}
          actionHref="/upload"
          actionLabel={screens.upload.title}
        />
      </AppShell>
    );
  }

  return (
    <AppShell
      source={view.descriptor}
      active="/approvals"
      title={screens.approvals.title}
      subtitle={screens.approvals.subtitle}
      status={<StatusChips snapshot={snapshot} />}
    >
      {waiting.length === 0 ? null : (
        <>
          <SectionTitle>{screens.approvals.batchesTitle}</SectionTitle>
          {waiting.map((batch) => {
            const rows = document.importProposals.filter(
              (proposal) => proposal.batchId === batch.id,
            );
            const pending = rows.filter((row) => row.reviewState === 'pending').length;

            return (
              <Card
                key={batch.id}
                title={batch.file.displayName}
                subtitle={
                  screens.review.documentTypes[batch.documentType] ?? batch.documentType
                }
                tone="attention"
              >
                <StatRow
                  label={screens.approvals.rows(rows.length)}
                  value={
                    <Badge tone="attention">{screens.review.approvePending(pending)}</Badge>
                  }
                  hint={screens.approvals.uploadedOn(batch.createdAt)}
                />
                {batch.summary.dateRangeStart === null ||
                batch.summary.dateRangeEnd === null ? null : (
                  <StatRow
                    label={screens.review.dateRange(
                      batch.summary.dateRangeStart,
                      batch.summary.dateRangeEnd,
                    )}
                    value=""
                  />
                )}
                <div className="mt-4">
                  <LinkButton href={`/imports/${batch.id}`}>
                    {screens.approvals.review}
                  </LinkButton>
                </div>
              </Card>
            );
          })}
        </>
      )}

      {drafts.length === 0 ? null : (
        <>
          <SectionTitle>{screens.approvals.draftsTitle}</SectionTitle>
          <Card>
            {drafts.map((transaction) => (
              <StatRow
                key={transaction.id}
                label={transaction.merchant ?? screens.common.none}
                value={
                  <Money amountMinor={transaction.amountMinor} currency={snapshot.currency} />
                }
                hint={`${formatBusinessDate(transaction.transactionDate)} · ${accountName(transaction.accountId)}`}
              />
            ))}
          </Card>
        </>
      )}

      <Card title={screens.review.pending}>
        <StatRow
          label={screens.reports.pendingCount(snapshot.quality.components.length)}
          value={<Figure>{snapshot.quality.score}</Figure>}
        />
        <p className="mt-3 text-small text-text-secondary">{screens.reports.approvedOnly}</p>
        <p className="mt-2">
          <Link
            href="/activity"
            className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
          >
            {screens.activity.title}
          </Link>
        </p>
      </Card>
    </AppShell>
  );
}
