import { AppShell } from '../../components/app-shell';
import { NoHousehold, StatusChips } from '../../components/screen';
import { Badge, Card, DataTable, EmptyPrompt, Figure, Money } from '../../components/ui';
import { screens } from '../../lib/copy/screens';
import { loadDashboardView } from '../../lib/dashboard/load';
import { formatBusinessDate } from '../../lib/format';

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

/** How many records the screen lists. Enough to answer "did that go in".  */
const RECORDS_SHOWN = 30;

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

  /*
   * The records themselves, newest first.
   *
   * Sorted by the day they happened and then by when they were written, so two
   * things recorded for the same day keep the order they were entered in. No
   * arithmetic: every figure below is a stored `amountMinor` printed as it is.
   */
  const records = [...document.transactions]
    .sort((left, right) =>
      left.transactionDate === right.transactionDate
        ? right.createdAt.localeCompare(left.createdAt)
        : right.transactionDate.localeCompare(left.transactionDate),
    )
    .slice(0, RECORDS_SHOWN);

  const accountName = (accountId: string): string =>
    document.accounts.find((account) => account.id === accountId)?.name ?? screens.common.none;

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
      {/*
       * What was recorded, before the trail of what was done. A person arriving
       * here has just pressed save somewhere and wants to see the thing, not the
       * name of the action that made it.
       */}
      <Card title={screens.activity.recordsTitle} subtitle={screens.activity.recordsSubtitle}>
        {records.length === 0 ? (
          <p className="text-text-secondary">{screens.activity.recordsEmpty}</p>
        ) : (
          <>
            <DataTable
              caption={screens.activity.recordsTitle}
              columns={[
                screens.entry.date,
                screens.activity.recordsWhat,
                screens.activity.recordsAmount,
                screens.activity.recordsAccount,
              ]}
              rows={records.map((record) => ({
                key: record.id,
                cells: [
                  <Figure key="when">{formatBusinessDate(record.transactionDate)}</Figure>,
                  <span key="what">
                    {record.merchant === null || record.merchant === ''
                      ? screens.activity.noMerchant
                      : record.merchant}
                    {record.status === 'void' ? (
                      <>
                        {' '}
                        <Badge tone="neutral">{screens.activity.voided}</Badge>
                      </>
                    ) : null}
                  </span>,
                  /*
                   * The sign is a character, not a calculation. The stored amount
                   * is non-negative and the direction says which way it went
                   * (02-FINANCIAL-RULES.md), so negating it here would be this
                   * screen doing arithmetic — the same pattern the lender ledger
                   * settled on.
                   */
                  <span key="amount">
                    {record.direction === 'inflow' ? '+' : '−'}
                    <Money amountMinor={record.amountMinor} currency={record.currency} />
                  </span>,
                  accountName(record.accountId),
                ],
              }))}
            />
            {document.transactions.length > RECORDS_SHOWN ? (
              <p className="mt-3 text-small text-text-secondary">
                {screens.activity.recordsMore(document.transactions.length)}
              </p>
            ) : null}
          </>
        )}
      </Card>

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
