import Link from 'next/link';
import type { ReactNode } from 'react';

import { copy } from '../lib/copy/copy';
import type { DataSourceDescriptor } from '../lib/dashboard/source';
import { Mark, SourceBanner } from './ui';

/**
 * The application shell: header, navigation and content column.
 *
 * 03-UX-SPEC.md § ניווט asks for bottom navigation on mobile and a right-hand
 * sidebar on desktop. Both are rendered from the same list so the two can never
 * drift apart, and the split between them is a product decision rather than a
 * layout one: a phone gets the five things a person does standing up, a desktop
 * gets everything, because that is where a family sits down with the picture.
 *
 * The sidebar uses `flex-row`, not `flex-row-reverse`. In a right-to-left
 * document `row` already lays children out from the right, so the first child —
 * the navigation — sits on the right where a Hebrew reader expects it. Reversing
 * it, which is what this shell did until the layout was inspected in a browser,
 * pushed the navigation to the left.
 *
 * The header is one line. It carries who we are, how fresh the picture is and how
 * complete it is, and nothing else: vertical space above the answer is the most
 * expensive space on the screen.
 */

export interface NavItem {
  readonly href: string;
  readonly label: string;
  /** Whether the destination also appears in the phone's bottom bar. */
  readonly onPhone: boolean;
}

export interface NavGroup {
  readonly title: string;
  readonly items: readonly NavItem[];
}

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    title: copy.nav.groupToday,
    items: [
      { href: '/', label: copy.nav.home, onPhone: true },
      { href: '/entry', label: copy.nav.entry, onPhone: true },
      { href: '/upload', label: copy.nav.upload, onPhone: false },
      { href: '/approvals', label: copy.nav.approvals, onPhone: true },
    ],
  },
  {
    title: copy.nav.groupPicture,
    items: [
      { href: '/accounts', label: copy.nav.accounts, onPhone: false },
      { href: '/budget', label: copy.nav.planning, onPhone: true },
      { href: '/debts', label: copy.nav.debts, onPhone: false },
      { href: '/forecast', label: copy.nav.forecast, onPhone: false },
      { href: '/business', label: copy.nav.business, onPhone: false },
    ],
  },
  {
    title: copy.nav.groupKeeping,
    items: [
      { href: '/tasks', label: copy.nav.tasks, onPhone: false },
      { href: '/reports', label: copy.nav.reports, onPhone: false },
      { href: '/activity', label: copy.nav.activity, onPhone: false },
      { href: '/more', label: copy.nav.more, onPhone: true },
    ],
  },
];

export const NAV_ITEMS: readonly NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

/** The five destinations a phone shows, in the order a thumb reaches them. */
export const PHONE_NAV: readonly NavItem[] = NAV_ITEMS.filter((item) => item.onPhone);

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
  subtitle,
  source,
  children,
}: {
  active: string;
  title: string;
  /**
   * Where the figures on this screen came from.
   *
   * Passing it is what renders the demonstration banner. The shell owns that
   * rather than each page, because a rule every screen has to remember is a rule
   * one screen will forget — and the screen that forgets is the one showing
   * invented money as if it were real.
   */
  source?: DataSourceDescriptor;
  /** Freshness and completeness chips, shown at the end of the header line. */
  status?: ReactNode;
  /**
   * Whether the shell renders the page's `h1`. The home screen sets this false
   * because its dominant question is the heading — one `h1`, and it is the thing
   * the reader is actually looking at.
   */
  showHeading?: boolean;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-4 px-4 pt-4 pb-24 sm:px-6 sm:pb-8">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:right-2 focus:z-50 focus:rounded-control focus:bg-primary focus:px-4 focus:py-2 focus:text-surface"
      >
        {copy.nav.skipToContent}
      </a>

      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <Link
          href="/"
          className="flex min-h-11 items-center gap-2 rounded-control text-primary transition-colors hover:text-primary-hover"
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
          className="hidden shrink-0 flex-col gap-3 rounded-card border border-border bg-surface p-2 shadow-card sm:flex sm:w-44"
        >
          {NAV_GROUPS.map((group, index) => (
            <div
              key={group.title}
              className={`flex flex-col gap-0.5 ${index > 0 ? 'border-t border-border pt-2' : ''}`}
            >
              {/*
                A label for a list, not a section of the document — so it is not a
                heading. The sidebar renders before `main`, and three `h2`s ahead of
                the page's own `h1` is an outline that starts in the wrong place.
                It is set smaller, lighter and letter-spaced so a reader scanning
                the column can still tell in one glance which lines are clickable.
              */}
              <p
                id={`nav-group-${index}`}
                className="px-3 pt-0.5 pb-1 text-[12px] font-semibold tracking-[0.06em] text-text-secondary/70"
              >
                {group.title}
              </p>
              <ul aria-labelledby={`nav-group-${index}`} className="flex flex-col gap-0.5">
                {group.items.map((item) => (
                  <li key={item.href} className="flex">
                    <NavLink item={item} active={item.href === active} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <main id="main" className="flex min-w-0 flex-1 flex-col gap-4">
          {source !== undefined && !source.isRealData && source.kind !== 'none' ? (
            <SourceBanner />
          ) : null}
          {showHeading ? (
            <div className="px-1">
              <h1 className="text-[24px] leading-tight font-bold">{title}</h1>
              {subtitle === undefined ? null : (
                <p className="mt-1 text-text-secondary">{subtitle}</p>
              )}
            </div>
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
          {PHONE_NAV.map((item) => (
            <li key={item.href} className="flex flex-1">
              <NavLink item={item} active={item.href === active} />
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
