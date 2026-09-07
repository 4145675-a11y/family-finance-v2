import {
  accountBalanceSnapshotSchema,
  auditEventSchema,
  budgetLineSchema,
  budgetSchema,
  businessSchema,
  cashflowItemSchema,
  categorySchema,
  debtEventSchema,
  debtRolloverSchema,
  debtSchema,
  familyTaskSchema,
  financialAccountSchema,
  householdMemberSchema,
  householdSchema,
  householdSettingsSchema,
  importBatchSchema,
  importProposalSchema,
  postDatedCheckSchema,
  profileSchema,
  repaymentPlanSchema,
  setupProgressSchema,
  transactionSchema,
} from '@family-finance/contracts';
import { z } from 'zod';

/**
 * Everything the household owns, as one versioned document.
 *
 * This is the shape on disk. It is one file rather than many because the
 * guarantee that matters most here is atomicity: approving an import has to
 * create transactions, attach them to a batch, write audit entries and bump
 * versions, and 05-ARCHITECTURE-DATA.md does not permit half of that to survive
 * a crash. One document written by rename is transactional without needing a
 * transaction manager.
 *
 * `formatVersion` is the compatibility contract. A backup taken today must be
 * refusable by a future build that cannot read it, rather than half-imported —
 * so the number is checked before anything is restored, and it is checked
 * against a list of versions this build actually knows how to read.
 *
 * Every collection here is validated on load. That is not cheap, and it is the
 * point: a file a person could have edited by hand, or a restore from a backup,
 * must not be able to put an amount with a minus sign or a date with no month
 * into the engine.
 */

/** The only format version this build writes. */
export const CURRENT_FORMAT_VERSION = 2;

/** Versions this build can read. Older ones are migrated on load. */
export const READABLE_FORMAT_VERSIONS: readonly number[] = [1, 2];

/**
 * A transaction, plus where it came from.
 *
 * The provenance fields are what make an import reversible and auditable: given
 * a batch, every record it created can be found, and given a record, the file and
 * row that produced it can be named. A hand-typed record carries nulls in all
 * three, which is how "the family entered this" is told from "a statement said
 * this".
 */
export const storedTransactionSchema = transactionSchema.safeExtend({
  importBatchId: z.uuid().nullable(),
  importProposalId: z.uuid().nullable(),
  /** File hash plus location. See `sourceFingerprint` in document-import. */
  sourceFingerprint: z.string().max(400).nullable(),
});
export type StoredTransaction = z.infer<typeof storedTransactionSchema>;

export const storedBalanceSnapshotSchema = accountBalanceSnapshotSchema.safeExtend({
  importBatchId: z.uuid().nullable(),
});
export type StoredBalanceSnapshot = z.infer<typeof storedBalanceSnapshotSchema>;

export const storedDebtEventSchema = debtEventSchema.safeExtend({
  importBatchId: z.uuid().nullable(),
});
export type StoredDebtEvent = z.infer<typeof storedDebtEventSchema>;

export const storedCashflowItemSchema = cashflowItemSchema.safeExtend({
  importBatchId: z.uuid().nullable(),
});
export type StoredCashflowItem = z.infer<typeof storedCashflowItemSchema>;

export const storeDocumentSchema = z.object({
  formatVersion: z.literal(CURRENT_FORMAT_VERSION),
  /** When this document was last written. Shown as "the picture is from…". */
  updatedAt: z.iso.datetime({ offset: true }),
  household: householdSchema,
  settings: householdSettingsSchema,
  setup: setupProgressSchema,
  profiles: z.array(profileSchema).max(20),
  members: z.array(householdMemberSchema).max(20),
  businesses: z.array(businessSchema).max(10),
  accounts: z.array(financialAccountSchema).max(200),
  categories: z.array(categorySchema).max(200),
  balanceSnapshots: z.array(storedBalanceSnapshotSchema).max(20_000),
  transactions: z.array(storedTransactionSchema).max(200_000),
  cashflowItems: z.array(storedCashflowItemSchema).max(20_000),
  debts: z.array(debtSchema).max(500),
  debtEvents: z.array(storedDebtEventSchema).max(50_000),
  rollovers: z.array(debtRolloverSchema).max(5_000),
  /**
   * Post-dated checks, and the agreements they repay.
   *
   * Their own collections rather than fields on a debt, because a check has a
   * life of its own: it is written, handed over, presented, honoured or returned,
   * and each of those is a fact with a date. Folding them into the debt would
   * make "the gemach is holding four of our checks" unrepresentable, which is the
   * single most important thing this data has to say.
   */
  checks: z.array(postDatedCheckSchema).max(10_000),
  repaymentPlans: z.array(repaymentPlanSchema).max(500),
  budgets: z.array(budgetSchema).max(600),
  budgetLines: z.array(budgetLineSchema).max(10_000),
  tasks: z.array(familyTaskSchema).max(5_000),
  importBatches: z.array(importBatchSchema).max(5_000),
  importProposals: z.array(importProposalSchema).max(200_000),
  /** Append-only. Never edited, never reordered, never pruned by the product. */
  audit: z.array(auditEventSchema).max(200_000),
});

export type StoreDocument = z.infer<typeof storeDocumentSchema>;

/**
 * The document a brand-new household starts from.
 *
 * Deliberately almost empty. There is one profile and one household because the
 * product cannot function without knowing whose money this is; everything else —
 * accounts, categories, budgets — is the family's to add, and inventing a default
 * chart of accounts would be inventing financial facts.
 *
 * The one exception is categories, and it is not an exception to that rule: the
 * budget category keys are fixed by `02-FINANCIAL-RULES.md` and the engine, so
 * the rows are structure rather than data. Their planned amounts are all absent
 * until a person sets them.
 */
export interface EmptyDocumentInput {
  readonly householdId: string;
  readonly householdName: string;
  readonly profileId: string;
  readonly profileName: string;
  readonly now: string;
  readonly currency: string;
  readonly timeZone: string;
}

export function emptyDocument(input: EmptyDocumentInput): StoreDocument {
  return {
    formatVersion: CURRENT_FORMAT_VERSION,
    updatedAt: input.now,
    household: {
      id: input.householdId,
      name: input.householdName,
      createdBy: input.profileId,
      createdAt: input.now,
      updatedAt: input.now,
      version: 1,
    },
    settings: {
      currency: input.currency,
      timeZone: input.timeZone,
      monthStartDay: 1,
      manualReserveFloorMinor: null,
      incidentBufferMinor: null,
      revolvingAvoidanceMinor: null,
      protectedReservesMinor: 0,
      notifications: {
        weeklyFoodGuidance: true,
        balanceFreshnessReminder: true,
        balanceFreshnessDays: 7,
      },
      updatedAt: input.now,
      version: 1,
    },
    setup: {
      householdNamed: true,
      membersAdded: false,
      accountsAdded: false,
      balancesConfirmed: false,
      businessDecided: false,
      debtsRecorded: false,
      recurringIncomeRecorded: false,
      recurringObligationsRecorded: false,
      budgetStarted: false,
      privacyExplained: false,
    },
    profiles: [
      {
        id: input.profileId,
        displayName: input.profileName,
        locale: 'he-IL',
        timeZone: input.timeZone,
        createdAt: input.now,
        updatedAt: input.now,
        version: 1,
      },
    ],
    members: [
      {
        id: crypto.randomUUID(),
        householdId: input.householdId,
        profileId: input.profileId,
        status: 'active',
        invitedBy: null,
        joinedAt: input.now,
        revokedAt: null,
        version: 1,
      },
    ],
    businesses: [],
    accounts: [],
    categories: [],
    balanceSnapshots: [],
    transactions: [],
    cashflowItems: [],
    debts: [],
    debtEvents: [],
    rollovers: [],
    checks: [],
    repaymentPlans: [],
    budgets: [],
    budgetLines: [],
    tasks: [],
    importBatches: [],
    importProposals: [],
    audit: [],
  };
}

/**
 * Reads a document from parsed JSON.
 *
 * Throws with a readable path when the file is not a valid document. The caller
 * turns that into a Hebrew message; what matters here is that an invalid document
 * never becomes a partially-loaded one.
 */
/**
 * Brings an older document up to the shape this build reads.
 *
 * Version 2 added post-dated checks and repayment plans. A version 1 document —
 * a file written before this feature existed, or a backup taken then — is
 * complete and correct; it simply has no checks. So the migration adds the empty
 * collections and nothing else, and it is written as a step rather than a special
 * case so the next one has somewhere to go.
 *
 * Migrating on read rather than rewriting the file on start-up means a document
 * is only ever upgraded by an action a person took, and a build that turns out to
 * be wrong has not already converted the family's history.
 */
export function migrateDocument(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  const document = { ...(value as Record<string, unknown>) };

  if (document['formatVersion'] === 1) {
    document['checks'] = Array.isArray(document['checks']) ? document['checks'] : [];
    document['repaymentPlans'] = Array.isArray(document['repaymentPlans'])
      ? document['repaymentPlans']
      : [];
    document['formatVersion'] = 2;
  }

  return document;
}

export function parseStoreDocument(value: unknown): StoreDocument {
  const result = storeDocumentSchema.safeParse(migrateDocument(value));
  if (result.success) return result.data;

  const first = result.error.issues[0];
  const path = first === undefined ? '' : first.path.join('.');
  throw new StoreFormatError(
    `the saved data does not match the expected shape at "${path}": ${first?.message ?? 'unknown'}`,
  );
}

export class StoreFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoreFormatError';
  }
}
