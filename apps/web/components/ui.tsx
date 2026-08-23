import type { ReactNode } from 'react';

import { formatMoney, formatSignedMoney } from '../lib/format';

/**
 * The small set of presentational pieces every screen is built from.
 *
 * Two rules from 04-DESIGN-SYSTEM.md are enforced here rather than left to each
 * page. First, a number inside Hebrew text carries its own direction: `<bdi>`
 * with `dir="ltr"` isolates the digit run so the sequence and the currency symbol
 * do not reorder. Second, no component takes a decimal amount — everything is
 * minor units, because a float on a screen means a float upstream.
 */

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
  const text = signed
    ? formatSignedMoney(amountMinor, currency)
    : formatMoney(amountMinor, currency);
  return (
    <bdi dir="ltr" className={`inline-block tabular-nums ${className}`}>
      {text}
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

export function Card({
  title,
  subtitle,
  children,
  tone = 'neutral',
}: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  tone?: 'neutral' | 'attention' | 'danger' | 'success';
}) {
  const border =
    tone === 'danger'
      ? 'border-danger'
      : tone === 'attention'
        ? 'border-attention'
        : tone === 'success'
          ? 'border-success'
          : 'border-border';

  return (
    <section className={`rounded-card border ${border} bg-surface p-4 sm:p-6`}>
      {title ? (
        <header className="mb-3">
          <h2 className="text-[20px] leading-tight font-semibold">{title}</h2>
          {subtitle ? <p className="mt-1 text-small text-text-secondary">{subtitle}</p> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

/** A label/value pair. Wraps rather than truncating: a number must never be cut. */
export function StatRow({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  // `exactOptionalPropertyTypes` is on, and a caller legitimately computes a hint
  // that may not exist, so the absent case is spelled out rather than forcing
  // every call site to branch around the prop.
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

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'attention' | 'danger' | 'success';
}) {
  const styles =
    tone === 'danger'
      ? 'border-danger text-danger'
      : tone === 'attention'
        ? 'border-attention text-attention'
        : tone === 'success'
          ? 'border-success text-success'
          : 'border-border-interactive text-text-secondary';

  return (
    <span className={`inline-block rounded-control border px-2 py-1 text-small ${styles}`}>
      {children}
    </span>
  );
}

/**
 * Progressive disclosure for the components behind a headline number.
 *
 * 02-FINANCIAL-RULES.md forbids presenting a result without access to its
 * breakdown, and 03-UX-SPEC.md asks for it as a sheet rather than a wall of text.
 * `<details>` gives that with no JavaScript, which means it also works before
 * hydration and for a keyboard user by default.
 */
export function Breakdown({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="mt-3 rounded-control border border-border">
      <summary className="cursor-pointer px-3 py-2 text-small font-medium">{summary}</summary>
      <div className="border-t border-border px-3 py-2">{children}</div>
    </details>
  );
}

export function BreakdownLines({
  lines,
  currency,
}: {
  lines: readonly { key: string; label: string; amountMinor: number; effect: string }[];
  currency: string;
}) {
  return (
    <dl className="flex flex-col">
      {lines.map((line) => (
        <div
          key={line.key}
          className="flex flex-wrap items-baseline justify-between gap-x-4 border-b border-border py-2 last:border-b-0"
        >
          <dt className="text-text-secondary">
            {line.effect === 'subtracts' ? 'פחות · ' : line.effect === 'adds' ? 'ועוד · ' : ''}
            {line.label}
          </dt>
          <dd>
            <Money amountMinor={line.amountMinor} currency={currency} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The banner that says where the numbers came from.
 *
 * Shown on every screen whenever the data is not real. A demonstration that
 * cannot be told apart from the truth is the failure mode this whole feature has
 * to avoid.
 */
export function SourceBanner({ label, reason }: { label: string; reason: string }) {
  return (
    <aside
      role="note"
      className="rounded-card border border-attention bg-surface px-4 py-3 text-small"
    >
      <strong className="text-attention">{label}</strong>
      <span className="text-text-secondary"> — {reason}</span>
    </aside>
  );
}

/** What a screen shows when there is no data source at all. */
export function EmptyState({ reason }: { reason: string }) {
  return (
    <Card title="אין כרגע מקור נתונים" tone="attention">
      <p className="text-text-secondary">{reason}</p>
      <p className="mt-3 text-text-secondary">
        המסך אינו ממציא מספרים. עד שיהיה מקור נתונים מאומת, אין כאן סכום להציג.
      </p>
    </Card>
  );
}
