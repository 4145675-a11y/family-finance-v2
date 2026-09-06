import Link from 'next/link';

import { AppShell } from '../components/app-shell';
import {
  Badge,
  BreakdownList,
  Card,
  Disclosure,
  Hero,
  LinkButton,
  Money,
  ProgressBar,
  SectionTitle,
  StatCard,
  StatRow,
} from '../components/ui';
import { NoHousehold } from '../components/screen';
import { copy } from '../lib/copy/copy';
import { breakdownLabel, qualityLabel, sayNotice } from '../lib/copy/notices';
import { loadDashboardView } from '../lib/dashboard/load';
import { formatBusinessDate } from '../lib/format';

/**
 * The home screen.
 *
 * It exists to make today's decision, and nothing else. 01-PRODUCT-SPEC.md gives
 * it three questions — how much can we spend, are the debts going down, what
 * should we do now — and the layout answers those first and puts everything else
 * one level away:
 *
 *   1. one dominant answer, beside one recommended action;
 *   2. four compact cards: food this week, debts, month end, business;
 *   3. quick updates;
 *   4. everything else, collapsed.
 *
 * Two rules the screen holds itself to. It never calculates: every figure comes
 * from the engine snapshot. And it never shows a bare frightening zero — when the
 * safe amount is zero the screen says what that means in words, and the
 * arithmetic follows underneath.
 */

/*
 * Rendered per request. The figures come from the household's own store, and a
 * prerendered copy would show what the build saw rather than what is true now.
 */
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const { descriptor, snapshot, input, food } = await loadDashboardView();

  if (snapshot === null || input === null) {
    return <NoHousehold active="/" title={copy.home.title} reason={descriptor.reason} />;
  }

  const { safeSpend, decision, quality } = snapshot;
  const forecast = snapshot.forecastConservative;
  const trend = snapshot.debtTrend;

  const certainInMinor =
    safeSpend.breakdown.find((line) => line.key === 'certain_income')?.amountMinor ?? 0;

  const cannotCalculate = decision.status === 'insufficient_data';
  const hasGap = safeSpend.fundingGapMinor > 0;
  const showsAmount = !cannotCalculate && safeSpend.resultMinor > 0;

  /** Nothing recorded is not the same as nothing owed, and it reads differently. */
  const noDebts = input.debts.length === 0;

  /** Non-essential household payments still to leave this month — what can move. */
  const movablePayments = input.plannedItems.filter(
    (item) => item.scope === 'household' && item.direction === 'outflow' && !item.essential,
  );

  const freshnessLabel =
    snapshot.freshnessAgeDays === null
      ? copy.freshness.never
      : snapshot.freshnessAgeDays <= 0
        ? copy.freshness.today
        : snapshot.freshnessAgeDays === 1
          ? copy.freshness.yesterday
          : copy.freshness.days(snapshot.freshnessAgeDays);

  const statusChips = (
    <>
      <Badge
        tone={
          snapshot.freshnessAgeDays !== null && snapshot.freshnessAgeDays <= 3
            ? 'success'
            : 'attention'
        }
      >
        {freshnessLabel}
      </Badge>
      <Badge tone={quality.confidence === 'high' ? 'success' : 'attention'}>
        {quality.missingData.length > 0
          ? copy.confidence.partial(quality.missingData.length)
          : copy.confidence[quality.confidence]}
      </Badge>
    </>
  );

  return (
    <AppShell
      source={descriptor}
      active="/"
      title={copy.home.title}
      showHeading={false}
      status={statusChips}
    >
      {/* The answer and what to do about it, side by side once there is room. */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col lg:col-span-2">
          <Hero
            asHeading
            label={copy.home.safeTitle}
            amountMinor={showsAmount ? safeSpend.resultMinor : null}
            headline={
              cannotCalculate ? copy.home.safeCannotCalculate : copy.home.safeZeroHeadline
            }
            currency={snapshot.currency}
            caption={showsAmount ? copy.home.safeUntil(snapshot.periodEnd) : undefined}
            note={
              cannotCalculate
                ? copy.home.safeCannotCalculateWhy(quality.missingData.length)
                : hasGap
                  ? copy.home.safeGap(safeSpend.fundingGapMinor)
                  : showsAmount
                    ? copy.home.safeMeaning
                    : copy.home.safeZeroNote
            }
            tone={cannotCalculate || hasGap ? 'attention' : 'primary'}
          />

          <Disclosure summary={copy.home.howWeCalculated}>
            <p className="mb-2 text-small text-text-secondary">{copy.home.calculationNote}</p>
            <BreakdownList
              lines={safeSpend.breakdown}
              currency={snapshot.currency}
              labelFor={breakdownLabel}
            />
            <ul className="mt-3 flex list-inside list-disc flex-col gap-1 text-small text-text-secondary">
              {safeSpend.assumptions.map((assumption) => (
                <li key={assumption.code}>{sayNotice(assumption)}</li>
              ))}
            </ul>
          </Disclosure>
        </div>

        {/* One recommendation, and a way to act on it. */}
        <Card title={copy.home.actionTitle} tone="primary" className="lg:self-start">
          {snapshot.nextAction.key === 'close_funding_gap' ? (
            <>
              <p className="text-text-secondary">{copy.plan.gapIntro}</p>
              <Disclosure summary={copy.plan.gapTitle} tone="action">
                <ul className="flex flex-col gap-2.5">
                  <li>
                    <p className="font-medium">{copy.plan.movePayments}</p>
                    <p className="text-small text-text-secondary">
                      {movablePayments.length > 0
                        ? copy.plan.movePaymentsWhy(movablePayments.length)
                        : copy.plan.noMovable}
                    </p>
                  </li>
                  <li>
                    <p className="font-medium">
                      {snapshot.safeTransfer.resultMinor > 0
                        ? copy.plan.businessTransfer(snapshot.safeTransfer.resultMinor)
                        : copy.plan.noBusinessTransfer}
                    </p>
                  </li>
                  <li>
                    <p className="font-medium">{copy.plan.expectedIncome(certainInMinor)}</p>
                  </li>
                  {quality.missingData.length > 0 ? (
                    <li>
                      <p className="font-medium">{copy.plan.updateDetails}</p>
                    </li>
                  ) : null}
                </ul>
              </Disclosure>
            </>
          ) : snapshot.nextAction.key === 'move_a_payment' &&
            forecast.firstFailureDate !== null ? (
            <>
              <p className="text-text-secondary">
                {copy.plan.failureDayIntro(forecast.firstFailureDate)}
              </p>
              <Disclosure summary={copy.plan.failureDayTitle} tone="action">
                {movablePayments.length === 0 ? (
                  <p>{copy.plan.noMovable}</p>
                ) : (
                  <ul className="flex flex-col">
                    {movablePayments.map((item) => (
                      <li key={item.id}>
                        <StatRow
                          label={item.label}
                          value={
                            <Money
                              amountMinor={item.amountMinor}
                              currency={snapshot.currency}
                            />
                          }
                          hint={formatBusinessDate(item.dueDate ?? item.expectedDate)}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </Disclosure>
            </>
          ) : snapshot.nextAction.key === 'confirm_balances' ? (
            <>
              <p className="text-text-secondary">{copy.plan.confirmIntro}</p>
              <Disclosure summary={copy.plan.confirmTitle} tone="action">
                <ul className="flex list-inside list-disc flex-col gap-1.5">
                  {quality.missingData.map((item) => (
                    <li key={item.code}>{sayNotice(item)}</li>
                  ))}
                </ul>
              </Disclosure>
            </>
          ) : (
            <>
              <p className="font-medium">{copy.plan.holdTitle}</p>
              <p className="mt-1.5 text-text-secondary">{copy.plan.holdIntro}</p>
            </>
          )}
        </Card>
      </div>

      {/* The four compact daily cards. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard
          title={copy.food.title}
          tone={
            food === null || food.status === 'insufficient_data'
              ? 'neutral'
              : food.status === 'on_track'
                ? 'success'
                : 'attention'
          }
          headline={
            food === null || food.status === 'insufficient_data'
              ? copy.food.noPlan
              : copy.food.remaining(food.weekRemainingMinor, food.weekEndsOn)
          }
          meaning={
            food === null
              ? undefined
              : copy.food.monthProgress(food.monthSpentMinor, food.monthPlannedMinor)
          }
          footer={
            <Link
              className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
              href="/budget"
            >
              {copy.food.budgetLink}
            </Link>
          }
        >
          {food === null ? null : (
            <div className="flex flex-col gap-2">
              <ProgressBar
                value={food.monthSpentMinor}
                max={Math.max(food.monthPlannedMinor, food.monthSpentMinor)}
                tone={food.status === 'on_track' ? 'success' : 'attention'}
                label={copy.food.ariaProgress(food.monthSpentMinor, food.monthPlannedMinor)}
              />
              <p className="text-small text-text-secondary">
                {food.status === 'over_month'
                  ? copy.food.overMonth
                  : food.weekOverPaceMinor > 0
                    ? copy.food.overPace(food.weekOverPaceMinor, food.nextWeekAllowanceMinor)
                    : food.status === 'ahead_of_pace'
                      ? copy.food.projection(food.projectedMonthMinor)
                      : copy.food.onTrack}
              </p>
            </div>
          )}
        </StatCard>

        <StatCard
          title={copy.home.debtTitle}
          tone={
            noDebts || trend === null
              ? 'neutral'
              : trend.consumerDirection === 'down'
                ? 'success'
                : trend.consumerDirection === 'up'
                  ? 'attention'
                  : 'neutral'
          }
          headline={
            noDebts
              ? copy.home.debtNone
              : trend === null
                ? copy.home.debtFlat
                : trend.consumerDirection === 'down'
                  ? copy.home.debtDown(-trend.netConsumerChangeMinor)
                  : trend.consumerDirection === 'up'
                    ? copy.home.debtUp(trend.netConsumerChangeMinor)
                    : copy.home.debtFlat
          }
          meaning={
            noDebts
              ? copy.home.debtNoneNote
              : trend === null
                ? undefined
                : trend.consumerDirection === 'down'
                  ? copy.home.debtDownNote
                  : trend.consumerDirection === 'up'
                    ? copy.home.debtUpNote
                    : copy.home.debtFlatNote
          }
          footer={
            <Link
              className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
              href="/debts"
            >
              {copy.home.debtLink}
            </Link>
          }
        >
          {noDebts ? null : (
            <StatRow
              label={copy.home.debtTotalNow}
              value={
                <Money
                  amountMinor={snapshot.debtTotals.consumerDebtMinor}
                  currency={snapshot.currency}
                />
              }
            />
          )}
        </StatCard>

        <StatCard
          title={copy.home.monthEndTitle}
          headline={
            <Money amountMinor={forecast.lowPointMinor} currency={snapshot.currency} signed />
          }
          tone={forecast.firstFailureDate === null ? 'neutral' : 'attention'}
          meaning={
            forecast.firstFailureDate === null
              ? copy.home.tightestDayOn(forecast.lowPointDate)
              : copy.home.runsOutOn(forecast.firstFailureDate)
          }
          footer={
            <Link
              className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
              href="/forecast"
            >
              {copy.home.forecastLink}
            </Link>
          }
        >
          <StatRow
            label={copy.home.certainIn}
            value={<Money amountMinor={certainInMinor} currency={snapshot.currency} />}
          />
          <StatRow
            label={copy.home.mustGoOut}
            value={
              <Money
                amountMinor={safeSpend.committedOutflowMinor}
                currency={snapshot.currency}
              />
            }
          />
        </StatCard>

        <StatCard
          title={copy.home.businessTitle}
          tone={snapshot.safeTransfer.resultMinor > 0 ? 'success' : 'neutral'}
          headline={
            snapshot.businessProfit === null
              ? copy.home.businessNone
              : snapshot.safeTransfer.resultMinor > 0
                ? copy.home.businessSafeTransfer(snapshot.safeTransfer.resultMinor)
                : copy.home.businessNotSafe
          }
          meaning={
            snapshot.businessProfit === null
              ? undefined
              : copy.business.limits[snapshot.safeTransfer.bindingConstraint] !== undefined
                ? `${copy.business.limitedBy}: ${copy.business.limits[snapshot.safeTransfer.bindingConstraint]}`
                : undefined
          }
          footer={
            <Link
              className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
              href="/business"
            >
              {copy.home.businessLink}
            </Link>
          }
        />
      </div>

      {/* Quick updates. Every one of these opens a working screen. */}
      <Card title={copy.home.updatesTitle}>
        <div className="flex flex-wrap gap-2.5">
          <LinkButton href="/entry">{copy.actions.addExpense}</LinkButton>
          <LinkButton href="/entry" tone="secondary">
            {copy.actions.addIncome}
          </LinkButton>
          <LinkButton href="/accounts" tone="secondary">
            {copy.actions.updateBalance}
          </LinkButton>
          <LinkButton href="/upload" tone="secondary">
            {copy.actions.uploadStatement}
          </LinkButton>
        </div>
      </Card>

      {/* Everything else, collapsed. */}
      <SectionTitle>{copy.home.moreTitle}</SectionTitle>

      {decision.warnings.length > 0 ? (
        <Card title={copy.sections.needsAttention} tone="attention">
          <ul className="flex list-inside list-disc flex-col gap-1.5">
            {decision.warnings.map((warning) => (
              <li key={warning.code}>{sayNotice(warning)}</li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <Disclosure summary={copy.sections.ourProgress}>
          <dl className="flex flex-col">
            {quality.components.map((component) => (
              <div
                key={component.key}
                className="flex flex-wrap items-baseline justify-between gap-x-4 border-b border-border py-2 last:border-b-0"
              >
                <dt className="text-text-secondary">{qualityLabel(component.key)}</dt>
                <dd className="text-small">{sayNotice(component.detail)}</dd>
              </div>
            ))}
          </dl>
        </Disclosure>

        <Disclosure summary={copy.sections.allAccounts}>
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
                hint={account.verifiedAt === null ? copy.freshness.never : undefined}
              />
            ))}
        </Disclosure>

        <p className="mt-3 px-1 text-small text-text-secondary">
          <Link
            className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
            href="/more"
          >
            {copy.home.moreLink}
          </Link>
        </p>
      </Card>
    </AppShell>
  );
}
