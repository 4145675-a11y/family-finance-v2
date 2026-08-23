import { z } from 'zod';

import { timestampSchema, uuidSchema, versionSchema } from './identity';
import {
  amountMinorSchema,
  businessDateSchema,
  certaintySchema,
  currencySchema,
  directionSchema,
  recordScopeSchema,
} from './money';

/**
 * Milestone 3 — accounts, balances and the opening picture.
 *
 * These shapes answer "what do we actually hold, and what is already committed",
 * which every later calculation depends on. 01-PRODUCT-SPEC.md § Must calls this
 * the opening picture: accounts, cards, cash, business, balances, future items.
 */

/**
 * What kind of instrument an account is.
 *
 * The distinction that matters to the engine is not the bank's product name but
 * whether the balance is money we hold (`bank_account`, `cash_wallet`) or money we
 * owe (`credit_card`). A credit card balance is a liability that lives in the
 * account list because that is where transactions land; it is never liquidity.
 */
export const accountKindSchema = z.enum([
  'bank_account',
  'credit_card',
  'cash_wallet',
  'other',
]);
export type AccountKind = z.infer<typeof accountKindSchema>;

/** Account kinds whose balance may ever be treated as spendable cash. */
export const LIQUID_ACCOUNT_KINDS: readonly AccountKind[] = ['bank_account', 'cash_wallet'];

export const businessSchema = z.object({
  id: uuidSchema,
  householdId: uuidSchema,
  name: z.string().trim().min(1).max(120),
  /** Reserve applied to received income, in basis points (2500 = 25%). */
  taxReserveRateBp: z.number().int().min(0).max(10_000),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  version: versionSchema,
});
export type Business = z.infer<typeof businessSchema>;

export const financialAccountSchema = z.object({
  id: uuidSchema,
  householdId: uuidSchema,
  /** Set only for business-scoped accounts; household accounts carry null. */
  businessId: uuidSchema.nullable(),
  scope: recordScopeSchema,
  kind: accountKindSchema,
  name: z.string().trim().min(1).max(120),
  institution: z.string().trim().max(120).nullable(),
  currency: currencySchema,
  /**
   * Last four digits only. 07-SECURITY-PRIVACY.md forbids a full card number
   * anywhere, audit images included.
   */
  displaySuffix: z
    .string()
    .regex(/^[0-9]{4}$/)
    .nullable(),
  /**
   * Opening balance as declared during onboarding, with the direction that gives
   * it meaning: `inflow` is money held, `outflow` is money owed (overdraft, card).
   */
  openingBalanceMinor: amountMinorSchema,
  openingBalanceDirection: directionSchema,
  openingBalanceDate: businessDateSchema,
  closedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  version: versionSchema,
});
export type FinancialAccount = z.infer<typeof financialAccountSchema>;

/**
 * A balance the user confirmed against the real institution at a point in time.
 *
 * 05-ARCHITECTURE-DATA.md § Reconciliation: the computed balance is compared to a
 * verified snapshot, and a gap is never silently absorbed. Dashboard freshness is
 * computed from `verifiedAt`.
 */
export const accountBalanceSnapshotSchema = z.object({
  id: uuidSchema,
  householdId: uuidSchema,
  accountId: uuidSchema,
  balanceMinor: amountMinorSchema,
  balanceDirection: directionSchema,
  verifiedAt: timestampSchema,
  source: z.enum(['manual_entry', 'statement', 'import']),
  note: z.string().trim().max(280).nullable(),
  createdBy: uuidSchema,
  createdAt: timestampSchema,
});
export type AccountBalanceSnapshot = z.infer<typeof accountBalanceSnapshotSchema>;

export const categorySchema = z.object({
  id: uuidSchema,
  householdId: uuidSchema,
  name: z.string().trim().min(1).max(80),
  scope: recordScopeSchema,
  /**
   * Essential needs are the first claim in the allocation waterfall
   * (02-FINANCIAL-RULES.md § מפל הקצאת כסף, step 1), so the flag belongs to the
   * category rather than to a heuristic applied later.
   */
  essential: z.boolean(),
  archivedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  version: versionSchema,
});
export type Category = z.infer<typeof categorySchema>;

/**
 * What a transaction represents.
 *
 * `transfer` and `settlement` are first-class kinds because both are net zero in
 * the consolidated view and must never be counted as household spending
 * (02-FINANCIAL-RULES.md § Scopes ותנועות).
 */
export const transactionKindSchema = z.enum([
  'expense',
  'income',
  'transfer',
  'settlement',
  'refund',
  'correction',
]);
export type TransactionKind = z.infer<typeof transactionKindSchema>;

/**
 * Lifecycle of a transaction.
 *
 * `draft` is never truth (CLAUDE.md) and `void` is never counted. Neither state is
 * ever reached by deleting: money records are voided or corrected so history stays.
 */
export const transactionStatusSchema = z.enum(['draft', 'confirmed', 'reconciled', 'void']);
export type TransactionStatus = z.infer<typeof transactionStatusSchema>;

const transferKinds: readonly TransactionKind[] = ['transfer', 'settlement'];

export const transactionSchema = z
  .object({
    id: uuidSchema,
    householdId: uuidSchema,
    accountId: uuidSchema,
    /** Destination account for `transfer` and `settlement`; null otherwise. */
    counterpartAccountId: uuidSchema.nullable(),
    scope: recordScopeSchema,
    kind: transactionKindSchema,
    direction: directionSchema,
    amountMinor: amountMinorSchema,
    currency: currencySchema,
    status: transactionStatusSchema,
    categoryId: uuidSchema.nullable(),
    merchant: z.string().trim().max(160).nullable(),
    /** The date roles stay apart, per 02-FINANCIAL-RULES.md § מוסכמות. */
    transactionDate: businessDateSchema,
    postingDate: businessDateSchema.nullable(),
    valueDate: businessDateSchema.nullable(),
    /** Set on a refund; points at the transaction being refunded. */
    refundsTransactionId: uuidSchema.nullable(),
    /** Set on a correction; points at the transaction being corrected. */
    correctsTransactionId: uuidSchema.nullable(),
    note: z.string().trim().max(500).nullable(),
    createdBy: uuidSchema,
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    version: versionSchema,
  })
  .refine(
    (tx) =>
      transferKinds.includes(tx.kind)
        ? tx.counterpartAccountId !== null
        : tx.counterpartAccountId === null,
    {
      message: 'transfer and settlement need a counterpart account; other kinds forbid one',
      path: ['counterpartAccountId'],
    },
  )
  .refine((tx) => tx.counterpartAccountId !== tx.accountId, {
    message: 'a transfer cannot have the same account on both sides',
    path: ['counterpartAccountId'],
  })
  .refine((tx) => (tx.kind === 'refund') === (tx.refundsTransactionId !== null), {
    message: 'a refund must link to the transaction it reverses, and only a refund may',
    path: ['refundsTransactionId'],
  });
export type Transaction = z.infer<typeof transactionSchema>;

export const transactionSplitSchema = z.object({
  id: uuidSchema,
  householdId: uuidSchema,
  transactionId: uuidSchema,
  categoryId: uuidSchema.nullable(),
  scope: recordScopeSchema,
  amountMinor: amountMinorSchema,
  note: z.string().trim().max(280).nullable(),
  createdAt: timestampSchema,
});
export type TransactionSplit = z.infer<typeof transactionSplitSchema>;

/**
 * A future inflow or outflow that has not happened yet.
 *
 * This is what makes a forecast possible, and it is where certainty and liquidity
 * are most often confused. `certainty` says how sure we are the event happens; it
 * says nothing about whether the money is available today.
 */
export const cashflowItemSchema = z.object({
  id: uuidSchema,
  householdId: uuidSchema,
  scope: recordScopeSchema,
  accountId: uuidSchema.nullable(),
  direction: directionSchema,
  amountMinor: amountMinorSchema,
  currency: currencySchema,
  label: z.string().trim().min(1).max(160),
  categoryId: uuidSchema.nullable(),
  certainty: certaintySchema,
  /** When we expect it to move. */
  expectedDate: businessDateSchema,
  /** When failing to pay causes damage. Null when nothing is contractually due. */
  dueDate: businessDateSchema.nullable(),
  /** An essential need, or an obligation whose failure causes material harm. */
  essential: z.boolean(),
  settledTransactionId: uuidSchema.nullable(),
  createdBy: uuidSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  version: versionSchema,
});
export type CashflowItem = z.infer<typeof cashflowItemSchema>;

export const createFinancialAccountInputSchema = z.object({
  householdId: uuidSchema,
  businessId: uuidSchema.nullable(),
  scope: recordScopeSchema,
  kind: accountKindSchema,
  name: z.string().trim().min(1).max(120),
  institution: z.string().trim().max(120).nullable(),
  currency: currencySchema,
  displaySuffix: z
    .string()
    .regex(/^[0-9]{4}$/)
    .nullable(),
  openingBalanceMinor: amountMinorSchema,
  openingBalanceDirection: directionSchema,
  openingBalanceDate: businessDateSchema,
});
export type CreateFinancialAccountInput = z.infer<typeof createFinancialAccountInputSchema>;

export const recordBalanceSnapshotInputSchema = z.object({
  accountId: uuidSchema,
  balanceMinor: amountMinorSchema,
  balanceDirection: directionSchema,
  verifiedAt: timestampSchema,
  source: z.enum(['manual_entry', 'statement', 'import']),
  note: z.string().trim().max(280).nullable(),
});
export type RecordBalanceSnapshotInput = z.infer<typeof recordBalanceSnapshotInputSchema>;

/**
 * Splits must sum exactly to the transaction amount
 * (02-FINANCIAL-RULES.md § אינווריאנטים: "splits שווים למקור").
 */
export const createTransactionInputSchema = z
  .object({
    householdId: uuidSchema,
    accountId: uuidSchema,
    counterpartAccountId: uuidSchema.nullable(),
    scope: recordScopeSchema,
    kind: transactionKindSchema,
    direction: directionSchema,
    amountMinor: amountMinorSchema,
    currency: currencySchema,
    categoryId: uuidSchema.nullable(),
    merchant: z.string().trim().max(160).nullable(),
    transactionDate: businessDateSchema,
    note: z.string().trim().max(500).nullable(),
    splits: z.array(
      z.object({
        categoryId: uuidSchema.nullable(),
        scope: recordScopeSchema,
        amountMinor: amountMinorSchema,
        note: z.string().trim().max(280).nullable(),
      }),
    ),
  })
  .refine(
    (input) =>
      input.splits.length === 0 ||
      input.splits.reduce((total, split) => total + split.amountMinor, 0) === input.amountMinor,
    { message: 'splits must sum exactly to the transaction amount', path: ['splits'] },
  );
export type CreateTransactionInput = z.infer<typeof createTransactionInputSchema>;
