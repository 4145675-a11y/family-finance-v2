'use client';

import { useFormStatus } from 'react-dom';

import { screens } from '../lib/copy/screens';

/**
 * A single button that runs a server action with no fields.
 *
 * Still a form, and deliberately so: a `<form action={...}>` posts, works before
 * hydration, and gets the pending state from `useFormStatus` for free. The
 * alternative — a button with an onClick that calls the action — is broken with
 * JavaScript disabled and gives the person no feedback while it runs.
 */
export function SimpleAction({
  action,
  label,
  tone = 'secondary',
  confirmText,
}: {
  action: () => Promise<void>;
  label: string;
  tone?: 'primary' | 'secondary' | 'danger';
  /** A short line shown beside the button explaining what it will do. */
  confirmText?: string;
}) {
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <PendingButton label={label} tone={tone} />
      {confirmText === undefined ? null : (
        <span className="text-small text-text-secondary">{confirmText}</span>
      )}
    </form>
  );
}

function PendingButton({
  label,
  tone,
}: {
  label: string;
  tone: 'primary' | 'secondary' | 'danger';
}) {
  const { pending } = useFormStatus();

  const styles: Record<string, string> = {
    primary: 'bg-primary text-surface hover:bg-primary-hover',
    secondary:
      'border border-border-interactive bg-surface text-text-primary hover:bg-surface-muted',
    danger: 'border border-danger/40 bg-surface text-danger hover:bg-danger/5',
  };

  return (
    <button
      type="submit"
      disabled={pending}
      className={`inline-flex min-h-11 items-center justify-center rounded-control px-4 py-2 font-medium transition-colors disabled:opacity-60 ${styles[tone]}`}
    >
      {pending ? screens.common.saving : label}
    </button>
  );
}
