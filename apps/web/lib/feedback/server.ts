import 'server-only';

import {
  feedbackBuildSchema,
  routeTemplate,
  deviceForWidth,
  FEEDBACK_SCHEMA_VERSION,
  type FeedbackBuild,
  type FeedbackMark,
  type FeedbackReviewRow,
  type FeedbackStatus,
  type FeedbackSubmission,
} from '@family-finance/contracts';
import { FeedbackLimitError } from '@family-finance/local-store';

import { activeBackend } from '../auth/backend';
import { AuthError } from '../auth/model';
import { localFeedbackStore } from '../store/server';
import { createClient } from '../supabase/server';

/**
 * Where a feedback note goes, on either backend (ADR-0047).
 *
 * The caller hands over a submission that already passed the contract's white
 * list. Nothing here adds anything the browser sent: the author and household
 * are the session's (the database decides them), the route is a template, and
 * the build is read from the environment Render provides.
 */

export type FeedbackRefusal = 'invalid' | 'limit' | 'no_household' | 'signed_out' | 'failed';

export type FeedbackOutcome =
  | { readonly ok: true; readonly reference: string }
  | { readonly ok: false; readonly reason: FeedbackRefusal };

/**
 * Which code is serving. Render sets both variables on every deploy; a local
 * build has neither, and a value that does not look like a commit is dropped
 * rather than stored.
 */
export function currentBuild(): FeedbackBuild {
  const parsed = feedbackBuildSchema.safeParse({
    commit: (process.env['RENDER_GIT_COMMIT'] ?? '').trim() || null,
    branch: (process.env['RENDER_GIT_BRANCH'] ?? '').trim() || null,
  });
  return parsed.success ? parsed.data : { commit: null, branch: null };
}

/** The mark as the database column holds it — rebuilt by name, like the record. */
function markForDatabase(mark: FeedbackMark): FeedbackMark {
  if (mark.type === 'page') return { type: 'page' };
  return {
    type: mark.type,
    chain: [...mark.chain],
    rect: { x: mark.rect.x, y: mark.rect.y, width: mark.rect.width, height: mark.rect.height },
  };
}

export async function storeFeedback(submission: FeedbackSubmission): Promise<FeedbackOutcome> {
  const build = currentBuild();

  if (activeBackend() !== 'supabase') {
    try {
      return { ok: true, reference: await localFeedbackStore().submit(submission, build) };
    } catch (error) {
      if (error instanceof FeedbackLimitError) return { ok: false, reason: 'limit' };
      if (error instanceof AuthError) return { ok: false, reason: 'signed_out' };
      throw error;
    }
  }

  const client = await createClient();
  const { data, error } = await client.rpc('submit_feedback', {
    p_kind: submission.kind,
    p_urgency: submission.urgency,
    p_body: submission.text,
    p_mark: markForDatabase(submission.mark),
    p_route: routeTemplate(submission.path),
    p_viewport_width: submission.viewport.width,
    p_viewport_height: submission.viewport.height,
    p_scroll_y: submission.viewport.scrollY,
    p_device: deviceForWidth(submission.viewport.width),
    p_build_commit: build.commit,
    p_build_branch: build.branch,
    p_schema_version: FEEDBACK_SCHEMA_VERSION,
  });
  if (error !== null) {
    if (error.code === '28000') return { ok: false, reason: 'signed_out' };
    if (error.code === '42501') return { ok: false, reason: 'no_household' };
    if (error.code === 'P0001') return { ok: false, reason: 'limit' };
    if (error.code === '23514' || error.code === '22023' || error.code === '22P02') {
      return { ok: false, reason: 'invalid' };
    }
    return { ok: false, reason: 'failed' };
  }
  return { ok: true, reference: String(data) };
}

/** Every note, newest first — for the platform owner. Empty for anybody else. */
export async function reviewFeedback(): Promise<FeedbackReviewRow[]> {
  const client = await createClient();
  const { data, error } = await client.rpc('admin_feedback_list');
  if (error !== null) throw new Error(error.message);

  return (data ?? []).map((row: Record<string, unknown>): FeedbackReviewRow => ({
    reference: String(row['reference']),
    createdAt: String(row['created_at']),
    status: row['status'] as FeedbackStatus,
    kind: row['kind'] as FeedbackReviewRow['kind'],
    urgency: row['urgency'] as FeedbackReviewRow['urgency'],
    text: String(row['body']),
    mark: row['mark'] as FeedbackMark,
    route: String(row['route']),
    viewport: {
      width: Number(row['viewport_width']),
      height: Number(row['viewport_height']),
      scrollY: Number(row['scroll_y']),
    },
    device: row['device'] as FeedbackReviewRow['device'],
    build: {
      commit: row['build_commit'] === null ? null : String(row['build_commit']),
      branch: row['build_branch'] === null ? null : String(row['build_branch']),
    },
    schemaVersion: Number(row['schema_version']),
    householdName: row['household_name'] === null ? null : String(row['household_name']),
  }));
}
