import type { BudgetResult, FinancialSnapshot } from '@family-finance/finance-engine';
import { balanceOf, isRealTransaction, type StoreDocument } from '@family-finance/local-store';

import { gemach } from './copy/gemach';
import { formatBusinessDate, formatMoney, money } from './format';
import { gemachLoans } from './gemach';

/**
 * The reports, as data.
 *
 * Every figure here comes from a stored record or from the engine snapshot.
 * Nothing is recomputed with a second formula: the report and the dashboard have
 * to agree, and the only way to guarantee that is for them to read the same
 * numbers.
 *
 * These are pure functions over a stored document — no filesystem, no request,
 * nothing that has to run on a server. They are not marked `server-only` for that
 * reason: the marker belongs on the modules that genuinely reach the disk, and
 * putting it here would only mean the report logic could not be tested directly.
 *
 * A report includes approved records only. A staged import contributes nothing —
 * not a footnote, not a provisional line — and the count of what is waiting is
 * stated instead, so a person reading a total knows what it is a total of.
 */

export interface ReportRow {
  readonly label: string;
  readonly amountMinor: number;
  /** A secondary figure, where the row compares two things. */
  readonly comparisonMinor?: number | undefined;
  readonly note?: string | undefined;
}

export interface ReportSection {
  readonly key: string;
  readonly title: string;
  readonly rows: readonly ReportRow[];
  readonly totalMinor?: number;
}

export interface Report {
  readonly key: string;
  readonly title: string;
  readonly periodLabel: string;
  readonly generatedAt: string;
  readonly currency: string;
  readonly sections: readonly ReportSection[];
  /** Records staged and not approved; excluded from every figure above. */
  readonly pendingCount: number;
}

export interface ReportInput {
  readonly document: StoreDocument;
  readonly snapshot: FinancialSnapshot;
  readonly budget: BudgetResult | null;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly generatedAt: string;
}

function pendingCountOf(document: StoreDocument): number {
  const draftCount = document.transactions.filter(
    (transaction) => transaction.status === 'draft',
  ).length;
  const stagedCount = document.importProposals.filter((proposal) => {
    const batch = document.importBatches.find((candidate) => candidate.id === proposal.batchId);
    return batch !== undefined && batch.status === 'needs_review';
  }).length;
  return draftCount + stagedCount;
}

function inPeriod(date: string, start: string, end: string): boolean {
  return date >= start && date <= end;
}

/** The month as the household lives it, for a report heading. */
export function periodLabel(start: string, end: string): string {
  const format = (date: string) =>
    new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long', year: 'numeric' }).format(
      new Date(`${date}T00:00:00Z`),
    );
  return `${format(start)} – ${format(end)}`;
}

export function monthlySummary(input: ReportInput): Report {
  const { document, snapshot, periodStart, periodEnd } = input;

  const real = document.transactions.filter(isRealTransaction);
  const household = real.filter(
    (transaction) =>
      transaction.scope === 'household' &&
      transaction.kind !== 'transfer' &&
      transaction.kind !== 'settlement' &&
      transaction.kind !== 'correction' &&
      inPeriod(transaction.transactionDate, periodStart, periodEnd),
  );

  const incomeMinor = household
    .filter((transaction) => transaction.direction === 'inflow')
    .reduce((total, transaction) => total + transaction.amountMinor, 0);
  const spendMinor = household
    .filter((transaction) => transaction.direction === 'outflow')
    .reduce((total, transaction) => total + transaction.amountMinor, 0);

  const byCategory = new Map<string, number>();
  for (const transaction of household) {
    if (transaction.direction !== 'outflow') continue;
    const category =
      document.categories.find((candidate) => candidate.id === transaction.categoryId)?.name ??
      'ללא קטגוריה';
    byCategory.set(category, (byCategory.get(category) ?? 0) + transaction.amountMinor);
  }

  return {
    key: 'month',
    title: 'סיכום החודש',
    periodLabel: periodLabel(periodStart, periodEnd),
    generatedAt: input.generatedAt,
    currency: snapshot.currency,
    pendingCount: pendingCountOf(document),
    sections: [
      {
        key: 'totals',
        title: 'התמונה הכללית',
        rows: [
          { label: 'כמה נכנס', amountMinor: incomeMinor },
          { label: 'כמה יצא', amountMinor: spendMinor },
          { label: 'ההפרש', amountMinor: incomeMinor - spendMinor },
          {
            label: 'כמה יש עכשיו בחשבונות הבית',
            amountMinor: snapshot.householdLiquidMinor,
          },
        ],
      },
      {
        key: 'categories',
        title: 'לאן הלך הכסף',
        rows: [...byCategory.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([label, amountMinor]) => ({ label, amountMinor })),
        totalMinor: spendMinor,
      },
    ],
  };
}

export function budgetVersusActual(input: ReportInput): Report {
  const { budget, snapshot, periodStart, periodEnd } = input;

  const rows: ReportRow[] =
    budget === null
      ? []
      : budget.lines.map((line) => ({
          label: line.categoryKey,
          amountMinor: line.plannedMinor,
          comparisonMinor: line.approvedMinor + line.pendingMinor + line.committedMinor,
          note:
            line.overMinor > 0
              ? `יצא יותר ב־${formatMoney(line.overMinor, snapshot.currency)}`
              : undefined,
        }));

  return {
    key: 'budget',
    title: 'תקציב מול מה שקרה',
    periodLabel: periodLabel(periodStart, periodEnd),
    generatedAt: input.generatedAt,
    currency: snapshot.currency,
    pendingCount: pendingCountOf(input.document),
    sections: [
      {
        key: 'lines',
        title: 'לפי קטגוריה',
        rows,
        totalMinor: budget?.totals.plannedMinor ?? 0,
      },
    ],
  };
}

export function debtMap(input: ReportInput): Report {
  const { document, snapshot, periodStart, periodEnd } = input;

  const rows: ReportRow[] = snapshot.debtBalances.map((balance) => {
    const debt = document.debts.find((candidate) => candidate.id === balance.debtId);
    return {
      label: debt?.creditorName ?? balance.debtId,
      amountMinor: balance.balanceMinor,
      note:
        debt?.effectiveAnnualRateBp === null || debt === undefined
          ? 'ריבית לא ידועה'
          : `${(debt.effectiveAnnualRateBp / 100).toFixed(1)}%`,
    };
  });

  const metrics = snapshot.debtMetrics;

  return {
    key: 'debts',
    title: 'מפת החובות',
    periodLabel: periodLabel(periodStart, periodEnd),
    generatedAt: input.generatedAt,
    currency: snapshot.currency,
    pendingCount: pendingCountOf(document),
    sections: [
      {
        key: 'balances',
        title: 'כל החובות',
        rows,
        totalMinor: snapshot.debtTotals.totalDebtMinor,
      },
      {
        key: 'movement',
        title: 'מה קרה החודש',
        rows: [
          { label: 'שילמנו על חשבון הקרן', amountMinor: metrics.grossPrincipalRepaidMinor },
          { label: 'לקחנו חוב חדש', amountMinor: metrics.newDebtOriginatedMinor },
          {
            label: 'מתוך מה ששילמנו — מומן מחוב חדש',
            amountMinor: metrics.rolloverFundedRepaymentMinor,
          },
          {
            label: 'ירידה אמיתית שמומנה מההכנסה',
            amountMinor: metrics.incomeFundedPrincipalReductionMinor,
          },
          { label: 'ריבית ועמלות', amountMinor: metrics.interestAndFeesPaidMinor },
        ],
      },
    ],
  };
}

export function businessSummary(input: ReportInput): Report | null {
  const { snapshot, periodStart, periodEnd } = input;
  if (snapshot.businessProfit === null) return null;

  const profit = snapshot.businessProfit;
  // The engine reports the profit; the raw components come from what it was
  // given, so the report and the calculation cannot disagree about either.
  const business = toBusinessFacts(snapshot);

  return {
    key: 'business',
    title: 'סיכום העסק',
    periodLabel: periodLabel(periodStart, periodEnd),
    generatedAt: input.generatedAt,
    currency: snapshot.currency,
    pendingCount: pendingCountOf(input.document),
    sections: [
      {
        key: 'profit',
        title: 'הרווח',
        rows: [
          { label: 'כמה נכנס בפועל', amountMinor: business.receivedIncomeMinor },
          { label: 'כמה יצא על העסק', amountMinor: business.paidExpensesMinor },
          { label: 'כמה שמרנו למסים', amountMinor: business.accruedTaxReserveMinor },
          { label: 'רווח על הנייר', amountMinor: profit.operatingProfitMinor },
          { label: 'רווח שכבר בידיים', amountMinor: profit.realizedCashProfitMinor },
        ],
      },
      {
        key: 'transfer',
        title: 'כמה בטוח להעביר לבית',
        rows: [
          { label: 'כסף פנוי בעסק', amountMinor: profit.availableCashMinor },
          {
            label: 'כמה בטוח להעביר',
            amountMinor: snapshot.safeTransfer.resultMinor,
          },
        ],
      },
    ],
  };
}

export function completeness(input: ReportInput): Report {
  const { document, snapshot, periodStart, periodEnd } = input;

  const accountsWithoutBalance = document.accounts.filter(
    (account) =>
      account.closedAt === null && balanceOf(document, account.id).verifiedAt === null,
  );

  const debtsWithoutRate = document.debts.filter(
    (debt) => debt.status === 'active' && debt.effectiveAnnualRateBp === null,
  );

  const uncategorised = document.transactions.filter(
    (transaction) =>
      isRealTransaction(transaction) &&
      transaction.kind === 'expense' &&
      transaction.categoryId === null,
  );

  return {
    key: 'completeness',
    title: 'עד כמה התמונה מלאה',
    periodLabel: periodLabel(periodStart, periodEnd),
    generatedAt: input.generatedAt,
    currency: snapshot.currency,
    pendingCount: pendingCountOf(document),
    sections: [
      {
        key: 'gaps',
        title: 'מה עוד חסר',
        rows: [
          {
            label: 'חשבונות שעוד לא אושרו מול הבנק',
            amountMinor: 0,
            note: String(accountsWithoutBalance.length),
          },
          {
            label: 'חובות בלי ריבית ידועה',
            amountMinor: 0,
            note: String(debtsWithoutRate.length),
          },
          {
            label: 'הוצאות בלי קטגוריה',
            amountMinor: uncategorised.reduce(
              (total, transaction) => total + transaction.amountMinor,
              0,
            ),
            note: String(uncategorised.length),
          },
        ],
      },
    ],
  };
}

export function importHistory(input: ReportInput): Report {
  const { document, snapshot, periodStart, periodEnd } = input;

  return {
    key: 'imports',
    title: 'קבצים שהעלינו',
    periodLabel: periodLabel(periodStart, periodEnd),
    generatedAt: input.generatedAt,
    currency: snapshot.currency,
    pendingCount: pendingCountOf(document),
    sections: [
      {
        key: 'batches',
        title: 'היסטוריית היבוא',
        rows: document.importBatches.map((batch) => ({
          label: batch.file.displayName,
          amountMinor: 0,
          note: `${batch.status} · ${batch.summary.rowsProposed}`,
        })),
      },
    ],
  };
}

/**
 * The business facts behind the profit, read from the engine's own breakdown.
 *
 * Taken from the breakdown rather than recalculated, so a report line and the
 * business screen can never disagree about how much came in.
 */
function toBusinessFacts(snapshot: FinancialSnapshot): {
  receivedIncomeMinor: number;
  paidExpensesMinor: number;
  accruedTaxReserveMinor: number;
} {
  const line = (key: string): number =>
    snapshot.businessProfit?.breakdown.find((entry) => entry.key === key)?.amountMinor ?? 0;

  return {
    receivedIncomeMinor: line('received_income'),
    paidExpensesMinor: line('paid_expenses'),
    accruedTaxReserveMinor: line('tax_reserve'),
  };
}

/** Every report the product produces, in the order the screen lists them. */
/**
 * Post-dated checks: exposure kept apart from payments already made.
 *
 * Two sections, deliberately never totalled together. "Already paid" is history
 * and belongs in the same column as any other expense. "Still outstanding" is
 * paper in somebody else's hands, and adding it to what has been paid produces a
 * number that describes nothing — not what the family has spent, and not what
 * they still owe.
 *
 * Check numbers appear masked. A report gets printed and left on a table, and a
 * check number beside an account number is most of what somebody needs to write
 * a check that is not theirs. The full number stays on the screen where a person
 * is working with that one check.
 */
export function checkExposureReport(input: ReportInput): Report | null {
  const { document, snapshot, periodStart, periodEnd } = input;

  const loans = gemachLoans(document, snapshot, snapshot.today);
  if (loans.length === 0) return null;

  const outstanding: ReportRow[] = [];
  const settled: ReportRow[] = [];
  const attention: ReportRow[] = [];

  for (const loan of loans) {
    for (const view of loan.checks) {
      const label = `${loan.creditorName} · ${view.maskedNumber ?? formatBusinessDate(view.check.dueDate)}`;
      const row: ReportRow = {
        label,
        amountMinor: view.check.amountMinor,
        note: `${gemach.states[view.state] ?? view.state} · ${formatBusinessDate(view.check.dueDate)}`,
      };

      if (view.check.status === 'cleared') settled.push(row);
      else if (view.check.status === 'returned') attention.push(row);
      else if (view.outstanding) outstanding.push(row);
    }
  }

  const sections: ReportSection[] = [
    {
      key: 'outstanding',
      title: gemach.checksOutstanding,
      rows: outstanding,
      totalMinor: snapshot.checkExposure.outstandingTotalMinor,
    },
    {
      key: 'cleared',
      title: gemach.cleared,
      rows: settled,
      totalMinor: snapshot.checkExposure.clearedTotalMinor,
    },
  ];

  if (attention.length > 0) {
    sections.push({
      key: 'returned',
      title: gemach.returned,
      rows: attention,
      totalMinor: snapshot.checkExposure.returnedTotalMinor,
    });
  }

  sections.push({
    key: 'loans',
    title: gemach.outstandingDebt,
    rows: loans.map((loan) => ({
      label: loan.creditorName,
      amountMinor: loan.outstandingDebtMinor,
      note: loan.coverage.fullyCovered
        ? gemach.coverageFull
        : gemach.coverageShort(money(loan.coverage.shortfallMinor, snapshot.currency)),
    })),
  });

  return {
    key: 'checks',
    title: gemach.title,
    periodLabel: periodLabel(periodStart, periodEnd),
    generatedAt: input.generatedAt,
    currency: snapshot.currency,
    pendingCount: pendingCountOf(document),
    sections,
  };
}

export function allReports(input: ReportInput): readonly Report[] {
  const business = businessSummary(input);
  const checks = checkExposureReport(input);
  return [
    monthlySummary(input),
    budgetVersusActual(input),
    debtMap(input),
    // Immediately after the debt map, because it is the half of the debt picture
    // the debt map cannot show: what is already written and not yet honoured.
    ...(checks === null ? [] : [checks]),
    ...(business === null ? [] : [business]),
    completeness(input),
    importHistory(input),
  ];
}

export function reportByKey(input: ReportInput, key: string): Report | null {
  return allReports(input).find((report) => report.key === key) ?? null;
}
