import type { SupabaseClient } from '@supabase/supabase-js';

import type { HouseholdChanges, LoadedHousehold } from './document-mapping';
import { failureForSqlState, TransportError, type HouseholdTransport } from './transport';

/**
 * The production transport: supabase-js, carrying the signed-in person's
 * session. PostgREST turns that session into the `authenticated` role and the
 * JWT claims, and every SQL function below runs as that person.
 *
 * The client is created per request by the application from the session
 * cookies (`@supabase/ssr`). This module never creates one and never sees a
 * key: it is handed a client that already speaks for somebody.
 *
 * Errors are reduced to a failure kind and a message that names the operation.
 * PostgREST's own message is not forwarded: it can quote identifiers and SQL,
 * and neither belongs on a screen or in a log line the application writes.
 */
export class SupabaseHouseholdTransport implements HouseholdTransport {
  constructor(
    private readonly client: SupabaseClient,
    private readonly profileId: string,
  ) {}

  async memberships(): Promise<readonly { householdId: string; joinedAt: string }[]> {
    const { data, error } = await this.client
      .from('household_members')
      .select('household_id, joined_at')
      .eq('profile_id', this.profileId)
      .eq('status', 'active')
      .order('joined_at', { ascending: true });
    if (error) throw this.translate(error, 'listing memberships');
    return (data ?? []).map((row) => ({
      householdId: String(row.household_id),
      joinedAt: String(row.joined_at),
    }));
  }

  async load(householdId: string): Promise<LoadedHousehold | null> {
    const { data, error } = await this.client.rpc('load_household_document', {
      p_household_id: householdId,
    });
    if (error) throw this.translate(error, 'loading the household');
    return (data as LoadedHousehold | null) ?? null;
  }

  async apply(
    householdId: string,
    expectedVersion: number,
    changes: HouseholdChanges,
  ): Promise<number> {
    /*
     * `apply_household_document` composes the record changes with this
     * household's classification rules, in one transaction. It delegates the
     * version check and the membership check to `apply_household_changes`, so the
     * failure modes and their error codes are unchanged.
     *
     * It may not be there. A deployment carries new code the moment `main` is
     * built, while a migration reaches the database only when the owner applies
     * it, so there is always a window in which the code is ahead of the schema.
     * A write that calls a function which does not exist comes back as PostgREST
     * `PGRST202`, which mapped to "the database is unavailable" — a sentence that
     * is both false and unactionable, and which stopped every write in the
     * product until somebody guessed why.
     *
     * So the older function is used when the newer one is absent. Falling back is
     * only safe because the two do the same thing to financial records; the one
     * thing the old function cannot do is carry classification rules, and that is
     * refused loudly below rather than dropped.
     */
    const composed = await this.client.rpc('apply_household_document', {
      p_household_id: householdId,
      p_expected_version: expectedVersion,
      p_changes: changes,
    });

    if (!isMissingFunction(composed.error)) {
      if (composed.error) throw this.translate(composed.error, 'saving the change');
      return this.versionOf(composed.data);
    }

    /*
     * The schema is behind the code. Records still save; rules cannot, and a
     * rule that silently failed to save would be a false success — the family
     * would be told their correction was remembered and find it forgotten.
     */
    if (changes['learnedRules'] !== undefined) {
      throw new TransportError(
        'schema_outdated',
        'saving a classification rule needs a database migration that has not been applied',
      );
    }

    const legacy = await this.client.rpc('apply_household_changes', {
      p_household_id: householdId,
      p_expected_version: expectedVersion,
      p_changes: changes,
    });
    if (legacy.error) throw this.translate(legacy.error, 'saving the change');
    return this.versionOf(legacy.data);
  }

  private versionOf(data: unknown): number {
    const version = (data as { version?: unknown } | null)?.version;
    if (typeof version !== 'number') {
      throw new TransportError('unavailable', 'saving the change returned no version');
    }
    return version;
  }

  async createHousehold(input: {
    name: string;
    profileDisplayName: string;
    currency: string;
    timeZone: string;
  }): Promise<string> {
    const { data, error } = await this.client.rpc('create_household', {
      p_name: input.name,
      p_profile_display_name: input.profileDisplayName,
      p_currency: input.currency,
      p_time_zone: input.timeZone,
    });
    if (error) throw this.translate(error, 'creating the household');
    if (typeof data !== 'string') {
      throw new TransportError('unavailable', 'creating the household returned no id');
    }
    return data;
  }

  async createInvitation(householdId: string, email: string): Promise<string> {
    const { data, error } = await this.client.rpc('create_household_invitation', {
      p_household_id: householdId,
      p_email: email,
    });
    if (error) throw this.translate(error, 'creating the invitation');
    if (typeof data !== 'string') {
      throw new TransportError('unavailable', 'creating the invitation returned no token');
    }
    return data;
  }

  async acceptInvitation(token: string): Promise<string> {
    const { data, error } = await this.client.rpc('accept_household_invitation', {
      p_token: token,
    });
    if (error) throw this.translate(error, 'accepting the invitation', 'invitation');
    if (typeof data !== 'string') {
      throw new TransportError('unavailable', 'accepting the invitation returned no household');
    }
    return data;
  }

  private translate(
    error: { code?: string; message?: string },
    operation: string,
    kind?: 'invitation',
  ): TransportError {
    const failure = failureForSqlState(error.code, kind);
    // "not a member" arrives as 42501 from apply_household_changes and as an
    // empty result from load; the code alone cannot tell the two apart, so the
    // message is inspected for the one phrase the functions use.
    if (failure === 'permission_denied' && /not a member/i.test(error.message ?? '')) {
      return new TransportError('not_a_member', `${operation}: not a member of this household`);
    }
    // The SQLSTATE / PostgREST code is diagnostic, never sensitive; the
    // message text stays behind.
    return new TransportError(
      failure,
      `${operation} failed (${failure}, code ${error.code ?? 'none'})`,
    );
  }
}

/**
 * True when PostgREST is saying the function does not exist.
 *
 * `PGRST202` is the schema cache reporting that no function matches the name and
 * arguments. It is the one error that means "the code is ahead of the database"
 * rather than "something went wrong with this write", and it is the only one this
 * module is willing to recover from.
 */
function isMissingFunction(error: { code?: string } | null): boolean {
  return error?.code === 'PGRST202';
}
