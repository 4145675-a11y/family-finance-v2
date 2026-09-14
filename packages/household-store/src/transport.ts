import type { HouseholdChanges, LoadedHousehold } from './document-mapping';

/**
 * The five calls the Supabase-backed store makes, as an interface.
 *
 * Production implements it over supabase-js with the signed-in person's
 * session, so PostgREST sets the role and the JWT claims and row-level
 * security judges every statement. The integration tests implement it over a
 * `pg` connection that sets the same role and claims inside a transaction they
 * roll back — the same SQL functions, the same policies, no rows left behind.
 *
 * Nothing above this interface knows which one it is talking to, and nothing
 * above it can reach a table directly.
 */
export interface HouseholdTransport {
  /** Active memberships of the signed-in person, oldest first. */
  memberships(): Promise<readonly { householdId: string; joinedAt: string }[]>;
  /** The household as one document, or null when the caller is not a member. */
  load(householdId: string): Promise<LoadedHousehold | null>;
  /** Applies one command's changes atomically. Resolves to the new household version. */
  apply(
    householdId: string,
    expectedVersion: number,
    changes: HouseholdChanges,
  ): Promise<number>;
  createHousehold(input: {
    name: string;
    profileDisplayName: string;
    currency: string;
    timeZone: string;
  }): Promise<string>;
  /** Mints an invitation token. Returned once; never stored in plaintext. */
  createInvitation(householdId: string, email: string): Promise<string>;
  /** Redeems a token under the caller's identity. Resolves to the household joined. */
  acceptInvitation(token: string): Promise<string>;
}

/**
 * Errors a transport raises, already reduced to what the store needs to know.
 * The transport is where a database error is translated, so the raw message
 * — which may carry identifiers — stops there.
 */
export type TransportFailure =
  | 'not_authenticated'
  | 'not_a_member'
  | 'permission_denied'
  | 'version_conflict'
  | 'invitation_invalid'
  | 'unavailable';

export class TransportError extends Error {
  readonly failure: TransportFailure;

  constructor(failure: TransportFailure, message: string) {
    super(message);
    this.name = 'TransportError';
    this.failure = failure;
  }
}

/**
 * Maps a PostgreSQL SQLSTATE (as surfaced by pg or PostgREST) to a failure.
 * Anything unrecognised is `unavailable`: the store then refuses rather than
 * guesses, and the code reaches the log while the message does not.
 */
export function failureForSqlState(
  code: string | undefined,
  operation?: 'invitation',
): TransportFailure {
  // The invitation function raises P0001/P0002/22023 for a token that is
  // revoked, expired, already used, unknown or malformed. All one answer to
  // the person holding it: this invitation is not valid any more.
  if (
    operation === 'invitation' &&
    (code === 'P0001' || code === 'P0002' || code === '22023')
  ) {
    return 'invitation_invalid';
  }
  switch (code) {
    case '28000':
      return 'not_authenticated';
    case '42501':
      return 'permission_denied';
    case '40001':
      return 'version_conflict';
    default:
      return 'unavailable';
  }
}
