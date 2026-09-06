import { Card, LinkButton } from '../../components/ui';
import { screens } from '../../lib/copy/screens';

/**
 * What an installed app shows when there is no connection.
 *
 * Deliberately empty of figures. The service worker serves this instead of a
 * cached page precisely so that no number reaches a person's eyes without being
 * current — a balance from last Tuesday shown without saying so is the failure
 * this page exists to prevent.
 *
 * Prerendered, because it has to be available when nothing else is.
 */

export const metadata = {
  title: screens.offline.title,
};

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 p-6">
      <Card title={screens.offline.title} tone="attention">
        <p className="text-text-secondary">{screens.offline.body}</p>
        <p className="mt-3 text-text-secondary">{screens.setup.privacyBody}</p>
        <div className="mt-5">
          <LinkButton href="/">{screens.common.back}</LinkButton>
        </div>
      </Card>
    </main>
  );
}
