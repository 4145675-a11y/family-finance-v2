import type { ReactNode } from 'react';

import { formatMoney, formatSignedMoney } from '../lib/format';
import { copy } from '../lib/copy/copy';

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
    <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
      <h2 className="text-[20px] leading-tight font-semibold">{children}</h2>
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
      className={`rounded-card border ${TONE_BORDER[tone]} bg-surface p-5 shadow-card sm:p-6 ${className}`}
    >
      {title ? (
        <header className="mb-4">
          <h2 className={`text-[20px] leading-tight font-semibold ${TONE_TEXT[tone]}`}>
            {title}
          </h2>
          {subtitle ? (
            <p className="mt-1.5 text-small text-text-secondary">{subtitle}</p>
          ) : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

/**
 * The dominant answer on the home screen.
 *
 * Deep blue, raised, and the only element on the page at this weight. 03-UX-SPEC.md
 * asks for one hero and for conditional money to sit beneath it rather than beside
 * it, so that the two are never read as one number.
 */
export function Hero({
  label,
  amountMinor,
  currency,
  caption,
  note,
  tone = 'primary',
  children,
}: {
  label: string;
  amountMinor: number | null;
  currency: string;
  caption?: string | undefined;
  note?: string | undefined;
  tone?: 'primary' | 'attention';
  children?: ReactNode;
}) {
  const surface =
    tone === 'primary'
      ? 'bg-primary text-surface shadow-hero'
      : 'bg-surface text-text-primary border border-attention/40 shadow-raised';
  const secondaryText = tone === 'primary' ? 'text-surface/85' : 'text-text-secondary';

  return (
    <section className={`rounded-hero p-6 sm:p-8 ${surface}`}>
      <p className={`text-small font-medium ${secondaryText}`}>{label}</p>

      {amountMinor === null ? (
        <p className="mt-2 text-[24px] leading-tight font-bold">
          {copy.home.safeCannotCalculate}
        </p>
      ) : (
        <p className="mt-2 text-display font-bold tracking-tight">
          <Money amountMinor={amountMinor} currency={currency} />
        </p>
      )}

      {caption ? <p className={`mt-2 text-small ${secondaryText}`}>{caption}</p> : null}
      {note ? <p className={`mt-3 text-small ${secondaryText}`}>{note}</p> : null}
      {children ? <div className="mt-5">{children}</div> : null}
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
    <section className="flex flex-col rounded-card border border-border bg-surface p-5 shadow-card">
      <h3 className="text-small font-medium text-text-secondary">{title}</h3>
      <p className={`mt-2 text-[24px] leading-tight font-semibold ${TONE_TEXT[tone]}`}>
        {headline}
      </p>
      {meaning ? <p className="mt-2 text-small text-text-secondary">{meaning}</p> : null}
      {children ? <div className="mt-3">{children}</div> : null}
      {footer ? <div className="mt-auto pt-4 text-small">{footer}</div> : null}
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
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border py-2.5 last:border-b-0">
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
export function Disclosure({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="group mt-4 rounded-control border border-border bg-surface-muted/60">
      <summary className="flex min-h-11 items-center px-4 py-2.5 text-small font-medium text-primary">
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

/** The one primary action, and the quieter ones beside it. */
export function ActionButton({
  children,
  variant = 'secondary',
  disabled = false,
  title,
}: {
  children: ReactNode;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  title?: string;
}) {
  const base =
    'inline-flex min-h-11 min-w-11 items-center justify-center rounded-control px-4 py-2.5 text-center font-medium transition-colors';
  const styles =
    variant === 'primary'
      ? 'bg-primary text-surface hover:bg-primary-hover'
      : 'border border-border-interactive bg-surface text-text-primary hover:bg-surface-muted';

  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      className={`${base} ${styles} disabled:cursor-not-allowed disabled:opacity-60`}
    >
      {children}
    </button>
  );
}

/**
 * The banner that says where the numbers came from.
 *
 * Shown on every screen whenever the data is not real, and it cannot be dismissed.
 * A demonstration that cannot be told apart from the truth is the failure this
 * whole feature exists to avoid.
 */
export function SourceBanner() {
  return (
    <aside
      role="note"
      className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-card border border-attention/40 bg-attention/5 px-4 py-3 text-small"
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
