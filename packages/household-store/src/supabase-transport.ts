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
    const { data, error } = await this.client.rpc('apply_household_changes', {
      p_household_id: householdId,
      p_expected_version: expectedVersion,
      p_changes: changes,
    });
    if (error) throw this.translate(error, 'saving the change');
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
    return new TransportError(failure, `${operation} failed (${failure})`);
  }
}
