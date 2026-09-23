import { buildCsv, extractDocument } from '@family-finance/document-import';
import {
  approveBatch,
  recordTransaction,
  reviewAll,
  stageExtraction,
  viewOf,
  type StoreDocument,
} from '@family-finance/local-store';
import { describe, expect, test } from 'vitest';

import { allReports, periodLabel, reportByKey } from './reports';
import {
  contextFor,
  seededHousehold,
  spend,
  TEST_NOW,
} from '../../../packages/local-store/src/fixtures/household';

/**
 * The reports.
 *
 * One property matters more than every figure in them: a report contains
 * approved records only. A total that quietly included a staged import is a total
 * a family would carry to their accountant, and the number would be wrong in the
 * direction that looks fine.
 */

const asOf = TEST_NOW;

function reportInput(document: StoreDocument) {
  const view = viewOf(document, asOf);
  return {
    document,
    snapshot: view.snapshot,
    budget: view.budget,
    periodStart: view.periodStart,
    periodEnd: view.periodEnd,
    generatedAt: asOf,
  };
}

describe('a report says what it covers and what it leaves out', () => {
  const seeded = seededHousehold();
  const withSpending = spend(
    seeded.document,
    seeded.bankAccountId,
    41_230,
    '2026-09-02',
    'סופרמרקט',
  );
  const reports = allReports(reportInput(withSpending.document));

  test('every report names its period and when it was produced', () => {
    for (const report of reports) {
      expect(report.periodLabel.length).toBeGreaterThan(0);
      expect(report.generatedAt).toBe(asOf);
      expect(report.currency).toBe('ILS');
    }
  });

  test('the period reads as a range a person can check', () => {
    expect(periodLabel('2026-09-01', '2026-09-30')).toContain('ספטמבר');
    expect(periodLabel('2026-09-01', '2026-09-30')).toContain('–');
  });

  test('the reports that exist are the ones the screen lists', () => {
    expect(reports.map((report) => report.key)).toEqual([
      'month',
      'budget',
      'debts',
      'business',
      'completeness',
      'imports',
    ]);
  });

  test('the monthly summary counts what was actually spent', () => {
    const month = reportByKey(reportInput(withSpending.document), 'month');
    const totals = month?.sections.find((section) => section.key === 'totals');
    expect(totals?.rows.find((row) => row.label === 'כמה יצא')?.amountMinor).toBe(41_230);
  });
});

describe('a staged import is not in any total', () => {
  const seeded = seededHousehold();

  const statement = buildCsv({
    header: ['תאריך', 'תיאור', 'סכום'],
    rows: [
      ['02/09/2026', 'מכולת', '-318.40'],
      ['03/09/2026', 'דלק', '-250.00'],
    ],
  });

  const extraction = extractDocument(statement, {
    fileName: 'statement.csv',
    currency: 'ILS',
    scope: 'household',
    importedOn: '2026-09-22',
  });

  const staged = stageExtraction(
    seeded.document,
    {
      extraction,
      displayName: 'statement.csv',
      storedId: crypto.randomUUID(),
      sha256: 'd'.repeat(64),
      byteSize: statement.byteLength,
      declaredMimeType: 'text/csv',
      targetAccountId: seeded.bankAccountId,
    },
    contextFor(seeded.document),
  );

  test('the totals do not move when a file is staged', () => {
    const before = reportByKey(reportInput(seeded.document), 'month');
    const after = reportByKey(reportInput(staged.document), 'month');

    const spent = (report: ReturnType<typeof reportByKey>) =>
      report?.sections
        .find((section) => section.key === 'totals')
        ?.rows.find((row) => row.label === 'כמה יצא')?.amountMinor;

    expect(spent(after)).toBe(spent(before));
  });

  test('the report says how many items are waiting instead', () => {
    const after = reportByKey(reportInput(staged.document), 'month');
    expect(after?.pendingCount).toBe(2);
  });

  test('once approved, the same rows do appear', () => {
    const reviewed = reviewAll(
      staged.document,
      { batchId: staged.value, reviewState: 'included', onlyPending: true },
      contextFor(staged.document),
    );
    const approved = approveBatch(
      reviewed.document,
      { batchId: staged.value },
      contextFor(reviewed.document),
    );

    const after = reportByKey(reportInput(approved.document), 'month');
    const spent = after?.sections
      .find((section) => section.key === 'totals')
      ?.rows.find((row) => row.label === 'כמה יצא')?.amountMinor;

    expect(spent).toBe(31_840 + 25_000);
    expect(after?.pendingCount).toBe(0);
  });
});

describe('a draft is not in any total either', () => {
  test('a transaction left as a draft is counted as waiting, not as spent', () => {
    const seeded = seededHousehold();
    const draft = recordTransaction(
      seeded.document,
      {
        accountId: seeded.bankAccountId,
        counterpartAccountId: null,
        scope: 'household',
        kind: 'expense',
        direction: 'outflow',
        amountMinor: 50_000,
        categoryId: null,
        merchant: 'טיוטה',
        transactionDate: '2026-09-03',
        note: null,
        status: 'draft',
      },
      contextFor(seeded.document),
    );

    const report = reportByKey(reportInput(draft.document), 'month');
    const spent = report?.sections
      .find((section) => section.key === 'totals')
      ?.rows.find((row) => row.label === 'כמה יצא')?.amountMinor;

    expect(spent).toBe(0);
    expect(report?.pendingCount).toBe(1);
  });
});

describe('the debt report keeps the two measures apart', () => {
  test('gross repayment and real reduction are separate lines', () => {
    const seeded = seededHousehold();
    const report = reportByKey(reportInput(seeded.document), 'debts');
    const movement = report?.sections.find((section) => section.key === 'movement');

    const labels = movement?.rows.map((row) => row.label) ?? [];
    expect(labels).toContain('שילמנו על חשבון הקרן');
    expect(labels).toContain('לקחנו חוב חדש');
    expect(labels).toContain('מתוך מה ששילמנו — מומן מחוב חדש');
    expect(labels).toContain('ירידה אמיתית שמומנה מההכנסה');
    expect(labels).toContain('ריבית ועמלות');
  });

  test('a debt with no known rate says so rather than showing zero', () => {
    const seeded = seededHousehold();
    const report = reportByKey(reportInput(seeded.document), 'debts');
    const balances = report?.sections.find((section) => section.key === 'balances');
    expect(balances?.rows.some((row) => row.note === 'ריבית לא ידועה')).toBe(true);
  });
});

describe('the completeness report names what is missing', () => {
  test('it counts the accounts nobody has confirmed', () => {
    const seeded = seededHousehold();
    const report = reportByKey(reportInput(seeded.document), 'completeness');
    const gaps = report?.sections.find((section) => section.key === 'gaps');
    const unconfirmed = gaps?.rows.find(
      (row) => row.label === 'חשבונות שעוד לא אושרו מול הבנק',
    );
    // The fixture confirms one of its three accounts.
    expect(unconfirmed?.note).toBe('2');
  });
});
