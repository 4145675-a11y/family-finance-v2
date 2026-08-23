import type { BudgetInput, EngineInput, FoodWeekInput } from '@family-finance/finance-engine';

/**
 * Development fixture — invented figures for a household that does not exist.
 *
 * This file exists for one reason: the real data layer is not verified yet
 * (Milestone 2's migrations have never been applied to a database), and a finance
 * engine that has never rendered anything is a claim rather than a capability.
 * The numbers here let the whole path — engine, formatting, layout, right-to-left
 * behaviour — be seen and judged before a single real shekel is involved.
 *
 * Three rules govern it:
 *
 *  1. It is unreachable unless `lib/dashboard/source.ts` says so, and that module
 *     refuses in a production build regardless of any environment variable.
 *  2. Every screen that renders it says so, visibly, in the user's language.
 *  3. Nothing here comes from a real household. 08-TEST-PLAN.md requires fixtures
 *     to be anonymous, and this one is invented from the situation described in
 *     01-PRODUCT-SPEC.md § הקשר משתמש rather than from anyone's accounts.
 */

/** Shekels to minor units, so the figures below stay readable as money. */
const ils = (shekels: number): number => Math.round(shekels * 100);

/** A date in the month of `asOf`, so the demo always looks current. */
function dayThisMonth(asOf: string, day: number): string {
  return `${asOf.slice(0, 7)}-${String(day).padStart(2, '0')}`;
}

function monthsBefore(asOf: string, months: number): string {
  const [year, month] = [Number(asOf.slice(0, 4)), Number(asOf.slice(5, 7))];
  const shifted = new Date(Date.UTC(year, month - 1 - months, 1));
  return shifted.toISOString().slice(0, 10);
}

/**
 * A couple with six children, two salaries, a small business and more consumer
 * debt than cushion. The overdraft is real and the month is tight — which is the
 * situation the product is for, and the one a demo has to be able to show
 * honestly rather than a comfortable one that flatters the screens.
 */
export function demoHouseholdInput(asOf: string = new Date().toISOString()): EngineInput {
  const opened = monthsBefore(asOf, 2);

  return {
    asOf,
    timeZone: 'Asia/Jerusalem',
    currency: 'ILS',

    accounts: [
      {
        id: 'acc-main',
        name: 'עובר ושב ראשי',
        scope: 'household',
        kind: 'bank_account',
        balance: { amountMinor: ils(8_450), direction: 'inflow' },
        verifiedAt: new Date(Date.parse(asOf) - 2 * 86_400_000).toISOString(),
      },
      {
        id: 'acc-overdraft',
        name: 'חשבון משני (במינוס)',
        scope: 'household',
        kind: 'bank_account',
        balance: { amountMinor: ils(31_200), direction: 'outflow' },
        verifiedAt: new Date(Date.parse(asOf) - 6 * 86_400_000).toISOString(),
      },
      {
        id: 'acc-cash',
        name: 'מזומן בבית',
        scope: 'household',
        kind: 'cash_wallet',
        balance: { amountMinor: ils(620), direction: 'inflow' },
        verifiedAt: null,
      },
      {
        id: 'acc-card-1',
        name: 'כרטיס אשראי ראשי',
        scope: 'household',
        kind: 'credit_card',
        balance: { amountMinor: ils(12_800), direction: 'outflow' },
        verifiedAt: new Date(Date.parse(asOf) - 3 * 86_400_000).toISOString(),
      },
      {
        id: 'acc-card-2',
        name: 'כרטיס אשראי משני',
        scope: 'household',
        kind: 'credit_card',
        balance: { amountMinor: ils(6_400), direction: 'outflow' },
        verifiedAt: new Date(Date.parse(asOf) - 11 * 86_400_000).toISOString(),
      },
      {
        id: 'acc-business',
        name: 'חשבון העסק',
        scope: 'business',
        kind: 'bank_account',
        balance: { amountMinor: ils(22_300), direction: 'inflow' },
        verifiedAt: new Date(Date.parse(asOf) - 1 * 86_400_000).toISOString(),
      },
    ],

    plannedItems: [
      {
        id: 'salary-a',
        label: 'משכורת ראשונה',
        scope: 'household',
        direction: 'inflow',
        amountMinor: ils(8_900),
        certainty: 'certain',
        expectedDate: dayThisMonth(asOf, 28),
        dueDate: null,
        essential: false,
      },
      {
        id: 'salary-b',
        label: 'משכורת שנייה',
        scope: 'household',
        direction: 'inflow',
        amountMinor: ils(4_600),
        certainty: 'certain',
        expectedDate: dayThisMonth(asOf, 10),
        dueDate: null,
        essential: false,
      },
      {
        id: 'child-allowance',
        label: 'קצבת ילדים',
        scope: 'household',
        direction: 'inflow',
        amountMinor: ils(2_730),
        certainty: 'certain',
        expectedDate: dayThisMonth(asOf, 20),
        dueDate: null,
        essential: false,
      },
      {
        id: 'business-receipt',
        label: 'תקבול מלקוח',
        scope: 'household',
        direction: 'inflow',
        amountMinor: ils(9_500),
        certainty: 'probable',
        expectedDate: dayThisMonth(asOf, 24),
        dueDate: null,
        essential: false,
      },
      {
        id: 'groceries',
        label: 'מזון לחודש',
        scope: 'household',
        direction: 'outflow',
        amountMinor: ils(6_200),
        certainty: 'certain',
        expectedDate: dayThisMonth(asOf, 12),
        dueDate: dayThisMonth(asOf, 12),
        essential: true,
      },
      {
        id: 'school',
        label: 'חינוך וצהרונים',
        scope: 'household',
        direction: 'outflow',
        amountMinor: ils(3_100),
        certainty: 'certain',
        expectedDate: dayThisMonth(asOf, 8),
        dueDate: dayThisMonth(asOf, 8),
        essential: true,
      },
      {
        id: 'utilities',
        label: 'חשמל ומים',
        scope: 'household',
        direction: 'outflow',
        amountMinor: ils(1_450),
        certainty: 'certain',
        expectedDate: dayThisMonth(asOf, 18),
        dueDate: dayThisMonth(asOf, 18),
        essential: true,
      },
      {
        id: 'fuel',
        label: 'דלק ונסיעות',
        scope: 'household',
        direction: 'outflow',
        amountMinor: ils(1_200),
        certainty: 'probable',
        expectedDate: dayThisMonth(asOf, 15),
        dueDate: null,
        essential: true,
      },
      {
        id: 'insurance',
        label: 'ביטוח',
        scope: 'household',
        direction: 'outflow',
        amountMinor: ils(890),
        certainty: 'certain',
        expectedDate: dayThisMonth(asOf, 22),
        dueDate: dayThisMonth(asOf, 22),
        essential: false,
      },
    ],

    debts: [
      {
        id: 'debt-revolving',
        creditorName: 'אשראי מתגלגל',
        kind: 'revolving_credit',
        status: 'active',
        minimumPaymentMinor: ils(2_400),
        paymentDueDay: 2,
        effectiveAnnualRateBp: 1_690,
        urgency: 'watch',
        expectedCallDate: null,
      },
      {
        id: 'debt-loan-a',
        creditorName: 'הלוואה בנקאית א',
        kind: 'bank_loan',
        status: 'active',
        minimumPaymentMinor: ils(1_850),
        paymentDueDay: 10,
        effectiveAnnualRateBp: 940,
        urgency: 'none',
        expectedCallDate: null,
      },
      {
        id: 'debt-loan-b',
        creditorName: 'הלוואה בנקאית ב',
        kind: 'bank_loan',
        status: 'active',
        minimumPaymentMinor: ils(1_240),
        paymentDueDay: 15,
        effectiveAnnualRateBp: 780,
        urgency: 'none',
        expectedCallDate: null,
      },
      {
        id: 'debt-loan-c',
        creditorName: 'הלוואה חוץ־בנקאית',
        kind: 'bank_loan',
        status: 'active',
        minimumPaymentMinor: ils(900),
        paymentDueDay: 20,
        // Deliberately unknown: the screens must show "לא ידוע" rather than 0%.
        effectiveAnnualRateBp: null,
        urgency: 'none',
        expectedCallDate: null,
      },
      {
        id: 'debt-moshe',
        creditorName: 'משה',
        kind: 'private_person',
        status: 'active',
        minimumPaymentMinor: null,
        paymentDueDay: null,
        effectiveAnnualRateBp: null,
        urgency: 'demanded',
        expectedCallDate: null,
      },
      {
        id: 'debt-israel',
        creditorName: 'ישראל',
        kind: 'private_person',
        status: 'active',
        minimumPaymentMinor: null,
        paymentDueDay: null,
        effectiveAnnualRateBp: null,
        urgency: 'watch',
        expectedCallDate: dayThisMonth(asOf, 28),
      },
      {
        id: 'debt-institution',
        creditorName: 'גוף ציבורי',
        kind: 'institution',
        status: 'active',
        minimumPaymentMinor: ils(600),
        paymentDueDay: 25,
        effectiveAnnualRateBp: 0,
        urgency: 'none',
        expectedCallDate: null,
      },
      {
        id: 'debt-mortgage',
        creditorName: 'משכנתה',
        kind: 'mortgage',
        status: 'active',
        minimumPaymentMinor: ils(8_600),
        paymentDueDay: 5,
        effectiveAnnualRateBp: 470,
        urgency: 'none',
        expectedCallDate: null,
      },
    ],

    debtEvents: [
      {
        id: 'ev-rev-open',
        debtId: 'debt-revolving',
        kind: 'opening_balance',
        amountMinor: ils(116_000),
        occurredOn: opened,
        correctionEffect: null,
      },
      {
        id: 'ev-rev-interest',
        debtId: 'debt-revolving',
        kind: 'interest_charge',
        amountMinor: ils(2_000),
        occurredOn: dayThisMonth(asOf, 3),
        correctionEffect: null,
      },
      {
        id: 'ev-a-open',
        debtId: 'debt-loan-a',
        kind: 'opening_balance',
        amountMinor: ils(98_350),
        occurredOn: opened,
        correctionEffect: null,
      },
      {
        id: 'ev-a-pay',
        debtId: 'debt-loan-a',
        kind: 'principal_payment',
        amountMinor: ils(1_850),
        occurredOn: dayThisMonth(asOf, 10),
        correctionEffect: null,
      },
      {
        id: 'ev-b-open',
        debtId: 'debt-loan-b',
        kind: 'opening_balance',
        amountMinor: ils(62_000),
        occurredOn: opened,
        correctionEffect: null,
      },
      {
        id: 'ev-c-open',
        debtId: 'debt-loan-c',
        kind: 'opening_balance',
        amountMinor: ils(46_000),
        occurredOn: opened,
        correctionEffect: null,
      },
      {
        id: 'ev-moshe-open',
        debtId: 'debt-moshe',
        kind: 'opening_balance',
        amountMinor: ils(50_000),
        occurredOn: opened,
        correctionEffect: null,
      },
      {
        id: 'ev-moshe-repay',
        debtId: 'debt-moshe',
        kind: 'principal_payment',
        amountMinor: ils(5_000),
        occurredOn: dayThisMonth(asOf, 6),
        correctionEffect: null,
      },
      {
        id: 'ev-israel-open',
        debtId: 'debt-israel',
        kind: 'opening_balance',
        amountMinor: ils(33_000),
        occurredOn: opened,
        correctionEffect: null,
      },
      {
        id: 'ev-israel-new',
        debtId: 'debt-israel',
        kind: 'new_principal',
        amountMinor: ils(5_000),
        occurredOn: dayThisMonth(asOf, 6),
        correctionEffect: null,
      },
      {
        id: 'ev-inst-open',
        debtId: 'debt-institution',
        kind: 'opening_balance',
        amountMinor: ils(22_000),
        occurredOn: opened,
        correctionEffect: null,
      },
      {
        id: 'ev-mort-open',
        debtId: 'debt-mortgage',
        kind: 'opening_balance',
        amountMinor: ils(1_395_000),
        occurredOn: opened,
        correctionEffect: null,
      },
    ],

    // The example from 02-FINANCIAL-RULES.md, made concrete: Moshe was repaid
    // 5,000 with 5,000 borrowed from Israel. Nothing was gained, and the debt
    // meter has to say so.
    rollovers: [
      {
        id: 'roll-moshe-israel',
        fromDebtId: 'debt-moshe',
        toDebtId: 'debt-israel',
        amountMinor: ils(5_000),
        occurredOn: dayThisMonth(asOf, 6),
        status: 'confirmed',
      },
    ],

    reserve: {
      manualFloorMinor: ils(6_000),
      incidentBufferMinor: ils(4_000),
      revolvingAvoidanceMinor: ils(3_500),
      protectedReservesMinor: 0,
    },

    business: {
      id: 'biz-1',
      name: 'העסק',
      receivedIncomeMinor: ils(41_000),
      approvedExpensesMinor: ils(26_500),
      paidExpensesMinor: ils(24_200),
      accruedTaxReserveMinor: ils(7_100),
      certainObligationsMinor: ils(5_400),
      operatingReserveMinor: ils(4_000),
      overduePayablesMinor: ils(2_300),
      cumulativeRealizedProfitMinor: ils(9_800),
    },

    // Nothing has been approved this month, so the household may not count a
    // single shekel of business money as income yet.
    approvedSafeTransferMinor: 0,

    debtBaseline: {
      asOf: `${asOf.slice(0, 7)}-01`,
      consumerDebtMinor: ils(427_350),
      totalDebtMinor: ils(1_822_350),
    },

    dataQuality: {
      unclassifiedCashMinor: ils(320),
      pendingApprovalCount: 7,
      recentTransactionCount: 84,
      transactionsMissingClassificationCount: 11,
      unresolvedReconciliationGapMinor: 0,
    },
  };
}

/**
 * A monthly budget for the same invented household.
 *
 * The figures are deliberately uncomfortable: food is running ahead of plan and
 * two categories are already past theirs. A demo where everything is on track
 * would show none of the screens that matter.
 */
export function demoBudgetInput(asOf: string = new Date().toISOString()): BudgetInput {
  const today = asOf.slice(0, 10);

  return {
    period: asOf.slice(0, 7),
    asOf: today,
    currency: 'ILS',
    dataAgeDays: 2,
    isFirstMonthDraft: false,
    lines: [
      {
        categoryId: 'cat-food',
        categoryKey: 'food',
        plannedMinor: ils(6_200),
        weeklyGuidance: true,
      },
      {
        categoryId: 'cat-housing',
        categoryKey: 'housing_and_bills',
        plannedMinor: ils(4_800),
        weeklyGuidance: false,
      },
      {
        categoryId: 'cat-transport',
        categoryKey: 'transport_and_fuel',
        plannedMinor: ils(1_450),
        weeklyGuidance: false,
      },
      {
        categoryId: 'cat-health',
        categoryKey: 'health',
        plannedMinor: ils(600),
        weeklyGuidance: false,
      },
      {
        categoryId: 'cat-education',
        categoryKey: 'education',
        plannedMinor: ils(3_100),
        weeklyGuidance: false,
      },
      {
        categoryId: 'cat-clothing',
        categoryKey: 'clothing',
        plannedMinor: ils(450),
        weeklyGuidance: false,
      },
      {
        categoryId: 'cat-celebrations',
        categoryKey: 'celebrations_and_gifts',
        plannedMinor: ils(500),
        weeklyGuidance: false,
      },
      {
        categoryId: 'cat-cash',
        categoryKey: 'cash_and_small',
        plannedMinor: ils(700),
        weeklyGuidance: false,
      },
      {
        categoryId: 'cat-holidays',
        categoryKey: 'holidays',
        plannedMinor: ils(400),
        weeklyGuidance: false,
      },
      {
        categoryId: 'cat-other',
        categoryKey: 'other',
        plannedMinor: ils(300),
        weeklyGuidance: false,
      },
    ],
    spend: [
      {
        categoryId: 'cat-food',
        approvedMinor: ils(3_180),
        pendingMinor: ils(240),
        committedMinor: 0,
      },
      {
        categoryId: 'cat-housing',
        approvedMinor: ils(1_900),
        pendingMinor: 0,
        committedMinor: ils(2_600),
      },
      {
        categoryId: 'cat-transport',
        approvedMinor: ils(980),
        pendingMinor: ils(120),
        committedMinor: 0,
      },
      { categoryId: 'cat-health', approvedMinor: ils(720), pendingMinor: 0, committedMinor: 0 },
      {
        categoryId: 'cat-education',
        approvedMinor: ils(3_100),
        pendingMinor: 0,
        committedMinor: 0,
      },
      {
        categoryId: 'cat-clothing',
        approvedMinor: ils(180),
        pendingMinor: 0,
        committedMinor: 0,
      },
      {
        categoryId: 'cat-celebrations',
        approvedMinor: ils(620),
        pendingMinor: 0,
        committedMinor: 0,
      },
      {
        categoryId: 'cat-cash',
        approvedMinor: ils(410),
        pendingMinor: ils(90),
        committedMinor: 0,
      },
      { categoryId: 'cat-holidays', approvedMinor: 0, pendingMinor: 0, committedMinor: 0 },
      { categoryId: 'cat-other', approvedMinor: ils(150), pendingMinor: 0, committedMinor: 0 },
    ],
  };
}

/**
 * The weekly food picture, taken from the same budget line.
 *
 * Includes one large stock-up shop, because that is the case a naive weekly
 * budget gets wrong: it looks like a disastrous week and is actually a full
 * cupboard.
 */
export function demoFoodInput(asOf: string = new Date().toISOString()): FoodWeekInput {
  return {
    asOf: asOf.slice(0, 10),
    monthlyPlannedMinor: ils(6_200),
    approvedThisMonthMinor: ils(3_180),
    pendingThisMonthMinor: ils(240),
    spentThisWeekMinor: ils(1_120),
    largePurchaseThisWeekMinor: ils(640),
    carryForwardEnabled: true,
    dataAgeDays: 2,
  };
}
