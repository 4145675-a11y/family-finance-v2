import type {
  HouseholdChanges,
  HouseholdTransport,
  LoadedHousehold,
} from '@family-finance/household-store';
import { failureForSqlState, TransportError } from '@family-finance/household-store';
import type { Client } from 'pg';

/**
 * The store's transport over a `pg` connection that already acts as a person
 * (the harness set the role and the JWT claims inside a savepoint).
 *
 * Same SQL functions, same policies, same failure translation as production —
 * only the wire differs, and nothing above the transport can tell. Every row
 * it writes lives inside the harness's transaction and is rolled back with it.
 */
export class PgHouseholdTransport implements HouseholdTransport {
  constructor(
    private readonly client: Client,
    private readonly profileId: string,
  ) {}

  async memberships(): Promise<readonly { householdId: string; joinedAt: string }[]> {
    const { rows } = await this.query<{ household_id: string; joined_at: Date }>(
      `select household_id, joined_at from public.household_members
       where profile_id = $1 and status = 'active' order by joined_at`,
      [this.profileId],
      'listing memberships',
    );
    return rows.map((r) => ({
      householdId: r.household_id,
      joinedAt: r.joined_at.toISOString(),
    }));
  }

  async load(householdId: string): Promise<LoadedHousehold | null> {
    const { rows } = await this.query<{ doc: LoadedHousehold | null }>(
      'select public.load_household_document($1) as doc',
      [householdId],
      'loading the household',
    );
    return rows[0]?.doc ?? null;
  }

  async apply(
    householdId: string,
    expectedVersion: number,
    changes: HouseholdChanges,
  ): Promise<number> {
    const { rows } = await this.query<{ result: { version: number } }>(
      'select public.apply_household_changes($1, $2, $3::jsonb) as result',
      [householdId, expectedVersion, JSON.stringify(changes)],
      'saving the change',
    );
    return rows[0]?.result.version ?? Number.NaN;
  }

  async createHousehold(input: {
    name: string;
    profileDisplayName: string;
    currency: string;
    timeZone: string;
  }): Promise<string> {
    const { rows } = await this.query<{ id: string }>(
      'select public.create_household($1, $2, $3, $4) as id',
      [input.name, input.profileDisplayName, input.currency, input.timeZone],
      'creating the household',
    );
    return rows[0]?.id ?? '';
  }

  async createInvitation(householdId: string, email: string): Promise<string> {
    const { rows } = await this.query<{ token: string }>(
      'select public.create_household_invitation($1, $2) as token',
      [householdId, email],
      'creating the invitation',
    );
    return rows[0]?.token ?? '';
  }

  async acceptInvitation(token: string): Promise<string> {
    const { rows } = await this.query<{ hid: string }>(
      'select public.accept_household_invitation($1) as hid',
      [token],
      'accepting the invitation',
      'invitation',
    );
    return rows[0]?.hid ?? '';
  }

  private async query<T extends Record<string, unknown>>(
    sql: string,
    params: unknown[],
    operation: string,
    kind?: 'invitation',
  ): Promise<{ rows: T[] }> {
    try {
      return await this.client.query<T>(sql, params);
    } catch (error) {
      const code = (error as { code?: string }).code;
      const message = (error as { message?: string }).message ?? '';
      const failure = failureForSqlState(code, kind);
      if (failure === 'permission_denied' && /not a member/i.test(message)) {
        throw new TransportError(
          'not_a_member',
          `${operation}: not a member of this household`,
        );
      }
      throw new TransportError(failure, `${operation} failed (${failure}): ${message}`);
    }
  }
}
