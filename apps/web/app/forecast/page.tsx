import { AppShell } from '../../components/app-shell';
import {
  Badge,
  Card,
  Disclosure,
  EmptyState,
  Figure,
  Money,
  SourceBanner,
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

export default async function ForecastPage() {
  const { descriptor, snapshot, input } = await loadDashboardView();

  if (snapshot === null || input === null) {
    return (
      <AppShell active="/more" title={copy.forecast.title}>
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
    <AppShell active="/more" title={copy.forecast.title}>
      {!descriptor.isRealData ? <SourceBanner /> : null}

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
          {copy.home.tightestDayValue(conservative.lowPointDate, conservative.lowPointMinor)}
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
          <div className="overflow-x-auto">
            <table className="w-full min-w-[30rem] border-collapse">
              <thead>
                <tr className="border-b border-border text-small text-text-secondary">
                  <th scope="col" className="py-2 text-start font-medium">
                    {copy.forecast.dayColumn}
                  </th>
                  <th scope="col" className="py-2 text-start font-medium">
                    {copy.forecast.inColumn}
                  </th>
                  <th scope="col" className="py-2 text-start font-medium">
                    {copy.forecast.outColumn}
                  </th>
                  <th scope="col" className="py-2 text-start font-medium">
                    {copy.forecast.balanceColumn}
                  </th>
                </tr>
              </thead>
              <tbody>
                {movingDays.map((day) => (
                  <tr key={day.date} className="border-b border-border last:border-b-0">
                    <th scope="row" className="py-2.5 text-start font-normal">
                      <Figure>{formatBusinessDate(day.date)}</Figure>
                    </th>
                    <td className="py-2.5">
                      {day.inflowMinor > 0 ? (
                        <Money amountMinor={day.inflowMinor} currency={snapshot.currency} />
                      ) : (
                        <span className="text-text-secondary">—</span>
                      )}
                    </td>
                    <td className="py-2.5">
                      {day.outflowMinor > 0 ? (
                        <Money amountMinor={day.outflowMinor} currency={snapshot.currency} />
                      ) : (
                        <span className="text-text-secondary">—</span>
                      )}
                    </td>
                    <td
                      className={`py-2.5 font-medium ${day.closingMinor < 0 ? 'text-danger' : ''}`}
                    >
                      <Money
                        amountMinor={day.closingMinor}
                        currency={snapshot.currency}
                        signed
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
