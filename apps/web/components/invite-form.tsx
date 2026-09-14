'use client';

import { useActionState } from 'react';

import { inviteMemberAction } from '../lib/actions/household';
import { accountScreen } from '../lib/copy/security';
import { idleForm } from '../lib/forms';
import { FormMessage, SubmitButton, TextField } from './form';

/**
 * Inviting a partner by email, and showing the one-time code that results.
 *
 * The code is displayed exactly once, here, straight from the action's
 * response. It is never stored by the application — the database keeps only
 * its hash — so closing this screen means asking for a new one.
 */
export function InviteForm() {
  const [state, formAction] = useActionState(inviteMemberAction, idleForm);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <p className="text-text-secondary">{accountScreen.inviteIntro}</p>
      <TextField
        name="email"
        label={accountScreen.inviteEmail}
        type="email"
        autoComplete="off"
        maxLength={254}
      />
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton tone="secondary" label={accountScreen.invite} />
        <FormMessage state={state} />
      </div>
      {state.status === 'success' && state.createdId !== undefined ? (
        <div className="rounded-md border border-border bg-surface-muted p-3">
          <p className="text-small text-text-secondary">{accountScreen.inviteCodeLabel}</p>
          <code dir="ltr" className="block break-all font-mono text-small select-all">
            {state.createdId}
          </code>
        </div>
      ) : null}
    </form>
  );
}
