import type { AuditEvent } from '@family-finance/contracts';

import type { StoreDocument } from './document';

/**
 * The history of what was done, written as it is done.
 *
 * 07-SECURITY-PRIVACY.md § Audit requires this to be append-only and to carry a
 * reduced image of what changed rather than the whole record. Both rules are here
 * for the same reason: an audit trail that can be edited proves nothing, and one
 * that copies whole records ends up holding a second copy of everything sensitive
 * in a place nobody thinks to protect.
 *
 * So `reduce` exists, and every writer goes through it. Fields it does not know
 * about are dropped rather than passed through, which fails closed: a field added
 * to a record later does not silently start appearing in the audit log.
 */

/** Fields worth keeping in an audit image. Everything else is dropped. */
const KEPT_FIELDS = new Set([
  'id',
  'name',
  'label',
  'title',
  'status',
  'kind',
  'scope',
  'direction',
  'amountMinor',
  'plannedMinor',
  'balanceMinor',
  'balanceDirection',
  'currency',
  'transactionDate',
  'occurredOn',
  'expectedDate',
  'dueDate',
  'verifiedAt',
  'categoryId',
  'accountId',
  'counterpartAccountId',
  'debtId',
  'creditorName',
  'period',
  'version',
  'reviewState',
  'documentType',
  'rowsProposed',
  'displayName',
  'monthStartDay',
  'assignedMemberId',
]);

/**
 * A record reduced to the fields an auditor needs.
 *
 * Explicitly not a redaction pass over the whole object: an allowlist, so the
 * default for anything unrecognised is exclusion.
 */
export function reduce(record: unknown): Record<string, unknown> | null {
  if (record === null || typeof record !== 'object') return null;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record as Record<string, unknown>)) {
    if (!KEPT_FIELDS.has(key)) continue;
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      out[key] = value;
    }
  }
  return Object.keys(out).length === 0 ? null : out;
}

export interface AuditInput {
  readonly householdId: string;
  readonly actorProfileId: string | null;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly occurredAt: string;
}

export function auditEvent(input: AuditInput): AuditEvent {
  return {
    id: crypto.randomUUID(),
    householdId: input.householdId,
    actorProfileId: input.actorProfileId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    beforeState: input.before === undefined ? null : reduce(input.before),
    afterState: input.after === undefined ? null : reduce(input.after),
    occurredAt: input.occurredAt,
  };
}

/**
 * Appends entries.
 *
 * There is deliberately no function that removes or edits one. The array is
 * append-only by construction, and the store document schema validates it on
 * every write, so a rewritten entry would have to get past both.
 */
export function withAudit(
  document: StoreDocument,
  entries: readonly AuditEvent[],
): StoreDocument {
  if (entries.length === 0) return document;
  return { ...document, audit: [...document.audit, ...entries] };
}
