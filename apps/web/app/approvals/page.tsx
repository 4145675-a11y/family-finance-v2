import { AppShell } from '../../components/app-shell';
import { ComingSoon } from '../../components/ui';
import { copy } from '../../lib/copy/copy';

/**
 * Approvals.
 *
 * 03-UX-SPEC.md § Approval Inbox belongs to Milestone 8, which needs the import
 * pipeline and a verified database beneath it. The route exists because the
 * navigation names it; it shows no figure and claims nothing.
 */
export default function ApprovalsPage() {
  return (
    <AppShell active="/approvals" title={copy.nav.approvals}>
      <ComingSoon title={copy.nav.approvals} />
    </AppShell>
  );
}
