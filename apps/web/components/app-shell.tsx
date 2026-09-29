import Link from 'next/link';
import type { ReactNode } from 'react';

import { copy } from '../lib/copy/copy';
import { platform } from '../lib/copy/platform';
import { isPlatformOwner } from '../lib/auth/platform';
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
}

/**
 * The whole primary navigation: five destinations, in the order of a day.
 *
 * It was fifteen, in three groups, and a phone showed a different five — so a
 * person who learned where something lived on a desktop had to learn it again on
 * a phone. Five is the number a person can hold without being taught, and the
 * same five everywhere means there is one map.
 *
 * What left did not disappear: `/more` is an index of every other screen with a
 * line of explanation each, and the screens that matter announce themselves from
 * the home screen when they have something to say.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/', label: copy.nav.home },
  { href: '/quick', label: copy.nav.quick },
  { href: '/activity', label: copy.nav.activity },
  { href: '/lenders', label: copy.nav.lenders },
  { href: '/more', label: copy.nav.more },
];

/** The same five, named for the bar a thumb reaches. */
export const PHONE_NAV: readonly NavItem[] = NAV_ITEMS;

/**
 * The sixth destination, for the one person who has it.
 *
 * Administering the service is not a household task, so it is not one of the
 * five a family learns. It is appended for the platform owner and absent for
 * everybody else — which keeps the promise that the navigation is the same on a
 * phone and a desktop, without making everybody carry a door they cannot open.
 */
export const ADMIN_NAV_ITEM: NavItem = { href: '/admin', label: platform.title };

/**
 * The navigation a given person sees.
 *
 * A pure function of one boolean, so the shape can be asserted without a
 * database, a session or a rendered tree. **It is not the authorisation.** The
 * boolean comes from `isPlatformOwner()`, which asks the database; `/admin`
 * checks again before it renders; and every action behind it is checked a third
 * time by a function that consults `app.is_platform_admin()` itself. Hiding a
 * link is a courtesy to the person reading the screen, never a boundary.
 */
export function navItemsFor(platformOwner: boolean): readonly NavItem[] {
  return platformOwner ? [...NAV_ITEMS, ADMIN_NAV_ITEM] : NAV_ITEMS;
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={`flex min-h-11 min-w-11 flex-1 items-center justify-center rounded-control px-2 py-2 text-center text-small leading-tight font-medium transition-colors sm:justify-start sm:px-3 sm:text-body ${
        active
          ? 'bg-primary text-surface'
          : 'text-text-secondary hover:bg-surface-muted hover:text-text-primary'
      }`}
    >
      {item.label}
    </Link>
  );
}

export async function AppShell({
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
  /*
   * Asked once per request. `isPlatformOwner` is React-cached, so a page that
   * also asks — `/admin` does — shares this answer rather than making a second
   * round trip, and on the file backend it returns false without asking anything
   * at all. What crosses the wire is one boolean: no household, member,
   * invitation or request data is loaded to decide whether to draw a link.
   */
  const items = navItemsFor(await isPlatformOwner());

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-4 px-4 pt-4 pb-24 sm:px-6 sm:pb-8">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:right-2 focus:z-50 focus:inline-flex focus:min-h-11 focus:items-center focus:rounded-control focus:bg-primary focus:px-4 focus:py-2 focus:text-surface"
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
        {/*
          Five links and no group labels. The groups existed to make fifteen
          items readable; at five they would be three headings over one line
          each, which is more structure than the thing it structures.
        */}
        <nav
          aria-label={copy.nav.ariaMain}
          className="hidden shrink-0 flex-col gap-0.5 rounded-card border border-border bg-surface p-2 shadow-card sm:flex sm:w-44"
        >
          <ul className="flex flex-col gap-0.5">
            {items.map((item) => (
              <li key={item.href} className="flex">
                <NavLink item={item} active={item.href === active} />
              </li>
            ))}
          </ul>
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

      {/*
        Mobile bottom navigation. Every target is at least 44px, per the design
        system — which is what bounds how many destinations this bar can hold.
        At the narrowest supported width, 390px, the bar has 374px of content
        after its padding and loses 5px per gap, so six equal columns are about
        59px each and five are about 71px. Both clear 44px, so the platform
        owner's sixth link does not make this bar scroll sideways. What it does
        do is wrap to two lines, exactly as `חובות ומלווים` and `עדכון מהיר`
        already wrap at five — so the bar's height is unchanged, and
        `leading-tight` on the link keeps a wrapped label compact for everyone.
        A seventh destination would be the one that breaks this, at about 50px
        a column: the honest fix then is fewer destinations, not smaller text.
      */}
      <nav
        aria-label={copy.nav.ariaBottom}
        className="fixed inset-x-0 bottom-0 border-t border-border bg-surface sm:hidden"
      >
        <ul className="mx-auto flex max-w-6xl items-stretch gap-1 px-2 py-2">
          {items.map((item) => (
            <li key={item.href} className="flex flex-1">
              <NavLink item={item} active={item.href === active} />
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
