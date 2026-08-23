import Link from 'next/link';
import type { ReactNode } from 'react';

import { CALCULATION_VERSION, POLICY_VERSION } from '@family-finance/finance-engine';

import { Figure } from './ui';

/**
 * The application shell: header, navigation and footer.
 *
 * 03-UX-SPEC.md § ניווט asks for bottom navigation on mobile and a right-hand
 * sidebar on desktop. Both are rendered from the same list here, so the two can
 * never drift apart.
 *
 * The destinations are the screens that actually exist. Approvals, imports and
 * planning belong to later milestones and are deliberately absent: a navigation
 * item that leads to an empty promise is a placeholder presented as a capability,
 * which CLAUDE.md forbids.
 */

export interface NavItem {
  readonly href: string;
  readonly label: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/', label: 'בית' },
  { href: '/forecast', label: 'תחזית' },
  { href: '/debts', label: 'חובות' },
  { href: '/business', label: 'עסק' },
];

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={`flex min-h-11 min-w-11 items-center justify-center rounded-control px-3 py-2 text-center ${
        active
          ? 'bg-primary text-surface font-semibold'
          : 'text-text-secondary hover:text-text-primary'
      }`}
    >
      {item.label}
    </Link>
  );
}

export function AppShell({
  active,
  title,
  children,
}: {
  active: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-4 px-4 pt-4 pb-24 sm:pb-8">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-[24px] leading-tight font-bold">{title}</h1>
        <p className="text-small text-text-secondary">מרכז השליטה הכלכלי המשפחתי</p>
      </header>

      <div className="flex flex-col gap-4 sm:flex-row-reverse sm:items-start">
        {/* Desktop sidebar, on the right as the spec requires for Hebrew. */}
        <nav aria-label="ניווט ראשי" className="hidden shrink-0 flex-col gap-1 sm:flex sm:w-40">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.href} item={item} active={item.href === active} />
          ))}
        </nav>

        <main className="flex min-w-0 flex-1 flex-col gap-4">{children}</main>
      </div>

      <footer className="mt-auto border-t border-border pt-3 text-small text-text-secondary">
        <p>
          גרסת חישוב <Figure>{CALCULATION_VERSION}</Figure> · גרסת מדיניות{' '}
          <Figure>{POLICY_VERSION}</Figure>
        </p>
      </footer>

      {/* Mobile bottom navigation. Touch targets are at least 44px per the design system. */}
      <nav
        aria-label="ניווט תחתון"
        className="fixed inset-x-0 bottom-0 border-t border-border bg-surface sm:hidden"
      >
        <ul className="mx-auto flex max-w-5xl items-stretch justify-around gap-1 px-2 py-2">
          {NAV_ITEMS.map((item) => (
            <li key={item.href} className="flex-1">
              <NavLink item={item} active={item.href === active} />
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
