import Link from 'next/link';
import type { ReactNode } from 'react';

import { AppShell } from '../components/app-shell';
import {
  Badge,
  BreakdownList,
  Card,
  Disclosure,
  Hero,
  LinkButton,
  Money,
  StatRow,
} from '../components/ui';
import { pendingImportRowCount } from '@family-finance/local-store';

import { ActionForm, HiddenValue, SelectField } from '../components/form';
import { NoHousehold } from '../components/screen';
import { screens } from '../lib/copy/screens';
import { copy } from '../lib/copy/copy';
import {
  ACTION_COPY,
  ACTION_WHY,
  breakdownLabel,
  qualityLabel,
  sayNotice,
} from '../lib/copy/notices';
import { loadDashboardView } from '../lib/dashboard/load';
import { addTaskAction } from '../lib/actions/entries';
import { formatBusinessDate, money } from '../lib/format';
import { checkAlert } from '../lib/gemach';
import { gemach } from '../lib/copy/gemach';

/**
 * The home screen: today's answer, today's action, and what needs attention.
 *
 * It had grown into a wall. Nine sections, ten competing links, three large
 * figures — two of them the same number meaning different things — and the thing
 * a person actually came to do, saying what happened, was a small button in the
 * ninth card, below the fold on a phone. A screen like that is read once and
 * thereafter scrolled past.
 *
 * Four things now, in the order a person needs them:
 *
 *   1. **How much can we spend** — one dominant figure, with the arithmetic
 *      behind a closed disclosure;
 *   2. **say what happened** — the quick update, as the one primary action;
 *   3. **what needs attention** — one card, or nothing at all when there is
 *      nothing to say;
 *   4. **two summary lines** — what is owed, and how the month ends.
 *
 * What left did not disappear. Assigning a task belongs on `/tasks`, recording a
 * form belongs on `/entry`, the budget on `/budget`, the business on `/business`
 * — each reachable from `עוד`, each announcing itself here only when it has
 * something urgent to say. An empty module no longer takes a whole card.
 *
 * Two rules the screen still holds itself to. It never calculates: every figure
 * comes from the engine snapshot. And it never shows a bare frightening zero —
 * when the safe amount is zero the screen says what that means in words.
 */

/*
 * Rendered per request. The figures come from the household's own store, and a
 * prerendered copy would show what the build saw rather than what is true now.
 */
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const { descriptor, snapshot, input, document } = await loadDashboardView();

  if (snapshot === null || input === null) {
    return <NoHousehold active="/" title={copy.home.title} reason={descriptor.reason} />;
  }

  const { safeSpend, decision, quality } = snapshot;
  const forecast = snapshot.forecastConservative;
  const trend = snapshot.debtTrend;

  const cannotCalculate = decision.status === 'insufficient_data';
  const hasGap = safeSpend.fundingGapMinor > 0;
  const showsAmount = !cannotCalculate && safeSpend.resultMinor > 0;

  /** Rows from an uploaded file that nobody has decided about yet. */
  const waitingRows = document === null ? 0 : pendingImportRowCount(document);

  /** Nothing recorded is not the same as nothing owed, and it reads differently. */
  const noDebts = input.debts.length === 0;

  /** The one thing worth saying about post-dated checks today, or nothing. */
  const alert = checkAlert(snapshot);

  /** The recommendation, in one line. The plan behind it lives on `/tasks`. */
  const actionTitle = ACTION_COPY[snapshot.nextAction.key]?.(snapshot.nextAction.params) ?? '';
  const actionReason = ACTION_WHY[snapshot.nextAction.key]?.(snapshot.nextAction.params) ?? '';
  const nothingUrgent = snapshot.nextAction.key === 'nothing_urgent';

  /** Money that is certain to arrive, for the plan to point at. */
  const certainInMinor =
    safeSpend.breakdown.find((line) => line.key === 'certain_income')?.amountMinor ?? 0;

  /** Non-essential household payments still to leave this month — what can move. */
  const movablePayments = input.plannedItems.filter(
    (item) => item.scope === 'household' && item.direction === 'outflow' && !item.essential,
  );

  const members = (document?.profiles ?? []).map((profile) => ({
    value: profile.id,
    label: profile.displayName,
  }));

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

  /*
   * Everything that wants a person's attention, gathered once.
   *
   * Three separate cards — rows waiting, cheques outstanding, a warning from the
   * engine — trained a reader to skip the second and third. One list of short
   * lines is read; three cards are not.
   */
  const attention: {
    key: string;
    text: string;
    href?: string;
    link?: string;
    detail?: ReactNode;
  }[] = [];
  if (waitingRows > 0) {
    attention.push({
      key: 'waiting',
      text: copy.home.waitingRows(waitingRows),
      href: '/approvals',
      link: copy.home.waitingLink,
    });
  }
  if (alert !== null) {
    attention.push({
      key: 'checks',
      text:
        alert.kind === 'returned'
          ? gemach.returnedLine(alert.count)
          : alert.kind === 'overdue'
            ? gemach.overdueLine(alert.count, money(alert.amountMinor, snapshot.currency))
            : gemach.outstandingCount(alert.count, money(alert.amountMinor, snapshot.currency)),
      href: '/gemach',
      link: gemach.details,
    });
  }
  /*
   * The recommendation, with its plan folded away.
   *
   * It used to be a card of its own beside the answer, carrying a paragraph, a
   * list of options and a form for assigning it to somebody — the second-largest
   * thing on the screen, every day, whether or not it mattered. What it says is
   * worth one line; what it *offers* is worth reading only when a person decides
   * to act on it, so the options and the form are one press away.
   */
  const plan =
    nothingUrgent || actionTitle === '' ? null : (
      <Disclosure summary={copy.plan.howTitle} tone="action">
        {snapshot.nextAction.key === 'close_funding_gap' ? (
          <>
            <p className="mb-2 text-small text-text-secondary">{copy.plan.gapIntro}</p>
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
          </>
        ) : snapshot.nextAction.key === 'move_a_payment' &&
          forecast.firstFailureDate !== null ? (
          <>
            <p className="mb-2 text-small text-text-secondary">
              {copy.plan.failureDayIntro(forecast.firstFailureDate)}
            </p>
            {movablePayments.length === 0 ? (
              <p>{copy.plan.noMovable}</p>
            ) : (
              <ul className="flex flex-col">
                {movablePayments.map((item) => (
                  <li key={item.id}>
                    <StatRow
                      label={item.label}
                      value={
                        <Money amountMinor={item.amountMinor} currency={snapshot.currency} />
                      }
                      hint={formatBusinessDate(item.dueDate ?? item.expectedDate)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : snapshot.nextAction.key === 'confirm_balances' ? (
          <ul className="flex list-inside list-disc flex-col gap-1.5">
            {quality.missingData.map((item) => (
              <li key={item.code}>{sayNotice(item)}</li>
            ))}
          </ul>
        ) : (
          <p className="text-text-secondary">{copy.plan.holdIntro}</p>
        )}

        {/*
          The recommendation becomes something with a name against it. Creating
          the task changes no figure — the money moves when the money moves, and
          this is a note the two of you leave each other.
        */}
        <div className="mt-4 border-t border-border pt-4">
          <ActionForm
            action={addTaskAction}
            submitLabel={screens.tasks.addFromAction}
            tone="secondary"
          >
            <>
              <HiddenValue name="title" value={actionTitle} />
              <HiddenValue name="reason" value={actionReason} />
              <HiddenValue name="recommendationKey" value={snapshot.nextAction.key} />
              {members.length === 0 ? null : (
                <SelectField
                  name="assignedMemberId"
                  label={screens.tasks.who}
                  required={false}
                  emptyLabel={screens.tasks.whoNobody}
                  options={members}
                />
              )}
            </>
          </ActionForm>
        </div>
      </Disclosure>
    );

  if (plan !== null) {
    attention.push({ key: 'action', text: actionTitle, detail: plan });
  }
  /*
   * The engine's own warnings, as lines and nothing more.
   *
   * No link: a warning says what is true, and the screen it might send somebody
   * to is already one press away at the bottom of this page. A second copy of
   * that link beside every warning is the kind of duplication this screen just
   * lost.
   */
  for (const warning of decision.warnings) {
    attention.push({ key: `warning:${warning.code}`, text: sayNotice(warning) });
  }

  return (
    <AppShell
      source={descriptor}
      active="/"
      title={copy.home.title}
      showHeading={false}
      status={statusChips}
    >
      {/* 1. The answer. */}
      <Hero
        asHeading
        label={copy.home.safeTitle}
        amountMinor={showsAmount ? safeSpend.resultMinor : null}
        headline={cannotCalculate ? copy.home.safeCannotCalculate : copy.home.safeZeroHeadline}
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

      {/*
        2. The one thing this screen asks a person to do.

        A whole card, above everything else, because saying what happened is the
        habit the product lives or dies by. It used to be one of four buttons in
        the ninth section.
      */}
      <Card title={copy.home.recordTitle} tone="primary">
        <p className="text-text-secondary">{copy.home.recordIntro}</p>
        <div className="mt-4">
          <LinkButton href="/quick">{copy.actions.quickUpdate}</LinkButton>
        </div>
      </Card>

      {/* 3. What needs attention — one card, or nothing at all. */}
      {attention.length === 0 ? null : (
        <Card title={copy.home.attentionTitle} tone="attention">
          <ul className="flex flex-col gap-3">
            {attention.map((item) => (
              <li key={item.key} className="flex flex-col gap-1">
                <span className="font-medium">{item.text}</span>
                {item.detail ?? null}
                {item.href === undefined ? null : (
                  <Link
                    href={item.href}
                    className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
                  >
                    {item.link}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/*
        4. Two lines of picture: what is owed, and how the month ends.

        Lines rather than cards. A figure with a label and a link is what a person
        reads at breakfast; a card with a progress bar, a meaning, a footer and a
        trend is what they scroll past.
      */}
      <Card title={copy.home.pictureTitle}>
        <StatRow
          label={copy.home.debtTotalNow}
          value={
            noDebts ? (
              <span className="text-text-secondary">{copy.home.debtNone}</span>
            ) : (
              <Money
                amountMinor={snapshot.debtTotals.consumerDebtMinor}
                currency={snapshot.currency}
              />
            )
          }
          hint={
            noDebts
              ? copy.home.debtNoneNote
              : trend === null
                ? copy.home.debtFlat
                : trend.consumerDirection === 'down'
                  ? copy.home.debtDown(-trend.netConsumerChangeMinor)
                  : trend.consumerDirection === 'up'
                    ? copy.home.debtUp(trend.netConsumerChangeMinor)
                    : copy.home.debtFlat
          }
        />
        <StatRow
          label={copy.home.monthEndTitle}
          value={
            <Money
              amountMinor={forecast.endOfPeriodMinor}
              currency={snapshot.currency}
              signed
            />
          }
          hint={
            forecast.firstFailureDate !== null
              ? copy.home.runsOutOn(forecast.firstFailureDate)
              : copy.home.tightestDayOn(forecast.lowPointDate)
          }
        />

        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1">
          <Link
            className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
            href="/lenders"
          >
            {copy.home.debtLink}
          </Link>
          <Link
            className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
            href="/forecast"
          >
            {copy.home.forecastLink}
          </Link>
        </div>
      </Card>

      {/*
        The arithmetic, and how complete the picture is. Both true, neither what
        a person came for — so both are closed, and one press away.
      */}
      <Card>
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
