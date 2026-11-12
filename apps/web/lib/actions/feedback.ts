'use server';

import { randomBytes } from 'node:crypto';

import {
  feedbackReference,
  feedbackStatusSchema,
  parseFeedbackSubmission,
} from '@family-finance/contracts';
import { revalidatePath } from 'next/cache';

import { activeBackend } from '../auth/backend';
import { assertUnlocked, requireUnlocked } from '../auth/guard';
import { AuthError } from '../auth/model';
import { isPlatformOwner } from '../auth/platform';
import { feedbackCopy } from '../copy/feedback';
import { storeFeedback, type FeedbackOutcome } from '../feedback/server';
import { FieldReader, failed, succeeded, type FormState } from '../forms';
import { createClient } from '../supabase/server';

/**
 * Sending a note, and deciding on one (ADR-0047).
 *
 * `submitFeedbackAction` is called by the feedback button with a plain object.
 * Next checks that a server action is called from this site's own origin; what
 * the object holds is checked here, by the contract's white list, and then
 * again by the database's own constraints. Nothing in the object names the
 * author or the household — the session does.
 *
 * Nothing is logged about a note but the fact that one was stored, and even
 * that is left to the database: the text is never written to the console.
 */
export async function submitFeedbackAction(payload: unknown): Promise<FeedbackOutcome> {
  try {
    await assertUnlocked();
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, reason: 'signed_out' };
    throw error;
  }

  const parsed = parseFeedbackSubmission(payload);
  if (!parsed.ok) return { ok: false, reason: 'invalid' };

  // A filled trap is a bot. It is told it succeeded, and nothing is kept.
  if (parsed.trap) {
    return {
      ok: true,
      reference: feedbackReference(new Date(), randomBytes(3).toString('hex')),
    };
  }

  return storeFeedback(parsed.submission);
}

/** The platform owner's check, as a sentence rather than a raw refusal. */
async function requireOwner(): Promise<FormState | null> {
  await requireUnlocked();
  if (activeBackend() !== 'supabase' || !(await isPlatformOwner())) {
    return failed(feedbackCopy.reviewNotOwner);
  }
  return null;
}

/** Reads the reference a review form carries, in the shape the database expects. */
function readReference(data: FormData): string | null {
  const value = data.get('reference');
  if (typeof value !== 'string') return null;
  return /^fb-\d{8}-\d{6}-[0-9a-f]{6}$/u.test(value) ? value : null;
}

export async function setFeedbackStatusAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const refusal = await requireOwner();
  if (refusal !== null) return refusal;

  const reference = readReference(data);
  const status = feedbackStatusSchema.safeParse(
    new FieldReader(data).optionalText('status', 'status', 20),
  );
  if (reference === null || !status.success) return failed(feedbackCopy.reviewUnknown);

  const client = await createClient();
  const { error } = await client.rpc('admin_set_feedback_status', {
    p_reference: reference,
    p_status: status.data,
  });
  if (error !== null) {
    return failed(error.code === 'P0002' ? feedbackCopy.reviewUnknown : error.message);
  }

  revalidatePath('/admin/feedback');
  return succeeded(feedbackCopy.reviewStatusChanged);
}

export async function deleteFeedbackAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const refusal = await requireOwner();
  if (refusal !== null) return refusal;

  const reference = readReference(data);
  if (reference === null) return failed(feedbackCopy.reviewUnknown);

  const client = await createClient();
  const { error } = await client.rpc('admin_delete_feedback', { p_reference: reference });
  if (error !== null) {
    return failed(error.code === 'P0002' ? feedbackCopy.reviewUnknown : error.message);
  }

  revalidatePath('/admin/feedback');
  return succeeded(feedbackCopy.reviewDeleted);
}
