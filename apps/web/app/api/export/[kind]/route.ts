import { cell, writeWorkbook, type WriteSheet } from '@family-finance/document-import';
import { balanceOf, isRealTransaction } from '@family-finance/local-store';

import { allReports } from '../../../../lib/reports';
import { loadDashboardView } from '../../../../lib/dashboard/load';

/**
 * Local exports.
 *
 * A real `.xlsx` and a real `.csv`, produced here on this machine and streamed
 * straight back. No service, no upload, no round trip — 07-SECURITY-PRIVACY.md
 * would not permit sending a household's ledger to a formatting API, and there is
 * no reason to.
 *
 * The CSV carries a UTF-8 byte-order mark. Without it Excel on Windows opens a
 * Hebrew CSV as mojibake, which for this product's users is the difference between
 * a working export and a broken one.
 *
 * There is deliberately no PDF endpoint. Producing one with Hebrew requires
 * embedding a font, and this repository ships none; `/reports/print` uses the
 * browser's own print-to-PDF, which renders the same page correctly with the
 * system's fonts. The reports screen says so rather than offering a button that
 * would emit empty boxes.
 */

export const dynamic = 'force-dynamic';

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** Minor units as a decimal, by string surgery. No float touches a shekel. */
function decimalText(amountMinor: number): string {
  const negative = amountMinor < 0;
  const digits = String(Math.abs(Math.trunc(amountMinor))).padStart(3, '0');
  return `${negative ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ kind: string }> },
): Promise<Response> {
  const { kind } = await params;
  const view = await loadDashboardView();

  if (
    view.document === null ||
    view.snapshot === null ||
    view.periodStart === null ||
    view.periodEnd === null
  ) {
    return new Response('עוד לא הוקם כאן משק בית.', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  const { document, snapshot } = view;
  const stamp = view.asOf.slice(0, 10);

  if (kind === 'transactions.csv') {
    const accountName = (accountId: string): string =>
      document.accounts.find((account) => account.id === accountId)?.name ?? '';
    const categoryName = (categoryId: string | null): string =>
      categoryId === null
        ? ''
        : (document.categories.find((category) => category.id === categoryId)?.name ?? '');

    const header = [
      'תאריך',
      'תיאור',
      'סכום',
      'כיוון',
      'חשבון',
      'קטגוריה',
      'שייך ל',
      'סוג',
      'מקור',
    ];

    const lines = document.transactions
      .filter(isRealTransaction)
      .sort((a, b) => a.transactionDate.localeCompare(b.transactionDate))
      .map((transaction) =>
        [
          transaction.transactionDate,
          transaction.merchant ?? '',
          decimalText(transaction.amountMinor),
          transaction.direction === 'inflow' ? 'נכנס' : 'יוצא',
          accountName(transaction.accountId),
          categoryName(transaction.categoryId),
          transaction.scope === 'household' ? 'הבית' : 'העסק',
          transaction.kind,
          transaction.importBatchId === null ? 'הוזן ידנית' : 'מקובץ שאושר',
        ]
          .map(csvEscape)
          .join(','),
      );

    // The BOM is what makes Excel on Windows read this as UTF-8. Written as an
    // escape: a literal one is invisible in the source, and its presence is the
    // whole point of the line.
    const BYTE_ORDER_MARK = '\ufeff';
    const body = `${BYTE_ORDER_MARK}${[header.map(csvEscape).join(','), ...lines].join('\r\n')}\r\n`;

    return new Response(body, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="transactions-${stamp}.csv"`,
        'cache-control': 'no-store',
      },
    });
  }

  if (kind === 'workbook') {
    const reports = allReports({
      document,
      snapshot,
      budget: view.budget,
      periodStart: view.periodStart,
      periodEnd: view.periodEnd,
      generatedAt: view.asOf,
    });

    const reportSheets: WriteSheet[] = reports.map((report) => ({
      name: report.title,
      rows: [
        [cell.text(report.title)],
        [cell.text(report.periodLabel)],
        [cell.text(`הופק ב־${stamp}`)],
        [cell.blank()],
        ...report.sections.flatMap((section) => [
          [cell.text(section.title)],
          ...section.rows.map((row) =>
            row.comparisonMinor === undefined
              ? [cell.text(row.label), cell.money(row.amountMinor), cell.text(row.note ?? '')]
              : [
                  cell.text(row.label),
                  cell.money(row.amountMinor),
                  cell.money(row.comparisonMinor),
                  cell.text(row.note ?? ''),
                ],
          ),
          ...(section.totalMinor === undefined
            ? []
            : [[cell.text('סך הכול'), cell.money(section.totalMinor)]]),
          [cell.blank()],
        ]),
      ],
    }));

    const accountName = (accountId: string): string =>
      document.accounts.find((account) => account.id === accountId)?.name ?? '';

    const transactionSheet: WriteSheet = {
      name: 'תנועות',
      rows: [
        [
          cell.text('תאריך'),
          cell.text('תיאור'),
          cell.text('סכום'),
          cell.text('כיוון'),
          cell.text('חשבון'),
          cell.text('שייך ל'),
        ],
        ...document.transactions
          .filter(isRealTransaction)
          .sort((a, b) => a.transactionDate.localeCompare(b.transactionDate))
          .map((transaction) => [
            cell.date(transaction.transactionDate),
            cell.text(transaction.merchant ?? ''),
            cell.money(transaction.amountMinor),
            cell.text(transaction.direction === 'inflow' ? 'נכנס' : 'יוצא'),
            cell.text(accountName(transaction.accountId)),
            cell.text(transaction.scope === 'household' ? 'הבית' : 'העסק'),
          ]),
      ],
    };

    const accountSheet: WriteSheet = {
      name: 'חשבונות',
      rows: [
        [cell.text('חשבון'), cell.text('לפי מה שרשום'), cell.text('אושר מול הבנק')],
        ...document.accounts
          .filter((account) => account.closedAt === null)
          .map((account) => {
            const balance = balanceOf(document, account.id);
            return [
              cell.text(account.name),
              cell.money(balance.computedMinor),
              balance.verifiedMinor === null
                ? cell.text('עוד לא אושר')
                : cell.money(balance.verifiedMinor),
            ];
          }),
      ],
    };

    const bytes = writeWorkbook([...reportSheets, transactionSheet, accountSheet]);

    return new Response(new Uint8Array(bytes), {
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': `attachment; filename="family-finance-${stamp}.xlsx"`,
        'cache-control': 'no-store',
      },
    });
  }

  return new Response('לא מכירים את סוג הייצוא הזה.', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
