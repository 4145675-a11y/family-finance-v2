import Link from 'next/link';

import { AppShell } from '../components/app-shell';
import {
  Badge,
  Breakdown,
  BreakdownLines,
  Card,
  EmptyState,
  Figure,
  Money,
  SourceBanner,
  StatRow,
} from '../components/ui';
import {
  CONFIDENCE_LABEL,
  MODE_LABEL,
  STATUS_LABEL,
  formatBusinessDate,
  formatFreshness,
} from '../lib/format';
import { loadDashboardView } from '../lib/dashboard/load';

/**
 * The home screen.
 *
 * 01-PRODUCT-SPEC.md § מסך הבית fixes the order, and the order is the product:
 *
 *   1. freshness and confidence   2. safe spend, with conditional beneath it
 *   3. forecast and low point     4. net consumer debt and total debt
 *   5. household against business 6. one action
 *
 * Nothing here calculates. Every figure comes from the snapshot the engine
 * produced, and every headline opens a breakdown, because 02-FINANCIAL-RULES.md
 * does not permit showing a result without access to what it was made of.
 */

export default async function HomePage() {
  const { descriptor, snapshot, input } = await loadDashboardView();

  if (snapshot === null || input === null) {
    return (
      <AppShell active="/" title="בית">
        <EmptyState reason={descriptor.reason} />
      </AppShell>
    );
  }

  const { safeSpend, decision, quality, forecastConservative: forecast } = snapshot;
  const gap = safeSpend.fundingGapMinor;
  const trend = snapshot.debtTrend;

  return (
    <AppShell active="/" title="בית">
      {!descriptor.isRealData ? (
        <SourceBanner label={descriptor.label} reason={descriptor.reason} />
      ) : null}

      {/* 1 — freshness and confidence */}
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            tone={
              snapshot.freshnessAgeDays !== null && snapshot.freshnessAgeDays <= 3
                ? 'success'
                : 'attention'
            }
          >
            {formatFreshness(snapshot.freshnessAgeDays)}
          </Badge>
          <Badge tone={quality.confidence === 'high' ? 'success' : 'attention'}>
            {CONFIDENCE_LABEL[quality.confidence]} · <Figure>{quality.score}</Figure>/
            <Figure>100</Figure>
          </Badge>
          <Badge tone={snapshot.mode.mode === 'emergency' ? 'danger' : 'neutral'}>
            מצב התנהלות: {MODE_LABEL[snapshot.mode.mode] ?? snapshot.mode.mode}
          </Badge>
        </div>

        {quality.missingData.length > 0 ? (
          <p className="mt-3 text-small text-text-secondary">
            חסר כדי לתת תשובה מלאה: {quality.missingData.join(' · ')}
          </p>
        ) : null}

        <Breakdown summary="איך נמדדת האמינות">
          <dl className="flex flex-col">
            {quality.components.map((component) => (
              <div
                key={component.key}
                className="flex flex-wrap items-baseline justify-between gap-x-4 border-b border-border py-2 last:border-b-0"
              >
                <dt className="text-text-secondary">
                  {component.label} <span className="text-small">({component.detail})</span>
                </dt>
                <dd>
                  <Figure>{component.score}</Figure>/<Figure>100</Figure> · משקל{' '}
                  <Figure>{component.weight}</Figure>
                </dd>
              </div>
            ))}
          </dl>
        </Breakdown>
      </Card>

      {/* 2 — safe spend */}
      <Card tone={gap > 0 ? 'danger' : 'neutral'}>
        <p className="text-text-secondary">בטוח להוצאה עד סוף החודש</p>
        <p className="mt-1 text-[32px] leading-tight font-bold">
          <Money amountMinor={safeSpend.resultMinor} currency={snapshot.currency} />
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge tone={decision.status === 'safe' ? 'success' : 'attention'}>
            {STATUS_LABEL[decision.status] ?? decision.status}
          </Badge>
          <span className="text-small text-text-secondary">
            עד <Figure>{formatBusinessDate(snapshot.periodEnd)}</Figure>
          </span>
        </div>

        {gap > 0 ? (
          <p className="mt-3 text-danger">
            חסר לכיסוי המחויבויות: <Money amountMinor={gap} currency={snapshot.currency} />
          </p>
        ) : null}

        <div className="mt-4 flex flex-col gap-1">
          <StatRow
            label="מותנה — תלוי בהכנסה שטרם התקבלה"
            value={
              <Money amountMinor={safeSpend.conditionalMinor} currency={snapshot.currency} />
            }
            hint="לעולם אינו הסכום שמותר להוציא לפיו."
          />
          <StatRow
            label="לא זמין — שמור, מחויב או רזרבה"
            value={
              <Money amountMinor={safeSpend.unavailableMinor} currency={snapshot.currency} />
            }
          />
        </div>

        <Breakdown summary="מאיפה הסכום הזה">
          <BreakdownLines lines={safeSpend.breakdown} currency={snapshot.currency} />
          <p className="mt-3 text-small text-text-secondary">
            רצפת הרזרבה נקבעה לפי: {safeSpend.reserve.chosenComponent}
          </p>
          <ul className="mt-2 list-inside list-disc text-small text-text-secondary">
            {safeSpend.assumptions.map((assumption) => (
              <li key={assumption}>{assumption}</li>
            ))}
          </ul>
        </Breakdown>
      </Card>

      {/* Warnings — kept next to the number they qualify. */}
      {decision.warnings.length > 0 ? (
        <Card title="אזהרות" tone="attention">
          <ul className="flex list-inside list-disc flex-col gap-1">
            {decision.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* 3 — forecast and low point */}
      <Card title="תחזית עד סוף החודש" subtitle="תרחיש שמרן: נספרת רק הכנסה ודאית.">
        <StatRow
          label="יתרה צפויה בסוף החודש"
          value={<Money amountMinor={forecast.endOfPeriodMinor} currency={snapshot.currency} />}
        />
        <StatRow
          label="נקודת השפל"
          value={<Money amountMinor={forecast.lowPointMinor} currency={snapshot.currency} />}
          hint={`צפויה ב־${formatBusinessDate(forecast.lowPointDate)}`}
        />
        <StatRow
          label="יום כשל צפוי"
          value={
            forecast.firstFailureDate === null ? (
              'אין'
            ) : (
              <Figure>{formatBusinessDate(forecast.firstFailureDate)}</Figure>
            )
          }
        />
        <p className="mt-3 text-small">
          <Link className="text-primary underline" href="/forecast">
            לתחזית היומית המלאה
          </Link>
        </p>
      </Card>

      {/* 4 — debt */}
      <Card title="מה קרה באמת לחוב" subtitle="המד הקובע הוא שינוי היתרות, לא גודל התשלום.">
        <StatRow
          label="חוב צרכני נטו"
          value={
            <Money
              amountMinor={snapshot.debtTotals.consumerDebtMinor}
              currency={snapshot.currency}
            />
          }
        />
        <StatRow
          label="חוב כולל עם משכנתה"
          value={
            <Money
              amountMinor={snapshot.debtTotals.totalDebtMinor}
              currency={snapshot.currency}
            />
          }
        />
        {trend !== null ? (
          <StatRow
            label="שינוי נטו מתחילת התקופה"
            value={
              <Money
                amountMinor={trend.netConsumerChangeMinor}
                currency={snapshot.currency}
                signed
              />
            }
            hint={
              trend.consumerDirection === 'down'
                ? 'החוב ירד נטו — זו התקדמות אמיתית.'
                : trend.consumerDirection === 'flat'
                  ? 'החוב לא ירד. ייתכן שנושה אחד נפרע והוחלף באחר.'
                  : 'החוב גדל בתקופה הזו.'
            }
          />
        ) : null}

        <Breakdown summary="קרן, ריבית ועלות">
          <StatRow
            label="פירעון קרן ברוטו"
            value={
              <Money
                amountMinor={snapshot.debtMetrics.grossPrincipalRepaidMinor}
                currency={snapshot.currency}
              />
            }
          />
          <StatRow
            label="חוב חדש שנוצר"
            value={
              <Money
                amountMinor={snapshot.debtMetrics.newDebtOriginatedMinor}
                currency={snapshot.currency}
              />
            }
          />
          <StatRow
            label="מתוך הפירעון — מומן בגלגול"
            value={
              <Money
                amountMinor={snapshot.debtMetrics.rolloverFundedRepaymentMinor}
                currency={snapshot.currency}
              />
            }
          />
          <StatRow
            label="ירידת קרן שמומנה מהכנסה"
            value={
              <Money
                amountMinor={snapshot.debtMetrics.incomeFundedPrincipalReductionMinor}
                currency={snapshot.currency}
              />
            }
            hint="רק זה נחשב התקדמות."
          />
          <StatRow
            label="ריבית ועמלות ששולמו"
            value={
              <Money
                amountMinor={snapshot.debtMetrics.interestAndFeesPaidMinor}
                currency={snapshot.currency}
              />
            }
            hint="תשלום ריבית אינו מקטין קרן."
          />
        </Breakdown>

        <p className="mt-3 text-small">
          <Link className="text-primary underline" href="/debts">
            למפת החובות המלאה
          </Link>
        </p>
      </Card>

      {/* 5 — household against business */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card title="הבית">
          <StatRow
            label="מזומן נזיל"
            value={
              <Money amountMinor={snapshot.householdLiquidMinor} currency={snapshot.currency} />
            }
          />
          <StatRow
            label="רצפת רזרבה"
            value={
              <Money amountMinor={safeSpend.reserve.floorMinor} currency={snapshot.currency} />
            }
          />
          <Breakdown summary="יתרות לפי חשבון">
            {input.accounts
              .filter((account) => account.scope === 'household')
              .map((account) => (
                <StatRow
                  key={account.id}
                  label={account.name}
                  value={
                    <Money
                      amountMinor={
                        account.balance.direction === 'outflow'
                          ? -account.balance.amountMinor
                          : account.balance.amountMinor
                      }
                      currency={snapshot.currency}
                      signed
                    />
                  }
                  hint={account.verifiedAt === null ? 'לא אומת מעולם' : undefined}
                />
              ))}
          </Breakdown>
        </Card>

        <Card title="העסק">
          {snapshot.businessProfit === null ? (
            <p className="text-text-secondary">אין עסק מוגדר.</p>
          ) : (
            <>
              <StatRow
                label="מזומן נזיל"
                value={
                  <Money
                    amountMinor={snapshot.businessLiquidMinor}
                    currency={snapshot.currency}
                  />
                }
              />
              <StatRow
                label="רווח ממומש במזומן"
                value={
                  <Money
                    amountMinor={snapshot.businessProfit.realizedCashProfitMinor}
                    currency={snapshot.currency}
                  />
                }
              />
              <StatRow
                label="העברה בטוחה לבית"
                value={
                  <Money
                    amountMinor={snapshot.safeTransfer.resultMinor}
                    currency={snapshot.currency}
                  />
                }
                hint={`הגורם המגביל: ${snapshot.safeTransfer.bindingConstraint}`}
              />
              <p className="mt-3 text-small">
                <Link className="text-primary underline" href="/business">
                  לפירוט מצב העסק
                </Link>
              </p>
            </>
          )}
        </Card>
      </div>

      {/* 6 — one action */}
      <Card title="הפעולה האחת שכדאי לעשות עכשיו" tone="success">
        <p className="text-[20px] font-semibold">{snapshot.nextAction.title}</p>
        <p className="mt-2 text-text-secondary">{snapshot.nextAction.detail}</p>
        <p className="mt-2 text-small text-text-secondary">{snapshot.nextAction.rationale}</p>
      </Card>

      <p className="text-small text-text-secondary">
        מזהה חישוב <Figure>{decision.calculationSnapshotId}</Figure>
      </p>
    </AppShell>
  );
}
