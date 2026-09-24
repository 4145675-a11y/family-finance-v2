import { AppShell } from '../../components/app-shell';
import { QuickCapture } from '../../components/quick-capture';
import { NoHousehold } from '../../components/screen';
import { EmptyPrompt } from '../../components/ui';
import { analyseQuickUpdateAction } from '../../lib/actions/quick';
import { quick } from '../../lib/copy/quick';
import { loadDashboardView } from '../../lib/dashboard/load';

/**
 * The quick update.
 *
 * One sentence in, one proposal out, one confirmation that goes through the same
 * commands as every other screen. It exists because the six-field form on
 * `/entry` is correct and slow, and a record that is never made because it took
 * too long is the one thing that makes every figure in this product wrong.
 *
 * One flow, deliberately. The page used to offer a choice between two ways of
 * reading the same sentence, which asked a person to decide something they had
 * no basis for deciding and that changed nothing about what could happen to
 * their money. The server now picks, silently, and falls back when it has to.
 *
 * What the page does **not** do is decide about money. It shows what was
 * understood and waits; confirming is a person's act, and it is the same
 * approval boundary a row from an uploaded file crosses.
 */

export const dynamic = 'force-dynamic';

export default async function QuickPage() {
  const view = await loadDashboardView();

  if (view.document === null) {
    return (
      <NoHousehold active="/quick" title={quick.heading} reason={view.descriptor.reason} />
    );
  }

  const open = view.document.accounts.filter((account) => account.closedAt === null);
  if (open.length === 0) {
    return (
      <AppShell active="/quick" title={quick.heading}>
        <EmptyPrompt
          title={quick.emptyTitle}
          body={quick.emptyReason}
          actionHref="/accounts"
          actionLabel={quick.addAccount}
        />
      </AppShell>
    );
  }

  return (
    <AppShell active="/quick" title={quick.heading}>
      <QuickCapture propose={analyseQuickUpdateAction} />
    </AppShell>
  );
}
