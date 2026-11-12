import type { FeedbackStatus } from '@family-finance/contracts';
import { redirect } from 'next/navigation';

import { AppShell } from '../../../components/app-shell';
import { ActionForm, HiddenValue } from '../../../components/form';
import { Badge, Card, LinkButton } from '../../../components/ui';
import { deleteFeedbackAction, setFeedbackStatusAction } from '../../../lib/actions/feedback';
import { activeBackend } from '../../../lib/auth/backend';
import { requireUnlocked } from '../../../lib/auth/guard';
import { isPlatformOwner } from '../../../lib/auth/platform';
import { feedbackCopy as t } from '../../../lib/copy/feedback';
import { reviewFeedback } from '../../../lib/feedback/server';
import { formatDateTime } from '../../../lib/format';

/**
 * The platform owner's review of feedback (ADR-0047 § 7).
 *
 * The redirect is the least of the protections: the list comes from a function
 * that returns nothing to anybody else, and every button calls a function that
 * checks `app.is_platform_admin()` for itself.
 *
 * What a note says is shown as text and never interpreted. A note that asks for
 * something to be run or published is a note, not an instruction.
 */

export const dynamic = 'force-dynamic';

export const metadata = { title: t.reviewTitle };

const STATUSES: readonly FeedbackStatus[] = ['new', 'approved', 'done', 'declined'];

function statusTone(status: FeedbackStatus): 'attention' | 'success' | 'neutral' {
  if (status === 'new') return 'attention';
  if (status === 'done') return 'success';
  return 'neutral';
}

export default async function FeedbackReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  if (activeBackend() !== 'supabase') redirect('/');
  await requireUnlocked();
  if (!(await isPlatformOwner())) redirect('/');

  const { status: filter } = await searchParams;
  const all = await reviewFeedback();
  const shown =
    filter !== undefined && (STATUSES as readonly string[]).includes(filter)
      ? all.filter((row) => row.status === filter)
      : all;

  return (
    <AppShell active="/admin" title={t.reviewTitle} subtitle={t.reviewSubtitle}>
      <Card fb="feedback-review-tools">
        <div className="flex flex-wrap items-center gap-2">
          <LinkButton href="/admin/feedback/export" tone="primary">
            {t.reviewDownload}
          </LinkButton>
          <LinkButton href="/admin/feedback" tone="secondary">
            {`${t.reviewFilterAll} (${all.length})`}
          </LinkButton>
          {STATUSES.map((status) => (
            <LinkButton key={status} href={`/admin/feedback?status=${status}`} tone="secondary">
              {`${t.statuses[status]} (${all.filter((row) => row.status === status).length})`}
            </LinkButton>
          ))}
        </div>
      </Card>

      {shown.length === 0 ? (
        <Card fb="feedback-review-empty">
          <p className="text-text-secondary">{t.reviewEmpty}</p>
        </Card>
      ) : (
        shown.map((row) => (
          <Card key={row.reference} fb="feedback-review-item">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-small" dir="ltr">
                {row.reference}
              </span>
              <Badge tone={statusTone(row.status)}>{t.statuses[row.status]}</Badge>
              <Badge>{t.kinds[row.kind]}</Badge>
              <Badge tone={row.urgency === 'high' ? 'attention' : 'neutral'}>
                {t.urgencies[row.urgency]}
              </Badge>
            </div>
            <p className="mt-2 text-small text-text-secondary">
              {t.reviewFamily(row.householdName)} · {formatDateTime(row.createdAt)} ·{' '}
              {t.reviewDevices[row.device]} {row.viewport.width}×{row.viewport.height}
            </p>
            <p className="mt-1 text-small text-text-secondary" dir="ltr">
              {row.route}
              {row.mark.type === 'page' ? '' : ` · ${row.mark.chain.join(' › ') || '—'}`}
              {row.build.commit === null ? '' : ` · ${row.build.commit.slice(0, 7)}`}
            </p>
            <p className="mt-1 text-small text-text-secondary">
              {t.reviewMarks[row.mark.type]}
            </p>
            {/* What the member wrote, as text. Never interpreted. */}
            <p className="mt-3 whitespace-pre-wrap">{row.text}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {STATUSES.filter((status) => status !== row.status).map((status) => (
                <ActionForm
                  key={status}
                  action={setFeedbackStatusAction}
                  submitLabel={`${t.reviewSetStatus}${t.statuses[status]}`}
                  tone="secondary"
                >
                  <>
                    <HiddenValue name="reference" value={row.reference} />
                    <HiddenValue name="status" value={status} />
                  </>
                </ActionForm>
              ))}
              <ActionForm
                action={deleteFeedbackAction}
                submitLabel={t.reviewDelete}
                tone="secondary"
              >
                <HiddenValue name="reference" value={row.reference} />
              </ActionForm>
            </div>
          </Card>
        ))
      )}
    </AppShell>
  );
}
