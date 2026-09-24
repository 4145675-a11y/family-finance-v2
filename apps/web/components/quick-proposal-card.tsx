'use client';

import Link from 'next/link';
import { useState } from 'react';

import type { AiProposal } from '@family-finance/ai-proposal';

import { ActionForm, HiddenValue, MoneyField, SelectField, TextField } from './form';
import { Badge, Card, Money, Notice } from './ui';
import { confirmQuickUpdateAction } from '../lib/actions/quick';
import { quick } from '../lib/copy/quick';
import { formatBusinessDate, formatDueDate } from '../lib/format';
import type { QuickState } from '../lib/quick/state';

/**
 * The proposal, short enough to read standing up.
 *
 * Five lines and a button, in the order a person checks them: that nothing is
 * saved, what kind of thing it is, how much, which lender, when. Anything the
 * sentence did not say is one question with the answer beside it — as buttons
 * where the answer is a choice from a short list, because a dropdown on a phone
 * is a worse way to answer "which account".
 *
 * The card used to carry the model's summary, its reason, and the quoted words
 * every figure was read from. All of it was true; none of it was what somebody
 * with shopping in one hand needed, and it pushed the question they had to
 * answer below the fold. It is gone rather than collapsed.
 *
 * Selecting an account writes nothing. It is local state that completes the
 * card; the write happens when — and only when — the confirmation button is
 * pressed, through the same action, the same idempotency key and the same
 * server-side checks as every other route into a command.
 */

/** Agorot as the amount field wants them: a decimal string a person can edit. */
function asAmountInput(amountMinor: number | null): string {
  if (amountMinor === null) return '';
  return (amountMinor / 100).toFixed(2);
}

/** True when the money is arriving rather than leaving. */
function isInflow(action: AiProposal['action']): boolean {
  return action === 'income' || action === 'new_principal' || action === 'new_debt';
}

export function QuickProposalCard({ state }: { state: QuickState }) {
  const proposal = state.ai;
  if (proposal === null) return null;

  if (proposal.state === 'not_understood' || proposal.action === 'unknown') {
    return (
      <Notice tone="neutral" title={quick.draftBadge}>
        <p data-testid="quick-not-understood">{quick.notUnderstood}</p>
      </Notice>
    );
  }

  const elsewhere = quick.elsewhere[proposal.action];
  if (elsewhere !== undefined) {
    return (
      <Notice tone="neutral" title={quick.actionTitle[proposal.action] ?? ''}>
        <p>{elsewhere}</p>
        <p className="mt-3">
          <Link
            href={proposal.action === 'note' ? '/lenders' : '/entry'}
            className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
          >
            {proposal.action === 'note' ? quick.goToLenders : quick.goToEntry}
          </Link>
        </p>
      </Notice>
    );
  }

  return <Proposal proposal={proposal} state={state} />;
}

function Proposal({ proposal, state }: { proposal: AiProposal; state: QuickState }) {
  /*
   * The account, chosen here and submitted with the form. Local state rather
   * than a round trip: answering "which account" is not a decision that needs
   * the server, and nothing is written until confirm regardless.
   */
  const [accountId, setAccountId] = useState<string | null>(proposal.accountId);

  const needsAccount = accountId === null && state.accounts.length > 0;
  const chosenAccount = state.accounts.find((account) => account.id === accountId);
  const needsLender =
    (proposal.action === 'debt_repayment' || proposal.action === 'new_principal') &&
    proposal.debtId === null;
  const isNewDebt = proposal.action === 'new_debt';

  const amount =
    proposal.amountMinor === null ? null : (
      <Money amountMinor={proposal.amountMinor} currency="ILS" />
    );

  return (
    <Card>
      <div
        className="flex flex-col gap-3"
        data-testid="quick-proposal"
        data-state={proposal.state}
        data-action={proposal.action}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="attention">{quick.draftBadge}</Badge>
        </div>

        {/* What, and how much — one line. */}
        <p className="text-[18px] font-semibold">
          {quick.actionTitle[proposal.action] ?? proposal.action}
          {amount === null ? null : <>: {amount}</>}
        </p>

        {/*
         * The lender, and whether it is a card that already exists. The label is
         * the whole point of this slice: a person has to be able to see at a
         * glance that this is being added to the card they already have rather
         * than opening a second one beside it.
         */}
        {proposal.lenderName === null ? null : (
          <p data-testid="quick-lender">
            {quick.lenderLabel}: <bdi dir="auto">{proposal.lenderName}</bdi>
            {proposal.debtId === null ? null : (
              <>
                {' · '}
                <Badge tone="success">{quick.existingLender}</Badge>
              </>
            )}
          </p>
        )}

        {/*
         * When, in both calendars, from the one dual-calendar implementation.
         *
         * A repayment date is shown in preference to the day the money moved,
         * because it is the fact a person checks: "קיבלתי עוד 3,000 לפירעון
         * ב־10/10/2026" arrived today — unremarkable — and comes due on a day
         * they need to see written out. Only one line either way.
         */}
        {proposal.dueDate !== null ? (
          <p data-testid="quick-due">
            {quick.dueLabel}: <bdi dir="ltr">{formatDueDate(proposal.dueDate)}</bdi>
            {proposal.dueHebrewDate === null ? null : <> · {proposal.dueHebrewDate}</>}
          </p>
        ) : proposal.date === null ? null : (
          <p data-testid="quick-date">
            {quick.dateLabel}: <bdi dir="ltr">{formatBusinessDate(proposal.date)}</bdi>
            {proposal.hebrewDate === null ? null : <> · {proposal.hebrewDate}</>}
          </p>
        )}

        {/*
         * Where the money goes, once that is settled.
         *
         * Shown whether the sentence named the account, the household has only
         * one, or a person just pressed its button — because by the time there is
         * something to confirm, the card has to say what confirming would do.
         */}
        {chosenAccount === undefined ? null : (
          <p data-testid="quick-account">
            {quick.fieldAccount}: <bdi dir="auto">{chosenAccount.name}</bdi>
          </p>
        )}

        {/* One question, with its answer beside it. */}
        {needsAccount ? (
          <AccountQuestion
            proposal={proposal}
            accounts={state.accounts}
            onChoose={setAccountId}
          />
        ) : null}

        {/*
         * Everything else the sentence did not settle, and the control that writes.
         *
         * One card rather than a sequence: a person who did not say the amount or
         * the account should see both gaps at once and fill them in whichever
         * order suits them. The confirmation control stays visible and inert
         * while the account question is open, because a button that can only fail
         * teaches a person that this screen argues with them — and one that
         * vanishes and reappears teaches them nothing at all.
         */}
        <ActionForm
          action={confirmQuickUpdateAction}
          submitLabel={quick.confirm}
          disabled={needsAccount}
        >
          <>
            <HiddenValue name="sourceText" value={state.text} />
            <HiddenValue name="aiIntent" value={proposal.action} />
            {/*
             * What the record is called. A resolved lender's own recorded name in
             * preference to the sentence's wording, so a lender's records are all
             * filed under one spelling; the sentence's own words otherwise.
             */}
            <HiddenValue name="merchant" value={proposal.lenderName ?? proposal.label ?? ''} />
            <HiddenValue name="occurredOn" value={proposal.date ?? ''} />
            {/*
             * The repayment date travels with the confirmation so the fact the
             * card showed is the fact that gets recorded. A due date that was
             * displayed and then dropped would be worse than not reading it.
             */}
            {proposal.dueDate === null ? null : (
              <HiddenValue name="dueDate" value={proposal.dueDate} />
            )}
            <HiddenValue name="amountMinor" value={asAmountInput(proposal.amountMinor)} />
            {accountId === null ? null : <HiddenValue name="accountId" value={accountId} />}

            {needsLender ? (
              <SelectField
                name="debtId"
                label={quick.fieldDebt}
                emptyLabel={quick.chooseDebt}
                options={state.debts.map((row) => ({
                  value: row.id,
                  label: row.creditorName,
                }))}
              />
            ) : proposal.debtId === null ? null : (
              <HiddenValue name="debtId" value={proposal.debtId} />
            )}

            {isNewDebt ? (
              <TextField
                name="creditorName"
                label={quick.creditorName}
                hint={quick.creditorHint}
                maxLength={160}
              />
            ) : null}

            {/*
             * The amount and the date are editable only when the sentence did not
             * settle them. A card that offered four boxes for facts a person
             * already stated would be the long form it replaced.
             */}
            {proposal.amountMinor === null ? (
              <MoneyField name="amountMinor" label={quick.fieldAmount} required />
            ) : null}
            {proposal.date === null ? (
              <TextField name="occurredOn" label={quick.fieldDate} type="date" />
            ) : null}
          </>
        </ActionForm>

        {/*
         * Once the reference is verified, the card is reachable — and only then.
         * A link to a lender the server did not resolve would be a link to
         * nothing, or worse, to somebody else's.
         */}
        {proposal.debtId === null ? null : (
          <p>
            <Link
              href="/lenders"
              className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
            >
              {quick.goToLenders}
            </Link>
          </p>
        )}
      </div>
    </Card>
  );
}

/**
 * "Which account did the money go into?" — as buttons.
 *
 * Buttons rather than a dropdown because the answer is one of two or three
 * things and a thumb should not have to open a picker to give it. Only open
 * accounts of this household are offered, and nothing is invented: a household
 * with no open account never reaches this card.
 */
function AccountQuestion({
  proposal,
  accounts,
  onChoose,
}: {
  proposal: AiProposal;
  accounts: QuickState['accounts'];
  onChoose: (id: string) => void;
}) {
  const amount =
    proposal.amountMinor === null
      ? ''
      : `${(proposal.amountMinor / 100).toLocaleString('he-IL')} ₪`;
  const question = isInflow(proposal.action)
    ? quick.accountQuestion(amount)
    : quick.accountQuestionOut(amount);

  return (
    <div className="flex flex-col gap-2" data-testid="quick-account-question">
      <p className="font-medium">{question}</p>
      <div className="flex flex-wrap gap-2">
        {accounts.map((account) => (
          <button
            key={account.id}
            type="button"
            onClick={() => onChoose(account.id)}
            className="inline-flex min-h-11 items-center justify-center rounded-control border border-border-interactive bg-surface px-4 py-2 font-medium text-text-primary transition-colors hover:bg-surface-muted"
          >
            {account.name}
          </button>
        ))}
      </div>
    </div>
  );
}
