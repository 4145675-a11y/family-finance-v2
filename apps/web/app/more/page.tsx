import Link from 'next/link';

import { AppShell } from '../../components/app-shell';
import { Card } from '../../components/ui';
import { copy } from '../../lib/copy/copy';

/**
 * "עוד" — the way to the detailed screens.
 *
 * These are the screens for investigating rather than deciding, which is exactly
 * why they are one level away from the home screen.
 */
const DESTINATIONS = [
  { href: '/forecast', label: copy.forecast.title, note: copy.forecast.endQuestion },
  { href: '/debts', label: copy.debts.title, note: copy.debts.realStoryTitle },
  { href: '/business', label: copy.business.title, note: copy.business.safeToMove },
  { href: '/budget', label: copy.budget.title, note: copy.budget.subtitle },
];

export default function MorePage() {
  return (
    <AppShell active="/more" title={copy.nav.more}>
      <Card>
        <ul className="flex flex-col">
          {DESTINATIONS.map((destination) => (
            <li key={destination.href} className="border-b border-border last:border-b-0">
              <Link
                href={destination.href}
                className="flex min-h-11 flex-col justify-center py-3 hover:text-primary"
              >
                <span className="font-medium">{destination.label}</span>
                <span className="text-small text-text-secondary">{destination.note}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </AppShell>
  );
}
