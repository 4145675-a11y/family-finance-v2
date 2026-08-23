import Link from 'next/link';

import { AppShell } from '../components/app-shell';
import {
  ActionButton,
  Badge,
  BreakdownList,
  Card,
  Disclosure,
  EmptyState,
  Figure,
  Hero,
  Money,
  ProgressBar,
  SectionTitle,
  SourceBanner,
  StatCard,
  StatRow,
} from '../components/ui';
import { copy } from '../lib/copy/copy';
import {
  ACTION_COPY,
  ACTION_WHY,
  breakdownLabel,
  qualityLabel,
  sayNotice,
} from '../lib/copy/notices';
import { loadDashboardView } from '../lib/dashboard/load';
import { formatBusinessDate } from '../lib/format';

/**
 * The home screen.
 *
 * It exists to make today's decision, and nothing else. 01-PRODUCT-SPEC.md gives
 * it three questions — how much can we spend, are the debts going down, what
 * should we do now — and everything here is arranged around answering those in
 * seconds:
 *
 *   1. one dominant answer;
 *   2. one recommended action;
 *   3. four compact cards;
 *   4. quick updates;
 *   5. everything else, collapsed.
 *
 * The full detail has not been removed, it has been moved. Anything a family
 * needs to investigate rather than decide lives on its own screen or behind a
 * disclosure, because a screen that shows everything helps with nothing.
 *
 * Nothing here calculates. Every figure comes from the engine.
 */

export default async function HomePage() {
  const { descriptor, snapshot, input, food } = await loadDashboardView();

  if (snapshot === null || input === null) {
    return (
      <AppShell active="/" title={copy.home.title}>
        <EmptyState reason={descriptor.reason} />
      </AppShell>
    );
  }

  const { safeSpend, decision, quality } = snapshot;
  const forecast = snapshot.forecastConservative;
  const trend = snapshot.debtTrend;

  const certainInMinor =
    safeSpend.breakdown.find((line) => line.key === 'certain_income')?.amountMinor ?? 0;
  const mustGoOutMinor = safeSpend.breakdown
    .filter((line) =>
      ['essential_needs', 'certain_due_items', 'debt_minimums'].includes(line.key),
    )
    .reduce((total, line) => total + line.amountMinor, 0);

  const cannotCalculate = decision.status === 'insufficient_data';
  const hasGap = safeSpend.fundingGapMinor > 0;

  const action = ACTION_COPY[snapshot.nextAction.key];
  const why = ACTION_WHY[snapshot.nextAction.key];

  const freshnessLabel =
    snapshot.freshnessAgeDays === null
      ? copy.freshness.never
      : snapshot.freshnessAgeDays <= 0
        ? copy.freshness.today
        : snapshot.freshnessAgeDays === 1
          ? copy.freshness.yesterday
          : copy.freshness.days(snapshot.freshnessAgeDays);

  return (
    <AppShell active="/" title={copy.home.title} subtitle={copy.home.greeting}>
      {!descriptor.isRealData ? <SourceBanner /> : null}

      {/* 1 — how reliable is what follows. One line, not a card. */}
      <div className="flex flex-wrap items-center gap-2 px-1">
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
      </div>

      {/* 2 — the one dominant answer. */}
      <Hero
        label={copy.home.safeTitle}
        amountMinor={cannotCalculate ? null : safeSpend.resultMinor}
        currency={snapshot.currency}
        caption={cannotCalculate ? undefined : copy.home.safeUntil(snapshot.periodEnd)}
        note={
          cannotCalculate
            ? copy.home.safeCannotCalculateWhy(quality.missingData.length)
            : hasGap
              ? copy.home.safeGap(safeSpend.fundingGapMinor)
              : safeSpend.resultMinor === 0
                ? copy.home.safeZero
                : copy.home.safeMeaning
        }
        tone={cannotCalculate || hasGap ? 'attention' : 'primary'}
      />

      <Disclosure summary={copy.home.howWeCalculated}>
        <p className="mb-3 text-small text-text-secondary">{copy.home.calculationNote}</p>
        <BreakdownList
          lines={safeSpend.breakdown}
          currency={snapshot.currency}
          labelFor={breakdownLabel}
        />
        <ul className="mt-4 flex list-inside list-disc flex-col gap-1 text-small text-text-secondary">
          {safeSpend.assumptions.map((assumption) => (
            <li key={assumption.code}>{sayNotice(assumption)}</li>
          ))}
        </ul>
      </Disclosure>

      {/* 3 — one, and only one, recommended action. */}
      <Card title={copy.home.actionTitle} tone="primary">
        <p className="text-[20px] leading-snug font-semibold">
          {action === undefined ? snapshot.nextAction.key : action(snapshot.nextAction.params)}
        </p>
        <p className="mt-2 text-text-secondary">
          {why === undefined ? '' : why(snapshot.nextAction.params)}
        </p>
      </Card>

      {/* 4 — the four compact daily cards. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard
          title={copy.home.debtTitle}
          tone={
            trend === null
              ? 'neutral'
              : trend.consumerDirection === 'down'
                ? 'success'
                : trend.consumerDirection === 'up'
                  ? 'attention'
                  : 'neutral'
          }
          headline={
            trend === null
              ? copy.home.debtFlat
              : trend.consumerDirection === 'down'
                ? copy.home.debtDown(-trend.netConsumerChangeMinor)
                : trend.consumerDirection === 'up'
                  ? copy.home.debtUp(trend.netConsumerChangeMinor)
                  : copy.home.debtFlat
          }
          meaning={
            trend === null
              ? undefined
              : trend.consumerDirection === 'down'
                ? copy.home.debtDownNote
                : trend.consumerDirection === 'up'
                  ? copy.home.debtUpNote
                  : copy.home.debtFlatNote
          }
          footer={
            <Link className="text-primary underline underline-offset-4" href="/debts">
              {copy.home.debtLink}
            </Link>
          }
        >
          <StatRow
            label={copy.home.debtTotalNow}
            value={
              <Money
                amountMinor={snapshot.debtTotals.consumerDebtMinor}
                currency={snapshot.currency}
              />
            }
          />
        </StatCard>

        <StatCard
          title={copy.food.title}
          tone={
            food === null || food.status === 'insufficient_data'
              ? 'neutral'
              : food.status === 'over_month'
                ? 'attention'
                : food.status === 'ahead_of_pace'
                  ? 'attention'
                  : 'success'
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
            <Link className="text-primary underline underline-offset-4" href="/budget">
              {copy.food.budgetLink}
            </Link>
          }
        >
          {food === null ? null : (
            <div className="flex flex-col gap-2">
              <ProgressBar
                value={food.monthSpentMinor}
                max={Math.max(food.monthPlannedMinor, food.monthSpentMinor)}
                tone={food.status === 'over_month' ? 'attention' : 'success'}
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
          title={copy.home.monthEndTitle}
          headline={
            forecast.firstFailureDate === null ? (
              <Money amountMinor={forecast.endOfPeriodMinor} currency={snapshot.currency} />
            ) : (
              <Figure>{formatBusinessDate(forecast.firstFailureDate)}</Figure>
            )
          }
          tone={forecast.firstFailureDate === null ? 'neutral' : 'attention'}
          meaning={
            forecast.firstFailureDate === null
              ? copy.home.noTightDay
              : copy.home.tightestDayValue(forecast.lowPointDate, forecast.lowPointMinor)
          }
          footer={
            <Link className="text-primary underline underline-offset-4" href="/forecast">
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
            value={<Money amountMinor={mustGoOutMinor} currency={snapshot.currency} />}
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
          footer={
            <Link className="text-primary underline underline-offset-4" href="/business">
              {copy.home.businessLink}
            </Link>
          }
        />
      </div>

      {/* 5 — quick updates. One is visually primary; the rest are quieter. */}
      <Card title={copy.home.updatesTitle}>
        <div className="flex flex-wrap gap-2">
          <ActionButton variant="primary" disabled title={copy.states.devOnly}>
            {copy.actions.addExpense}
          </ActionButton>
          <ActionButton disabled title={copy.states.devOnly}>
            {copy.actions.addIncome}
          </ActionButton>
          <ActionButton disabled title={copy.states.devOnly}>
            {copy.actions.updateBalance}
          </ActionButton>
          <ActionButton disabled title={copy.states.devOnly}>
            {copy.actions.uploadStatement}
          </ActionButton>
        </div>
        <p className="mt-3 text-small text-text-secondary">{copy.states.devOnly}</p>
      </Card>

      {/* 6 — everything else, collapsed. */}
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
      </Card>
    </AppShell>
  );
}
