import { AppShell } from '../../components/app-shell';
import { ComingSoon } from '../../components/ui';
import { copy } from '../../lib/copy/copy';

/**
 * Activity.
 *
 * The transaction list needs stored transactions, which needs the migrations that
 * have never been applied. Until then this says so rather than showing an empty
 * table that looks like a family with no spending.
 */
export default function ActivityPage() {
  return (
    <AppShell active="/activity" title={copy.nav.activity}>
      <ComingSoon title={copy.nav.activity} />
    </AppShell>
  );
}
