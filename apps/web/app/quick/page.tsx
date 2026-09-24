import { AppShell } from '../../components/app-shell';
import { QuickCapture } from '../../components/quick-capture';
import { NoHousehold } from '../../components/screen';
import { Card, EmptyPrompt, Notice } from '../../components/ui';
import { analyseQuickUpdateAction, interpretQuickUpdateAction } from '../../lib/actions/quick';
import { aiConfigured } from '../../lib/ai/server';
import { quick } from '../../lib/copy/quick';
import { loadDashboardView } from '../../lib/dashboard/load';

/**
 * The quick update.
 *
 * One sentence in, a proposal out, an approval that goes through the same
 * commands as every other screen. It exists because the six-field form on
 * `/entry` is correct and slow, and a record that is never made because it took
 * too long is the one thing that makes every figure in this product wrong.
 *
 * What it does **not** do is decide. The page shows what the server understood
 * and waits; approving is a person's act, and it is the same approval boundary a
 * row from an uploaded file crosses.
 */

export const dynamic = 'force-dynamic';

export default async function QuickPage() {
  const view = await loadDashboardView();

  if (view.document === null) {
    return <NoHousehold active="/quick" title={quick.title} reason={view.descriptor.reason} />;
  }

  const open = view.document.accounts.filter((account) => account.closedAt === null);
  if (open.length === 0) {
    return (
      <AppShell active="/quick" title={quick.title}>
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
    <AppShell active="/quick" title={quick.title}>
      {/*
       * Where the point of no return is, before a person types anything about
       * money. The upload screen makes the same promise above its file picker for
       * the same reason: it is the question they actually have.
       */}
      <Notice tone="primary" title={quick.promise}>
        {quick.promiseBody}
      </Notice>

      <Card title={quick.subtitle}>
        <QuickCapture
          action={interpretQuickUpdateAction}
          analyse={analyseQuickUpdateAction}
          aiConfigured={aiConfigured()}
        />
      </Card>
    </AppShell>
  );
}
