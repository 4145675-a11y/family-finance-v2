import { AppShell } from '../../components/app-shell';
import {
  BreakdownList,
  Card,
  Disclosure,
  EmptyState,
  Hero,
  Money,
  SourceBanner,
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

export default async function BusinessPage() {
  const { descriptor, snapshot } = await loadDashboardView();

  if (snapshot === null) {
    return (
      <AppShell active="/more" title={copy.business.title}>
        <EmptyState reason={descriptor.reason} />
      </AppShell>
    );
  }

  const profit = snapshot.businessProfit;
  const transfer = snapshot.safeTransfer;

  if (profit === null) {
    return (
      <AppShell active="/more" title={copy.business.title}>
        {!descriptor.isRealData ? <SourceBanner /> : null}
        <Card title={copy.business.title}>
          <p className="text-text-secondary">{copy.business.none}</p>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell active="/more" title={copy.business.title}>
      {!descriptor.isRealData ? <SourceBanner /> : null}

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
    </AppShell>
  );
}
