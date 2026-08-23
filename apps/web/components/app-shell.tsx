import Link from 'next/link';
import type { ReactNode } from 'react';

import { CALCULATION_VERSION, POLICY_VERSION } from '@family-finance/finance-engine';

import { copy } from '../lib/copy/copy';
import { Figure } from './ui';

/**
 * The application shell: header, navigation and footer.
 *
 * 03-UX-SPEC.md § ניווט fixes the five destinations and asks for bottom navigation
 * on mobile and a right-hand sidebar on desktop. Both are rendered from the same
 * list here, so the two can never drift apart.
 *
 * Approvals and activity are real routes that say plainly they are still being
 * built. That is an honest state rather than a placeholder pretending to be a
 * capability: nothing there shows a number, and no navigation item leads to
 * something that looks finished and is not.
 */

export interface NavItem {
  readonly href: string;
  readonly label: string;
  /** Whether the destination is a working screen today. */
  readonly ready: boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/', label: copy.nav.home, ready: true },
  { href: '/approvals', label: copy.nav.approvals, ready: false },
  { href: '/activity', label: copy.nav.activity, ready: false },
  { href: '/budget', label: copy.nav.planning, ready: true },
  { href: '/more', label: copy.nav.more, ready: true },
];

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={`flex min-h-11 min-w-11 flex-1 items-center justify-center rounded-control px-2 py-2 text-center text-small font-medium transition-colors sm:justify-start sm:px-3 sm:text-body ${
        active
          ? 'bg-primary text-surface'
          : 'text-text-secondary hover:bg-surface-muted hover:text-text-primary'
      }`}
    >
      {item.label}
    </Link>
  );
}

export function AppShell({
  active,
  title,
  subtitle,
  children,
}: {
  active: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-5 px-4 pt-5 pb-28 sm:px-6 sm:pb-10">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <h1 className="text-[24px] leading-tight font-bold sm:text-[32px]">{title}</h1>
          {subtitle ? <p className="mt-1 text-text-secondary">{subtitle}</p> : null}
        </div>
        <p className="text-small text-text-secondary">{copy.app.name}</p>
      </header>

      <div className="flex flex-col gap-5 sm:flex-row-reverse sm:items-start sm:gap-6">
        {/* Desktop navigation, on the right as a Hebrew document expects. */}
        <nav
          aria-label={copy.nav.ariaMain}
          className="hidden shrink-0 flex-col gap-1 rounded-card border border-border bg-surface p-2 shadow-card sm:flex sm:w-44"
        >
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.href} item={item} active={item.href === active} />
          ))}
        </nav>

        <main className="flex min-w-0 flex-1 flex-col gap-5">{children}</main>
      </div>

      <footer className="mt-auto border-t border-border pt-4 text-small text-text-secondary">
        <p>
          גרסת חישוב <Figure>{CALCULATION_VERSION}</Figure> · גרסת כללים{' '}
          <Figure>{POLICY_VERSION}</Figure>
        </p>
      </footer>

      {/* Mobile bottom navigation. Every target is at least 44px, per the design system. */}
      <nav
        aria-label={copy.nav.ariaBottom}
        className="fixed inset-x-0 bottom-0 border-t border-border bg-surface sm:hidden"
      >
        <ul className="mx-auto flex max-w-5xl items-stretch gap-1 px-2 py-2">
          {NAV_ITEMS.map((item) => (
            <li key={item.href} className="flex flex-1">
              <NavLink item={item} active={item.href === active} />
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
