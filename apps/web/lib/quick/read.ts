import 'server-only';

import type { InterpretContext, QuickAccountHint } from '@family-finance/quick-update';
import type { StoreDocument } from '@family-finance/local-store';

/**
 * The household's own facts, in the shape the rule reader needs them.
 *
 * The interpretation itself is pure and lives in `@family-finance/quick-update`.
 * All this does is translate a stored document into that module's context, which
 * is the one thing a pure module cannot do for itself.
 */
export function contextFromDocument(document: StoreDocument, today: string): InterpretContext {
  const accounts: readonly QuickAccountHint[] = document.accounts.map((account) => ({
    id: account.id,
    name: account.name,
    scope: account.scope,
    kind: account.kind,
    status: account.closedAt === null ? 'open' : 'closed',
  }));

  return {
    today,
    accounts,
    debts: document.debts.map((debt) => ({
      id: debt.id,
      creditorName: debt.creditorName,
      status: debt.status,
    })),
    householdRules: document.learnedRules,
  };
}
