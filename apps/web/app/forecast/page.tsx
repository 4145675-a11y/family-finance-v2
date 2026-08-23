import { AppShell } from '../../components/app-shell';
import {
  Badge,
  Breakdown,
  Card,
  EmptyState,
  Figure,
  Money,
  SourceBanner,
  StatRow,
} from '../../components/ui';
import { formatBusinessDate } from '../../lib/format';
import { loadDashboardView } from '../../lib/dashboard/load';

/**
 * The daily forecast, and the stress tests that qualify it.
 *
 * 02-FINANCIAL-RULES.md closes its stress-test section with "תחזית אינה הבטחה",
 * which is why the conservative scenario leads and the expected one is shown
 * beside it rather than instead of it.
 */

export default async function ForecastPage() {
  const { descriptor, snapshot } = await loadDashboardView();

  if (snapshot === null) {
    return (
      <AppShell active="/forecast" title="תחזית">
        <EmptyState reason={descriptor.reason} />
      </AppShell>
    );
  }

  const conservative = snapshot.forecastConservative;
  const expected = snapshot.forecastExpected;
  const movingDays = conservative.days.filter(
    (day) => day.inflowMinor > 0 || day.outflowMinor > 0,
  );

  return (
    <AppShell active="/forecast" title="תחזית">
      {!descriptor.isRealData ? (
        <SourceBanner label={descriptor.label} reason={descriptor.reason} />
      ) : null}

      <Card
        title="תרחיש שמרן"
        subtitle="נספרת רק הכנסה ודאית. הוצאות נספרות במלואן, בלי קשר לרמת הוודאות."
        tone={conservative.firstFailureDate === null ? 'neutral' : 'danger'}
      >
        <StatRow
          label="יתרת פתיחה היום"
          value={<Money amountMinor={conservative.openingMinor} currency={snapshot.currency} />}
        />
        <StatRow
          label="יתרה בסוף התקופה"
          value={
            <Money amountMinor={conservative.endOfPeriodMinor} currency={snapshot.currency} />
          }
        />
        <StatRow
          label="נקודת שפל"
          value={
            <Money amountMinor={conservative.lowPointMinor} currency={snapshot.currency} />
          }
          hint={`ב־${formatBusinessDate(conservative.lowPointDate)}`}
        />
        <StatRow
          label="יום כשל ראשון"
          value={
            conservative.firstFailureDate === null ? (
              'אין'
            ) : (
              <Figure>{formatBusinessDate(conservative.firstFailureDate)}</Figure>
            )
          }
        />
      </Card>

      <Card title="תרחיש צפוי" subtitle="מוסיף הכנסה סבירה. מוצג לצד השמרן, לא במקומו.">
        <StatRow
          label="יתרה בסוף התקופה"
          value={<Money amountMinor={expected.endOfPeriodMinor} currency={snapshot.currency} />}
        />
        <StatRow
          label="נקודת שפל"
          value={<Money amountMinor={expected.lowPointMinor} currency={snapshot.currency} />}
          hint={`ב־${formatBusinessDate(expected.lowPointDate)}`}
        />
      </Card>

      <Card title="ימים שבהם זזה יתרה" subtitle="לפי התרחיש השמרן.">
        {movingDays.length === 0 ? (
          <p className="text-text-secondary">אין תנועות צפויות עד סוף התקופה.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] border-collapse text-start">
              <thead>
                <tr className="border-b border-border text-small text-text-secondary">
                  <th scope="col" className="py-2 text-start font-medium">
                    תאריך
                  </th>
                  <th scope="col" className="py-2 text-start font-medium">
                    נכנס
                  </th>
                  <th scope="col" className="py-2 text-start font-medium">
                    יוצא
                  </th>
                  <th scope="col" className="py-2 text-start font-medium">
                    יתרה בסוף היום
                  </th>
                </tr>
              </thead>
              <tbody>
                {movingDays.map((day) => (
                  <tr key={day.date} className="border-b border-border last:border-b-0">
                    <th scope="row" className="py-2 text-start font-normal">
                      <Figure>{formatBusinessDate(day.date)}</Figure>
                    </th>
                    <td className="py-2">
                      <Money amountMinor={day.inflowMinor} currency={snapshot.currency} />
                    </td>
                    <td className="py-2">
                      <Money amountMinor={day.outflowMinor} currency={snapshot.currency} />
                    </td>
                    <td className={`py-2 ${day.closingMinor < 0 ? 'text-danger' : ''}`}>
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

      <Card title="תרחישי לחץ" subtitle="שישה תרחישים סבירים. תחזית אינה הבטחה.">
        <div className="flex flex-col gap-2">
          {snapshot.stressTests.map((result) => (
            <div key={result.key} className="border-b border-border pb-2 last:border-b-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span>{result.label}</span>
                <Badge tone={result.passed ? 'success' : 'danger'}>
                  {result.passed ? 'עומד' : 'נשבר'}
                </Badge>
              </div>
              <p className="mt-1 text-small text-text-secondary">
                שפל{' '}
                <Money amountMinor={result.lowPointMinor} currency={snapshot.currency} signed />
                {result.firstFailureDate !== null ? (
                  <>
                    {' '}
                    · יום כשל <Figure>{formatBusinessDate(result.firstFailureDate)}</Figure>
                  </>
                ) : null}
              </p>
              {result.atRiskObligations.length > 0 ? (
                <Breakdown summary="מחויבויות בסיכון בתרחיש הזה">
                  <ul className="list-inside list-disc">
                    {[...new Set(result.atRiskObligations)].map((obligation) => (
                      <li key={obligation}>{obligation}</li>
                    ))}
                  </ul>
                </Breakdown>
              ) : null}
            </div>
          ))}
        </div>
      </Card>
    </AppShell>
  );
}
