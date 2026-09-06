import type { FinancialSnapshot } from '@family-finance/finance-engine';

import { copy } from '../lib/copy/copy';
import type { DataSourceDescriptor } from '../lib/dashboard/source';
import { screens } from '../lib/copy/screens';
import { AppShell } from './app-shell';
import { Card, LinkButton, SourceBanner } from './ui';
import { Badge } from './ui';

/**
 * The two things every screen needs before it can show a number: whether there is
 * a household at all, and how much the figures can be trusted.
 *
 * Kept here rather than repeated per page so that a screen cannot accidentally
 * omit the freshness chip, which is the one piece of context that turns a number
 * into a number a person can act on (UX-TRUST-001).
 */

export function StatusChips({ snapshot }: { snapshot: FinancialSnapshot }) {
  const { quality } = snapshot;
  const age = snapshot.freshnessAgeDays;

  const freshness =
    age === null
      ? copy.freshness.never
      : age <= 0
        ? copy.freshness.today
        : age === 1
          ? copy.freshness.yesterday
          : copy.freshness.days(age);

  return (
    <>
      <Badge tone={age !== null && age <= 3 ? 'success' : 'attention'}>{freshness}</Badge>
      <Badge tone={quality.confidence === 'high' ? 'success' : 'attention'}>
        {quality.missingData.length > 0
          ? copy.confidence.partial(quality.missingData.length)
          : copy.confidence[quality.confidence]}
      </Badge>
    </>
  );
}

/**
 * What every screen shows before a household exists.
 *
 * Not an error and not an empty table: an invitation, with the one thing to do
 * next. The first minute of using this product is the one where a family decides
 * whether it is for them.
 */
export function NoHousehold({
  active,
  title,
  reason,
}: {
  active: string;
  title: string;
  reason: string;
}) {
  return (
    <AppShell active={active} title={title}>
      <Card title={screens.setup.title} tone="primary">
        <p className="text-text-secondary">{reason}</p>
        <p className="mt-3 text-text-secondary">{screens.setup.intro}</p>
        <div className="mt-4">
          <LinkButton href="/setup">{screens.setup.create}</LinkButton>
        </div>
      </Card>
    </AppShell>
  );
}

/** The demonstration banner, shown on every screen whose figures are invented. */
export function SourceNotice({ descriptor }: { descriptor: DataSourceDescriptor }) {
  if (descriptor.isRealData) return null;
  if (descriptor.kind === 'none') return null;
  return <SourceBanner />;
}
