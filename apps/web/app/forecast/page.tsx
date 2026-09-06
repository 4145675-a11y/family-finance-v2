import { AppShell } from '../../components/app-shell';
import {
  Badge,
  Card,
  DataTable,
  Disclosure,
  EmptyState,
  Figure,
  Money,
  StatRow,
} from '../../components/ui';
import { copy } from '../../lib/copy/copy';
import { scenarioLabel } from '../../lib/copy/notices';
import { loadDashboardView } from '../../lib/dashboard/load';
import { formatBusinessDate } from '../../lib/format';

/**
 * What is expected for the rest of the month.
 *
 * The screen is organised around the questions a family actually asks, in their
 * words. The four kinds of money are kept visibly apart because only the first
 * two may support a decision — 02-FINANCIAL-RULES.md § נזילות מול ודאות — and a
 * screen that blurs them is how a family spends money that has not arrived.
 */

/*
 * Rendered per request. The figures come from the household's own store, and a
 * prerendered copy would show what the build saw rather than what is true now.
 */
export const dynamic = 'force-dynamic';

export default async function ForecastPage() {
  const { descriptor, snapshot, input } = await loadDashboardView();

  if (snapshot === null || input === null) {
    return (
      <AppShell source={descriptor} active="/more" title={copy.forecast.title}>
        <EmptyState reason={descriptor.reason} />
      </AppShell>
    );
  }

  const conservative = snapshot.forecastConservative;
  const expected = snapshot.forecastExpected;
  const movingDays = conservative.days.filter(
    (day) => day.inflowMinor > 0 || day.outflowMinor > 0,
  );

  const incomeBy = (certainty: 'certain' | 'probable' | 'possible') =>
    input.plannedItems
      .filter(
        (item) =>
          item.scope === 'household' &&
          item.direction === 'inflow' &&
          item.certainty === certainty,
      )
      .reduce((total, item) => total + item.amountMinor, 0);

  return (
    <AppShell source={descriptor} active="/more" title={copy.forecast.title}>
      <Card title={copy.forecast.endQuestion}>
        <p className="text-display font-bold text-primary">
          <Money amountMinor={conservative.endOfPeriodMinor} currency={snapshot.currency} />
        </p>
        <p className="mt-2 text-text-secondary">{copy.forecast.onlyFirstTwoCount}</p>
      </Card>

      <Card
        title={copy.forecast.tightQuestion}
        tone={conservative.firstFailureDate === null ? 'neutral' : 'attention'}
      >
        <p className="text-[24px] leading-tight font-semibold">
          <Money amountMinor={conservative.lowPointMinor} currency={snapshot.currency} signed />
        </p>
        <p className="mt-1.5 text-text-secondary">
          {copy.home.tightestDayOn(conservative.lowPointDate)}
        </p>
        {conservative.firstFailureDate !== null ? (
          <p className="mt-2 text-attention">
            הכסף עלול להיגמר ב־
            <Figure>{formatBusinessDate(conservative.firstFailureDate)}</Figure>.
          </p>
        ) : (
          <p className="mt-2 text-text-secondary">{copy.home.noTightDay}</p>
        )}
      </Card>

      {/* The four kinds of money, in order of how much you can rely on them. */}
      <Card title={copy.forecast.certainQuestion}>
        <StatRow
          label={copy.forecast.alreadyHave}
          value={<Money amountMinor={conservative.openingMinor} currency={snapshot.currency} />}
        />
        <StatRow
          label={copy.forecast.willCertainlyEnter}
          value={<Money amountMinor={incomeBy('certain')} currency={snapshot.currency} />}
        />
        <p className="mt-3 text-small text-text-secondary">{copy.forecast.onlyFirstTwoCount}</p>
      </Card>

      <Card title={copy.forecast.maybeQuestion}>
        <StatRow
          label={copy.forecast.probablyEnter}
          value={<Money amountMinor={incomeBy('probable')} currency={snapshot.currency} />}
        />
        <StatRow
          label={copy.forecast.maybeEnter}
          value={<Money amountMinor={incomeBy('possible')} currency={snapshot.currency} />}
        />
        <StatRow
          label="אם גם זה ייכנס, בסוף החודש יישארו"
          value={<Money amountMinor={expected.endOfPeriodMinor} currency={snapshot.currency} />}
        />
      </Card>

      <Card title={copy.forecast.dayTable}>
        {movingDays.length === 0 ? (
          <p className="text-text-secondary">אין תנועות צפויות עד סוף החודש.</p>
        ) : (
          <DataTable
            caption={copy.forecast.dayTable}
            columns={[
              copy.forecast.dayColumn,
              copy.forecast.inColumn,
              copy.forecast.outColumn,
              copy.forecast.balanceColumn,
            ]}
            rows={movingDays.map((day) => ({
              key: day.date,
              cells: [
                <Figure key="date">{formatBusinessDate(day.date)}</Figure>,
                day.inflowMinor > 0 ? (
                  <Money key="in" amountMinor={day.inflowMinor} currency={snapshot.currency} />
                ) : (
                  <span key="in" className="text-text-secondary">
                    {'—'}
                  </span>
                ),
                day.outflowMinor > 0 ? (
                  <Money
                    key="out"
                    amountMinor={day.outflowMinor}
                    currency={snapshot.currency}
                  />
                ) : (
                  <span key="out" className="text-text-secondary">
                    {'—'}
                  </span>
                ),
                <span
                  key="closing"
                  className={`font-medium ${day.closingMinor < 0 ? 'text-danger' : ''}`}
                >
                  <Money amountMinor={day.closingMinor} currency={snapshot.currency} signed />
                </span>,
              ],
            }))}
          />
        )}
      </Card>

      <Card title={copy.forecast.whatIfTitle} subtitle={copy.forecast.whatIfNote}>
        <div className="flex flex-col gap-3">
          {snapshot.stressTests.map((result) => (
            <div key={result.key} className="border-b border-border pb-3 last:border-b-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span>{scenarioLabel(result.key)}</span>
                <Badge tone={result.passed ? 'success' : 'attention'}>
                  {result.passed ? copy.forecast.holds : copy.forecast.breaks}
                </Badge>
              </div>
              {!result.passed && result.firstFailureDate !== null ? (
                <p className="mt-1.5 text-small text-text-secondary">
                  הכסף עלול להיגמר ב־
                  <Figure>{formatBusinessDate(result.firstFailureDate)}</Figure>, בפער של{' '}
                  <Money amountMinor={result.fundingGapMinor} currency={snapshot.currency} />.
                </p>
              ) : null}
              {result.atRiskObligations.length > 0 ? (
                <Disclosure summary="מה עלול להיתקע">
                  <ul className="list-inside list-disc">
                    {[...new Set(result.atRiskObligations)].map((obligation) => (
                      <li key={obligation}>{obligation}</li>
                    ))}
                  </ul>
                </Disclosure>
              ) : null}
            </div>
          ))}
        </div>
      </Card>
    </AppShell>
  );
}
