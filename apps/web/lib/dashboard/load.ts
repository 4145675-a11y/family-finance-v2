import 'server-only';

import {
  buildFinancialSnapshot,
  calculateBudget,
  calculateFoodWeek,
  type BudgetResult,
  type EngineInput,
  type FinancialSnapshot,
  type FoodWeekGuidance,
} from '@family-finance/finance-engine';
import type { StoreDocument } from '@family-finance/local-store';

import { householdStore } from '../store/server';
import {
  currentEnvironment,
  loadDashboardSource,
  resolveDataSource,
  type DataSourceDescriptor,
} from './source';

/**
 * The one entry point every screen uses.
 *
 * Screens do not compute. They read what the engine produced and render it.
 * 05-ARCHITECTURE-DATA.md keeps the domain in `packages/finance-engine`, and the
 * practical reason is visible here: if a page could add two numbers together, the
 * dashboard and the engine would eventually disagree about what "safe" means.
 *
 * When there is no data source everything is null. Callers render the empty
 * state; nobody substitutes zeros.
 */
export interface DashboardView {
  readonly descriptor: DataSourceDescriptor;
  readonly snapshot: FinancialSnapshot | null;
  /**
   * The facts the snapshot was computed from. Carried so a screen can list the
   * accounts behind a balance without recomputing anything from them.
   */
  readonly input: EngineInput | null;
  readonly budget: BudgetResult | null;
  readonly food: FoodWeekGuidance | null;
  /**
   * The stored records, when the source is the household's own store.
   *
   * Screens use it for things the engine has no opinion about — the list of
   * imports, the tasks, the audit trail — and never to recompute a figure the
   * snapshot already carries.
   */
  readonly document: StoreDocument | null;
  readonly periodStart: string | null;
  readonly periodEnd: string | null;
  readonly asOf: string;
}

export async function loadDashboardView(
  asOf = new Date().toISOString(),
): Promise<DashboardView> {
  const store = householdStore();
  const view = await store.view(asOf);

  if (view !== null) {
    return {
      descriptor: resolveDataSource(currentEnvironment(true)),
      snapshot: view.snapshot,
      input: view.input,
      budget: view.budget,
      food: view.food,
      document: view.document,
      periodStart: view.periodStart,
      periodEnd: view.periodEnd,
      asOf,
    };
  }

  const { descriptor, input, budget, food } = await loadDashboardSource(
    currentEnvironment(false),
  );

  return {
    descriptor,
    input,
    snapshot: input === null ? null : buildFinancialSnapshot(input),
    budget: budget === null ? null : calculateBudget(budget),
    food: food === null ? null : calculateFoodWeek(food),
    document: null,
    periodStart: null,
    periodEnd: null,
    asOf,
  };
}

/** True when a household exists on this machine. */
export async function householdExists(): Promise<boolean> {
  return householdStore().exists();
}
