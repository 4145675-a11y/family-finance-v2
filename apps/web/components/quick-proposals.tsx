'use client';

import type { QuickProposal } from '@family-finance/quick-update';

import { ActionForm, HiddenValue, MoneyField, SelectField, TextField } from './form';
import { Badge, Card } from './ui';
import { confirmQuickUpdateAction } from '../lib/actions/quick';
import { quick } from '../lib/copy/quick';
import type { QuickState } from '../lib/quick/state';

/**
 * What the server understood, offered back for checking.
 *
 * One card per proposal, and each card is a form of its own. That is not a
 * layout preference: a sentence that produced two updates has to be approvable
 * one at a time, because a person who agrees with the first and not the second
 * must not be made to choose between recording something wrong and recording
 * nothing.
 *
 * A card that is not `ready` shows the field it is missing rather than an error.
 * "חסר סכום" beside an empty amount box is a thing to do; "לא הצלחנו" is not.
 */

const TONE: Readonly<Record<QuickProposal['state'], 'neutral' | 'success' | 'attention'>> = {
  ready: 'success',
  needs_amount: 'attention',
  needs_account: 'attention',
  needs_debt: 'attention',
  needs_date: 'attention',
  not_understood: 'neutral',
};

function shekels(amountMinor: number | null): string {
  if (amountMinor === null) return '';
  return (amountMinor / 100).toFixed(2);
}

export function QuickProposals({ state }: { state: QuickState }) {
  if (state.status !== 'read' || state.proposals.length === 0) return null;

  return (
    <div className="flex flex-col gap-4">
      {state.proposals.map((proposal) => (
        <ProposalCard
          key={proposal.index}
          proposal={proposal}
          accounts={state.accounts}
          debts={state.debts}
        />
      ))}
    </div>
  );
}

function ProposalCard({
  proposal,
  accounts,
  debts,
}: {
  proposal: QuickProposal;
  accounts: QuickState['accounts'];
  debts: QuickState['debts'];
}) {
  const understood = proposal.state !== 'not_understood';

  return (
    <Card title={quick.intent[proposal.intent]}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={TONE[proposal.state]}>{quick.state[proposal.state]}</Badge>
          {proposal.classification !== null ? (
            <span className="text-small text-text-secondary">
              {proposal.classification.explanation}
            </span>
          ) : null}
        </div>

        <p className="text-small text-text-secondary">„{proposal.sourceText}”</p>
        <p>{proposal.explanation}</p>

        {understood ? (
          <ActionForm action={confirmQuickUpdateAction} submitLabel={quick.approve}>
            <HiddenValue name="sourceText" value={proposal.sourceText} />
            <HiddenValue name="proposalIndex" value={String(proposal.index)} />

            <MoneyField
              name="amountMinor"
              label={quick.fieldAmount}
              defaultValue={shekels(proposal.amountMinor)}
              required
            />

            {proposal.accountId === null ? (
              <SelectField
                name="accountId"
                label={quick.fieldAccount}
                emptyLabel={quick.chooseAccount}
                options={accounts.map((account) => ({
                  value: account.id,
                  label: account.name,
                }))}
              />
            ) : (
              <HiddenValue name="accountId" value={proposal.accountId} />
            )}

            {proposal.intent === 'debt_payment' ? (
              proposal.debtId === null ? (
                <SelectField
                  name="debtId"
                  label={quick.fieldDebt}
                  emptyLabel={quick.chooseDebt}
                  options={debts.map((debt) => ({ value: debt.id, label: debt.creditorName }))}
                />
              ) : (
                <HiddenValue name="debtId" value={proposal.debtId} />
              )
            ) : null}

            <TextField
              name="occurredOn"
              label={quick.fieldDate}
              type="date"
              defaultValue={proposal.date}
              {...(proposal.dateAssumed ? { hint: quick.assumedToday } : {})}
            />
          </ActionForm>
        ) : null}
      </div>
    </Card>
  );
}
