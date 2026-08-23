import { AppShell } from '../../components/app-shell';
import {
  Badge,
  Card,
  EmptyState,
  Figure,
  Money,
  SourceBanner,
  StatRow,
} from '../../components/ui';
import { formatBasisPoints, formatBusinessDate } from '../../lib/format';
import { loadDashboardView } from '../../lib/dashboard/load';

/**
 * The debt map.
 *
 * The card at the top is the one 03-UX-SPEC.md § מסכים names explicitly —
 * "מה קרה באמת לחוב". Success is celebrated only for a net fall, never for a
 * creditor being replaced, which is why the rollover line sits directly under the
 * repayment line rather than in a footnote.
 */

const URGENCY_LABEL: Readonly<Record<string, string>> = {
  none: 'רגיל',
  watch: 'למעקב',
  demanded: 'נדרש תשלום',
  legal: 'סיכון משפטי',
};

export const metadata = { title: 'חובות' };

export default async function DebtsPage() {
  const { descriptor, snapshot, input } = await loadDashboardView();

  if (snapshot === null || input === null) {
    return (
      <AppShell active="/debts" title="חובות">
        <EmptyState reason={descriptor.reason} />
      </AppShell>
    );
  }

  const balanceOf = (debtId: string) =>
    snapshot.debtBalances.find((entry) => entry.debtId === debtId)?.balanceMinor ?? 0;

  const { debtMetrics: metrics, debtTrend: trend, callRisk: risk } = snapshot;
  const activeDebts = input.debts.filter((debt) => debt.status === 'active');

  return (
    <AppShell active="/debts" title="חובות">
      {!descriptor.isRealData ? (
        <SourceBanner label={descriptor.label} reason={descriptor.reason} />
      ) : null}

      <Card
        title="מה קרה באמת לחוב"
        subtitle="בתחילת התקופה, עכשיו, ומה בדיוק השתנה ביניהן."
        tone={trend?.consumerDirection === 'down' ? 'success' : 'neutral'}
      >
        <StatRow
          label="חוב צרכני בתחילת התקופה"
          value={
            <Money
              amountMinor={trend?.baselineConsumerMinor ?? 0}
              currency={snapshot.currency}
            />
          }
        />
        <StatRow
          label="חוב צרכני עכשיו"
          value={
            <Money
              amountMinor={snapshot.debtTotals.consumerDebtMinor}
              currency={snapshot.currency}
            />
          }
        />
        <StatRow
          label="שינוי נטו"
          value={
            <Money
              amountMinor={trend?.netConsumerChangeMinor ?? 0}
              currency={snapshot.currency}
              signed
            />
          }
          hint={
            trend?.consumerDirection === 'down'
              ? 'החוב ירד נטו — זו התקדמות אמיתית.'
              : trend?.consumerDirection === 'flat'
                ? 'החוב לא ירד, גם אם נושה אחד נפרע והוחלף באחר.'
                : 'החוב גדל בתקופה הזו.'
          }
        />
        <StatRow
          label="פירעון קרן ברוטו"
          value={
            <Money
              amountMinor={metrics.grossPrincipalRepaidMinor}
              currency={snapshot.currency}
            />
          }
        />
        <StatRow
          label="חוב חדש שנוצר"
          value={
            <Money amountMinor={metrics.newDebtOriginatedMinor} currency={snapshot.currency} />
          }
        />
        <StatRow
          label="מתוכו מומן בגלגול"
          value={
            <Money
              amountMinor={metrics.rolloverFundedRepaymentMinor}
              currency={snapshot.currency}
            />
          }
          hint={`שיעור הגלגול: ${formatBasisPoints(metrics.rolloverRatioBp)}`}
        />
        <StatRow
          label="ירידת קרן שמומנה מהכנסה"
          value={
            <Money
              amountMinor={metrics.incomeFundedPrincipalReductionMinor}
              currency={snapshot.currency}
            />
          }
          hint="רק החלק הזה הוא התקדמות."
        />
        <StatRow
          label="ריבית ועמלות ששולמו"
          value={
            <Money
              amountMinor={metrics.interestAndFeesPaidMinor}
              currency={snapshot.currency}
            />
          }
          hint="אינו מקטין קרן."
        />
        <StatRow
          label="תיקוני יתרה"
          value={
            <Money
              amountMinor={metrics.balanceCorrectionMinor}
              currency={snapshot.currency}
              signed
            />
          }
          hint="מוצג בנפרד: תיקון אינו הישג ואינו הידרדרות."
        />
        <StatRow
          label="החלפות נושים בתקופה"
          value={<Figure>{metrics.creditorChurn}</Figure>}
          hint={`גלגולים שאושרו: ${metrics.rolloverCount}`}
        />
      </Card>

      <Card title="ציר הזמן של הגלגולים" subtitle="פירעון וחוב חדש נשמרים כשתי עובדות מקושרות.">
        {input.rollovers.length === 0 ? (
          <p className="text-text-secondary">לא נרשם גלגול בתקופה הזו.</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {input.rollovers.map((link) => {
              const from = input.debts.find((debt) => debt.id === link.fromDebtId);
              const to = input.debts.find((debt) => debt.id === link.toDebtId);
              return (
                <li key={link.id} className="border-b border-border pb-3 last:border-b-0">
                  <p>
                    {from?.creditorName ?? link.fromDebtId} נפרע · נוצר חוב ל־
                    {to?.creditorName ?? link.toDebtId}
                  </p>
                  <p className="mt-1 text-small text-text-secondary">
                    <Money amountMinor={link.amountMinor} currency={snapshot.currency} /> ·{' '}
                    <Figure>{formatBusinessDate(link.occurredOn)}</Figure> ·{' '}
                    {link.status === 'confirmed' ? 'אושר' : 'הצעה שממתינה לאישור'}
                  </p>
                </li>
              );
            })}
          </ol>
        )}
      </Card>

      <Card title="סיכון דרישה פתאומית" subtitle="חוב פרטי בלבד. הלוואה אפשרית אינה מקור כסף.">
        <StatRow
          label="עלול להידרש תוך 7 ימים"
          value={<Money amountMinor={risk.within7DaysMinor} currency={snapshot.currency} />}
        />
        <StatRow
          label="תוך 30 יום"
          value={<Money amountMinor={risk.within30DaysMinor} currency={snapshot.currency} />}
        />
        <StatRow
          label="תוך 90 יום"
          value={<Money amountMinor={risk.within90DaysMinor} currency={snapshot.currency} />}
        />
        <StatRow
          label="כבר נדרש"
          value={<Money amountMinor={risk.demandedNowMinor} currency={snapshot.currency} />}
        />
        <StatRow
          label="ריכוז אצל המלווה הגדול"
          value={<Figure>{formatBasisPoints(risk.largestLenderShareBp)}</Figure>}
          hint={
            risk.averageNoticeDays === null
              ? 'אין מועדים ידועים'
              : `זמן התראה ממוצע: ${risk.averageNoticeDays} ימים`
          }
        />
      </Card>

      <Card title="כל החובות" subtitle="ריבית לא ידועה מוצגת ככזו, לעולם לא כאפס.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] border-collapse">
            <thead>
              <tr className="border-b border-border text-small text-text-secondary">
                <th scope="col" className="py-2 text-start font-medium">
                  נושה
                </th>
                <th scope="col" className="py-2 text-start font-medium">
                  יתרה
                </th>
                <th scope="col" className="py-2 text-start font-medium">
                  מינימום
                </th>
                <th scope="col" className="py-2 text-start font-medium">
                  עלות שנתית
                </th>
                <th scope="col" className="py-2 text-start font-medium">
                  מצב
                </th>
              </tr>
            </thead>
            <tbody>
              {activeDebts.map((debt) => (
                <tr key={debt.id} className="border-b border-border last:border-b-0">
                  <th scope="row" className="py-2 text-start font-normal">
                    {debt.creditorName}
                    {debt.kind === 'mortgage' ? (
                      <span className="text-small text-text-secondary"> · משכנתה</span>
                    ) : null}
                  </th>
                  <td className="py-2">
                    <Money amountMinor={balanceOf(debt.id)} currency={snapshot.currency} />
                  </td>
                  <td className="py-2">
                    {debt.minimumPaymentMinor === null ? (
                      <span className="text-text-secondary">אין</span>
                    ) : (
                      <Money
                        amountMinor={debt.minimumPaymentMinor}
                        currency={snapshot.currency}
                      />
                    )}
                  </td>
                  <td className="py-2">
                    {debt.effectiveAnnualRateBp === null ? (
                      <span className="text-attention">לא ידוע</span>
                    ) : (
                      <Figure>{formatBasisPoints(debt.effectiveAnnualRateBp)}</Figure>
                    )}
                  </td>
                  <td className="py-2">
                    <Badge
                      tone={
                        debt.urgency === 'legal'
                          ? 'danger'
                          : debt.urgency === 'demanded'
                            ? 'attention'
                            : 'neutral'
                      }
                    >
                      {URGENCY_LABEL[debt.urgency] ?? debt.urgency}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </AppShell>
  );
}
