import type {
  AccountKind,
  BusinessDate,
  Certainty,
  Currency,
  DebtEventKind,
  DebtKind,
  DebtStatus,
  DebtUrgency,
  Direction,
  RecordScope,
} from '@family-finance/contracts';

import type { DirectedAmount } from './money';

/**
 * What the engine is given, and nothing more.
 *
 * 05-ARCHITECTURE-DATA.md keeps this package pure: no database, no network, no
 * clock of its own. `asOf` is passed in rather than read from the system clock,
 * because a calculation that cannot be replayed cannot be audited, and every
 * number this engine produces is attached to a snapshot someone may have to
 * reconstruct months later.
 */

/** A balance we hold (`inflow`) or owe (`outflow`) on one account. */
export interface AccountPosition {
  readonly id: string;
  readonly name: string;
  readonly scope: RecordScope;
  readonly kind: AccountKind;
  readonly balance: DirectedAmount;
  /**
   * When a person last confirmed this balance against the institution. `null`
   * means never — which is not the same as old, and is scored differently.
   */
  readonly verifiedAt: string | null;
}

/**
 * A future movement: what the forecast walks through.
 *
 * Only unsettled items are passed in. Once a planned item has been matched to a
 * real transaction it is history, and counting it again would charge the
 * household twice for the same bill.
 */
export interface PlannedItem {
  readonly id: string;
  readonly label: string;
  readonly scope: RecordScope;
  readonly direction: Direction;
  readonly amountMinor: number;
  readonly certainty: Certainty;
  readonly expectedDate: BusinessDate;
  readonly dueDate: BusinessDate | null;
  /** An essential need, or an obligation whose failure causes material harm. */
  readonly essential: boolean;
}

export interface DebtRecord {
  readonly id: string;
  readonly creditorName: string;
  readonly kind: DebtKind;
  readonly status: DebtStatus;
  readonly minimumPaymentMinor: number | null;
  readonly paymentDueDay: number | null;
  readonly effectiveAnnualRateBp: number | null;
  readonly urgency: DebtUrgency;
  /** A date a private lender may call the money in, when one was agreed. */
  readonly expectedCallDate: BusinessDate | null;
}

export interface DebtEventRecord {
  readonly id: string;
  readonly debtId: string;
  readonly kind: DebtEventKind;
  readonly amountMinor: number;
  readonly occurredOn: BusinessDate;
  readonly correctionEffect: 'increase' | 'decrease' | null;
}

/** A confirmed link saying that repaying one debt was funded by another. */
export interface RolloverLink {
  readonly id: string;
  readonly fromDebtId: string;
  readonly toDebtId: string;
  readonly amountMinor: number;
  readonly occurredOn: BusinessDate;
  readonly status: 'proposed' | 'confirmed' | 'rejected';
}

/**
 * Components of the minimum reserve floor.
 *
 * 02-FINANCIAL-RULES.md § רזרבה מינימלית forbids "three to six months" as a first
 * rule. The floor is the highest of these, and the engine reports which one won
 * so the user can see why the number is what it is.
 */
export interface ReserveInputs {
  readonly manualFloorMinor: number | null;
  readonly incidentBufferMinor: number | null;
  readonly revolvingAvoidanceMinor: number | null;
  /**
   * Money already earmarked for something else — a sinking fund, a held deposit.
   * It is not part of the floor; it is simply not available to spend.
   */
  readonly protectedReservesMinor: number;
}

export interface BusinessInputs {
  readonly id: string;
  readonly name: string;
  readonly receivedIncomeMinor: number;
  readonly approvedExpensesMinor: number;
  readonly paidExpensesMinor: number;
  readonly accruedTaxReserveMinor: number;
  readonly certainObligationsMinor: number;
  readonly operatingReserveMinor: number;
  readonly overduePayablesMinor: number;
  /** Realized profit accumulated over previous periods and not yet transferred. */
  readonly cumulativeRealizedProfitMinor: number;
}

/** Where debt stood at the start of the period the trend is measured over. */
export interface DebtBaseline {
  readonly asOf: BusinessDate;
  readonly consumerDebtMinor: number;
  readonly totalDebtMinor: number;
}

/** Facts about data completeness that the engine cannot derive on its own. */
export interface DataQualityInputs {
  readonly unclassifiedCashMinor: number;
  readonly pendingApprovalCount: number;
  readonly recentTransactionCount: number;
  readonly transactionsMissingClassificationCount: number;
  /** Reconciliation differences that are still unexplained. */
  readonly unresolvedReconciliationGapMinor: number;
}

export interface EngineInput {
  /** The instant the snapshot is taken, in UTC. */
  readonly asOf: string;
  readonly timeZone: string;
  readonly currency: Currency;
  readonly accounts: readonly AccountPosition[];
  readonly plannedItems: readonly PlannedItem[];
  readonly debts: readonly DebtRecord[];
  readonly debtEvents: readonly DebtEventRecord[];
  readonly rollovers: readonly RolloverLink[];
  readonly reserve: ReserveInputs;
  readonly business: BusinessInputs | null;
  /**
   * A business-to-household transfer that has already been approved. Only an
   * approved transfer may appear in reliable household income
   * (02-FINANCIAL-RULES.md § נוסחאות).
   */
  readonly approvedSafeTransferMinor: number;
  readonly debtBaseline: DebtBaseline | null;
  readonly dataQuality: DataQualityInputs;
}

/**
 * One line of a breakdown: what went into a number, and which way it pulled.
 *
 * There is deliberately no label. The key is the contract; the words belong to
 * the copy layer, which is where they can be reviewed as product language.
 */
export interface BreakdownLine {
  readonly key: string;
  readonly amountMinor: number;
  readonly effect: 'adds' | 'subtracts' | 'informational';
}

export type DecisionStatus = 'safe' | 'conditional' | 'not_safe' | 'insufficient_data';
