import { assertSigned, assertStoredAmount } from './money';

/**
 * `FIN-WATERFALL-001` — the order every free shekel is allocated in.
 *
 * The order is not a preference and it is not configurable. It is the difference
 * between a household that keeps the lights on and one that pays down an
 * expensive loan while missing a mortgage payment. 02-FINANCIAL-RULES.md fixes
 * all ten steps; this module only applies them.
 *
 * The important structural property is that allocation is strictly sequential.
 * Because the minimal operating reserve is step 5 and accelerated repayment is
 * step 7, the rule "no accelerated repayment that drops the reserve below its
 * floor" is a consequence of the ordering rather than a separate check that
 * someone could forget to run.
 */

export const WATERFALL_STEPS = [
  { step: 1, key: 'essential_needs', label: 'צרכים חיוניים עד סוף החודש' },
  { step: 2, key: 'mortgage_and_material', label: 'משכנתה והתחייבויות שאי־תשלומן מזיק' },
  { step: 3, key: 'taxes_and_held_funds', label: 'מסים וכספים שאינם שייכים למשפחה' },
  { step: 4, key: 'debt_minimums', label: 'תשלומי מינימום לכל החובות' },
  { step: 5, key: 'operating_reserve', label: 'רזרבה תפעולית מינימלית' },
  { step: 6, key: 'legal_or_urgent_debt', label: 'חוב בסיכון משפטי או דרישה דחופה' },
  { step: 7, key: 'expensive_debt', label: 'חוב יקר לפי עלות אפקטיבית' },
  { step: 8, key: 'sinking_funds', label: 'קרנות להוצאות מחזוריות קרובות' },
  { step: 9, key: 'buffer_growth', label: 'הרחבת כרית הביטחון' },
  { step: 10, key: 'long_term_goals', label: 'מטרות ארוכות טווח' },
] as const;

export type WaterfallStepKey = (typeof WATERFALL_STEPS)[number]['key'];

/** How much each step is asking for. A step with nothing to claim asks for zero. */
export type WaterfallClaims = Readonly<Record<WaterfallStepKey, number>>;

export interface WaterfallAllocation {
  readonly step: number;
  readonly key: WaterfallStepKey;
  readonly label: string;
  readonly claimedMinor: number;
  readonly allocatedMinor: number;
  readonly unfundedMinor: number;
}

export interface WaterfallResult {
  readonly availableMinor: number;
  readonly allocations: readonly WaterfallAllocation[];
  readonly remainingMinor: number;
  /** The first step that could not be paid in full, or null when all are covered. */
  readonly firstUnfundedStep: number | null;
  /**
   * True only when steps 1–5 are fully funded. Below that line an extra debt
   * payment is not "getting ahead", it is borrowing from next month's essentials.
   */
  readonly acceleratedRepaymentAllowed: boolean;
}

/**
 * Distributes available money across the ten steps, in order.
 *
 * Never allocates more than is available, and never skips a step to fund a later
 * one — that is the whole point of the sequence.
 */
export function allocateWaterfall(
  availableMinor: number,
  claims: WaterfallClaims,
): WaterfallResult {
  assertStoredAmount(availableMinor, 'available');

  let remaining = availableMinor;
  let firstUnfundedStep: number | null = null;

  const allocations = WATERFALL_STEPS.map(({ step, key, label }) => {
    const claimedMinor = assertStoredAmount(claims[key], `claim for ${key}`);
    const allocatedMinor = Math.min(claimedMinor, remaining);
    remaining = assertSigned(remaining - allocatedMinor);
    const unfundedMinor = claimedMinor - allocatedMinor;

    if (unfundedMinor > 0 && firstUnfundedStep === null) firstUnfundedStep = step;

    return { step, key, label, claimedMinor, allocatedMinor, unfundedMinor };
  });

  const throughStepFive = allocations.filter((allocation) => allocation.step <= 5);
  const acceleratedRepaymentAllowed = throughStepFive.every(
    (allocation) => allocation.unfundedMinor === 0,
  );

  return {
    availableMinor,
    allocations,
    remainingMinor: remaining,
    firstUnfundedStep,
    acceleratedRepaymentAllowed,
  };
}

/** An empty claim set, so a caller fills only the steps it has data for. */
export function noClaims(): WaterfallClaims {
  return {
    essential_needs: 0,
    mortgage_and_material: 0,
    taxes_and_held_funds: 0,
    debt_minimums: 0,
    operating_reserve: 0,
    legal_or_urgent_debt: 0,
    expensive_debt: 0,
    sinking_funds: 0,
    buffer_growth: 0,
    long_term_goals: 0,
  };
}
