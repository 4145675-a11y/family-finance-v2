'use client';

import { useActionState } from 'react';

import { applyRestoreAction, previewRestoreAction } from '../lib/actions/backup';
import { screens } from '../lib/copy/screens';
import { idleForm } from '../lib/forms';
import { FileField, SubmitButton, TextField } from './form';

/**
 * Restore, in two steps that cannot be collapsed into one.
 *
 * The first form reads the file and reports what is in it. Only once that has
 * succeeded does the second form appear — carrying the verified text, asking for
 * the word "שחזור" to be typed, and saying in the same breath what will be
 * replaced.
 *
 * The verified payload travels back through a hidden field and is verified again
 * on the server. That is not redundant: these are two separate requests, and a
 * value that passed through a browser is not evidence by the time it returns.
 */
export function RestorePanel() {
  const [preview, previewAction] = useActionState(previewRestoreAction, {
    ...idleForm,
  });
  const [applied, applyAction] = useActionState(applyRestoreAction, idleForm);

  return (
    <div className="flex flex-col gap-6">
      <form action={previewAction} className="flex flex-col gap-4">
        <FileField
          name="backup"
          label={screens.backup.chooseFile}
          accept=".json,application/json"
        />
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton label={screens.backup.check} tone="secondary" />
          <span
            role="status"
            aria-live="polite"
            className={`text-small font-medium ${
              preview.status === 'error' ? 'text-danger' : 'text-success'
            }`}
          >
            {preview.status === 'idle' ? '' : preview.message}
          </span>
        </div>
      </form>

      {preview.preview === undefined || preview.payload === undefined ? null : (
        <div className="rounded-card border border-attention/40 bg-attention/5 p-4">
          <h3 className="font-semibold text-attention">{screens.backup.previewTitle}</h3>
          <p className="mt-1 text-small text-text-secondary">
            {screens.backup.previewCreated(preview.preview.createdAt)}
          </p>

          <dl className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-2">
            <Row label={screens.setup.householdName} value={preview.preview.householdName} />
            <Row
              label={screens.backup.counts['accounts'] ?? ''}
              value={String(preview.preview.accounts)}
            />
            <Row
              label={screens.backup.counts['transactions'] ?? ''}
              value={String(preview.preview.transactions)}
            />
            <Row
              label={screens.backup.counts['debts'] ?? ''}
              value={String(preview.preview.debts)}
            />
            <Row
              label={screens.backup.counts['budgets'] ?? ''}
              value={String(preview.preview.budgets)}
            />
            <Row
              label={screens.backup.counts['auditEntries'] ?? ''}
              value={String(preview.preview.auditEntries)}
            />
          </dl>

          {preview.preview.currentHouseholdName === null ? null : (
            <p className="mt-3 text-small text-text-secondary">
              {screens.backup.previewNow}: {preview.preview.currentHouseholdName} ·{' '}
              <bdi dir="ltr">{preview.preview.currentTransactions ?? 0}</bdi>
            </p>
          )}

          <form action={applyAction} className="mt-4 flex flex-col gap-4">
            <input type="hidden" name="payload" value={preview.payload} />
            <TextField
              name="confirm"
              label={screens.backup.confirmLabel}
              placeholder={screens.backup.confirmWord}
              maxLength={20}
            />
            <div className="flex flex-wrap items-center gap-3">
              <SubmitButton label={screens.backup.apply} tone="danger" />
              <span
                role="status"
                aria-live="polite"
                className={`text-small font-medium ${
                  applied.status === 'error' ? 'text-danger' : 'text-success'
                }`}
              >
                {applied.status === 'idle' ? '' : applied.message}
              </span>
            </div>
          </form>

          <p className="mt-3 text-small text-text-secondary">{screens.backup.keptHistory}</p>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/60 py-1.5">
      <dt className="text-text-secondary">{label}</dt>
      <dd className="font-medium">
        <bdi dir="auto">{value}</bdi>
      </dd>
    </div>
  );
}
