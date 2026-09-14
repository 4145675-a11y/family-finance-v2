import { AppShell } from '../../components/app-shell';
import { ReauthGate } from '../../components/reauth-gate';
import { NoHousehold, StatusChips } from '../../components/screen';
import {
  Card,
  DataTable,
  EmptyPrompt,
  LinkButton,
  Money,
  Notice,
  SectionTitle,
} from '../../components/ui';
import { copy } from '../../lib/copy/copy';
import { screens } from '../../lib/copy/screens';
import { loadDashboardView } from '../../lib/dashboard/load';
import { allReports } from '../../lib/reports';

/**
 * The reports.
 *
 * Every one of them says two things before a single figure: what period it
 * covers, and that it contains approved records only. A report that quietly
 * included a staged import would be worse than no report, because a person would
 * carry the total to their accountant.
 *
 * Export is real and it is local. Excel and CSV are produced here; a PDF comes
 * from the browser's own print dialogue, which is the one path that gets Hebrew
 * right without embedding a font this repository does not have the right to ship.
 * That is stated on the page rather than hidden behind a button that produces
 * squares instead of letters.
 */

export const dynamic = 'force-dynamic';

export default async function ReportsPage() {
  const view = await loadDashboardView();

  if (
    view.document === null ||
    view.snapshot === null ||
    view.periodStart === null ||
    view.periodEnd === null
  ) {
    return (
      <NoHousehold
        active="/reports"
        title={screens.reports.title}
        reason={view.descriptor.reason}
      />
    );
  }

  const reports = allReports({
    document: view.document,
    snapshot: view.snapshot,
    budget: view.budget,
    periodStart: view.periodStart,
    periodEnd: view.periodEnd,
    generatedAt: view.asOf,
  });

  const hasAnything = view.document.transactions.length > 0 || view.document.debts.length > 0;

  return (
    <AppShell
      source={view.descriptor}
      active="/reports"
      title={screens.reports.title}
      subtitle={screens.reports.subtitle}
      status={<StatusChips snapshot={view.snapshot} />}
    >
      {hasAnything ? null : (
        <EmptyPrompt
          title={screens.reports.noData}
          body={screens.reports.nothingThisMonth}
          actionHref="/entry"
          actionLabel={screens.entry.title}
        />
      )}

      <Notice tone="primary">
        <p>{screens.reports.approvedOnly}</p>
        <p className="mt-1">{screens.reports.pendingCount(reports[0]?.pendingCount ?? 0)}</p>
      </Notice>

      <Card title={screens.reports.exportTitle}>
        {/* Printing renders a screen this person is already looking at, so it is
            outside the gate. The two file exports carry every figure out of the
            application, so they are inside it. */}
        <ReauthGate actionKey="export_all">
          <div className="flex flex-wrap gap-3">
            <LinkButton href="/api/export/workbook" tone="secondary">
              {screens.reports.exportExcel}
            </LinkButton>
            <LinkButton href="/api/export/transactions.csv" tone="secondary">
              {screens.reports.exportCsv}
            </LinkButton>
          </div>
        </ReauthGate>
        <div className="mt-4 flex flex-wrap gap-3">
          <LinkButton href="/reports/print" tone="secondary">
            {screens.reports.exportPdf}
          </LinkButton>
        </div>
        <p className="mt-3 text-small text-text-secondary">{screens.reports.exportPdfHint}</p>
      </Card>

      {reports.map((report) => (
        <div key={report.key} className="flex flex-col gap-3">
          <SectionTitle>{report.title}</SectionTitle>
          <Card
            subtitle={`${report.periodLabel} · ${screens.reports.generatedAt(report.generatedAt)}`}
          >
            {report.sections.map((section) => {
              // A section either compares two figures or carries one, and either
              // has notes or does not. The columns follow the rows rather than the
              // rows being padded to fit a fixed table.
              const hasComparison = section.rows.some(
                (row) => row.comparisonMinor !== undefined,
              );
              const hasNote = section.rows.some((row) => row.note !== undefined);

              const columns = [
                screens.reports.period,
                hasComparison ? copy.budget.planned : screens.common.total,
                ...(hasComparison ? [copy.budget.spent] : []),
                ...(hasNote ? [screens.tasks.why] : []),
              ];

              return (
                <div key={section.key} className="mb-5 last:mb-0">
                  <h3 className="mb-2 font-semibold">{section.title}</h3>
                  {section.rows.length === 0 ? (
                    <p className="text-text-secondary">{screens.reports.nothingThisMonth}</p>
                  ) : (
                    <DataTable
                      caption={`${report.title} — ${section.title}`}
                      columns={columns}
                      rows={section.rows.map((row, index) => ({
                        key: `${section.key}-${index}`,
                        cells: [
                          <span key="label">{row.label}</span>,
                          <Money
                            key="amount"
                            amountMinor={row.amountMinor}
                            currency={report.currency}
                          />,
                          ...(hasComparison
                            ? [
                                <Money
                                  key="comparison"
                                  amountMinor={row.comparisonMinor ?? 0}
                                  currency={report.currency}
                                />,
                              ]
                            : []),
                          ...(hasNote
                            ? [<span key="note">{row.note ?? screens.common.none}</span>]
                            : []),
                        ],
                      }))}
                    />
                  )}
                  {section.totalMinor === undefined ? null : (
                    <p className="mt-2 text-end font-semibold">
                      {screens.common.total}:{' '}
                      <Money amountMinor={section.totalMinor} currency={report.currency} />
                    </p>
                  )}
                </div>
              );
            })}
          </Card>
        </div>
      ))}
    </AppShell>
  );
}
