import { notFound } from 'next/navigation';

import { AppShell } from '../../../components/app-shell';
import {
  ActionForm,
  HiddenValue,
  MoneyField,
  SelectField,
  TextAreaField,
  TextField,
} from '../../../components/form';
import { NoHousehold } from '../../../components/screen';
import {
  Badge,
  Card,
  DataTable,
  Disclosure,
  Figure,
  Money,
  Notice,
  SectionTitle,
  StatRow,
} from '../../../components/ui';
import {
  addCheckAction,
  addCheckSeriesAction,
  cancelCheckAction,
  clearCheckAction,
  closeLoanAction,
  correctCheckAction,
  deliverChecksAction,
  markCheckDepositedAction,
  markCheckReturnedAction,
  replaceCheckAction,
  setRepaymentPlanAction,
} from '../../../lib/actions/checks';
import { gemach } from '../../../lib/copy/gemach';
import { screens } from '../../../lib/copy/screens';
import { loadDashboardView } from '../../../lib/dashboard/load';
import { formatBusinessDate, formatDateTime, money, toAmountInput } from '../../../lib/format';
import { gemachLoanById, type CheckView } from '../../../lib/gemach';
import { todayInJerusalem } from '../../../lib/forms';

/**
 * One gemach loan: the paper, the money, and the difference between them.
 *
 * The screen is ordered by what a person came to find out. First the exposure —
 * how many checks are out and when the next one might land — because that is the
 * thing they cannot see in their bank balance. Then the loan's own figures. Then
 * every check with the one action each is actually capable of. The forms for
 * creating checks come last: they are used once and then rarely.
 *
 * Every destructive-looking action asks for a reason, and every reason ends up in
 * the audit trail. That is not bureaucracy — a check marked "returned" with no
 * explanation is a mystery in three months, and it is the sort of mystery that
 * gets resolved by guessing.
 */

export const dynamic = 'force-dynamic';

/** The tone a check's state should be read in. */
function toneFor(state: string): 'neutral' | 'success' | 'attention' | 'danger' {
  if (state === 'cleared') return 'success';
  if (state === 'returned') return 'danger';
  if (state === 'overdue' || state === 'due') return 'attention';
  return 'neutral';
}

function CheckActions({ view }: { view: CheckView }) {
  const check = view.check;
  const today = todayInJerusalem();

  if (check.status === 'cleared') {
    return (
      <Disclosure summary={gemach.correct}>
        <p className="text-text-secondary">{gemach.correctNote}</p>
        <div className="mt-4">
          <ActionForm action={correctCheckAction} submitLabel={gemach.correct} tone="secondary">
            <>
              <HiddenValue name="checkId" value={check.id} />
              <TextField name="occurredOn" label="תאריך" type="date" defaultValue={today} />
              <TextField name="reason" label={gemach.reason} hint={gemach.reasonHint} />
            </>
          </ActionForm>
        </div>
      </Disclosure>
    );
  }

  if (check.status === 'cancelled' || check.status === 'replaced') {
    return check.status === 'cancelled' ? (
      <Disclosure summary={gemach.correct}>
        <ActionForm action={correctCheckAction} submitLabel={gemach.correct} tone="secondary">
          <>
            <HiddenValue name="checkId" value={check.id} />
            <TextField name="occurredOn" label="תאריך" type="date" defaultValue={today} />
            <TextField name="reason" label={gemach.reason} hint={gemach.reasonHint} />
          </>
        </ActionForm>
      </Disclosure>
    ) : null;
  }

  return (
    <div className="mt-3 flex flex-col gap-3">
      {check.status === 'prepared' ? (
        <ActionForm
          action={deliverChecksAction}
          submitLabel={gemach.markDelivered}
          tone="secondary"
        >
          <>
            <HiddenValue name="checkId" value={check.id} />
            <TextField
              name="deliveredOn"
              label={gemach.deliveredOn}
              type="date"
              defaultValue={today}
            />
          </>
        </ActionForm>
      ) : null}

      {check.status === 'delivered' || check.status === 'returned' ? (
        <ActionForm
          action={markCheckDepositedAction}
          submitLabel={gemach.markDeposited}
          tone="secondary"
        >
          <HiddenValue name="checkId" value={check.id} />
        </ActionForm>
      ) : null}

      {check.status === 'delivered' || check.status === 'deposited' ? (
        <Disclosure summary={gemach.markCleared}>
          <p className="text-text-secondary">{gemach.clearNote}</p>
          <div className="mt-4">
            <ActionForm action={clearCheckAction} submitLabel={gemach.markCleared}>
              <>
                <HiddenValue name="checkId" value={check.id} />
                <TextField
                  name="clearedOn"
                  label={gemach.clearedOn}
                  type="date"
                  defaultValue={today}
                />
              </>
            </ActionForm>
          </div>
        </Disclosure>
      ) : null}

      {check.status === 'delivered' || check.status === 'deposited' ? (
        <Disclosure summary={gemach.markReturned}>
          <ActionForm
            action={markCheckReturnedAction}
            submitLabel={gemach.markReturned}
            tone="secondary"
          >
            <>
              <HiddenValue name="checkId" value={check.id} />
              <TextField
                name="occurredOn"
                label={gemach.returnedOn}
                type="date"
                defaultValue={today}
              />
              <TextField name="reason" label={gemach.reason} hint={gemach.reasonHint} />
            </>
          </ActionForm>
        </Disclosure>
      ) : null}

      <Disclosure summary={gemach.markReplaced}>
        <p className="text-text-secondary">{gemach.replacementTitle}</p>
        <div className="mt-4">
          <ActionForm
            action={replaceCheckAction}
            submitLabel={gemach.markReplaced}
            tone="secondary"
          >
            <>
              <HiddenValue name="checkId" value={check.id} />
              <TextField name="reason" label={gemach.reason} hint={gemach.reasonHint} />
              <div className="grid gap-4 sm:grid-cols-2">
                <MoneyField
                  name="amountMinor"
                  label={gemach.amount}
                  defaultValue={toAmountInput(check.amountMinor)}
                />
                <TextField
                  name="dueDate"
                  label={gemach.dueDate}
                  type="date"
                  defaultValue={check.dueDate}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  name="checkNumber"
                  label={gemach.checkNumber}
                  required={false}
                  inputMode="numeric"
                />
                <TextField
                  name="deliveredOn"
                  label={gemach.deliveredOn}
                  type="date"
                  required={false}
                />
              </div>
            </>
          </ActionForm>
        </div>
      </Disclosure>

      <Disclosure summary={gemach.markCancelled}>
        <ActionForm
          action={cancelCheckAction}
          submitLabel={gemach.markCancelled}
          tone="secondary"
        >
          <>
            <HiddenValue name="checkId" value={check.id} />
            <TextField name="occurredOn" label="תאריך" type="date" defaultValue={today} />
            <TextField name="reason" label={gemach.reason} hint={gemach.reasonHint} />
          </>
        </ActionForm>
      </Disclosure>

      {check.status === 'delivered' ? (
        <Disclosure summary={gemach.correct}>
          <p className="text-text-secondary">{gemach.correctNote}</p>
          <div className="mt-4">
            <ActionForm
              action={correctCheckAction}
              submitLabel={gemach.correct}
              tone="secondary"
            >
              <>
                <HiddenValue name="checkId" value={check.id} />
                <TextField name="occurredOn" label="תאריך" type="date" defaultValue={today} />
                <TextField name="reason" label={gemach.reason} hint={gemach.reasonHint} />
              </>
            </ActionForm>
          </div>
        </Disclosure>
      ) : null}
    </div>
  );
}

export default async function GemachLoanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const view = await loadDashboardView();

  if (view.document === null || view.snapshot === null) {
    return <NoHousehold active="/more" title={gemach.title} reason={view.descriptor.reason} />;
  }

  const { document, snapshot } = view;
  const loan = gemachLoanById(document, snapshot, snapshot.today, id);
  if (loan === null) notFound();

  const currency = snapshot.currency;
  const accounts = document.accounts
    .filter((account) => account.closedAt === null && account.scope === 'household')
    .map((account) => ({ value: account.id, label: account.name }));

  const history = document.audit
    .filter(
      (entry) =>
        (entry.entityType === 'check' &&
          loan.checks.some((view) => view.check.id === entry.entityId)) ||
        (entry.entityType === 'repayment_plan' && entry.entityId === loan.plan?.id),
    )
    .slice(-40)
    .reverse();

  return (
    <AppShell active="/more" title={loan.creditorName} subtitle={gemach.subtitle}>
      {/*
        The exposure, first and largest. A family can read their bank balance
        anywhere; what they cannot see there is the paper somebody else is
        holding.
      */}
      <Card
        title={gemach.checksOutstanding}
        tone={
          loan.exposure.returnedCount > 0
            ? 'danger'
            : loan.exposure.overdueCount > 0
              ? 'attention'
              : 'neutral'
        }
      >
        {loan.exposure.atLargeCount > 0 ? (
          <>
            <p className="text-[24px] leading-tight font-semibold">
              {gemach.outstandingCount(
                loan.exposure.atLargeCount,
                money(loan.exposure.atLargeTotalMinor, currency),
              )}
            </p>
            <p className="mt-2 font-medium">{gemach.stillOut}</p>
          </>
        ) : (
          <p className="text-text-secondary">{gemach.deliveredNone}</p>
        )}

        {loan.exposure.nextCheck === null ? null : (
          <p className="mt-3 text-text-secondary">
            {gemach.nextCheckLine(
              formatBusinessDate(loan.exposure.nextCheck.dueDate),
              money(loan.exposure.nextCheck.amountMinor, currency),
            )}
          </p>
        )}

        <div className="mt-4">
          <StatRow
            label={gemach.checksDueSoon}
            value={<Money amountMinor={loan.exposure.dueSoonTotalMinor} currency={currency} />}
            hint={`${loan.exposure.dueSoonCount}`}
          />
          {loan.exposure.overdueCount === 0 ? null : (
            <StatRow
              label="עברו את התאריך ולא נפרעו"
              value={
                <Money amountMinor={loan.exposure.overdueTotalMinor} currency={currency} />
              }
              hint={`${loan.exposure.overdueCount}`}
            />
          )}
          {loan.exposure.returnedCount === 0 ? null : (
            <StatRow
              label={gemach.returned}
              value={
                <Money amountMinor={loan.exposure.returnedTotalMinor} currency={currency} />
              }
              hint={`${loan.exposure.returnedCount}`}
            />
          )}
        </div>
      </Card>

      <Card title={gemach.loanAmount}>
        <StatRow
          label={gemach.loanAmount}
          value={<Money amountMinor={loan.principalMinor} currency={currency} />}
        />
        <StatRow
          label={gemach.outstandingDebt}
          value={<Money amountMinor={loan.outstandingDebtMinor} currency={currency} />}
        />
        <StatRow
          label={gemach.cleared}
          value={<Money amountMinor={loan.exposure.clearedTotalMinor} currency={currency} />}
        />
        <StatRow
          label={gemach.startDate}
          value={<Figure>{formatBusinessDate(loan.openedOn)}</Figure>}
        />
        <StatRow label="ריבית" value={<span>0%</span>} hint={gemach.interestNote} />
        {loan.agreement === null ? null : (
          <p className="mt-3 text-text-secondary">{loan.agreement}</p>
        )}

        <div className="mt-4">
          <Notice
            tone={loan.coverage.fullyCovered ? 'success' : 'attention'}
            title={gemach.coverageTitle}
          >
            <p>
              {loan.coverage.fullyCovered
                ? loan.coverage.excessMinor > 0
                  ? gemach.coverageExcess(money(loan.coverage.excessMinor, currency))
                  : gemach.coverageFull
                : gemach.coverageShort(money(loan.coverage.shortfallMinor, currency))}
            </p>
          </Notice>
        </div>
      </Card>

      {/* Delivering everything at once: the common case, and the one that must
          visibly change no figure. */}
      {loan.deliverable.length === 0 ? null : (
        <Card title={gemach.checksDelivered} subtitle={gemach.deliverAllNote}>
          <ActionForm action={deliverChecksAction} submitLabel={gemach.markDeliveredAll}>
            <>
              {loan.deliverable.map((view) => (
                <HiddenValue key={view.check.id} name="checkId" value={view.check.id} />
              ))}
              <TextField
                name="deliveredOn"
                label={gemach.deliveredOn}
                type="date"
                defaultValue={todayInJerusalem()}
              />
            </>
          </ActionForm>
        </Card>
      )}

      <SectionTitle>{gemach.checksTitle}</SectionTitle>

      {loan.checks.length === 0 ? (
        <Card>
          <p className="text-text-secondary">{gemach.checksNone}</p>
        </Card>
      ) : (
        <Card>
          <DataTable
            caption={gemach.checksTitle}
            columns={['מס׳', gemach.dueDate, gemach.amount, 'מצב', gemach.fromAccount]}
            rows={loan.checks.map((view) => ({
              key: view.check.id,
              cells: [
                <span key="number">
                  {view.maskedNumber ?? '—'}
                  {view.check.installmentNumber === null ? null : (
                    <span className="text-small text-text-secondary">
                      {' '}
                      · {view.check.installmentNumber}
                    </span>
                  )}
                </span>,
                <Figure key="due">{formatBusinessDate(view.check.dueDate)}</Figure>,
                <Money key="amount" amountMinor={view.check.amountMinor} currency={currency} />,
                <Badge key="state" tone={toneFor(view.state)}>
                  {gemach.states[view.state] ?? view.state}
                </Badge>,
                <span key="account">{view.accountName}</span>,
              ],
            }))}
          />
        </Card>
      )}

      {loan.checks.map((view) => (
        <Card key={view.check.id} title={`${gemach.checkNumber} ${view.maskedNumber ?? '—'}`}>
          <StatRow
            label={gemach.dueDate}
            value={<Figure>{formatBusinessDate(view.check.dueDate)}</Figure>}
          />
          <StatRow
            label={gemach.amount}
            value={<Money amountMinor={view.check.amountMinor} currency={currency} />}
          />
          <StatRow
            label="מצב"
            value={
              <Badge tone={toneFor(view.state)}>
                {gemach.states[view.state] ?? view.state}
              </Badge>
            }
            hint={gemach.stateNotes[view.state]}
          />
          {view.check.deliveredOn === null ? null : (
            <StatRow
              label={gemach.deliveredOn}
              value={<Figure>{formatBusinessDate(view.check.deliveredOn)}</Figure>}
            />
          )}
          {view.check.clearedOn === null ? null : (
            <StatRow
              label={gemach.clearedOn}
              value={<Figure>{formatBusinessDate(view.check.clearedOn)}</Figure>}
            />
          )}
          {view.check.resolutionReason === null ? null : (
            <StatRow label={gemach.reason} value={<span>{view.check.resolutionReason}</span>} />
          )}
          {view.replacedByNumber === null ? null : (
            <StatRow label={gemach.replaced} value={<span>{view.replacedByNumber}</span>} />
          )}

          <CheckActions view={view} />
        </Card>
      ))}

      <SectionTitle>{gemach.planTitle}</SectionTitle>

      <Card title={gemach.planTitle} subtitle={gemach.planNote}>
        {loan.plan === null ? (
          <p className="text-text-secondary">{gemach.planNone}</p>
        ) : (
          <div className="mb-5">
            <StatRow
              label={gemach.installmentCount}
              value={<Figure>{loan.plan.installmentCount}</Figure>}
            />
            <StatRow
              label={gemach.installmentAmount}
              value={
                <Money amountMinor={loan.plan.installmentAmountMinor} currency={currency} />
              }
            />
            <StatRow
              label={gemach.planTotal}
              value={<Money amountMinor={loan.plannedTotalMinor ?? 0} currency={currency} />}
            />
          </div>
        )}

        <ActionForm action={setRepaymentPlanAction} submitLabel={gemach.savePlan}>
          <>
            <HiddenValue name="debtId" value={loan.debtId} />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                name="installmentCount"
                label={gemach.installmentCount}
                inputMode="numeric"
                defaultValue={String(loan.plan?.installmentCount ?? '')}
              />
              <MoneyField
                name="installmentAmountMinor"
                label={gemach.installmentAmount}
                defaultValue={toAmountInput(loan.plan?.installmentAmountMinor)}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <MoneyField
                name="finalInstallmentAmountMinor"
                label={gemach.finalInstallment}
                hint={gemach.finalInstallmentHint}
                required={false}
                defaultValue={toAmountInput(loan.plan?.finalInstallmentAmountMinor)}
              />
              <TextField
                name="firstDueDate"
                label={gemach.firstDueDate}
                type="date"
                defaultValue={loan.plan?.firstDueDate ?? todayInJerusalem()}
              />
            </div>
            <TextAreaField
              name="agreementSummary"
              label={gemach.agreement}
              hint={gemach.agreementHint}
              required={false}
              defaultValue={loan.plan?.agreementSummary ?? ''}
            />
          </>
        </ActionForm>
      </Card>

      <SectionTitle>{gemach.addSeries}</SectionTitle>

      <Card title={gemach.addSeries} subtitle={gemach.intendedTotalHint}>
        <ActionForm action={addCheckSeriesAction} submitLabel={gemach.addSeries}>
          <>
            <HiddenValue name="debtId" value={loan.debtId} />
            <HiddenValue name="payeeName" value={loan.creditorName} />
            <SelectField name="accountId" label={gemach.fromAccount} options={accounts} />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField name="count" label={gemach.howMany} inputMode="numeric" />
              <MoneyField name="amountPerCheckMinor" label={gemach.amountPerCheck} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <MoneyField
                name="finalCheckAmountMinor"
                label={gemach.finalCheckAmount}
                hint={gemach.finalInstallmentHint}
                required={false}
              />
              <TextField
                name="firstDueDate"
                label={gemach.firstDueDate}
                type="date"
                defaultValue={todayInJerusalem()}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                name="firstCheckNumber"
                label={gemach.firstCheckNumber}
                hint={gemach.checkNumberHint}
                required={false}
                inputMode="numeric"
              />
              <MoneyField
                name="intendedTotalMinor"
                label={gemach.intendedTotal}
                required={false}
              />
            </div>
            <TextField
              name="deliveredOn"
              label={gemach.deliveredOn}
              type="date"
              required={false}
              hint={gemach.deliveredAlready}
            />
          </>
        </ActionForm>
      </Card>

      <Card title={gemach.addOne}>
        <ActionForm action={addCheckAction} submitLabel={gemach.addOne} resetOnSuccess>
          <>
            <HiddenValue name="debtId" value={loan.debtId} />
            <HiddenValue name="payeeName" value={loan.creditorName} />
            <SelectField name="accountId" label={gemach.fromAccount} options={accounts} />
            <div className="grid gap-4 sm:grid-cols-2">
              <MoneyField name="amountMinor" label={gemach.amount} />
              <TextField
                name="dueDate"
                label={gemach.dueDate}
                type="date"
                defaultValue={todayInJerusalem()}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                name="checkNumber"
                label={gemach.checkNumber}
                hint={gemach.checkNumberHint}
                required={false}
                inputMode="numeric"
              />
              <TextField
                name="deliveredOn"
                label={gemach.deliveredOn}
                type="date"
                required={false}
              />
            </div>
          </>
        </ActionForm>
      </Card>

      <SectionTitle>{gemach.closeTitle}</SectionTitle>

      <Card title={gemach.closeTitle}>
        {loan.status === 'settled' ? (
          <p className="text-text-secondary">{gemach.closed}</p>
        ) : loan.canClose ? (
          <>
            <p className="text-text-secondary">{gemach.closeReady}</p>
            <div className="mt-4">
              <ActionForm action={closeLoanAction} submitLabel={gemach.close}>
                <HiddenValue name="debtId" value={loan.debtId} />
              </ActionForm>
            </div>
          </>
        ) : (
          <>
            <p className="text-text-secondary">{gemach.closeNotReady}</p>
            <ul className="mt-2 flex list-disc flex-col gap-2 pe-5 text-text-secondary">
              {loan.outstandingDebtMinor === 0 ? null : (
                <li>{gemach.closeBlockDebt(money(loan.outstandingDebtMinor, currency))}</li>
              )}
              {loan.exposure.outstandingCount === 0 ? null : (
                <li>{gemach.closeBlockChecks(loan.exposure.outstandingCount)}</li>
              )}
            </ul>
          </>
        )}
      </Card>

      <Card title={gemach.historyTitle}>
        {history.length === 0 ? (
          <p className="text-text-secondary">{gemach.historyEmpty}</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {history.map((entry) => (
              <li key={entry.id} className="border-b border-border pb-3 last:border-b-0">
                <p className="font-medium">
                  {gemach.historyActions[entry.action] ?? entry.action}
                </p>
                <p className="mt-1 text-small text-text-secondary">
                  <Figure>{formatDateTime(entry.occurredAt)}</Figure>
                </p>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <p className="px-1 text-small text-text-secondary">{screens.common.back}</p>
    </AppShell>
  );
}
