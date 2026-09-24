'use client';

import Link from 'next/link';

import type { AiProposal } from '@family-finance/ai-proposal';

import { ActionForm, HiddenValue, MoneyField, SelectField, TextField } from './form';
import { Badge, Card, Notice } from './ui';
import { confirmQuickUpdateAction } from '../lib/actions/quick';
import { CATEGORY_LABEL } from '../lib/copy/classification';
import { quick } from '../lib/copy/quick';
import type { QuickState } from '../lib/quick/state';

/**
 * What the smart reading suggested, offered for checking.
 *
 * The card is written against one specific way this feature goes wrong: a person
 * reads a confident summary, assumes it has been saved, and closes the tab. So the
 * hierarchy is deliberate and the same on every state —
 *
 *   1. **this is a suggestion** (a badge, not a sentence buried in prose);
 *   2. **nothing has been recorded** (said plainly, above the fields);
 *   3. what was understood, and *from which words of your own sentence*;
 *   4. what is missing, as one question;
 *   5. the fields, editable;
 *   6. one button that says it records.
 *
 * Point 3 is the one that catches errors. "120 ₪" is plausible whatever the
 * sentence said; "נקרא מ־«120 שקל»" is checkable at a glance.
 *
 * Confirming submits the ordinary confirmation form — the same action, the same
 * idempotency key, the same server-side checks as the deterministic route. This
 * component has no write path of its own and cannot acquire one: it renders
 * fields, and the server decides.
 */

const STATE_BADGE: Readonly<
  Record<AiProposal['state'], { label: string; tone: 'success' | 'attention' | 'neutral' }>
> = {
  ready: { label: quick.aiReadyBadge, tone: 'success' },
  needs_clarification: { label: quick.aiNeedsBadge, tone: 'attention' },
  not_understood: { label: quick.aiNotUnderstoodBadge, tone: 'neutral' },
  unavailable: { label: quick.aiUnavailableTitle, tone: 'neutral' },
};

/** Agorot as the amount field wants them: a decimal string a person can edit. */
function asAmountInput(amountMinor: number | null): string {
  if (amountMinor === null) return '';
  return (amountMinor / 100).toFixed(2);
}

export function AiProposalCard({ state }: { state: QuickState }) {
  const proposal = state.ai;
  if (proposal === null) return null;

  if (proposal.state === 'unavailable') {
    return <AiUnavailable proposal={proposal} />;
  }

  const badge = STATE_BADGE[proposal.state];
  const action = proposal.action;
  const elsewhere = quick.aiNotHere[action];

  return (
    <Card title={quick.aiProposalTitle}>
      <div
        className="flex flex-col gap-3"
        data-testid="ai-proposal"
        data-state={proposal.state}
      >
        {/*
         * The two facts a person needs before reading anything else, and they
         * come first for that reason.
         */}
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="primary">{quick.aiSuggestion}</Badge>
          <Badge tone={badge.tone}>{badge.label}</Badge>
          <Badge tone="neutral">{quick.aiConfidence[proposal.confidence] ?? ''}</Badge>
        </div>
        <p className="font-medium text-attention">{quick.aiNotSaved}</p>

        <p className="text-small text-text-secondary">„{state.text}”</p>

        <p className="font-medium">{quick.aiActionTitle[action] ?? action}</p>
        {/*
         * The summary, unless it only repeats the line above it. A reader that
         * answers "החזר הלוואה" for an action already titled "החזר הלוואה" would
         * otherwise print the same words twice, which reads as a glitch and
         * teaches a person to skim the card.
         */}
        {proposal.summary === '' || proposal.summary === quick.aiActionTitle[action] ? null : (
          <p>{proposal.summary}</p>
        )}
        {proposal.reason === '' ? null : (
          <p className="text-small text-text-secondary">
            {quick.aiWhy}: {proposal.reason}
          </p>
        )}

        <Evidence proposal={proposal} />

        {proposal.missing.length === 0 ? null : (
          <Notice tone="attention" title={quick.aiNeedsBadge}>
            <ul className="flex list-inside list-disc flex-col gap-1" data-testid="ai-missing">
              {proposal.missing.map((item) => (
                <li key={item.field}>{item.question}</li>
              ))}
            </ul>
          </Notice>
        )}

        {elsewhere === undefined ? (
          <ConfirmForm proposal={proposal} state={state} />
        ) : (
          <Notice tone="neutral" title={quick.aiActionTitle[action] ?? ''}>
            <p>{elsewhere}</p>
            <p className="mt-3">
              <Link
                href={action === 'note' ? '/lenders' : '/entry'}
                className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
              >
                {action === 'note' ? quick.aiGoToLenders : quick.aiGoToEntry}
              </Link>
            </p>
          </Notice>
        )}
      </div>
    </Card>
  );
}

/**
 * Which words each figure came from.
 *
 * Quoted from the person's own sentence, never paraphrased, and never shown for a
 * field the sentence did not supply — an empty row would read as "we found
 * nothing there", which is a different claim from "there was nothing to find".
 */
function Evidence({ proposal }: { proposal: AiProposal }) {
  const rows: { label: string; value: string }[] = [];
  const add = (label: string, value: string | null): void => {
    if (value !== null) rows.push({ label, value });
  };
  add(quick.aiEvidenceAmount, proposal.evidence.amountText);
  add(quick.aiEvidenceDate, proposal.evidence.dateText);
  add(quick.aiEvidenceWho, proposal.evidence.counterpartyText);

  if (rows.length === 0) return null;

  return (
    <div className="rounded-control bg-surface-muted p-3">
      <p className="font-medium">{quick.aiEvidenceTitle}</p>
      <ul className="mt-1 flex flex-col gap-1 text-small text-text-secondary">
        {rows.map((row) => (
          <li key={row.label}>
            {row.label}: <bdi dir="auto">„{row.value}”</bdi>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The fields, and the one button that records.
 *
 * Every field is an ordinary control from the existing form kit, submitting the
 * name the server already reads. Nothing here is special to the smart route
 * except `proposalSource`, which tells the server which branch of its own
 * validation to start from.
 *
 * The button is offered whatever the state, and the server refuses what is not
 * complete. That is on purpose: disabling it would leave a person looking at a
 * screen with no way forward and no explanation, whereas a filled-in field and a
 * press is a thing they can do.
 */
function ConfirmForm({ proposal, state }: { proposal: AiProposal; state: QuickState }) {
  const needsAccount = proposal.accountId === null && state.accounts.length > 1;
  const needsDebt = proposal.action === 'debt_repayment';
  const isNewDebt = proposal.action === 'new_debt';
  const debt = state.debts.find((row) => row.id === proposal.debtId);

  return (
    <ActionForm action={confirmQuickUpdateAction} submitLabel={quick.aiConfirm}>
      <>
        <HiddenValue name="sourceText" value={state.text} />
        <HiddenValue name="proposalSource" value="ai" />
        <HiddenValue name="aiIntent" value={proposal.action} />
        {/*
         * The label the record will carry, taken from the person's own words and
         * shown to them above as evidence. Hidden because it is not a decision —
         * the sentence is on the screen, and editing it and reading again is how
         * you change it.
         */}
        <HiddenValue name="merchant" value={proposal.evidence.counterpartyText ?? ''} />

        <MoneyField
          name="amountMinor"
          label={quick.fieldAmount}
          defaultValue={asAmountInput(proposal.amountMinor)}
          required
        />

        {needsAccount ? (
          <SelectField
            name="accountId"
            label={quick.fieldAccount}
            emptyLabel={quick.chooseAccount}
            options={state.accounts.map((account) => ({
              value: account.id,
              label: account.name,
            }))}
          />
        ) : proposal.accountId === null ? null : (
          <HiddenValue name="accountId" value={proposal.accountId} />
        )}

        {needsDebt ? (
          proposal.debtId === null ? (
            <SelectField
              name="debtId"
              label={quick.fieldDebt}
              emptyLabel={quick.chooseDebt}
              options={state.debts.map((row) => ({ value: row.id, label: row.creditorName }))}
            />
          ) : (
            <>
              <HiddenValue name="debtId" value={proposal.debtId} />
              {/*
               * The link appears only once the reference has been verified — the
               * id in `proposal.debtId` survived `verifyProposal`, so it names an
               * active debt of this household and the card exists.
               */}
              {debt === undefined ? null : (
                <p>
                  <Link
                    href="/lenders"
                    className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
                  >
                    {quick.aiLenderLink}: {debt.creditorName}
                  </Link>
                </p>
              )}
            </>
          )
        ) : null}

        {isNewDebt ? (
          <TextField
            name="creditorName"
            label={quick.aiCreditorName}
            hint={quick.aiCreditorHint}
            defaultValue={proposal.evidence.counterpartyText ?? ''}
            maxLength={160}
          />
        ) : null}

        <TextField
          name="occurredOn"
          label={quick.fieldDate}
          type="date"
          defaultValue={proposal.date ?? ''}
          {...(proposal.evidence.dateText === null ? { hint: quick.aiAssumedToday } : {})}
        />

        {proposal.categoryId === null ? null : (
          <p className="text-small text-text-secondary">
            {quick.category}: {CATEGORY_LABEL[proposal.categoryId] ?? proposal.categoryId}
          </p>
        )}
      </>
    </ActionForm>
  );
}

/**
 * The reading did not happen, and the screen says which of the reasons it was.
 *
 * Each reason gets its own sentence because each one calls for something
 * different: waiting, trying again, or knowing that nothing will change until the
 * owner sets it up. "Something went wrong" would cover all three and help with
 * none of them — and every one of them ends by pointing at the deterministic
 * reader, which is still there and still works.
 */
function AiUnavailable({ proposal }: { proposal: AiProposal }) {
  const reason = proposal.unavailableReason ?? 'provider_error';
  const notConfigured = reason === 'not_configured';

  return (
    <Notice
      tone="neutral"
      title={notConfigured ? quick.aiNotConfiguredTitle : quick.aiUnavailableTitle}
    >
      <div data-testid="ai-unavailable" data-reason={reason}>
        <p>{notConfigured ? quick.aiNotConfigured : (quick.aiUnavailable[reason] ?? '')}</p>
        <p className="mt-2 text-small text-text-secondary">{quick.aiFallbackHint}</p>
      </div>
    </Notice>
  );
}
