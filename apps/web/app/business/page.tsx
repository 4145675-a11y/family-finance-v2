import { AppShell } from '../../components/app-shell';
import {
  Breakdown,
  BreakdownLines,
  Card,
  EmptyState,
  Money,
  SourceBanner,
  StatRow,
} from '../../components/ui';
import { loadDashboardView } from '../../lib/dashboard/load';

/**
 * The business screen.
 *
 * Two profit figures, on purpose. Accounting profit answers "did the business do
 * well"; realized cash profit answers "is there money that is actually ours", and
 * only the second may fund a transfer to the household
 * (02-FINANCIAL-RULES.md § נוסחאות, PROD-KPI-004).
 *
 * The transfer figure always states which of its three limits bound it, because
 * "why only this much" is the first question anyone asks of it.
 */

const CONSTRAINT_LABEL: Readonly<Record<string, string>> = {
  realized_profit: 'הרווח הממומש המצטבר',
  available_cash: 'המזומן העסקי הפנוי',
  household_need: 'צורך הבית עד סוף החודש',
  none: 'אין נתונים מספיקים',
};

export default async function BusinessPage() {
  const { descriptor, snapshot } = await loadDashboardView();

  if (snapshot === null) {
    return (
      <AppShell active="/business" title="עסק">
        <EmptyState reason={descriptor.reason} />
      </AppShell>
    );
  }

  const profit = snapshot.businessProfit;
  const transfer = snapshot.safeTransfer;

  if (profit === null) {
    return (
      <AppShell active="/business" title="עסק">
        {!descriptor.isRealData ? (
          <SourceBanner label={descriptor.label} reason={descriptor.reason} />
        ) : null}
        <Card title="אין עסק מוגדר">
          <p className="text-text-secondary">
            כשיוגדר עסק, יוצגו כאן תקבולים, הוצאות, מס, רזרבה, רווח ממומש והעברה בטוחה.
          </p>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell active="/business" title="עסק">
      {!descriptor.isRealData ? (
        <SourceBanner label={descriptor.label} reason={descriptor.reason} />
      ) : null}

      <Card title="רווח" subtitle="רווח חשבונאי ורווח ממומש במזומן הם שני מספרים שונים.">
        <StatRow
          label="רווח תפעולי חשבונאי"
          value={
            <Money
              amountMinor={profit.operatingProfitMinor}
              currency={snapshot.currency}
              signed
            />
          }
          hint="תקבולים שהתקבלו פחות הוצאות מאושרות."
        />
        <StatRow
          label="רווח ממומש במזומן"
          value={
            <Money
              amountMinor={profit.realizedCashProfitMinor}
              currency={snapshot.currency}
              signed
            />
          }
          hint="בניכוי מה ששולם, רזרבת המס וההתחייבויות הוודאיות."
        />
        <StatRow
          label="מזומן עסקי פנוי"
          value={
            <Money
              amountMinor={profit.availableCashMinor}
              currency={snapshot.currency}
              signed
            />
          }
        />
        <Breakdown summary="הרכיבים">
          <BreakdownLines lines={profit.breakdown} currency={snapshot.currency} />
        </Breakdown>
      </Card>

      <Card
        title="העברה בטוחה לבית"
        subtitle="הנמוך מבין הרווח הממומש, המזומן הפנוי וצורך הבית."
        tone={transfer.resultMinor > 0 ? 'success' : 'attention'}
      >
        <p className="text-[32px] leading-tight font-bold">
          <Money amountMinor={transfer.resultMinor} currency={snapshot.currency} />
        </p>
        <p className="mt-2 text-text-secondary">
          הגורם המגביל:{' '}
          {CONSTRAINT_LABEL[transfer.bindingConstraint] ?? transfer.bindingConstraint}
        </p>
        <StatRow
          label="צורך הבית עד סוף החודש"
          value={
            <Money amountMinor={transfer.householdNeedMinor} currency={snapshot.currency} />
          }
        />
        <Breakdown summary="שלושת הגבולות">
          <BreakdownLines lines={transfer.breakdown} currency={snapshot.currency} />
        </Breakdown>

        {transfer.warnings.length > 0 ? (
          <ul className="mt-3 flex list-inside list-disc flex-col gap-1 text-attention">
            {transfer.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        ) : null}

        <p className="mt-3 text-small text-text-secondary">
          זהו סכום מוצע. העברה בפועל היא פעולה שדורשת אישור, והמערכת אינה מבצעת העברות בנקאיות.
        </p>
      </Card>
    </AppShell>
  );
}
