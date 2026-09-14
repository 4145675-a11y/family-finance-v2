import { AppShell } from '../../components/app-shell';
import { ActionForm, MoneyField, TextAreaField, TextField } from '../../components/form';
import { NoHousehold } from '../../components/screen';
import {
  Badge,
  Card,
  EmptyPrompt,
  LinkButton,
  Money,
  Notice,
  SectionTitle,
  StatRow,
} from '../../components/ui';
import { addGemachLoanAction } from '../../lib/actions/checks';
import { gemach } from '../../lib/copy/gemach';
import { loadDashboardView } from '../../lib/dashboard/load';
import { formatBusinessDate, money } from '../../lib/format';
import { gemachLoans } from '../../lib/gemach';
import { todayInJerusalem } from '../../lib/forms';

/**
 * The gemach loans, and how much paper is still out there.
 *
 * The list leads with the number that is easy to forget: how many checks the
 * family has handed over that have not yet been honoured. A borrower knows what
 * they owe; what catches them out is that four of next month's payments are
 * already written and sitting in somebody else's drawer.
 */

export const dynamic = 'force-dynamic';

export default async function GemachPage() {
  const view = await loadDashboardView();

  if (view.document === null || view.snapshot === null) {
    return <NoHousehold active="/more" title={gemach.title} reason={view.descriptor.reason} />;
  }

  const { document, snapshot } = view;
  const loans = gemachLoans(document, snapshot, snapshot.today);
  const currency = snapshot.currency;

  return (
    <AppShell active="/more" title={gemach.title} subtitle={gemach.subtitle}>
      {loans.length === 0 ? (
        <EmptyPrompt title={gemach.emptyTitle} body={gemach.emptyBody} />
      ) : (
        loans.map((loan) => (
          <Card
            key={loan.debtId}
            title={loan.creditorName}
            tone={
              loan.exposure.returnedCount > 0
                ? 'danger'
                : loan.exposure.overdueCount > 0
                  ? 'attention'
                  : 'neutral'
            }
          >
            {loan.status === 'settled' ? (
              <p className="mb-3">
                <Badge tone="success">{gemach.closed}</Badge>
              </p>
            ) : null}

            {/* The sentence that matters most, before any table. */}
            {loan.exposure.atLargeCount > 0 ? (
              <p className="text-[18px] leading-snug font-medium">
                {gemach.outstandingCount(
                  loan.exposure.atLargeCount,
                  money(loan.exposure.atLargeTotalMinor, currency),
                )}
              </p>
            ) : (
              <p className="text-text-secondary">{gemach.deliveredNone}</p>
            )}

            {loan.exposure.nextCheck === null ? null : (
              <p className="mt-2 text-text-secondary">
                {gemach.nextCheckLine(
                  formatBusinessDate(loan.exposure.nextCheck.dueDate),
                  money(loan.exposure.nextCheck.amountMinor, currency),
                )}
              </p>
            )}

            <div className="mt-4">
              <StatRow
                label={gemach.loanAmount}
                value={<Money amountMinor={loan.principalMinor} currency={currency} />}
              />
              <StatRow
                label={gemach.outstandingDebt}
                value={<Money amountMinor={loan.outstandingDebtMinor} currency={currency} />}
              />
              <StatRow
                label={gemach.checksOutstanding}
                value={
                  <Money
                    amountMinor={loan.exposure.outstandingTotalMinor}
                    currency={currency}
                  />
                }
                hint={`${loan.exposure.outstandingCount}`}
              />
              <StatRow
                label={gemach.cleared}
                value={
                  <Money amountMinor={loan.exposure.clearedTotalMinor} currency={currency} />
                }
              />
            </div>

            {loan.exposure.returnedCount > 0 ? (
              <div className="mt-4">
                <Notice tone="danger">
                  {gemach.returnedLine(loan.exposure.returnedCount)}
                </Notice>
              </div>
            ) : null}

            {loan.exposure.overdueCount > 0 ? (
              <div className="mt-4">
                <Notice tone="attention">
                  {gemach.overdueLine(
                    loan.exposure.overdueCount,
                    money(loan.exposure.overdueTotalMinor, currency),
                  )}
                </Notice>
              </div>
            ) : null}

            <div className="mt-5">
              <LinkButton href={`/gemach/${loan.debtId}`}>{gemach.details}</LinkButton>
            </div>
          </Card>
        ))
      )}

      <SectionTitle>{gemach.newLoanTitle}</SectionTitle>

      <Card title={gemach.newLoanTitle} subtitle={gemach.interestNote}>
        <ActionForm action={addGemachLoanAction} submitLabel={gemach.addLoan} resetOnSuccess>
          <>
            <TextField name="creditorName" label={gemach.lenderName} maxLength={160} />
            <div className="grid gap-4 sm:grid-cols-2">
              <MoneyField name="openingBalanceMinor" label={gemach.principal} />
              <TextField
                name="openedOn"
                label={gemach.startDate}
                type="date"
                defaultValue={todayInJerusalem()}
              />
            </div>
            <TextAreaField
              name="agreement"
              label={gemach.agreement}
              hint={gemach.agreementHint}
              required={false}
            />
          </>
        </ActionForm>
      </Card>
    </AppShell>
  );
}
