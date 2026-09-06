import { SourceNotice } from '../../../components/screen';
import { EmptyState, Money } from '../../../components/ui';
import { screens } from '../../../lib/copy/screens';
import { loadDashboardView } from '../../../lib/dashboard/load';
import { allReports } from '../../../lib/reports';
import { PrintTrigger } from '../../../components/print-trigger';

/**
 * The printable report.
 *
 * A plain page with no navigation and no controls, sized for A4, which the
 * browser's own print dialogue turns into a PDF. That path is chosen deliberately
 * over generating a PDF on the server: rendering Hebrew into a PDF needs an
 * embedded font, this repository ships none, and a PDF full of empty boxes is
 * worse than no PDF at all.
 *
 * What the browser produces is a real document with real Hebrew, correct
 * right-to-left order and the system's own fonts. The trade — the family presses
 * one extra button in a dialogue — is named on the reports screen rather than
 * hidden.
 */

export const dynamic = 'force-dynamic';

export default async function PrintablePage() {
  const view = await loadDashboardView();

  if (
    view.document === null ||
    view.snapshot === null ||
    view.periodStart === null ||
    view.periodEnd === null
  ) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <EmptyState reason={view.descriptor.reason} />
      </main>
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

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 bg-surface p-8 print:p-0">
      <SourceNotice descriptor={view.descriptor} />

      <header className="border-b border-border pb-4">
        <h1 className="text-[24px] font-bold">{view.document.household.name}</h1>
        <p className="mt-1 text-text-secondary">{reports[0]?.periodLabel ?? ''}</p>
        <p className="text-small text-text-secondary">
          {screens.reports.generatedAt(view.asOf)}
        </p>
        <p className="mt-2 text-small text-text-secondary">{screens.reports.approvedOnly}</p>
        <p className="text-small text-text-secondary">
          {screens.reports.pendingCount(reports[0]?.pendingCount ?? 0)}
        </p>
      </header>

      <PrintTrigger label={screens.reports.print} />

      {reports.map((report) => (
        <section key={report.key} className="break-inside-avoid">
          <h2 className="text-[20px] font-semibold">{report.title}</h2>
          {report.sections.map((section) => (
            <div key={section.key} className="mt-4">
              <h3 className="font-semibold">{section.title}</h3>
              {section.rows.length === 0 ? (
                <p className="text-text-secondary">{screens.reports.nothingThisMonth}</p>
              ) : (
                <table className="mt-2 w-full border-collapse">
                  <tbody>
                    {section.rows.map((row, index) => (
                      <tr key={`${section.key}-${index}`} className="border-b border-border">
                        <th scope="row" className="py-1.5 text-start font-normal">
                          {row.label}
                        </th>
                        <td className="py-1.5 text-end font-medium">
                          <Money amountMinor={row.amountMinor} currency={report.currency} />
                        </td>
                        {row.comparisonMinor === undefined ? null : (
                          <td className="py-1.5 text-end font-medium">
                            <Money
                              amountMinor={row.comparisonMinor}
                              currency={report.currency}
                            />
                          </td>
                        )}
                        {row.note === undefined ? null : (
                          <td className="py-1.5 text-end text-small text-text-secondary">
                            {row.note}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                  {section.totalMinor === undefined ? null : (
                    <tfoot>
                      <tr>
                        <th scope="row" className="py-2 text-start font-semibold">
                          {screens.common.total}
                        </th>
                        <td className="py-2 text-end font-semibold">
                          <Money amountMinor={section.totalMinor} currency={report.currency} />
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              )}
            </div>
          ))}
        </section>
      ))}
    </main>
  );
}
