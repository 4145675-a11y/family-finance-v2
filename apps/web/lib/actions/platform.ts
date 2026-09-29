'use server';

import { revalidatePath } from 'next/cache';

import { requireUnlocked } from '../auth/guard';
import { isPlatformOwner } from '../auth/platform';
import { createClient } from '../supabase/server';
import { FieldReader, failed, succeeded, type FormState } from '../forms';
import { platform } from '../copy/platform';

/**
 * The platform owner's actions: which households exist, and who staffs them.
 *
 * Every one of these is a thin call onto a database function that checks
 * `app.is_platform_admin()` for itself. The check in this file is not the
 * boundary — it is there so a person who is not the owner gets a sentence
 * instead of a raw refusal, and so a mistake in a screen cannot turn into a
 * silent success. Delete every line of this file and the database still says no.
 *
 * None of them touches money. The platform owner creates a household, names its
 * first owner, switches it off, removes somebody — and cannot read a shekel of
 * what is inside, because no financial policy mentions them.
 */

/** The one place the refusal sentence is written. */
async function requireOwner(): Promise<FormState | null> {
  await requireUnlocked();
  if (!(await isPlatformOwner())) return failed(platform.notOwner);
  return null;
}

/**
 * Creates a household and the single-use invitation that will give it an owner.
 *
 * One database call, so it is one transaction: a household, its settings, and
 * the invitation, or none of them. The token comes back once, in the form's own
 * state, and is never stored — exactly like an ordinary household invitation.
 */
export async function createHouseholdForOwnerAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const refusal = await requireOwner();
  if (refusal !== null) return refusal;

  const reader = new FieldReader(data);
  const name = reader.text('householdName', platform.fieldHouseholdName, { max: 120 });
  const email = reader.text('ownerEmail', platform.fieldOwnerEmail, { max: 254 });
  if (!reader.ok) return failed(platform.incomplete, reader.errors);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    return failed(platform.incomplete, [{ field: 'ownerEmail', message: platform.badEmail }]);
  }

  const client = await createClient();
  const { data: created, error } = await client.rpc('admin_create_household_with_owner', {
    p_name: name,
    p_owner_email: email.trim().toLowerCase(),
  });
  if (error !== null) return failed(error.message);

  const row = Array.isArray(created) ? created[0] : created;
  const token = String((row as Record<string, unknown> | null)?.['token'] ?? '');

  revalidatePath('/admin');
  return succeeded(platform.householdCreated, token);
}

/** Approves a request, which creates the household and its first invitation. */
export async function approveRequestAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const refusal = await requireOwner();
  if (refusal !== null) return refusal;

  const reader = new FieldReader(data);
  const requestId = reader.id('requestId', platform.fieldRequest);
  const email = reader.optionalText('ownerEmail', platform.fieldOwnerEmail, 254);
  if (!reader.ok || requestId === null) return failed(platform.incomplete, reader.errors);

  const client = await createClient();
  const { data: created, error } = await client.rpc('approve_household_request', {
    p_request_id: requestId,
    p_owner_email: email === '' ? null : email,
  });
  if (error !== null) return failed(error.message);

  const row = Array.isArray(created) ? created[0] : created;
  const token = String((row as Record<string, unknown> | null)?.['token'] ?? '');

  revalidatePath('/admin');
  return succeeded(platform.requestApproved, token);
}

export async function declineRequestAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const refusal = await requireOwner();
  if (refusal !== null) return refusal;

  const requestId = new FieldReader(data).id('requestId', platform.fieldRequest);
  if (requestId === null) return failed(platform.incomplete);

  const client = await createClient();
  const { error } = await client.rpc('decline_household_request', { p_request_id: requestId });
  if (error !== null) return failed(error.message);

  revalidatePath('/admin');
  return succeeded(platform.requestDeclined);
}

/** Switches a household off, or back on. Its members stop seeing it entirely. */
export async function setHouseholdDisabledAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const refusal = await requireOwner();
  if (refusal !== null) return refusal;

  const reader = new FieldReader(data);
  const householdId = reader.id('householdId', platform.fieldHousehold);
  const disabled =
    reader.choice('disabled', platform.fieldHousehold, ['true', 'false'] as const, 'false') ===
    'true';
  if (householdId === null) return failed(platform.incomplete);

  const client = await createClient();
  const { error } = await client.rpc('admin_set_household_disabled', {
    p_household_id: householdId,
    p_disabled: disabled,
  });
  if (error !== null) return failed(error.message);

  revalidatePath('/admin');
  return succeeded(disabled ? platform.householdDisabled : platform.householdEnabled);
}

/** Withdraws an invitation nobody has redeemed. */
export async function revokeInvitationAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const refusal = await requireOwner();
  if (refusal !== null) return refusal;

  const invitationId = new FieldReader(data).id('invitationId', platform.fieldInvitation);
  if (invitationId === null) return failed(platform.incomplete);

  const client = await createClient();
  const { error } = await client.rpc('admin_revoke_invitation', {
    p_invitation_id: invitationId,
  });
  if (error !== null) return failed(error.message);

  revalidatePath('/admin');
  return succeeded(platform.invitationRevoked);
}

/**
 * Whether a person without an invitation may ask for a household.
 *
 * Off by default, and off is the state this product ships in: the ordinary way
 * in is an invitation the platform owner sent to a named address.
 */
export async function setRequestsEnabledAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const refusal = await requireOwner();
  if (refusal !== null) return refusal;

  const enabled =
    new FieldReader(data).choice(
      'enabled',
      platform.requestsTitle,
      ['true', 'false'] as const,
      'false',
    ) === 'true';
  const client = await createClient();
  const { error } = await client
    .from('platform_settings')
    .update({ household_requests_enabled: enabled })
    .eq('id', true);
  if (error !== null) return failed(error.message);

  revalidatePath('/admin');
  revalidatePath('/join');
  return succeeded(enabled ? platform.requestsOpened : platform.requestsClosed);
}

/**
 * Asking for a household, as somebody who has none.
 *
 * Creates nothing. The database refuses outright while requests are closed, so
 * a stale page cannot smuggle a request through after they are shut.
 */
export async function requestHouseholdAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  await requireUnlocked();

  const reader = new FieldReader(data);
  const name = reader.text('householdName', platform.fieldHouseholdName, { max: 120 });
  const note = reader.optionalText('note', platform.fieldNote, 500);
  if (!reader.ok) return failed(platform.incomplete, reader.errors);

  const client = await createClient();
  const { error } = await client.rpc('request_household', {
    p_household_name: name,
    p_note: note === '' ? null : note,
  });
  if (error !== null) return failed(platform.requestRefused);

  revalidatePath('/join');
  return succeeded(platform.requestSent);
}
