import {
  buildFinancialSnapshot,
  type EngineInput,
  type FinancialSnapshot,
} from '@family-finance/finance-engine';

import { loadDashboardSource, type DataSourceDescriptor } from './source';

/**
 * The one entry point every screen uses.
 *
 * Screens do not compute. They read a snapshot the engine produced and render it.
 * 05-ARCHITECTURE-DATA.md keeps the domain in `packages/finance-engine`, and the
 * practical reason is visible here: if a page could add two numbers together, the
 * dashboard and the engine would eventually disagree about what "safe" means.
 *
 * When there is no data source the result carries a null snapshot. Callers render
 * the empty state; nobody substitutes zeros.
 */
export interface DashboardView {
  readonly descriptor: DataSourceDescriptor;
  readonly snapshot: FinancialSnapshot | null;
  /**
   * The facts the snapshot was computed from. Carried so a screen can list the
   * accounts behind a balance without recomputing anything from them.
   */
  readonly input: EngineInput | null;
}

export async function loadDashboardView(): Promise<DashboardView> {
  const { descriptor, input } = await loadDashboardSource();
  return {
    descriptor,
    input,
    snapshot: input === null ? null : buildFinancialSnapshot(input),
  };
}
