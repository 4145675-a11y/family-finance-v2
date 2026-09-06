import { transferToHouseholdAction } from '../../lib/actions/entries';
import { AppShell } from '../../components/app-shell';
import { ActionForm, MoneyField, SelectField, TextField } from '../../components/form';
import { screens } from '../../lib/copy/screens';
import { todayInJerusalem } from '../../lib/forms';
import { toAmountInput } from '../../lib/format';
import {
  BreakdownList,
  Card,
  Disclosure,
  EmptyState,
  Hero,
  Money,
  StatRow,
} from '../../components/ui';
import { copy } from '../../lib/copy/copy';
import { breakdownLabel, sayNotice } from '../../lib/copy/notices';
import { loadDashboardView } from '../../lib/dashboard/load';

/**
 * The business.
 *
 * Two profit figures, on purpose, and in ordinary words. "רווח על הנייר" is what
 * the business earned; "רווח שכבר בידיים" is what is actually ours after tax and
 * what we already owe. Only the second may fund a transfer home — PROD-KPI-004 —
 * and the whole breakdown is shown before the transfer figure, never after it.
 */

/*
 * Rendered per request. The figures come from the household's own store, and a
 * prerendered copy would show what the build saw rather than what is true now.
 */
export const dynamic = 'force-dynamic';

export default async function BusinessPage() {
  const { descriptor, snapshot, document } = await loadDashboardView();

  // The two sides of a transfer. Both lists come from the household's own
  // accounts; a transfer with nowhere to land is simply not offered.
  const openAccounts = (document?.accounts ?? []).filter(
    (account) => account.closedAt === null,
  );
  const businessAccounts = openAccounts
    .filter((account) => account.scope === 'business')
    .map((account) => ({ value: account.id, label: account.name }));
  const householdAccounts = openAccounts
    .filter((account) => account.scope === 'household')
    .map((account) => ({ value: account.id, label: account.name }));

  if (snapshot === null) {
    return (
      <AppShell source={descriptor} active="/more" title={copy.business.title}>
        <EmptyState reason={descriptor.reason} />
      </AppShell>
    );
  }

  const profit = snapshot.businessProfit;
  const transfer = snapshot.safeTransfer;

  if (profit === null) {
    return (
      <AppShell source={descriptor} active="/more" title={copy.business.title}>
        <Card title={copy.business.title}>
          <p className="text-text-secondary">{copy.business.none}</p>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell source={descriptor} active="/more" title={copy.business.title}>
      {/* The breakdown comes first. The transfer figure is the conclusion, not the headline. */}
      <Card title={copy.business.reallyLeft}>
        <StatRow
          label={copy.business.accountingProfit}
          value={
            <Money
              amountMinor={profit.operatingProfitMinor}
              currency={snapshot.currency}
              signed
            />
          }
          hint={copy.business.accountingProfitNote}
        />
        <StatRow
          label={copy.business.cashProfit}
          value={
            <Money
              amountMinor={profit.realizedCashProfitMinor}
              currency={snapshot.currency}
              signed
            />
          }
          hint={copy.business.cashProfitNote}
        />
        <StatRow
          label="כמה יש עכשיו בחשבון העסק"
          value={
            <Money amountMinor={snapshot.businessLiquidMinor} currency={snapshot.currency} />
          }
        />

        <Disclosure summary={copy.sections.calculation}>
          <BreakdownList
            lines={profit.breakdown}
            currency={snapshot.currency}
            labelFor={breakdownLabel}
          />
        </Disclosure>
      </Card>

      <Hero
        label={copy.business.safeToMove}
        amountMinor={transfer.resultMinor}
        currency={snapshot.currency}
        caption={`${copy.business.limitedBy}: ${copy.business.limits[transfer.bindingConstraint] ?? transfer.bindingConstraint}`}
        note={copy.business.proposalNote}
        tone={transfer.resultMinor > 0 ? 'primary' : 'attention'}
      />

      <Card title={copy.business.limitedBy}>
        <BreakdownList
          lines={transfer.breakdown}
          currency={snapshot.currency}
          labelFor={breakdownLabel}
        />
        <StatRow
          label={copy.business.limits.household_need ?? ''}
          value={
            <Money amountMinor={transfer.householdNeedMinor} currency={snapshot.currency} />
          }
        />

        {transfer.warnings.length > 0 ? (
          <ul className="mt-4 flex list-inside list-disc flex-col gap-1.5 text-attention">
            {transfer.warnings.map((warning) => (
              <li key={warning.code}>{sayNotice(warning)}</li>
            ))}
          </ul>
        ) : null}
      </Card>

      {/*
        Recording the transfer. The application does not move money — it records
        that the family did, as one transaction with two sides so the consolidated
        view nets to zero (02-FINANCIAL-RULES.md § Scopes ותנועות).
      */}
      {businessAccounts.length === 0 || householdAccounts.length === 0 ? null : (
        <Card title={copy.business.safeToMove} subtitle={copy.business.proposalNote}>
          <ActionForm action={transferToHouseholdAction} submitLabel={copy.business.safeToMove}>
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField
                  name="businessAccountId"
                  label={copy.business.title}
                  options={businessAccounts}
                />
                <SelectField
                  name="householdAccountId"
                  label={copy.app.household}
                  options={householdAccounts}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <MoneyField
                  name="amountMinor"
                  label={screens.entry.amount}
                  defaultValue={
                    transfer.resultMinor > 0 ? toAmountInput(transfer.resultMinor) : ''
                  }
                />
                <TextField
                  name="transactionDate"
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
