import 'server-only';

import {
  interpretQuickUpdate,
  type InterpretContext,
  type QuickAccountHint,
  type QuickProposal,
} from '@family-finance/quick-update';
import { todayInIsrael } from '@family-finance/hebrew-calendar';
import type { StoreDocument } from '@family-finance/local-store';

import { householdStore } from '../store/server';

/**
 * Reading a family's sentence, on the server, against their own facts.
 *
 * The interpretation itself is pure and lives in `@family-finance/quick-update`.
 * This file does the two things a pure module must not: it reads the household
 * document, and it asks what day it is.
 *
 * Both of those are the reason the sentence never leaves the machine. There is
 * no client here, no fetch and no key: the whole reading happens between the
 * browser that typed it and the server that already holds the family's money.
 */

/** The household's own facts, as the reader needs to see them. */
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

export interface QuickReading {
  readonly text: string;
  readonly proposals: readonly QuickProposal[];
  /** The accounts a person can choose from when the sentence did not say. */
  readonly accounts: readonly QuickAccountHint[];
  /** The debts a person can choose from when a repayment named none. */
  readonly debts: readonly { readonly id: string; readonly creditorName: string }[];
}

/**
 * The reading of one utterance.
 *
 * Called both when the screen first shows what it understood and again when a
 * person presses approve. The second call is not a cache miss: an approval
 * arrives from a browser, and a browser is not where this product decides what
 * a sentence meant.
 */
export async function readQuickUpdate(text: string): Promise<QuickReading> {
  const document = await (await householdStore()).readDocument();
  const today = todayInIsrael();
  const context = contextFromDocument(document, today);

  return {
    text,
    proposals: interpretQuickUpdate(text, context),
    accounts: context.accounts.filter((account) => account.status === 'open'),
    debts: document.debts
      .filter((debt) => debt.status === 'active')
      .map((debt) => ({ id: debt.id, creditorName: debt.creditorName })),
  };
}
