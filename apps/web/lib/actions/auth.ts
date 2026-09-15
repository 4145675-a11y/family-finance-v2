'use server';

import { redirect } from 'next/navigation';

import { activeBackend } from '../auth/backend';
import { safeNextPath } from '../auth/redirect';
import {
  requestPasswordReset,
  requireUser,
  signInWithPassword,
  signOut,
  updatePassword,
} from '../auth/supabase';
import { accountScreen, authScreen } from '../copy/security';
import { failed, FieldReader, succeeded, type FormState } from '../forms';
import { supabaseHouseholdStore } from '../store/server';
import { describe } from './errors';

/**
 * Sign in, sign out and invitation acceptance for the database backend.
 *
 * Every action here refuses to run under the file backend: there is no
 * password there, and a form that appears to accept one would be a lie.
 */

function requireSupabaseBackend(): FormState | null {
  return activeBackend() === 'supabase'
    ? null
    : failed(authScreen.errors['auth_unavailable'] ?? '');
}

export async function signInAction(_previous: FormState, data: FormData): Promise<FormState> {
  const refused = requireSupabaseBackend();
  if (refused !== null) return refused;

  const reader = new FieldReader(data);
  const email = reader.text('email', 'אימייל', { max: 254 });
  const password = reader.text('password', 'סיסמה', { max: 256 });
  if (!reader.ok) return failed('בואו נשלים כמה פרטים.', reader.errors);

  const result = await signInWithPassword(email.trim().toLowerCase(), password);
  if (!result.ok) {
    return failed(
      result.failure === 'invalid_credentials'
        ? (authScreen.errors['invalid_credentials'] ?? '')
        : (authScreen.errors['auth_unavailable'] ?? ''),
    );
  }
  redirect(safeNextPath(data.get('next')));
}

export async function signOutAction(): Promise<void> {
  if (activeBackend() === 'supabase') await signOut();
  redirect('/login');
}

/** Redeems an invitation token as the signed-in person. */
export async function acceptInvitationAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const refused = requireSupabaseBackend();
  if (refused !== null) return refused;

  const reader = new FieldReader(data);
  const token = reader.text('token', 'קוד הזמנה', { max: 200 });
  if (!reader.ok) return failed('בואו נשלים כמה פרטים.', reader.errors);

  try {
    await requireUser();
    const store = await supabaseHouseholdStore();
    await store.acceptInvitation(token.trim());
  } catch (error) {
    return describe(error);
  }
  redirect('/');
}

/** The minimum this product accepts. Supabase enforces its own floor as well. */
const MIN_PASSWORD_LENGTH = 10;

/**
 * Sets a new password for the signed-in person — after an invitation or a
 * recovery link, or by choice. The session must exist; the link routes create
 * it, so a person who lands here without one is sent to sign in.
 */
export async function setPasswordAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const refused = requireSupabaseBackend();
  if (refused !== null) return refused;

  const reader = new FieldReader(data);
  const password = reader.text('password', accountScreen.newPassword, { max: 256 });
  if (!reader.ok) return failed('בואו נשלים כמה פרטים.', reader.errors);
  if (password.length < MIN_PASSWORD_LENGTH) {
    return failed(accountScreen.passwordTooShort, [
      { field: 'password', message: accountScreen.passwordTooShort },
    ]);
  }

  try {
    await requireUser();
  } catch (error) {
    return describe(error);
  }
  const outcome = await updatePassword(password);
  if (!outcome.ok) return failed(authScreen.errors['auth_unavailable'] ?? '');
  redirect('/');
}

/**
 * Asks the auth server to email a recovery link. The answer is the same
 * whether or not the address exists: an address book must not be readable
 * through a password form.
 */
export async function requestPasswordResetAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const refused = requireSupabaseBackend();
  if (refused !== null) return refused;

  const reader = new FieldReader(data);
  const email = reader.text('email', accountScreen.email, { max: 254 });
  if (!reader.ok) return failed('בואו נשלים כמה פרטים.', reader.errors);

  await requestPasswordReset(email.trim().toLowerCase());
  return succeeded(accountScreen.forgotSent);
}
