'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { uploadDocumentAction } from '../lib/actions/imports';
import { screens } from '../lib/copy/screens';
import { idleForm } from '../lib/forms';
import { FileField, SelectField, SubmitButton } from './form';

/**
 * The upload control.
 *
 * A client component for one reason worth the cost: when the file has been read,
 * the person should land on the review screen rather than on a success message
 * that leaves them to find it. The action returns the batch id; this navigates to
 * it.
 *
 * A failure stays on this page with the message beside the picker, because the
 * next thing to do — pick a different file, or save the old workbook as `.xlsx` —
 * happens right here.
 */
export function UploadForm({
  accounts,
  hasBusiness,
}: {
  accounts: readonly { value: string; label: string }[];
  hasBusiness: boolean;
}) {
  const [state, formAction] = useActionState(uploadDocumentAction, idleForm);
  const router = useRouter();

  useEffect(() => {
    if (state.status === 'success' && state.createdId !== undefined) {
      router.push(`/imports/${state.createdId}`);
    }
  }, [state, router]);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <FileField
        name="document"
        label={screens.upload.choose}
        hint={screens.upload.dropHint}
        accept=".xlsx,.csv,.pdf,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      />

      {accounts.length === 0 ? null : (
        <SelectField
          name="targetAccountId"
          label={screens.upload.account}
          hint={screens.upload.accountHint}
          required={false}
          emptyLabel={screens.common.none}
          options={accounts}
        />
      )}

      {hasBusiness ? (
        <SelectField
          name="scope"
          label={screens.upload.scope}
          defaultValue="household"
          options={[
            { value: 'household', label: screens.accounts.scopes['household'] ?? '' },
            { value: 'business', label: screens.accounts.scopes['business'] ?? '' },
          ]}
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton label={screens.upload.upload} />
        <span
          role="status"
          aria-live="polite"
          className={`text-small font-medium ${
            state.status === 'error' ? 'text-danger' : 'text-success'
          }`}
        >
          {state.status === 'idle' ? '' : state.message}
        </span>
      </div>
    </form>
  );
}
