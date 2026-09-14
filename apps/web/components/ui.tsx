import type { ReactNode } from 'react';

import { copy } from '../lib/copy/copy';
import { formatMoney, formatSignedMoney } from '../lib/format';

/**
 * The pieces every screen is built from.
 *
 * Two rules from 04-DESIGN-SYSTEM.md are enforced here rather than left to each
 * page. First, a number inside Hebrew text carries its own direction: `<bdi>` with
 * `dir="ltr"` isolates the digit run so the sequence and the currency symbol do
 * not reorder. Second, no component takes a decimal amount — everything is minor
 * units, because a float on a screen means a float upstream.
 *
 * Nothing here invents a colour. Every surface, border and tone comes from the
 * design tokens, so a change to the palette moves the whole product at once.
 */

type Tone = 'neutral' | 'primary' | 'success' | 'attention' | 'danger';

/** A monetary figure, isolated from the surrounding right-to-left text. */
export function Money({
  amountMinor,
  currency = 'ILS',
  signed = false,
  className = '',
}: {
  amountMinor: number;
  currency?: string;
  signed?: boolean;
  className?: string;
}) {
  const value = signed
    ? formatSignedMoney(amountMinor, currency)
    : formatMoney(amountMinor, currency);
  return (
    <bdi dir="ltr" className={`inline-block tabular-nums ${className}`}>
      {value}
    </bdi>
  );
}

/** Any other digit run — a date, a count, a percentage. */
export function Figure({ children }: { children: ReactNode }) {
  return (
    <bdi dir="ltr" className="inline-block tabular-nums">
      {children}
    </bdi>
  );
}

/**
 * The product mark.
 *
 * Drawn in code rather than shipped as an asset: a roof over a coin, which is the
 * whole product in one shape — a household, and the money inside it. Small,
 * single-colour, and it inherits the text colour so it works on any surface.
 */
export function Mark({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className={`h-6 w-6 shrink-0 ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.5 10.2 12 3.5l8.5 6.7" />
      <path d="M5.5 11.8V19a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5v-7.2" />
      <circle cx="12" cy="14.6" r="2.6" />
    </svg>
  );
}

const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-text-primary',
  primary: 'text-primary',
  success: 'text-success',
  attention: 'text-attention',
  danger: 'text-danger',
};

const TONE_BORDER: Record<Tone, string> = {
  neutral: 'border-border',
  primary: 'border-primary/30',
  success: 'border-success/35',
  attention: 'border-attention/35',
  danger: 'border-danger/35',
};

export function SectionTitle({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 px-1 pt-1">
      <h2 className="text-[18px] leading-tight font-semibold">{children}</h2>
      {action}
    </div>
  );
}

export function Card({
  title,
  subtitle,
  children,
  tone = 'neutral',
  className = '',
}: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <section
      className={`rounded-card border ${TONE_BORDER[tone]} bg-surface p-4 shadow-card sm:p-5 ${className}`}
    >
      {title ? (
        <header className="mb-3">
          <h2 className={`text-[18px] leading-tight font-semibold ${TONE_TEXT[tone]}`}>
            {title}
          </h2>
          {subtitle ? <p className="mt-1 text-small text-text-secondary">{subtitle}</p> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

/**
 * The dominant answer on the home screen.
 *
 * Deep blue, raised, and the only element on the page at this weight.
 *
 * `headline` exists for the case that matters most: when the safe amount is zero,
 * a very large `0 ₪` is technically accurate and frightening. The screen says what
 * that zero means in words instead, and the arithmetic follows underneath.
 */
export function Hero({
  label,
  amountMinor,
  headline,
  currency,
  caption,
  note,
  tone = 'primary',
  asHeading = false,
  children,
}: {
  label: string;
  amountMinor: number | null;
  headline?: string | undefined;
  currency: string;
  caption?: string | undefined;
  note?: string | undefined;
  tone?: 'primary' | 'attention';
  /** Render the label as the page's `h1`. The question is the heading. */
  asHeading?: boolean;
  children?: ReactNode;
}) {
  const surface =
    tone === 'primary'
      ? 'bg-primary text-surface shadow-hero'
      : 'bg-surface text-text-primary border border-attention/40 shadow-raised';
  const secondaryText = tone === 'primary' ? 'text-surface/85' : 'text-text-secondary';
  const Label = asHeading ? 'h1' : 'p';

  return (
    <section className={`flex flex-col rounded-hero p-5 sm:p-6 ${surface}`}>
      <Label className={`text-small font-medium ${secondaryText}`}>{label}</Label>

      {amountMinor === null ? (
        <p className="mt-1.5 text-[26px] leading-tight font-bold sm:text-[30px]">
          {headline ?? copy.home.safeCannotCalculate}
        </p>
      ) : (
        <p className="mt-1.5 text-display font-bold tracking-tight">
          <Money amountMinor={amountMinor} currency={currency} />
        </p>
      )}

      {caption ? <p className={`mt-1.5 text-small ${secondaryText}`}>{caption}</p> : null}
      {note ? <p className={`mt-3 ${secondaryText}`}>{note}</p> : null}
      {children ? <div className="mt-4">{children}</div> : null}
    </section>
  );
}

/** A compact daily card: one heading, one figure, one line of meaning. */
export function StatCard({
  title,
  headline,
  meaning,
  tone = 'neutral',
  footer,
  children,
}: {
  title: string;
  headline: ReactNode;
  meaning?: string | undefined;
  tone?: Tone;
  footer?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="flex flex-col rounded-card border border-border bg-surface p-4 shadow-card">
      <h3 className="text-small font-medium text-text-secondary">{title}</h3>
      <p className={`mt-1.5 text-[21px] leading-snug font-semibold ${TONE_TEXT[tone]}`}>
        {headline}
      </p>
      {meaning ? <p className="mt-1.5 text-small text-text-secondary">{meaning}</p> : null}
      {children ? <div className="mt-2.5">{children}</div> : null}
      {footer ? <div className="mt-auto pt-3 text-small">{footer}</div> : null}
    </section>
  );
}

export function StatRow({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string | undefined;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border py-2 last:border-b-0">
      <span className="text-text-secondary">{label}</span>
      <span className="font-medium">{value}</span>
      {hint ? <span className="w-full text-small text-text-secondary">{hint}</span> : null}
    </div>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  const styles: Record<Tone, string> = {
    neutral: 'border-border-interactive text-text-secondary bg-surface-muted',
    primary: 'border-primary/30 text-primary bg-primary/5',
    success: 'border-success/35 text-success bg-success/5',
    attention: 'border-attention/35 text-attention bg-attention/5',
    danger: 'border-danger/35 text-danger bg-danger/5',
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-1 text-small font-medium ${styles[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * A progress bar that never means anything by colour alone.
 *
 * `role="img"` with a Hebrew label is what a screen reader announces; the bar is
 * the same information for everyone else. UX-A11Y-001 forbids colour as the only
 * carrier of meaning, so the caller always renders the numbers beside it too.
 */
export function ProgressBar({
  value,
  max,
  tone = 'primary',
  label,
}: {
  value: number;
  max: number;
  tone?: Tone;
  label: string;
}) {
  const safeMax = max > 0 ? max : 1;
  const percent = Math.min(100, Math.max(0, Math.round((value / safeMax) * 100)));
  const fill: Record<Tone, string> = {
    neutral: 'bg-text-secondary',
    primary: 'bg-primary',
    success: 'bg-success',
    attention: 'bg-attention',
    danger: 'bg-danger',
  };

  return (
    <div className="progress-track" role="img" aria-label={label}>
      <div className={`progress-fill ${fill[tone]}`} style={{ width: `${percent}%` }} />
    </div>
  );
}

/**
 * Progressive disclosure.
 *
 * 02-FINANCIAL-RULES.md forbids presenting a result without access to its
 * breakdown, and 03-UX-SPEC.md asks for the detail to be opened rather than
 * displayed. `<details>` gives that with no JavaScript, which means it also works
 * before hydration and for a keyboard user by default.
 */
export function Disclosure({
  summary,
  children,
  tone = 'quiet',
}: {
  summary: string;
  children: ReactNode;
  tone?: 'quiet' | 'action';
}) {
  const styles =
    tone === 'action' ? 'border-primary/30 bg-primary/5' : 'border-border bg-surface-muted/60';
  const summaryStyles =
    tone === 'action' ? 'text-primary font-semibold' : 'text-primary font-medium';

  return (
    <details className={`mt-3 rounded-control border ${styles}`}>
      <summary className={`flex min-h-11 items-center px-4 py-2.5 text-small ${summaryStyles}`}>
        {summary}
      </summary>
      <div className="border-t border-border px-4 py-3">{children}</div>
    </details>
  );
}

export function BreakdownList({
  lines,
  currency,
  labelFor,
}: {
  lines: readonly { key: string; amountMinor: number; effect: string }[];
  currency: string;
  labelFor: (key: string) => string;
}) {
  return (
    <dl className="flex flex-col">
      {lines.map((line) => (
        <div
          key={line.key}
          className="flex flex-wrap items-baseline justify-between gap-x-4 border-b border-border py-2 last:border-b-0"
        >
          <dt className="text-text-secondary">
            {/* The sign is a word, never only a colour or a symbol. */}
            {line.effect === 'subtracts' ? 'פחות · ' : line.effect === 'adds' ? 'ועוד · ' : ''}
            {labelFor(line.key)}
          </dt>
          <dd className="font-medium">
            <Money amountMinor={line.amountMinor} currency={currency} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A capability that is genuinely not built yet.
 *
 * Deliberately not a disabled button. A greyed-out control that looks like a
 * production action reads as broken software; a labelled "בקרוב" chip reads as a
 * plan. It is not focusable and announces itself to a screen reader as text.
 */
export function SoonChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex min-h-11 items-center gap-2 rounded-control border border-dashed border-border-interactive bg-surface-muted px-3.5 py-2 text-text-secondary">
      <span>{children}</span>
      <span className="rounded-pill bg-surface px-2 py-0.5 text-small">{copy.states.soon}</span>
    </span>
  );
}

/**
 * The banner that says where the numbers came from.
 *
 * Shown on every screen whenever the data is not real, and it cannot be dismissed.
 * A demonstration that cannot be told apart from the truth is the failure this
 * whole feature exists to avoid. It is one compact line: obvious, not shouting.
 */
export function SourceBanner() {
  return (
    <aside
      role="note"
      className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-control border border-attention/40 bg-attention/5 px-3 py-2 text-small"
    >
      <strong className="font-semibold text-attention">{copy.demo.title}</strong>
      <span className="text-text-secondary">{copy.demo.body}</span>
    </aside>
  );
}

/** What a screen shows when there is no data source at all. */
export function EmptyState({ reason }: { reason: string }) {
  return (
    <Card title={copy.states.noSource} tone="attention">
      <p className="text-text-secondary">{reason}</p>
      <p className="mt-3 text-text-secondary">{copy.states.noSourceBody}</p>
    </Card>
  );
}

/** An honest placeholder for a screen that genuinely belongs to a later stage. */
export function ComingSoon({ title }: { title: string }) {
  return (
    <Card title={title} tone="neutral">
      <p className="font-medium">{copy.states.comingSoon}</p>
      <p className="mt-2 text-text-secondary">{copy.states.comingSoonBody}</p>
    </Card>
  );
}

/**
 * A link that looks and behaves like a button.
 *
 * Deliberately an anchor rather than a button with an onClick: navigation is a
 * link, and making it one means the middle-click, the long-press and the
 * screen-reader announcement all work without any code.
 */
export function LinkButton({
  href,
  children,
  tone = 'primary',
  className = '',
}: {
  href: string;
  children: ReactNode;
  tone?: 'primary' | 'secondary';
  className?: string;
}) {
  const styles =
    tone === 'primary'
      ? 'bg-primary text-surface hover:bg-primary-hover'
      : 'border border-border-interactive bg-surface text-text-primary hover:bg-surface-muted';

  return (
    <a
      href={href}
      className={`inline-flex min-h-11 items-center justify-center rounded-control px-4 py-2 font-medium transition-colors ${styles} ${className}`}
    >
      {children}
    </a>
  );
}

/**
 * A statement that needs to be noticed without being alarming.
 *
 * `role="note"` rather than `role="alert"`: an alert interrupts a screen-reader
 * user mid-sentence, and almost nothing on these screens earns that. The one
 * thing that does — a form's result — is announced by the form itself.
 */
export function Notice({
  tone = 'neutral',
  title,
  children,
}: {
  tone?: Tone;
  title?: string;
  children: ReactNode;
}) {
  const styles: Record<Tone, string> = {
    neutral: 'border-border bg-surface-muted/60',
    primary: 'border-primary/30 bg-primary/5',
    success: 'border-success/35 bg-success/5',
    attention: 'border-attention/40 bg-attention/5',
    danger: 'border-danger/40 bg-danger/5',
  };

  return (
    <aside role="note" className={`rounded-control border px-4 py-3 ${styles[tone]}`}>
      {title === undefined ? null : (
        <p className={`font-semibold ${TONE_TEXT[tone]}`}>{title}</p>
      )}
      <div className={`text-small ${title === undefined ? '' : 'mt-1'} text-text-secondary`}>
        {children}
      </div>
    </aside>
  );
}

/**
 * A table that becomes a list of cards on a phone.
 *
 * A financial table has four to six columns, and on a 360px screen those either
 * scroll sideways — which UX-RTL-001 forbids for the page and which nobody does
 * for a table either — or stack. They stack: each row becomes a card with the
 * column names as labels, which is readable with a thumb.
 */
export function DataTable({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: readonly string[];
  rows: readonly { key: string; cells: readonly ReactNode[] }[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-0 border-collapse text-start">
        <caption className="sr-only">{caption}</caption>
        <thead className="hidden sm:table-header-group">
          <tr className="border-b border-border">
            {columns.map((column) => (
              <th
                key={column}
                scope="col"
                className="px-2 py-2 text-start text-small font-semibold text-text-secondary"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="flex flex-col gap-3 sm:table-row-group sm:gap-0">
          {rows.map((row) => (
            <tr
              key={row.key}
              className="flex flex-col gap-1 rounded-card border border-border bg-surface p-3 sm:table-row sm:border-0 sm:border-b sm:border-border sm:bg-transparent sm:p-0"
            >
              {row.cells.map((cell, index) => (
                <td
                  key={columns[index] ?? String(index)}
                  className="flex items-baseline justify-between gap-3 px-0 py-0.5 sm:table-cell sm:px-2 sm:py-2.5"
                >
                  <span className="text-small text-text-secondary sm:hidden">
                    {columns[index]}
                  </span>
                  <span className="min-w-0 text-end sm:text-start">{cell}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** How far through something the household is, as a bar plus the words. */
export function Meter({
  label,
  done,
  total,
  caption,
}: {
  label: string;
  done: number;
  total: number;
  caption: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">{label}</span>
        <span className="text-small text-text-secondary">{caption}</span>
      </div>
      <ProgressBar
        value={done}
        max={Math.max(total, 1)}
        tone={done >= total ? 'success' : 'primary'}
        label={caption}
      />
    </div>
  );
}

/**
 * A short list of destinations, for a screen that is a hub.
 *
 * Rendered as a list of links rather than tabs: these are pages, they have URLs,
 * and a person who bookmarks "the budget" should get the budget.
 */
export function LinkList({
  items,
}: {
  items: readonly { href: string; title: string; description: string }[];
}) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {items.map((item) => (
        <li key={item.href}>
          <a
            href={item.href}
            className="flex min-h-11 flex-col justify-center rounded-card border border-border bg-surface p-4 transition-colors hover:border-primary/40 hover:bg-primary/5"
          >
            <span className="font-semibold text-primary">{item.title}</span>
            <span className="mt-1 text-small text-text-secondary">{item.description}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * What a screen shows before the household has anything in it.
 *
 * An empty state with a way forward, not an apology. The difference matters most
 * on the first day, which is the only day every family has in common.
 */
export function EmptyPrompt({
  title,
  body,
  actionHref,
  actionLabel,
}: {
  title: string;
  body: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  return (
    <Card title={title} tone="neutral">
      <p className="text-text-secondary">{body}</p>
      {actionHref !== undefined && actionLabel !== undefined ? (
        <div className="mt-4">
          <LinkButton href={actionHref}>{actionLabel}</LinkButton>
        </div>
      ) : null}
    </Card>
  );
}

/** A quiet label for a row's state: pending, included, approved. */
export function StateChip({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: Tone;
}) {
  return <Badge tone={tone}>{children}</Badge>;
}
