import 'server-only';

import { cache } from 'react';

import { activeBackend } from './backend';
import { currentUser } from './supabase';
import { createClient } from '../supabase/server';

/**
 * The platform owner — the one identity that may bring a household into being.
 *
 * Everything here asks the **database** rather than deciding anything. The
 * authorisation lives in `app.is_platform_admin()` and in the policies and
 * functions that consult it; a screen calling `isPlatformOwner()` is choosing
 * what to render, not choosing who may act. If this file returned `true` for
 * everybody, the database would still refuse every one of the calls below.
 *
 * That ordering matters more than it looks. Hiding a control is a courtesy to
 * the person using the product; it is not a security boundary, and a server
 * action is reachable by anybody who can read the page's JavaScript.
 */

/**
 * Whether the signed-in person holds platform ownership.
 *
 * `cache` scopes the answer to one request, so a page and the actions it renders
 * ask once. A person who is not signed in, or a deployment on the file backend
 * where the concept does not exist, is not an owner.
 */
export const isPlatformOwner = cache(async (): Promise<boolean> => {
  if (activeBackend() !== 'supabase') return false;
  if ((await currentUser()) === null) return false;

  const client = await createClient();
  const { data, error } = await client.rpc('is_platform_owner');
  if (error !== null) return false;
  return data === true;
});

export interface HouseholdOverviewRow {
  readonly householdId: string;
  readonly name: string;
  readonly createdAt: string;
  readonly disabledAt: string | null;
  readonly memberCount: number;
  readonly ownerCount: number;
  readonly pendingInvites: number;
}

/**
 * Every household, with how it is staffed and whether it is switched on.
 *
 * Counts and names, never a figure of money: the whole point of the role is that
 * it can staff a household without reading it. The function returns nothing at
 * all to anybody who is not the platform owner, so an empty list here is the
 * database's answer rather than this file's.
 */
export async function householdOverview(): Promise<HouseholdOverviewRow[]> {
  const client = await createClient();
  const { data, error } = await client.rpc('admin_household_overview');
  if (error !== null) throw new Error(error.message);

  return (data ?? []).map((row: Record<string, unknown>) => ({
    householdId: String(row['household_id']),
    name: String(row['name']),
    createdAt: String(row['created_at']),
    disabledAt: row['disabled_at'] === null ? null : String(row['disabled_at']),
    memberCount: Number(row['member_count'] ?? 0),
    ownerCount: Number(row['owner_count'] ?? 0),
    pendingInvites: Number(row['pending_invites'] ?? 0),
  }));
}

export interface HouseholdRequestRow {
  readonly id: string;
  readonly householdName: string;
  readonly note: string | null;
  readonly status: 'pending' | 'approved' | 'declined';
  readonly createdAt: string;
}

/** Requests waiting for a decision, newest last. Readable only by the owner. */
export async function householdRequests(): Promise<HouseholdRequestRow[]> {
  const client = await createClient();
  const { data, error } = await client
    .from('household_requests')
    .select('id, household_name, note, status, created_at')
    .order('created_at', { ascending: true });
  if (error !== null) throw new Error(error.message);

  return (data ?? []).map((row) => ({
    id: String(row.id),
    householdName: String(row.household_name),
    note: row.note === null ? null : String(row.note),
    status: row.status as 'pending' | 'approved' | 'declined',
    createdAt: String(row.created_at),
  }));
}

/** Whether a person without an invitation may ask for a household at all. */
export async function requestsEnabled(): Promise<boolean> {
  if (activeBackend() !== 'supabase') return false;
  const client = await createClient();
  const { data, error } = await client
    .from('platform_settings')
    .select('household_requests_enabled')
    .maybeSingle();
  if (error !== null || data === null) return false;
  return data.household_requests_enabled === true;
}
