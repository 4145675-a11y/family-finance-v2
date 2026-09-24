import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { replayDebtBalances } from '@family-finance/finance-engine';
import type { StoreDocument } from '@family-finance/local-store';

import { readRunState } from './run-state';

/**
 * What the server actually wrote, read from disk.
 *
 * This is the part that makes a browser test evidence rather than a screenshot.
 * A screen can say "נרשם" because a component decided to; the only way to know a
 * record exists is to read the document the server persisted and count.
 *
 * Read-only, and only ever the file this run created. Nothing here writes, so a
 * spec cannot arrange the state it is about to assert on.
 */

export function storedDocument(): StoreDocument {
  const { dataDirectory } = readRunState();
  const raw = readFileSync(join(dataDirectory, 'household.json'), 'utf8');
  return JSON.parse(raw) as StoreDocument;
}

/** Transactions whose merchant is exactly this, in the persisted document. */
export function transactionsFor(merchant: string): StoreDocument['transactions'] {
  return storedDocument().transactions.filter((row) => row.merchant === merchant);
}

/** Every debt event recorded against one debt. */
export function eventsFor(debtId: string): StoreDocument['debtEvents'] {
  return storedDocument().debtEvents.filter((event) => event.debtId === debtId);
}

/**
 * A debt's balance, from the one engine that computes it.
 *
 * Deliberately the same function the product calls (M1). A test that added the
 * events up itself would be a second calculation, and the thing it would fail to
 * notice is precisely the thing M1 exists to prevent.
 */
export function balanceOf(debtId: string, asOf = '2026-12-31'): number {
  return replayDebtBalances(storedDocument().debtEvents, asOf).get(debtId) ?? 0;
}

/** The id of the debt whose creditor is named this. */
export function debtIdByName(creditorName: string): string {
  const debt = storedDocument().debts.find((row) => row.creditorName === creditorName);
  if (debt === undefined) throw new Error(`no seeded debt named ${creditorName}`);
  return debt.id;
}

/**
 * What an account's balance should be, worked out from the document directly.
 *
 * A deliberate second opinion: the product reaches its figure through the
 * engine's snapshot, and a test that called the same function would agree with a
 * bug as readily as with correct behaviour. Summing the rows here is crude and
 * that is the point — if the screen and this disagree, one of them is wrong and
 * the test says so.
 */
export function accountBalanceMinor(accountId: string): number {
  const document = storedDocument();
  const account = document.accounts.find((row) => row.id === accountId);
  if (account === undefined) throw new Error('no seeded account');
  let total =
    account.openingBalanceDirection === 'inflow'
      ? account.openingBalanceMinor
      : -account.openingBalanceMinor;
  for (const row of document.transactions) {
    if (row.status !== 'confirmed') continue;
    if (row.accountId === accountId) {
      total += row.direction === 'inflow' ? row.amountMinor : -row.amountMinor;
    }
    if (row.counterpartAccountId === accountId) {
      total += row.direction === 'inflow' ? -row.amountMinor : row.amountMinor;
    }
  }
  return total;
}

/**
 * The figure as the screens print it.
 *
 * The application's own formatter, on purpose. The amount is what this suite
 * verifies independently; how many digits and which gap character it is printed
 * with is a presentation decision that already has its own unit tests, and
 * re-implementing it here would only produce a second thing to keep in step.
 */
export { formatMoney as asShekels } from '../../apps/web/lib/format';
