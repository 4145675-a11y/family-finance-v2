import { AppShell } from '../../components/app-shell';
import {
  Badge,
  Card,
  Disclosure,
  EmptyState,
  Figure,
  Money,
  ProgressBar,
  SourceBanner,
  StatRow,
} from '../../components/ui';
import { copy } from '../../lib/copy/copy';
import { sayNotice } from '../../lib/copy/notices';
import { loadDashboardView } from '../../lib/dashboard/load';
import { formatBusinessDate } from '../../lib/format';

/**
 * "התקציב שלנו" — the monthly budget.
 *
 * Deliberately its own screen. The home screen answers today's question; a budget
 * is something a family sits down with, and putting ten categories on the home
 * screen was what made it unusable for daily use.
 *
 * Every figure is what `calculateBudget` returned. The screen decides what to
 * show and in what order; it never works anything out.
 */

const STATUS_TONE = {
  on_track: 'success',
  watch: 'attention',
  over: 'attention',
} as const;

const STATUS_LABEL = {
  on_track: copy.budget.statusOnTrack,
  watch: copy.budget.statusWatch,
  over: copy.budget.statusOver,
} as const;

export default async function BudgetPage() {
  const { descriptor, budget, food } = await loadDashboardView();

  if (budget === null) {
    return (
      <AppShell active="/budget" title={copy.budget.title}>
        <EmptyState reason={descriptor.reason} />
      </AppShell>
    );
  }

  const { totals } = budget;
  const projectedShortMinor = totals.projectedMinor - totals.plannedMinor;

  return (
    <AppShell active="/budget" title={copy.budget.title} subtitle={copy.budget.subtitle}>
      {!descriptor.isRealData ? <SourceBanner /> : null}

      {budget.lines.length === 0 ? (
        <Card title={copy.budget.empty}>
          <p className="text-text-secondary">{copy.budget.emptyAction}</p>
        </Card>
      ) : (
        <>
          {/* The month in one card, before any category detail. */}
          <Card title={copy.budget.monthTotal}>
            <div className="flex flex-col gap-3">
              <ProgressBar
                value={totals.approvedMinor + totals.pendingMinor + totals.committedMinor}
                max={Math.max(
                  totals.plannedMinor,
                  totals.approvedMinor + totals.pendingMinor + totals.committedMinor,
                )}
                tone={projectedShortMinor > 0 ? 'attention' : 'primary'}
                label={copy.food.ariaProgress(
                  totals.approvedMinor + totals.pendingMinor + totals.committedMinor,
                  totals.plannedMinor,
                )}
              />
              <p className="text-text-secondary">
                {projectedShortMinor > 0
                  ? copy.budget.projectedShort(projectedShortMinor)
                  : copy.budget.projectedGood(-projectedShortMinor)}
              </p>
            </div>

            <div className="mt-4">
              <StatRow
                label={copy.budget.planned}
                value={<Money amountMinor={totals.plannedMinor} currency={budget.currency} />}
              />
              <StatRow
                label={copy.budget.spent}
                value={<Money amountMinor={totals.approvedMinor} currency={budget.currency} />}
              />
              <StatRow
                label={copy.budget.pending}
                value={<Money amountMinor={totals.pendingMinor} currency={budget.currency} />}
              />
              <StatRow
                label={copy.budget.committed}
                value={<Money amountMinor={totals.committedMinor} currency={budget.currency} />}
              />
              <StatRow
                label={copy.budget.remaining}
                value={<Money amountMinor={totals.remainingMinor} currency={budget.currency} />}
              />
            </div>

            <Disclosure summary={copy.sections.calculation}>
              <ul className="flex list-inside list-disc flex-col gap-1.5 text-small text-text-secondary">
                {budget.assumptions.map((assumption) => (
                  <li key={assumption.code}>{sayNotice(assumption)}</li>
                ))}
              </ul>
              <p className="mt-3 text-small text-text-secondary">
                <Figure>{budget.daysElapsed}</Figure> מתוך <Figure>{budget.daysInMonth}</Figure>{' '}
                ימים בחודש עברו.
              </p>
            </Disclosure>
          </Card>

          {/* The weekly food figure, in full, on the screen that owns it. */}
          {food !== null ? (
            <Card
              title={copy.food.title}
              tone={food.status === 'on_track' ? 'success' : 'attention'}
            >
              <p className="text-[24px] leading-tight font-semibold">
                {food.status === 'insufficient_data'
                  ? copy.food.noPlan
                  : copy.food.remaining(food.weekRemainingMinor, food.weekEndsOn)}
              </p>
              <p className="mt-2 text-text-secondary">
                {copy.food.monthProgress(food.monthSpentMinor, food.monthPlannedMinor)}
              </p>
              <p className="mt-1 text-text-secondary">
                {copy.food.projection(food.projectedMonthMinor)}
              </p>

              {food.weekOverPaceMinor > 0 ? (
                <p className="mt-3 rounded-control bg-surface-muted px-4 py-3">
                  {copy.food.overPace(food.weekOverPaceMinor, food.nextWeekAllowanceMinor)}
                </p>
              ) : null}

              {food.warnings.length > 0 ? (
                <ul className="mt-3 flex list-inside list-disc flex-col gap-1.5 text-small text-text-secondary">
                  {food.warnings.map((warning) => (
                    <li key={warning.code}>{sayNotice(warning)}</li>
                  ))}
                </ul>
              ) : null}

              <Disclosure summary={copy.sections.calculation}>
                <StatRow
                  label="השבוע נספר מ"
                  value={<Figure>{formatBusinessDate(food.weekStartsOn)}</Figure>}
                />
                <StatRow
                  label="עד"
                  value={<Figure>{formatBusinessDate(food.weekEndsOn)}</Figure>}
                />
                <StatRow
                  label="נשאר לחודש"
                  value={
                    <Money amountMinor={food.monthRemainingMinor} currency={budget.currency} />
                  }
                />
                <ul className="mt-3 flex list-inside list-disc flex-col gap-1.5 text-small text-text-secondary">
                  {food.assumptions.map((assumption) => (
                    <li key={assumption.code}>{sayNotice(assumption)}</li>
                  ))}
                </ul>
              </Disclosure>
            </Card>
          ) : null}

          {/* Categories. */}
          <Card title={copy.budget.title}>
            <div className="flex flex-col gap-5">
              {budget.lines.map((line) => {
                const usedMinor = line.approvedMinor + line.pendingMinor + line.committedMinor;
                return (
                  <div
                    key={line.categoryId}
                    className="border-b border-border pb-5 last:border-b-0"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="text-[20px] font-semibold">
                        {copy.budget.categories[line.categoryKey] ?? line.categoryKey}
                      </h3>
                      <div className="flex flex-wrap items-center gap-2">
                        {line.weeklyGuidance ? <Badge>{copy.budget.weeklyBadge}</Badge> : null}
                        <Badge tone={STATUS_TONE[line.status]}>
                          {STATUS_LABEL[line.status]}
                        </Badge>
                      </div>
                    </div>

                    <div className="mt-3">
                      <ProgressBar
                        value={usedMinor}
                        max={Math.max(line.plannedMinor, usedMinor)}
                        tone={line.status === 'on_track' ? 'success' : 'attention'}
                        label={copy.food.ariaProgress(usedMinor, line.plannedMinor)}
                      />
                    </div>

                    <div className="mt-3 grid gap-x-6 sm:grid-cols-2">
                      <StatRow
                        label={copy.budget.planned}
                        value={
                          <Money amountMinor={line.plannedMinor} currency={budget.currency} />
                        }
                      />
                      <StatRow
                        label={copy.budget.spent}
                        value={
                          <Money amountMinor={line.approvedMinor} currency={budget.currency} />
                        }
                      />
                      {line.pendingMinor > 0 ? (
                        <StatRow
                          label={copy.budget.pending}
                          value={
                            <Money amountMinor={line.pendingMinor} currency={budget.currency} />
                          }
                        />
                      ) : null}
                      {line.committedMinor > 0 ? (
                        <StatRow
                          label={copy.budget.committed}
                          value={
                            <Money
                              amountMinor={line.committedMinor}
                              currency={budget.currency}
                            />
                          }
                        />
                      ) : null}
                      {line.overMinor > 0 ? (
                        <StatRow
                          label={copy.budget.over}
                          value={
                            <Money amountMinor={line.overMinor} currency={budget.currency} />
                          }
                        />
                      ) : (
                        <StatRow
                          label={copy.budget.remaining}
                          value={
                            <Money
                              amountMinor={line.remainingMinor}
                              currency={budget.currency}
                            />
                          }
                        />
                      )}
                      <StatRow
                        label={copy.budget.projected}
                        value={
                          <Money amountMinor={line.projectedMinor} currency={budget.currency} />
                        }
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Moving money between categories is a proposal, and the screen says so. */}
          <Card title={copy.budget.transferTitle}>
            <p>{copy.budget.transferExplain(30_000, copy.budget.categories.food ?? 'מזון')}</p>
            <p className="mt-2 text-text-secondary">{copy.budget.transferKeepsTotal}</p>
            <p className="mt-2 text-text-secondary">{copy.budget.transferNeedsApproval}</p>
            <p className="mt-3 text-small text-text-secondary">{copy.states.devOnly}</p>
          </Card>

          {budget.warnings.length > 0 || budget.missingData.length > 0 ? (
            <Card title={copy.sections.needsAttention} tone="attention">
              <ul className="flex list-inside list-disc flex-col gap-1.5">
                {[...budget.warnings, ...budget.missingData].map((item) => (
                  <li key={item.code}>{sayNotice(item)}</li>
                ))}
              </ul>
            </Card>
          ) : null}
        </>
      )}
    </AppShell>
  );
}
