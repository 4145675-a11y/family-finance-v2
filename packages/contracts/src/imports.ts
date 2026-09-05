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
import { accountKindSchema } from './accounts';
import { budgetCategoryKeySchema } from './budget';
import { debtKindSchema } from './debt';

/**
 * Document import — the staging model.
 *
 * The rule this whole file exists to enforce is one sentence from CLAUDE.md:
 * "draft לא truth". A spreadsheet a bank produced is a claim about the family's
 * money, not the money itself. Until a person has looked at a proposed row and
 * said yes, it may not move a single balance, budget, debt or forecast.
 *
 * So the shapes here are deliberately *not* the domain shapes. An import batch
 * holds `ImportProposal` rows — each one carrying, side by side and separately:
 *
 *   - `raw`, exactly what the file said, as text;
 *   - `proposed`, what the parser believes that text means;
 *   - `correction`, what the reviewer changed it to;
 *   - `reviewState`, whether it is in or out;
 *   - the sheet, page and row it came from, so any number can be traced back.
 *
 * Nothing merges those four. A reviewer must always be able to see what the file
 * said, what we read it as, and what they decided — 05-ARCHITECTURE-DATA.md
 * § Imports and `IMP-DRAFT-001`.
 */

/** File formats the importer will open. Anything else is refused by name. */
export const importFileKindSchema = z.enum(['xlsx', 'csv', 'pdf']);
export type ImportFileKind = z.infer<typeof importFileKindSchema>;

/**
 * What the file appears to be.
 *
 * Detection is a hint that steers the review, never a fact that skips it.
 * `unrecognised` is a first-class answer: a table we cannot name is still a table
 * a person can map by hand.
 */
export const documentTypeSchema = z.enum([
  'bank_statement',
  'credit_card_statement',
  'loan_schedule',
  'mortgage_schedule',
  'private_debt_list',
  'household_income_expense',
  'business_income_expense',
  'balance_summary',
  'budget_file',
  'general_table',
  'unrecognised',
]);
export type DocumentType = z.infer<typeof documentTypeSchema>;

/**
 * Where a batch is in its life.
 *
 * `failed` is separated from `rejected`: one is the software not managing to read
 * the file, the other is a person deciding the contents should not be used. They
 * mean different things to a reader of the import history.
 */
export const importBatchStatusSchema = z.enum([
  'extracting',
  'needs_review',
  'approved',
  'rejected',
  'failed',
  'reversed',
]);
export type ImportBatchStatus = z.infer<typeof importBatchStatusSchema>;

/** What a single proposed row would become if approved. */
export const proposalKindSchema = z.enum([
  'account',
  'transaction',
  'balance',
  'debt',
  'debt_payment',
  'planned_item',
  'budget_line',
]);
export type ProposalKind = z.infer<typeof proposalKindSchema>;

/**
 * The reviewer's decision on one row.
 *
 * `pending` is the only state a row can be created in, and a batch cannot be
 * approved while any row is still `pending`: silence is not consent.
 */
export const reviewStateSchema = z.enum(['pending', 'included', 'excluded']);
export type ReviewState = z.infer<typeof reviewStateSchema>;

/**
 * How much the row looks like something already recorded.
 *
 * Never acted on automatically. 02-FINANCIAL-RULES.md § אינווריאנטים requires that
 * a repeated import not double a record; it does not permit us to delete or merge
 * on a guess, so an uncertain match is shown and left to the reviewer.
 */
export const duplicateVerdictSchema = z.enum(['new', 'possible_duplicate', 'likely_duplicate']);
export type DuplicateVerdict = z.infer<typeof duplicateVerdictSchema>;

/**
 * A machine-readable reason the row needs attention.
 *
 * Codes, not sentences: the words belong to the copy layer where they can be
 * reviewed as Hebrew, and the same code may be phrased differently in a summary
 * and in a row.
 */
export const importWarningCodeSchema = z.enum([
  'ambiguous_date',
  'ambiguous_column_mapping',
  'ambiguous_direction',
  'unparsed_amount',
  'missing_date',
  'missing_amount',
  'missing_description',
  'row_out_of_range',
  'repeated_header',
  'footer_total_row',
  'formula_cell_value_used',
  'low_confidence_document_type',
  'multiple_accounts_in_file',
  'page_text_unreliable',
  'image_only_page',
  'truncated_by_limit',
  'currency_assumed',
  'balance_does_not_follow',
]);
export type ImportWarningCode = z.infer<typeof importWarningCodeSchema>;

/** A raw cell as it appeared in the document, before any interpretation. */
export const rawCellSchema = z.object({
  column: z.string().max(200),
  text: z.string().max(2000),
});
export type RawCell = z.infer<typeof rawCellSchema>;

export const proposedTransactionSchema = z.object({
  transactionDate: businessDateSchema,
  postingDate: businessDateSchema.nullable(),
  description: z.string().trim().max(300),
  amountMinor: amountMinorSchema,
  direction: directionSchema,
  currency: currencySchema,
  scope: recordScopeSchema,
  categoryKey: budgetCategoryKeySchema.nullable(),
  reference: z.string().trim().max(120).nullable(),
  installmentNumber: z.number().int().min(1).max(999).nullable(),
  installmentTotal: z.number().int().min(1).max(999).nullable(),
  /** Running balance printed on the row, when the statement carries one. */
  balanceAfterMinor: amountMinorSchema.nullable(),
  balanceAfterDirection: directionSchema.nullable(),
});
export type ProposedTransaction = z.infer<typeof proposedTransactionSchema>;

export const proposedBalanceSchema = z.object({
  asOfDate: businessDateSchema,
  balanceMinor: amountMinorSchema,
  balanceDirection: directionSchema,
  currency: currencySchema,
  accountHint: z.string().trim().max(160).nullable(),
});
export type ProposedBalance = z.infer<typeof proposedBalanceSchema>;

export const proposedAccountSchema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: accountKindSchema,
  scope: recordScopeSchema,
  institution: z.string().trim().max(120).nullable(),
  displaySuffix: z
    .string()
    .regex(/^[0-9]{4}$/)
    .nullable(),
  currency: currencySchema,
});
export type ProposedAccount = z.infer<typeof proposedAccountSchema>;

export const proposedDebtSchema = z.object({
  creditorName: z.string().trim().min(1).max(160),
  kind: debtKindSchema,
  balanceMinor: amountMinorSchema,
  currency: currencySchema,
  openedOn: businessDateSchema,
  effectiveAnnualRateBp: z.number().int().min(0).max(1_000_000).nullable(),
  minimumPaymentMinor: amountMinorSchema.nullable(),
  paymentDueDay: z.number().int().min(1).max(31).nullable(),
});
export type ProposedDebt = z.infer<typeof proposedDebtSchema>;

export const proposedDebtPaymentSchema = z.object({
  creditorHint: z.string().trim().max(160),
  principalMinor: amountMinorSchema,
  interestMinor: amountMinorSchema,
  feeMinor: amountMinorSchema,
  occurredOn: businessDateSchema,
});
export type ProposedDebtPayment = z.infer<typeof proposedDebtPaymentSchema>;

export const proposedPlannedItemSchema = z.object({
  label: z.string().trim().min(1).max(160),
  direction: directionSchema,
  amountMinor: amountMinorSchema,
  currency: currencySchema,
  scope: recordScopeSchema,
  certainty: certaintySchema,
  expectedDate: businessDateSchema,
  dueDate: businessDateSchema.nullable(),
  essential: z.boolean(),
});
export type ProposedPlannedItem = z.infer<typeof proposedPlannedItemSchema>;

export const proposedBudgetLineSchema = z.object({
  categoryKey: budgetCategoryKeySchema,
  plannedMinor: amountMinorSchema,
});
export type ProposedBudgetLine = z.infer<typeof proposedBudgetLineSchema>;

/** The interpreted payload, tagged by what it would become. */
export const proposedPayloadSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('account'), value: proposedAccountSchema }),
  z.object({ kind: z.literal('transaction'), value: proposedTransactionSchema }),
  z.object({ kind: z.literal('balance'), value: proposedBalanceSchema }),
  z.object({ kind: z.literal('debt'), value: proposedDebtSchema }),
  z.object({ kind: z.literal('debt_payment'), value: proposedDebtPaymentSchema }),
  z.object({ kind: z.literal('planned_item'), value: proposedPlannedItemSchema }),
  z.object({ kind: z.literal('budget_line'), value: proposedBudgetLineSchema }),
]);
export type ProposedPayload = z.infer<typeof proposedPayloadSchema>;

/** Exactly where in the document a proposal came from. */
export const sourceLocationSchema = z.object({
  sheetName: z.string().max(200).nullable(),
  /** 1-based page number for a PDF; null for a spreadsheet. */
  page: z.number().int().min(1).max(10_000).nullable(),
  /** 1-based row within the sheet or the detected table. */
  row: z.number().int().min(1).max(1_000_000).nullable(),
  /** The text around the row, kept so a reviewer can check our reading. */
  snippet: z.string().max(1000).nullable(),
});
export type SourceLocation = z.infer<typeof sourceLocationSchema>;

export const importProposalSchema = z
  .object({
    id: uuidSchema,
    batchId: uuidSchema,
    kind: proposalKindSchema,
    location: sourceLocationSchema,
    /** What the file said, verbatim. Never rewritten by a correction. */
    raw: z.array(rawCellSchema).max(80),
    /** What the parser read that as. */
    proposed: proposedPayloadSchema,
    /** What the reviewer changed it to. Null while untouched. */
    correction: proposedPayloadSchema.nullable(),
    confidenceBp: z.number().int().min(0).max(10_000),
    warnings: z.array(importWarningCodeSchema).max(20),
    duplicateVerdict: duplicateVerdictSchema,
    /** The existing record this looks like, when there is one. */
    duplicateOfId: uuidSchema.nullable(),
    reviewState: reviewStateSchema,
    /** Which account, debt or business the row should attach to once approved. */
    targetAccountId: uuidSchema.nullable(),
    targetDebtId: uuidSchema.nullable(),
    /** The record created when the batch was approved. Null until then. */
    committedRecordId: uuidSchema.nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    version: versionSchema,
  })
  .refine((row) => row.proposed.kind === row.kind, {
    message: 'the payload must match the declared kind',
    path: ['proposed'],
  })
  .refine((row) => row.correction === null || row.correction.kind === row.kind, {
    message: 'a correction may refine a row, never change what it is',
    path: ['correction'],
  })
  .refine((row) => row.duplicateVerdict === 'new' || row.duplicateOfId !== null, {
    message: 'a duplicate verdict must name the record it matched',
    path: ['duplicateOfId'],
  });
export type ImportProposal = z.infer<typeof importProposalSchema>;

/**
 * The file, as we recorded it.
 *
 * The original name is kept only to show the reviewer which file they picked; it
 * never becomes a path. `storedId` is the internal, generated identifier used for
 * anything on disk, which is how 07-SECURITY-PRIVACY.md's path-traversal rule is
 * kept structurally rather than by escaping.
 */
export const importSourceFileSchema = z.object({
  /** The user's name for the file, sanitised for display only. */
  displayName: z.string().trim().min(1).max(200),
  storedId: uuidSchema,
  byteSize: z.number().int().min(0).max(1_000_000_000),
  fileKind: importFileKindSchema,
  declaredMimeType: z.string().max(160).nullable(),
  /** SHA-256 of the bytes. Reimporting the same file is detected by this. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export type ImportSourceFile = z.infer<typeof importSourceFileSchema>;

/** What the extraction found, in the numbers a summary screen shows. */
export const extractionSummarySchema = z.object({
  sheetNames: z.array(z.string().max(200)).max(200),
  pageCount: z.number().int().min(0).max(10_000).nullable(),
  rowsScanned: z.number().int().min(0),
  rowsProposed: z.number().int().min(0),
  rowsSkipped: z.number().int().min(0),
  dateRangeStart: businessDateSchema.nullable(),
  dateRangeEnd: businessDateSchema.nullable(),
  accountHints: z.array(z.string().max(160)).max(50),
  /** True when a PDF page carried no extractable text at all. */
  hasImageOnlyPages: z.boolean(),
});
export type ExtractionSummary = z.infer<typeof extractionSummarySchema>;

export const importBatchSchema = z
  .object({
    id: uuidSchema,
    householdId: uuidSchema,
    file: importSourceFileSchema,
    documentType: documentTypeSchema,
    documentTypeConfidenceBp: z.number().int().min(0).max(10_000),
    status: importBatchStatusSchema,
    summary: extractionSummarySchema,
    warnings: z.array(importWarningCodeSchema).max(40),
    /** Why extraction failed, as a code. Only set when status is `failed`. */
    failureCode: z
      .enum([
        'unsupported_file_type',
        'signature_mismatch',
        'file_too_large',
        'encrypted_file',
        'macro_enabled_file',
        'malformed_archive',
        'malformed_document',
        'no_text_layer',
        'no_table_found',
        'limit_exceeded',
        'extraction_timeout',
      ])
      .nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    approvedAt: timestampSchema.nullable(),
    approvedBy: uuidSchema.nullable(),
    rejectedAt: timestampSchema.nullable(),
    reversedAt: timestampSchema.nullable(),
    version: versionSchema,
  })
  .refine((batch) => (batch.status === 'failed') === (batch.failureCode !== null), {
    message: 'a failed batch states why, and only a failed batch carries a reason',
    path: ['failureCode'],
  })
  .refine((batch) => (batch.status === 'approved') === (batch.approvedAt !== null), {
    message: 'an approved batch records when it was approved',
    path: ['approvedAt'],
  })
  .refine((batch) => (batch.status === 'reversed') === (batch.reversedAt !== null), {
    message: 'a reversed batch records when it was reversed',
    path: ['reversedAt'],
  });
export type ImportBatch = z.infer<typeof importBatchSchema>;
