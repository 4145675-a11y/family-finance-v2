import Link from 'next/link';
import type { ReactNode } from 'react';

import { copy } from '../lib/copy/copy';
import { Mark } from './ui';

/**
 * The application shell: header, navigation and content column.
 *
 * 03-UX-SPEC.md § ניווט fixes the five destinations and asks for bottom navigation
 * on mobile and a right-hand sidebar on desktop. Both are rendered from the same
 * list, so the two can never drift apart.
 *
 * The sidebar uses `flex-row`, not `flex-row-reverse`. In a right-to-left
 * document `row` already lays children out from the right, so the first child —
 * the navigation — sits on the right where a Hebrew reader expects it. Reversing
 * it, which is what this shell did until the layout was inspected in a browser,
 * pushed the navigation to the left.
 *
 * The header is one line. It carries who we are, how fresh the picture is and how
 * complete it is, and nothing else: vertical space above the answer is the most
 * expensive space on the screen. The calculation version moved to "עוד" — it is
 * real evidence, and it is not something a family reads at breakfast.
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
  status,
  showHeading = true,
  children,
}: {
  active: string;
  title: string;
  /** Freshness and completeness chips, shown at the end of the header line. */
  status?: ReactNode;
  /**
   * Whether the shell renders the page's `h1`. The home screen sets this false
   * because its dominant question is the heading — one `h1`, and it is the thing
   * the reader is actually looking at.
   */
  showHeading?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-4 px-4 pt-4 pb-24 sm:px-6 sm:pb-8">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <Link
          href="/"
          className="flex items-center gap-2 rounded-control text-primary transition-colors hover:text-primary-hover"
        >
          <Mark />
          <span className="text-[18px] font-bold text-text-primary">{copy.app.name}</span>
          <span className="text-small text-text-secondary">· {copy.app.household}</span>
        </Link>
        {status ? <div className="flex flex-wrap items-center gap-2">{status}</div> : null}
      </header>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
        {/* First child, and therefore the right-hand column in a Hebrew document. */}
        <nav
          aria-label={copy.nav.ariaMain}
          className="hidden shrink-0 flex-col gap-1 rounded-card border border-border bg-surface p-2 shadow-card sm:flex sm:w-40"
        >
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.href} item={item} active={item.href === active} />
          ))}
        </nav>

        <main className="flex min-w-0 flex-1 flex-col gap-4">
          {showHeading ? (
            <h1 className="px-1 text-[24px] leading-tight font-bold">{title}</h1>
          ) : null}
          {children}
        </main>
      </div>

      {/* Mobile bottom navigation. Every target is at least 44px, per the design system. */}
      <nav
        aria-label={copy.nav.ariaBottom}
        className="fixed inset-x-0 bottom-0 border-t border-border bg-surface sm:hidden"
      >
        <ul className="mx-auto flex max-w-6xl items-stretch gap-1 px-2 py-2">
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
