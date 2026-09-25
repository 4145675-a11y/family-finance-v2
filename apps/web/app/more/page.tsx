import { CALCULATION_VERSION, POLICY_VERSION } from '@family-finance/finance-engine';

import { AppShell } from '../../components/app-shell';
import { Card, Figure, LinkList, StatRow } from '../../components/ui';
import { copy } from '../../lib/copy/copy';
import { screens } from '../../lib/copy/screens';
import { householdExists } from '../../lib/dashboard/load';
import { requireUnlocked } from '../../lib/auth/guard';
import { accountScreen, authScreen } from '../../lib/copy/security';
import { activeBackend } from '../../lib/auth/backend';
import { gemach } from '../../lib/copy/gemach';

/**
 * "עוד" — everything the home screen deliberately does not carry.
 *
 * The home screen answers today's question. This is where the rest lives:
 * the detail screens for investigating, the housekeeping, and the technical
 * evidence. Grouping matters more than completeness here — a flat list of twelve
 * links is a list nobody reads.
 *
 * Since the primary navigation came down to five, this is the **only** index of
 * the other screens, so every one of them has to be reachable from here. A screen
 * that is in neither place does not exist as far as a person is concerned, and
 * `/entry` was in that position for exactly as long as it took to notice.
 */

export const dynamic = 'force-dynamic';

export default async function MorePage() {
  await requireUnlocked();
  const exists = await householdExists();

  const picture = [
    { href: '/forecast', title: copy.forecast.title, description: copy.forecast.endQuestion },
    { href: '/gemach', title: gemach.title, description: gemach.subtitle },
    {
      href: '/rules',
      title: 'כללים',
      description: 'מה שאמרתם לנו על השורות בדף החשבון — לראות, לשנות, לכבות או למחוק',
    },
    { href: '/business', title: copy.business.title, description: copy.business.safeToMove },
    { href: '/budget', title: copy.budget.title, description: copy.budget.subtitle },
    {
      href: '/accounts',
      title: screens.accounts.title,
      description: screens.accounts.subtitle,
    },
    { href: '/reports', title: screens.reports.title, description: screens.reports.subtitle },
  ];

  const keeping = [
    { href: '/entry', title: screens.entry.title, description: screens.entry.subtitle },
    { href: '/tasks', title: screens.tasks.title, description: screens.tasks.subtitle },
    { href: '/upload', title: screens.upload.title, description: screens.upload.subtitle },
    {
      href: '/approvals',
      title: screens.approvals.title,
      description: screens.approvals.subtitle,
    },
    {
      href: '/activity',
      title: screens.activity.title,
      description: screens.activity.subtitle,
    },
  ];

  const household = [
    { href: '/setup', title: screens.setup.title, description: screens.setup.intro },
    {
      href: '/settings',
      title: screens.settings.title,
      description: screens.settings.subtitle,
    },
    { href: '/backup', title: screens.backup.title, description: screens.backup.subtitle },
    activeBackend() === 'supabase'
      ? {
          href: '/account',
          title: accountScreen.membersTitle,
          description: accountScreen.inviteIntro,
        }
      : { href: '/security', title: authScreen.title, description: authScreen.setupIntro },
  ];

  return (
    <AppShell active="/more" title={copy.nav.more}>
      <Card title={copy.nav.groupPicture}>
        <LinkList items={picture} />
      </Card>

      <Card title={copy.nav.groupKeeping}>
        <LinkList items={keeping} />
      </Card>

      <Card title={copy.app.household}>
        <LinkList items={household} />
        {exists ? null : (
          <p className="mt-3 text-small text-text-secondary">{screens.setup.intro}</p>
        )}
      </Card>

      {/* Real evidence, and not something a family reads at breakfast. It moved
          off the home screen for that reason, and it did not disappear. */}
      <Card title={copy.sections.technical}>
        <StatRow label="גרסת חישוב" value={<Figure>{CALCULATION_VERSION}</Figure>} />
        <StatRow label="גרסת כללים" value={<Figure>{POLICY_VERSION}</Figure>} />
      </Card>
    </AppShell>
  );
}
