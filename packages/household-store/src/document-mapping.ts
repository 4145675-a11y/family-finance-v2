import {
  CURRENT_FORMAT_VERSION,
  parseStoreDocument,
  type StoreDocument,
} from '@family-finance/local-store';

import { PersistenceError } from './port';
import { rowToCamel, rowToSnake, stableStringify, type JsonRow } from './rows';

/**
 * Between the household as the database returns it and the document the
 * commands run on.
 *
 * `load_household_document()` returns one JSON object with an array per table.
 * `documentFromLoaded` turns it into a `StoreDocument` and validates it with
 * the same schema the file store applies on read, so a row the database holds
 * that the engine could not accept is refused here rather than half-loaded.
 *
 * `changesBetween` turns the difference between the document a command was
 * given and the one it returned into the payload `apply_household_changes()`
 * expects: per table, the rows to upsert, and — only where the schema defines
 * a mark for it — the rows that disappeared. A command that removes a row from
 * any other collection is refused: nothing else is ever deleted (ADR-0032).
 */

/** The object `public.load_household_document()` returns. */
export interface LoadedHousehold {
  readonly household: JsonRow;
  readonly settings: JsonRow | null;
  readonly setup: JsonRow | null;
  readonly members: JsonRow[];
  readonly profiles: JsonRow[];
  readonly invitations: JsonRow[];
  readonly businesses: JsonRow[];
  readonly accounts: JsonRow[];
  readonly categories: JsonRow[];
  readonly balanceSnapshots: JsonRow[];
  readonly transactions: JsonRow[];
  readonly cashflowItems: JsonRow[];
  readonly debts: JsonRow[];
  readonly debtEvents: JsonRow[];
  readonly rollovers: JsonRow[];
  readonly checks: JsonRow[];
  readonly repaymentPlans: JsonRow[];
  readonly budgets: JsonRow[];
  readonly budgetLines: JsonRow[];
  readonly tasks: JsonRow[];
  readonly importSourceFiles: JsonRow[];
  readonly importBatches: JsonRow[];
  readonly importProposals: JsonRow[];
  readonly learnedRules: JsonRow[];
  readonly audit: JsonRow[];
}

/** An invitation as the members screen lists it. Never carries the token or its hash. */
export interface HouseholdInvitation {
  readonly id: string;
  readonly householdId: string;
  readonly invitedEmail: string;
  readonly createdBy: string;
  readonly expiresAt: string;
  readonly acceptedAt: string | null;
  readonly acceptedBy: string | null;
  readonly revokedAt: string | null;
  readonly createdAt: string;
}

/** JSON payload columns that must not be reinterpreted. */
const RAW_PAYLOAD_COLUMNS = new Set(['raw', 'proposed', 'correction', 'summary', 'warnings']);

function str(row: JsonRow, key: string): string {
  const value = row[key];
  return typeof value === 'string' ? value : '';
}

export function documentFromLoaded(loaded: LoadedHousehold): StoreDocument {
  const household = rowToCamel(loaded.household);
  const settingsRow = loaded.settings === null ? null : rowToCamel(loaded.settings);
  const setupRow = loaded.setup === null ? null : rowToCamel(loaded.setup);
  if (settingsRow === null || setupRow === null) {
    throw new PersistenceError(
      'invalid_document',
      'the household has no settings or setup row; create_household() always writes both',
    );
  }

  const filesById = new Map(loaded.importSourceFiles.map((f) => [str(f, 'id'), rowToCamel(f)]));

  const candidate: JsonRow = {
    formatVersion: CURRENT_FORMAT_VERSION,
    updatedAt: household['updatedAt'],
    household,
    settings: {
      currency: settingsRow['currency'],
      timeZone: settingsRow['timeZone'],
      monthStartDay: settingsRow['monthStartDay'],
      manualReserveFloorMinor: settingsRow['manualReserveFloorMinor'],
      incidentBufferMinor: settingsRow['incidentBufferMinor'],
      revolvingAvoidanceMinor: settingsRow['revolvingAvoidanceMinor'],
      protectedReservesMinor: settingsRow['protectedReservesMinor'],
      notifications: {
        weeklyFoodGuidance: settingsRow['weeklyFoodGuidance'],
        balanceFreshnessReminder: settingsRow['balanceFreshnessReminder'],
        balanceFreshnessDays: settingsRow['balanceFreshnessDays'],
      },
      updatedAt: settingsRow['updatedAt'],
      version: settingsRow['version'],
    },
    setup: {
      householdNamed: setupRow['householdNamed'],
      membersAdded: setupRow['membersAdded'],
      accountsAdded: setupRow['accountsAdded'],
      balancesConfirmed: setupRow['balancesConfirmed'],
      businessDecided: setupRow['businessDecided'],
      debtsRecorded: setupRow['debtsRecorded'],
      recurringIncomeRecorded: setupRow['recurringIncomeRecorded'],
      recurringObligationsRecorded: setupRow['recurringObligationsRecorded'],
      budgetStarted: setupRow['budgetStarted'],
      privacyExplained: setupRow['privacyExplained'],
    },
    profiles: loaded.profiles.map((r) => rowToCamel(r)),
    members: loaded.members.map((r) => rowToCamel(r)),
    businesses: loaded.businesses.map((r) => rowToCamel(r)),
    accounts: loaded.accounts.map((r) => rowToCamel(r)),
    categories: loaded.categories.map((r) => rowToCamel(r)),
    balanceSnapshots: loaded.balanceSnapshots.map((r) => rowToCamel(r)),
    transactions: loaded.transactions.map((r) => rowToCamel(r)),
    cashflowItems: loaded.cashflowItems.map((r) => rowToCamel(r)),
    debts: loaded.debts.map((r) => rowToCamel(r)),
    debtEvents: loaded.debtEvents.map((r) => rowToCamel(r)),
    rollovers: loaded.rollovers.map((r) => rowToCamel(r)),
    checks: loaded.checks.map((r) => rowToCamel(r)),
    repaymentPlans: loaded.repaymentPlans.map((r) => rowToCamel(r)),
    budgets: loaded.budgets.map((r) => rowToCamel(r)),
    budgetLines: loaded.budgetLines.map((r) => rowToCamel(r)),
    tasks: loaded.tasks.map((r) => rowToCamel(r)),
    importBatches: loaded.importBatches.map((r) => {
      const batch = rowToCamel(r, RAW_PAYLOAD_COLUMNS);
      const file = filesById.get(str(r, 'source_file_id'));
      if (file === undefined) {
        throw new PersistenceError(
          'invalid_document',
          'an import batch references a source file the caller cannot see',
        );
      }
      return {
        id: batch['id'],
        householdId: batch['householdId'],
        file: {
          displayName: file['displayName'],
          storedId: file['id'],
          byteSize: file['byteSize'],
          fileKind: file['kind'],
          declaredMimeType: file['declaredMimeType'],
          sha256: file['sha256'],
        },
        documentType: batch['documentType'],
        documentTypeConfidenceBp: batch['documentConfidenceBp'],
        status: batch['status'],
        summary: batch['summary'],
        warnings: batch['warnings'],
        failureCode: batch['failureCode'],
        createdAt: batch['createdAt'],
        updatedAt: batch['updatedAt'],
        approvedAt: batch['approvedAt'],
        approvedBy: batch['approvedBy'],
        rejectedAt: batch['rejectedAt'],
        reversedAt: batch['reversedAt'],
        version: batch['version'],
      };
    }),
    importProposals: loaded.importProposals.map((r) => {
      const p = rowToCamel(r, RAW_PAYLOAD_COLUMNS);
      return {
        id: p['id'],
        batchId: p['batchId'],
        kind: p['kind'],
        location: {
          sheetName: p['locationSheetName'],
          page: p['locationPage'],
          row: p['locationRow'],
          snippet: p['locationSnippet'],
        },
        raw: p['raw'],
        proposed: p['proposed'],
        correction: p['correction'],
        confidenceBp: p['confidenceBp'],
        warnings: p['warnings'],
        duplicateVerdict: p['duplicateVerdict'],
        duplicateOfId: p['duplicateOfId'],
        reviewState: p['reviewState'],
        targetAccountId: p['targetAccountId'],
        targetDebtId: p['targetDebtId'],
        targetCheckId: p['targetCheckId'],
        committedRecordId: p['committedRecordId'],
        createdAt: p['createdAt'],
        updatedAt: p['updatedAt'],
        version: p['version'],
      };
    }),
    learnedRules: (loaded.learnedRules ?? []).map((r) => {
      const rule = rowToCamel(r);
      return {
        id: rule['id'],
        householdId: rule['householdId'],
        label: rule['label'],
        matcher: {
          descriptionContains: rule['descriptionContains'],
          direction: rule['direction'] ?? null,
          accountId: rule['accountId'] ?? null,
        },
        class: rule['class'],
        budgetCategoryKey: rule['budgetCategoryKey'] ?? null,
        counterparty: rule['counterparty'] ?? null,
        debtId: rule['debtId'] ?? null,
        enabled: rule['enabled'],
        timesApplied: rule['timesApplied'],
        createdBy: rule['createdBy'],
        createdAt: rule['createdAt'],
        updatedAt: rule['updatedAt'],
        version: rule['version'],
      };
    }),
    audit: loaded.audit.map((r) => rowToCamel(r)),
  };

  try {
    return parseStoreDocument(candidate);
  } catch (error) {
    throw new PersistenceError(
      'invalid_document',
      error instanceof Error ? error.message : 'the loaded household is not a valid document',
    );
  }
}

export function invitationsFromLoaded(loaded: LoadedHousehold): HouseholdInvitation[] {
  return loaded.invitations.map((r) => {
    const row = rowToCamel(r);
    return {
      id: str(row, 'id'),
      householdId: str(row, 'householdId'),
      invitedEmail: str(row, 'invitedEmail'),
      createdBy: str(row, 'createdBy'),
      expiresAt: str(row, 'expiresAt'),
      acceptedAt: (row['acceptedAt'] as string | null) ?? null,
      acceptedBy: (row['acceptedBy'] as string | null) ?? null,
      revokedAt: (row['revokedAt'] as string | null) ?? null,
      createdAt: str(row, 'createdAt'),
    };
  });
}

// ---------------------------------------------------------------------------
// Differences
// ---------------------------------------------------------------------------

/** The payload `apply_household_changes()` accepts. Keys are table groups; rows are snake_case. */
export type HouseholdChanges = Record<string, unknown>;

interface Identified {
  readonly id: string;
}

/** Collections whose disappearance has a defined meaning, and the key the function expects. */
const MARK_ON_DISAPPEAR: Readonly<Record<string, 'void' | 'remove'>> = {
  balanceSnapshots: 'void',
  debtEvents: 'void',
  cashflowItems: 'remove',
};

/** Collections written as plain rows: contract keys → columns, one to one. */
const PLAIN_COLLECTIONS = [
  'businesses',
  'accounts',
  'categories',
  'balanceSnapshots',
  'transactions',
  'cashflowItems',
  'debts',
  'debtEvents',
  'rollovers',
  'checks',
  'repaymentPlans',
  'budgets',
  'budgetLines',
  'tasks',
] as const;

function diffRows<T extends Identified>(
  before: readonly T[],
  after: readonly T[],
): { upsert: T[]; gone: string[] } {
  const previous = new Map(before.map((row) => [row.id, stableStringify(row)]));
  const upsert: T[] = [];
  const seen = new Set<string>();
  for (const row of after) {
    seen.add(row.id);
    if (previous.get(row.id) !== stableStringify(row)) upsert.push(row);
  }
  const gone = before.filter((row) => !seen.has(row.id)).map((row) => row.id);
  return { upsert, gone };
}

/**
 * What a command changed, as the database wants to hear it.
 *
 * `actorProfileId` fills the columns the contracts do not carry but the
 * schema requires (a batch's creator, who reversed it). The policies insist
 * these name the caller, and the caller is exactly who ran the command.
 */
export function changesBetween(
  before: StoreDocument,
  after: StoreDocument,
  actorProfileId: string,
): HouseholdChanges {
  const changes: HouseholdChanges = {};

  if (before.household.name !== after.household.name) {
    changes['household'] = { name: after.household.name };
  }
  if (stableStringify(before.settings) !== stableStringify(after.settings)) {
    const { notifications, ...rest } = after.settings;
    changes['settings'] = rowToSnake({
      ...rest,
      weeklyFoodGuidance: notifications.weeklyFoodGuidance,
      balanceFreshnessReminder: notifications.balanceFreshnessReminder,
      balanceFreshnessDays: notifications.balanceFreshnessDays,
    });
  }
  if (stableStringify(before.setup) !== stableStringify(after.setup)) {
    changes['setup'] = rowToSnake({ ...after.setup });
  }

  const profiles = diffRows(before.profiles, after.profiles);
  if (profiles.gone.length > 0) {
    throw new PersistenceError('unsupported_in_backend', 'a profile cannot be removed');
  }
  if (profiles.upsert.length > 0) {
    changes['profiles'] = { upsert: profiles.upsert.map((p) => rowToSnake({ ...p })) };
  }

  const members = diffRows(before.members, after.members);
  const knownMembers = new Set(before.members.map((m) => m.id));
  if (members.gone.length > 0 || members.upsert.some((m) => !knownMembers.has(m.id))) {
    throw new PersistenceError(
      'unsupported_in_backend',
      'membership is granted by invitation and never removed; a member row cannot be added or deleted here',
    );
  }
  if (members.upsert.length > 0) {
    changes['members'] = { upsert: members.upsert.map((m) => rowToSnake({ ...m })) };
  }

  for (const collection of PLAIN_COLLECTIONS) {
    const { upsert, gone } = diffRows(
      before[collection] as Identified[],
      after[collection] as Identified[],
    );
    const mark = MARK_ON_DISAPPEAR[collection];
    if (gone.length > 0 && mark === undefined) {
      throw new PersistenceError(
        'unsupported_in_backend',
        `a row of ${collection} disappeared; nothing in that collection is ever deleted`,
      );
    }
    if (upsert.length === 0 && gone.length === 0) continue;
    const entry: JsonRow = { upsert: upsert.map((row) => rowToSnake({ ...row })) };
    if (gone.length > 0 && mark !== undefined) entry[mark] = gone;
    changes[collection] = entry;
  }

  const batches = diffRows(before.importBatches, after.importBatches);
  if (batches.gone.length > 0) {
    throw new PersistenceError('unsupported_in_backend', 'an import batch is never deleted');
  }
  if (batches.upsert.length > 0) {
    const knownBatches = new Set(before.importBatches.map((b) => b.id));
    const newFiles = batches.upsert
      .filter((b) => !knownBatches.has(b.id))
      .map((b) => ({
        id: b.file.storedId,
        display_name: b.file.displayName,
        // The bytes are parsed on arrival and never kept by a hosted server;
        // the row records what was seen, hashed, and that nothing was retained.
        storage_path: b.file.storedId,
        kind: b.file.fileKind,
        byte_size: Math.max(1, b.file.byteSize),
        sha256: b.file.sha256,
        declared_mime_type: b.file.declaredMimeType,
        retention_state: 'purged',
        purged_at: b.createdAt,
        uploaded_by: actorProfileId,
        uploaded_at: b.createdAt,
      }));
    if (newFiles.length > 0) changes['importSourceFiles'] = { upsert: newFiles };
    changes['importBatches'] = {
      upsert: batches.upsert.map((b) => ({
        id: b.id,
        source_file_id: b.file.storedId,
        status: b.status,
        document_type: b.documentType,
        document_confidence_bp: b.documentTypeConfidenceBp,
        rows_proposed: b.summary.rowsProposed,
        rows_scanned: b.summary.rowsScanned,
        truncated: false,
        failure_code: b.failureCode,
        target_account_id: null,
        summary: b.summary,
        warnings: b.warnings,
        approved_at: b.approvedAt,
        approved_by: b.approvedBy,
        rejected_at: b.rejectedAt,
        reversed_at: b.reversedAt,
        reversed_by: b.reversedAt === null ? null : actorProfileId,
        created_by: actorProfileId,
        created_at: b.createdAt,
        updated_at: b.updatedAt,
        version: b.version,
      })),
    };
  }

  /*
   * Classification rules, which are the one collection a household may delete
   * from.
   *
   * Every financial record here is append-only or voidable, never removed — but a
   * rule is not a record of anything that happened. It describes how to read the
   * next statement, and a family that says to stop reading it that way is not
   * erasing history: nothing already imported changes.
   */
  const rules = diffRows(before.learnedRules, after.learnedRules);
  if (rules.upsert.length > 0 || rules.gone.length > 0) {
    changes['learnedRules'] = {
      upsert: rules.upsert.map((rule) => ({
        id: rule.id,
        label: rule.label,
        description_contains: rule.matcher.descriptionContains,
        direction: rule.matcher.direction,
        account_id: rule.matcher.accountId,
        class: rule.class,
        budget_category_key: rule.budgetCategoryKey,
        counterparty: rule.counterparty,
        debt_id: rule.debtId,
        enabled: rule.enabled,
        times_applied: rule.timesApplied,
        created_by: rule.createdBy,
        created_at: rule.createdAt,
        updated_at: rule.updatedAt,
        version: rule.version,
      })),
      gone: rules.gone,
    };
  }

  const proposals = diffRows(before.importProposals, after.importProposals);
  if (proposals.gone.length > 0) {
    throw new PersistenceError('unsupported_in_backend', 'an import proposal is never deleted');
  }
  if (proposals.upsert.length > 0) {
    changes['importProposals'] = {
      upsert: proposals.upsert.map((p) => ({
        id: p.id,
        batch_id: p.batchId,
        kind: p.kind,
        location_sheet_name: p.location.sheetName,
        location_page: p.location.page,
        location_row: p.location.row,
        location_snippet: p.location.snippet,
        raw: p.raw,
        proposed: p.proposed,
        correction: p.correction,
        confidence_bp: p.confidenceBp,
        warnings: p.warnings,
        duplicate_verdict: p.duplicateVerdict,
        duplicate_of_id: p.duplicateOfId,
        review_state: p.reviewState,
        target_account_id: p.targetAccountId,
        target_debt_id: p.targetDebtId,
        target_check_id: p.targetCheckId,
        committed_record_id: p.committedRecordId,
        created_at: p.createdAt,
        updated_at: p.updatedAt,
        version: p.version,
      })),
    };
  }

  const knownAudit = new Set(before.audit.map((a) => a.id));
  const newAudit = after.audit.filter((a) => !knownAudit.has(a.id));
  if (newAudit.length > 0) {
    changes['audit'] = newAudit.map((a) => ({
      action: a.action,
      entity_type: a.entityType,
      entity_id: a.entityId,
      before_state: a.beforeState,
      after_state: a.afterState,
    }));
  }

  return changes;
}

export function isEmptyChangeSet(changes: HouseholdChanges): boolean {
  return Object.keys(changes).length === 0;
}
