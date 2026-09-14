'use server';

import { redirect } from 'next/navigation';

import { activeBackend } from '../auth/backend';
import { requireUser, signInWithPassword, signOut } from '../auth/supabase';
import { authScreen } from '../copy/security';
import { failed, FieldReader, type FormState } from '../forms';
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

/** Where to go after signing in. Only a path on this site is ever followed. */
function safeNext(value: FormDataEntryValue | null): string {
  if (typeof value !== 'string') return '/';
  return value.startsWith('/') && !value.startsWith('//') ? value : '/';
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
  redirect(safeNext(data.get('next')));
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
