import {
  maskCheckNumber,
  plannedTotalMinor,
  type PostDatedCheck,
  type RepaymentPlan,
} from '@family-finance/contracts';
import {
  coverageOf,
  derivedCheckState,
  summariseChecks,
  type CheckCoverage,
  type CheckExposure,
  type CheckRecord,
  type DerivedCheckState,
  type FinancialSnapshot,
} from '@family-finance/finance-engine';
import type { StoreDocument } from '@family-finance/local-store';

/**
 * Everything the gemach screens show, assembled once.
 *
 * The screens render this. They do not compute — not even a subtraction — for the
 * same reason the rest of the product keeps arithmetic out of pages: the home
 * screen's warning, the loan screen's totals and the reports all have to be the
 * same numbers, and three places doing their own sums is three places that can
 * drift apart.
 *
 * The exposure figures come from the engine snapshot, which took them from the
 * same `summariseChecks`. What is added here is the per-loan grouping and the
 * display state of each individual check, which is a presentation concern the
 * engine has no business knowing about.
 */

export interface CheckView {
  readonly check: PostDatedCheck;
  /** Status plus today's date: what a person actually needs to read. */
  readonly state: DerivedCheckState;
  /** The number as an ordinary screen should show it. */
  readonly maskedNumber: string | null;
  /** The account it is drawn on, named. */
  readonly accountName: string;
  /** True while it can still take money out of the account. */
  readonly outstanding: boolean;
  /** The check that replaced this one, or that this one replaced. */
  readonly replacedByNumber: string | null;
}

export interface GemachLoan {
  readonly debtId: string;
  readonly creditorName: string;
  readonly status: 'active' | 'settled' | 'written_off';
  readonly openedOn: string;
  readonly agreement: string | null;
  /** What was borrowed: the opening balance. */
  readonly principalMinor: number;
  /** What is still owed, replayed from the debt events. */
  readonly outstandingDebtMinor: number;
  readonly plan: RepaymentPlan | null;
  readonly plannedTotalMinor: number | null;
  readonly checks: readonly CheckView[];
  readonly exposure: CheckExposure;
  readonly coverage: CheckCoverage;
  /** Checks written but not yet handed over, which can be delivered together. */
  readonly deliverable: readonly CheckView[];
  readonly canClose: boolean;
}

function toRecord(check: PostDatedCheck): CheckRecord {
  return {
    id: check.id,
    debtId: check.debtId,
    accountId: check.accountId,
    amountMinor: check.amountMinor,
    dueDate: check.dueDate,
    status: check.status,
    installmentNumber: check.installmentNumber,
    payeeName: check.payeeName,
    deliveredOn: check.deliveredOn,
    clearedOn: check.clearedOn,
  };
}

const OUTSTANDING_STATES: readonly DerivedCheckState[] = [
  'prepared',
  'delivered',
  'due',
  'overdue',
  'deposited',
];

/** Every gemach loan in the household, with its checks and what they mean. */
export function gemachLoans(
  document: StoreDocument,
  snapshot: FinancialSnapshot,
  today: string,
): GemachLoan[] {
  const accountName = (accountId: string): string =>
    document.accounts.find((account) => account.id === accountId)?.name ?? '';

  const numberOf = (checkId: string | null): string | null => {
    if (checkId === null) return null;
    const found = document.checks.find((candidate) => candidate.id === checkId);
    return found === undefined ? null : maskCheckNumber(found.checkNumber);
  };

  return document.debts
    .filter((debt) => debt.kind === 'gemach')
    .map((debt) => {
      const checks = document.checks
        .filter((check) => check.debtId === debt.id)
        .sort(
          (a, b) =>
            a.dueDate.localeCompare(b.dueDate) ||
            (a.installmentNumber ?? 0) - (b.installmentNumber ?? 0),
        );

      const views: CheckView[] = checks.map((check) => {
        const state = derivedCheckState(toRecord(check), today);
        return {
          check,
          state,
          maskedNumber: maskCheckNumber(check.checkNumber),
          accountName: accountName(check.accountId),
          outstanding: OUTSTANDING_STATES.includes(state),
          replacedByNumber: numberOf(check.replacedByCheckId),
        };
      });

      const exposure = summariseChecks(checks.map(toRecord), today);
      const outstandingDebtMinor =
        snapshot.debtBalances.find((entry) => entry.debtId === debt.id)?.balanceMinor ?? 0;

      const plan = document.repaymentPlans.find((candidate) => candidate.debtId === debt.id);

      // The opening balance is what was borrowed. Later events change the
      // balance; they do not change what the loan was for.
      const principalMinor =
        document.debtEvents.find(
          (event) => event.debtId === debt.id && event.kind === 'opening_balance',
        )?.amountMinor ?? 0;

      return {
        debtId: debt.id,
        creditorName: debt.creditorName,
        status: debt.status,
        openedOn: debt.openedOn,
        agreement: debt.promiseSummary,
        principalMinor,
        outstandingDebtMinor,
        plan: plan ?? null,
        plannedTotalMinor: plan === undefined ? null : plannedTotalMinor(plan),
        checks: views,
        exposure,
        coverage: coverageOf(outstandingDebtMinor, exposure),
        deliverable: views.filter((view) => view.check.status === 'prepared'),
        canClose: outstandingDebtMinor === 0 && exposure.outstandingCount === 0,
      };
    });
}

export function gemachLoanById(
  document: StoreDocument,
  snapshot: FinancialSnapshot,
  today: string,
  debtId: string,
): GemachLoan | null {
  return gemachLoans(document, snapshot, today).find((loan) => loan.debtId === debtId) ?? null;
}

/**
 * The one thing the home screen may need to say about checks.
 *
 * Returns null when there is nothing useful to do, which is most days. A home
 * screen that permanently carries a line about post-dated checks trains a family
 * to stop reading it, and then it is not there when it matters.
 *
 * The order is the order of urgency: a bounced check needs a phone call, an
 * overdue one may hit the account this morning, and outstanding paper is a
 * standing fact worth one calm sentence.
 */
export type CheckAlertKind = 'returned' | 'overdue' | 'outstanding';

export interface CheckAlert {
  readonly kind: CheckAlertKind;
  readonly count: number;
  readonly amountMinor: number;
  /** The next check that may come out, when there is one. */
  readonly next: { readonly dueDate: string; readonly amountMinor: number } | null;
}

export function checkAlert(snapshot: FinancialSnapshot): CheckAlert | null {
  const exposure = snapshot.checkExposure;

  const next =
    exposure.nextCheck === null
      ? null
      : { dueDate: exposure.nextCheck.dueDate, amountMinor: exposure.nextCheck.amountMinor };

  if (exposure.returnedCount > 0) {
    return {
      kind: 'returned',
      count: exposure.returnedCount,
      amountMinor: exposure.returnedTotalMinor,
      next,
    };
  }

  if (exposure.overdueCount > 0) {
    return {
      kind: 'overdue',
      count: exposure.overdueCount,
      amountMinor: exposure.overdueTotalMinor,
      next,
    };
  }

  // Only when the gemach is actually holding paper. Checks still in the
  // chequebook are a plan, and a plan is not something to warn about.
  if (exposure.atLargeCount > 0) {
    return {
      kind: 'outstanding',
      count: exposure.atLargeCount,
      amountMinor: exposure.atLargeTotalMinor,
      next,
    };
  }

  return null;
}
