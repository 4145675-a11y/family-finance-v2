import type { Debt, DebtRepaymentDemand } from '@family-finance/contracts';

import {
  recordRepaymentDemandAction,
  setRepaymentExpectationAction,
} from '../lib/actions/lenders';
import { repayment } from '../lib/copy/repayment';
import { formatDueDate } from '../lib/format';
import { ActionForm, HiddenValue, MoneyField, SelectField, TextField } from './form';
import { Badge, Disclosure, Money, StatRow } from './ui';

/**
 * What a loan says about repayment, and every time the lender asked.
 *
 * The two are drawn apart on purpose, and the separation is the design. The
 * expectation is what the family and the lender agreed; a demand is what
 * happened afterwards. A screen that merged them — the soonest of the two, a
 * single "due" line — would answer neither question: "when did we say we would
 * pay" and "have they started asking" lead to different actions, and a family
 * under pressure needs both, unmixed.
 *
 * Neither belongs in the ledger table. That column has to add up to the balance
 * printed above it, and a demand moves no money: it would either break the sum
 * or sit in it meaning nothing.
 */

/** The expected repayment date in words, for whichever of the three states holds. */
export function RepaymentExpectationLine({ debt }: { debt: Debt }) {
  const expectation = debt.repaymentExpectation;

  if (expectation === undefined) {
    return (
      <StatRow
        label={repayment.expectation.heading}
        value={repayment.expectation.unrecorded}
        hint={repayment.expectation.unrecordedHint}
      />
    );
  }

  if (expectation.kind === 'none') {
    return (
      <StatRow
        label={repayment.expectation.heading}
        value={repayment.expectation.none}
        hint={repayment.expectation.noneHint}
      />
    );
  }

  return (
    <StatRow label={repayment.expectation.heading} value={formatDueDate(expectation.on)} />
  );
}

/**
 * Changing what is expected.
 *
 * Three radio-equivalent choices rather than a date box that can be emptied,
 * because "we agreed there is no date" has to be sayable. The date field stays
 * visible under all three: hiding it would need client state on a screen that
 * has none, and a person who picks the wrong answer first can correct it without
 * losing what they typed.
 *
 * Absent for a closed loan. The command refuses it there, and offering a control
 * that will be refused is how a product teaches people not to trust it.
 */
export function RepaymentExpectationForm({ debt }: { debt: Debt }) {
  if (debt.status !== 'active') return null;

  const current = debt.repaymentExpectation;

  return (
    <Disclosure summary={repayment.expectation.editSummary}>
      <ActionForm action={setRepaymentExpectationAction} submitLabel="לשמור">
        <>
          <HiddenValue name="debtId" value={debt.id} />
          <SelectField
            name="expectation"
            label={repayment.expectation.choiceLabel}
            defaultValue={current?.kind ?? 'dated'}
            emptyLabel=""
            required
            options={[
              { value: 'dated', label: repayment.expectation.choiceDated },
              { value: 'none', label: repayment.expectation.choiceNone },
              { value: 'unrecorded', label: repayment.expectation.choiceUnrecorded },
            ]}
          />
          <TextField
            name="expectedRepaymentOn"
            label={repayment.expectation.dateLabel}
            type="date"
            required={false}
            defaultValue={current?.kind === 'dated' ? current.on : ''}
          />
        </>
      </ActionForm>
    </Disclosure>
  );
}

/**
 * The demands against one loan, and the form that adds another.
 *
 * `submissionId` is rendered once per page load and becomes the new row's
 * identifier, so a double press or a retry writes one demand rather than two.
 */
export function RepaymentDemands({
  debt,
  demands,
  today,
  submissionId,
}: {
  debt: Debt;
  demands: readonly DebtRepaymentDemand[];
  today: string;
  submissionId: string;
}) {
  return (
    <div className="mt-3 border-t border-border pt-3">
      <p className="mb-1 font-medium">{repayment.demand.heading}</p>
      <p className="text-text-secondary">{repayment.demand.harmless}</p>
      {debt.status === 'active' ? null : (
        <p className="mt-1 text-text-secondary">{repayment.demand.onClosedDebt}</p>
      )}

      {demands.length === 0 ? (
        <p className="mt-2 text-text-secondary">{repayment.demand.empty}</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {demands.map((demand) => (
            <li key={demand.id} className="rounded-control bg-surface-muted p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{formatDueDate(demand.demandedOn)}</Badge>
                {demand.amountMinor === null ? (
                  <span className="text-text-secondary">{repayment.demand.noAmount}</span>
                ) : (
                  <Money amountMinor={demand.amountMinor} currency={debt.currency} />
                )}
              </div>
              <p className="mt-1 text-text-secondary">
                {repayment.demand.requestedDeadline}:{' '}
                {demand.requestedDeadline === null
                  ? repayment.demand.noDeadline
                  : formatDueDate(demand.requestedDeadline)}
              </p>
              {demand.note === null ? null : <p className="mt-1">{demand.note}</p>}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3">
        <Disclosure summary={repayment.demand.addSummary}>
          <ActionForm action={recordRepaymentDemandAction} submitLabel="לרשום">
            <>
              <HiddenValue name="debtId" value={debt.id} />
              <HiddenValue name="idempotencyKey" value={submissionId} />
              <TextField
                name="demandedOn"
                label={repayment.demand.demandedOn}
                type="date"
                defaultValue={today}
              />
              <TextField
                name="requestedDeadline"
                label={repayment.demand.requestedDeadline}
                hint={repayment.demand.requestedDeadlineHint}
                type="date"
                required={false}
              />
              <MoneyField
                name="amountMinor"
                label={repayment.demand.amount}
                hint={repayment.demand.amountHint}
                required={false}
              />
              <TextField name="note" label={repayment.demand.note} required={false} />
            </>
          </ActionForm>
        </Disclosure>
      </div>
    </div>
  );
}
