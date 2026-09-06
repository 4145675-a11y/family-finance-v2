import { addDebtAction, recordRolloverAction } from '../../lib/actions/entries';
import { AppShell } from '../../components/app-shell';
import { ActionForm, MoneyField, SelectField, TextField } from '../../components/form';
import { screens } from '../../lib/copy/screens';
import { todayInJerusalem } from '../../lib/forms';
import {
  Badge,
  Card,
  SectionTitle,
  Disclosure,
  EmptyState,
  Figure,
  Money,
  StatRow,
} from '../../components/ui';
import { copy } from '../../lib/copy/copy';
import { loadDashboardView } from '../../lib/dashboard/load';
import { formatBasisPoints, formatBusinessDate } from '../../lib/format';

/**
 * The debts, and what actually happened to them this month.
 *
 * The mathematics is unchanged — 02-FINANCIAL-RULES.md § גלגול חוב still decides
 * what counts as progress. What changed is the explanation: a family should be
 * able to read one sentence and understand why paying five thousand shekels left
 * the total where it was.
 *
 * Principal and interest stay apart throughout. Replacing an expensive debt with
 * a cheaper one may leave the principal untouched while lowering what it costs,
 * and those are two separate facts that must never be merged into one cheerful
 * number.
 */

/*
 * Rendered per request. The figures come from the household's own store, and a
 * prerendered copy would show what the build saw rather than what is true now.
 */
export const dynamic = 'force-dynamic';

export default async function DebtsPage() {
  const { descriptor, snapshot, input } = await loadDashboardView();

  if (snapshot === null || input === null) {
    return (
      <AppShell source={descriptor} active="/more" title={copy.debts.title}>
        <EmptyState reason={descriptor.reason} />
      </AppShell>
    );
  }

  const { debtMetrics: metrics, debtTrend: trend, callRisk: risk } = snapshot;

  /** The debts a rollover can name. Two are needed for a swap to mean anything. */
  const debtOptions = input.debts
    .filter((debt) => debt.status === 'active')
    .map((debt) => ({ value: debt.id, label: debt.creditorName }));
  const balanceOf = (debtId: string) =>
    snapshot.debtBalances.find((entry) => entry.debtId === debtId)?.balanceMinor ?? 0;
  const activeDebts = input.debts.filter((debt) => debt.status === 'active');
  const confirmedSwaps = input.rollovers.filter((link) => link.status === 'confirmed');

  return (
    <AppShell source={descriptor} active="/more" title={copy.debts.title}>
      <Card
        title={copy.debts.realStoryTitle}
        tone={trend?.consumerDirection === 'down' ? 'success' : 'neutral'}
      >
        <p className="text-[24px] leading-tight font-semibold">
          {trend === null
            ? copy.home.debtFlat
            : trend.consumerDirection === 'down'
              ? copy.home.debtDown(-trend.netConsumerChangeMinor)
              : trend.consumerDirection === 'up'
                ? copy.home.debtUp(trend.netConsumerChangeMinor)
                : copy.home.debtFlat}
        </p>
        <p className="mt-2 text-text-secondary">
          {trend === null
            ? copy.home.debtFlatNote
            : trend.consumerDirection === 'down'
              ? copy.home.debtDownNote
              : trend.consumerDirection === 'up'
                ? copy.home.debtUpNote
                : copy.home.debtFlatNote}
        </p>

        <div className="mt-4">
          <StatRow
            label={copy.debts.startOfMonth}
            value={
              <Money
                amountMinor={trend?.baselineConsumerMinor ?? 0}
                currency={snapshot.currency}
              />
            }
          />
          <StatRow
            label={copy.debts.now}
            value={
              <Money
                amountMinor={snapshot.debtTotals.consumerDebtMinor}
                currency={snapshot.currency}
              />
            }
          />
          <StatRow
            label={copy.debts.change}
            value={
              <Money
                amountMinor={trend?.netConsumerChangeMinor ?? 0}
                currency={snapshot.currency}
                signed
              />
            }
          />
        </div>

        <Disclosure summary={copy.sections.calculation}>
          <StatRow
            label={copy.debts.repaid}
            value={
              <Money
                amountMinor={metrics.grossPrincipalRepaidMinor}
                currency={snapshot.currency}
              />
            }
          />
          <StatRow
            label={copy.debts.borrowed}
            value={
              <Money
                amountMinor={metrics.newDebtOriginatedMinor}
                currency={snapshot.currency}
              />
            }
          />
          <StatRow
            label={copy.debts.fromBorrowing}
            value={
              <Money
                amountMinor={metrics.rolloverFundedRepaymentMinor}
                currency={snapshot.currency}
              />
            }
          />
          <StatRow
            label={copy.debts.fromIncome}
            value={
              <Money
                amountMinor={metrics.incomeFundedPrincipalReductionMinor}
                currency={snapshot.currency}
              />
            }
          />
          <StatRow
            label={copy.debts.interestPaid}
            value={
              <Money
                amountMinor={metrics.interestAndFeesPaidMinor}
                currency={snapshot.currency}
              />
            }
            hint={copy.debts.interestNote}
          />
          <StatRow
            label={copy.debts.correction}
            value={
              <Money
                amountMinor={metrics.balanceCorrectionMinor}
                currency={snapshot.currency}
                signed
              />
            }
            hint={copy.debts.correctionNote}
          />
        </Disclosure>
      </Card>

      <Card title={copy.debts.swapTitle}>
        {confirmedSwaps.length === 0 ? (
          <p className="text-text-secondary">{copy.debts.noSwaps}</p>
        ) : (
          <ol className="flex flex-col gap-4">
            {confirmedSwaps.map((link) => {
              const from = input.debts.find((debt) => debt.id === link.fromDebtId);
              const to = input.debts.find((debt) => debt.id === link.toDebtId);
              return (
                <li key={link.id} className="border-b border-border pb-4 last:border-b-0">
                  <p>
                    {copy.debts.swapExplain(
                      from?.creditorName ?? link.fromDebtId,
                      to?.creditorName ?? link.toDebtId,
                      link.amountMinor,
                    )}
                  </p>
                  <p className="mt-1.5 text-small text-text-secondary">
                    <Figure>{formatBusinessDate(link.occurredOn)}</Figure>
                  </p>
                </li>
              );
            })}
          </ol>
        )}
      </Card>

      <Card
        title={copy.debts.urgentTitle}
        tone={risk.within30DaysMinor > 0 ? 'attention' : 'neutral'}
      >
        <p>
          {risk.within30DaysMinor > 0
            ? copy.debts.callableSoon(risk.within30DaysMinor)
            : copy.debts.noCallable}
        </p>
        {risk.demandedNowMinor > 0 ? (
          <StatRow
            label="כבר ביקשו מאיתנו להחזיר"
            value={<Money amountMinor={risk.demandedNowMinor} currency={snapshot.currency} />}
          />
        ) : null}
      </Card>

      <Card title={copy.debts.allTitle} subtitle={copy.debts.unknownCostNote}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] border-collapse">
            <thead>
              <tr className="border-b border-border text-small text-text-secondary">
                <th scope="col" className="py-2 text-start font-medium">
                  {copy.debts.creditor}
                </th>
                <th scope="col" className="py-2 text-start font-medium">
                  {copy.debts.balance}
                </th>
                <th scope="col" className="py-2 text-start font-medium">
                  {copy.debts.monthly}
                </th>
                <th scope="col" className="py-2 text-start font-medium">
                  {copy.debts.cost}
                </th>
                <th scope="col" className="py-2 text-start font-medium">
                  &nbsp;
                </th>
              </tr>
            </thead>
            <tbody>
              {activeDebts.map((debt) => (
                <tr key={debt.id} className="border-b border-border last:border-b-0">
                  <th scope="row" className="py-2.5 text-start font-normal">
                    {debt.creditorName}
                    {debt.kind === 'mortgage' ? (
                      <span className="text-small text-text-secondary">
                        {' '}
                        · {copy.debts.mortgageTag}
                      </span>
                    ) : null}
                  </th>
                  <td className="py-2.5 font-medium">
                    <Money amountMinor={balanceOf(debt.id)} currency={snapshot.currency} />
                  </td>
                  <td className="py-2.5">
                    {debt.minimumPaymentMinor === null ? (
                      <span className="text-text-secondary">—</span>
                    ) : (
                      <Money
                        amountMinor={debt.minimumPaymentMinor}
                        currency={snapshot.currency}
                      />
                    )}
                  </td>
                  <td className="py-2.5">
                    {debt.effectiveAnnualRateBp === null ? (
                      <span className="text-attention">{copy.debts.unknownCost}</span>
                    ) : (
                      <Figure>{formatBasisPoints(debt.effectiveAnnualRateBp)}</Figure>
                    )}
                  </td>
                  <td className="py-2.5">
                    {debt.urgency === 'none' ? null : (
                      <Badge
                        tone={
                          debt.urgency === 'legal'
                            ? 'danger'
                            : debt.urgency === 'demanded'
                              ? 'attention'
                              : 'neutral'
                        }
                      >
                        {copy.debts.urgency[debt.urgency] ?? debt.urgency}
                      </Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <SectionTitle>{screens.entry.debtTitle}</SectionTitle>

      <Card title={copy.debts.creditor}>
        <ActionForm action={addDebtAction} submitLabel={screens.entry.save} resetOnSuccess>
          <>
            <TextField name="creditorName" label={copy.debts.creditor} maxLength={160} />
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                name="kind"
                label={screens.accounts.kind}
                defaultValue="bank_loan"
                options={[
                  { value: 'bank_loan', label: 'הלוואה מהבנק' },
                  { value: 'mortgage', label: copy.debts.mortgageTag },
                  { value: 'revolving_credit', label: 'אשראי מתגלגל' },
                  { value: 'overdraft', label: 'מינוס' },
                  { value: 'private_person', label: 'חוב לאדם פרטי' },
                  { value: 'institution', label: 'חוב למוסד' },
                  { value: 'other', label: 'אחר' },
                ]}
              />
              <MoneyField name="openingBalanceMinor" label={copy.debts.balance} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                name="openedOn"
                label={screens.entry.date}
                type="date"
                defaultValue={todayInJerusalem()}
              />
              <TextField
                name="annualRatePercent"
                label={copy.debts.cost}
                hint={copy.debts.unknownCostNote}
                required={false}
                inputMode="decimal"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <MoneyField
                name="minimumPaymentMinor"
                label={copy.debts.monthly}
                required={false}
              />
              <SelectField
                name="urgency"
                label={copy.debts.urgentTitle}
                defaultValue="none"
                options={[
                  { value: 'none', label: copy.debts.urgency['none'] ?? '' },
                  { value: 'watch', label: copy.debts.urgency['watch'] ?? '' },
                  { value: 'demanded', label: copy.debts.urgency['demanded'] ?? '' },
                  { value: 'legal', label: copy.debts.urgency['legal'] ?? '' },
                ]}
              />
            </div>
          </>
        </ActionForm>
      </Card>

      {/*
        A rollover is three facts, and the form makes that visible: which debt was
        repaid, which one paid for it, and how much. The total does not move, and
        the card above says exactly that.
      */}
      {debtOptions.length < 2 ? null : (
        <Card title={copy.debts.swapTitle}>
          <ActionForm action={recordRolloverAction} submitLabel={screens.entry.save}>
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField
                  name="fromDebtId"
                  label={copy.debts.repaid}
                  options={debtOptions}
                />
                <SelectField
                  name="toDebtId"
                  label={copy.debts.borrowed}
                  options={debtOptions}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <MoneyField name="amountMinor" label={screens.entry.amount} />
                <TextField
                  name="occurredOn"
                  label={screens.entry.date}
                  type="date"
                  defaultValue={todayInJerusalem()}
                />
              </div>
            </>
          </ActionForm>
        </Card>
      )}
    </AppShell>
  );
}
