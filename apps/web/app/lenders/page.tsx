import Link from 'next/link';

import { AppShell } from '../../components/app-shell';
import { DueDateInline } from '../../components/due-date';
import { ActionForm, MoneyField, SelectField, TextField } from '../../components/form';
import {
  Badge,
  Card,
  Disclosure,
  EmptyState,
  Money,
  SectionTitle,
  StatRow,
} from '../../components/ui';
import { addDebtAction, recordRolloverAction } from '../../lib/actions/entries';
import { copy } from '../../lib/copy/copy';
import { screens } from '../../lib/copy/screens';
import { loadDashboardView } from '../../lib/dashboard/load';
import { todayInJerusalem } from '../../lib/forms';
import { lenderCards } from '../../lib/lenders';

/**
 * Debts and lenders — one screen, because they were always one subject.
 *
 * There were two: `/debts` listed the same seven lenders as a table with two
 * full forms under it, and `/lenders` listed them as cards. A family choosing
 * between them was choosing between two views of one question, and the payment
 * form on `/debts` was a second way to record something the lender's own card
 * already records.
 *
 * What a person needs to see here, in this order: how much is owed in total and
 * whether it moved this month, then each lender with its balance and its next
 * date, then a way in to the history. Opening a lender and swapping one debt for
 * another are real but rare, so they are behind `פרטים` rather than in the way.
 *
 * Every balance is replayed from that lender's own events (M1). Nothing on this
 * screen adds figures up itself, and due dates are printed in both calendars
 * wherever they appear.
 */

export const dynamic = 'force-dynamic';

export default async function LendersPage() {
  const view = await loadDashboardView();
  const document = view.document;
  const snapshot = view.snapshot;

  if (document === null) {
    return (
      <AppShell source={view.descriptor} active="/lenders" title={copy.nav.lenders}>
        <EmptyState reason={view.descriptor.reason} />
      </AppShell>
    );
  }

  const today = todayInJerusalem();
  const cards = lenderCards(document, today);
  const currency = document.settings.currency;
  const totalMinor = cards.reduce((total, card) => total + card.currentBalanceMinor, 0);
  const needingReview = cards.filter((card) => card.dueDatesNeedingReview.length > 0);

  const trend = snapshot?.debtTrend ?? null;
  const risk = snapshot?.callRisk ?? null;

  /** The debts a rollover can name. Two are needed for a swap to mean anything. */
  const debtOptions = document.debts
    .filter((debt) => debt.status === 'active')
    .map((debt) => ({ value: debt.id, label: debt.creditorName }));

  return (
    <AppShell
      source={view.descriptor}
      active="/lenders"
      title={copy.nav.lenders}
      subtitle={copy.debts.subtitle}
    >
      {cards.length === 0 ? (
        <Card title="עוד אין מלווים" tone="neutral">
          <p className="text-text-secondary">
            אחרי שמעלים קובץ חובות ומאשרים אותו, כל מלווה יקבל כאן כרטיס עם כל ההיסטוריה שלו.
          </p>
        </Card>
      ) : (
        <>
          {/*
            One card for the whole picture: what is owed, and whether it moved.
            The trend used to be a section of its own on a second screen, which
            is how a family ended up reading the same total twice.
          */}
          <Card
            title="סך הכול"
            tone={trend?.consumerDirection === 'down' ? 'success' : 'primary'}
          >
            <StatRow
              label="מה שנשאר לשלם לכל המלווים"
              value={<Money amountMinor={totalMinor} currency={currency} />}
              hint={`${cards.length} מלווים · הסכום מחושב מהתנועות, לא נרשם בנפרד`}
            />
            <StatRow
              label={copy.debts.change}
              value={
                trend === null ? (
                  <span className="text-text-secondary">{copy.home.debtFlat}</span>
                ) : (
                  <Money
                    amountMinor={trend.netConsumerChangeMinor}
                    currency={currency}
                    signed
                  />
                )
              }
              hint={
                trend === null
                  ? undefined
                  : trend.consumerDirection === 'down'
                    ? copy.home.debtDownNote
                    : trend.consumerDirection === 'up'
                      ? copy.home.debtUpNote
                      : copy.home.debtFlatNote
              }
            />
          </Card>

          {/*
            One attention card, not three. A date nobody could read and a lender
            who may call the money in are both "something to deal with", and a
            person meeting them in two separate places treats the second as noise.
          */}
          {needingReview.length === 0 && (risk?.within30DaysMinor ?? 0) === 0 ? null : (
            <Card title={copy.debts.urgentTitle} tone="attention">
              {(risk?.within30DaysMinor ?? 0) > 0 ? (
                <p>{copy.debts.callableSoon(risk?.within30DaysMinor ?? 0)}</p>
              ) : null}
              {needingReview.length === 0 ? null : (
                <>
                  <p className="text-text-secondary">
                    באחד המלווים או יותר יש תאריך פירעון שלא הצלחנו לקרוא בבירור, ולכן לא נקבע
                    תאריך. הוא מופיע בכרטיס עם מה שכתוב בקובץ.
                  </p>
                  <ul className="mt-2 flex list-inside list-disc flex-col gap-1">
                    {needingReview.map((card) => (
                      <li key={card.key}>
                        <Link
                          className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
                          href={`/lenders/${encodeURIComponent(card.key)}`}
                        >
                          {card.displayName}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Card>
          )}

          <SectionTitle>כל המלווים</SectionTitle>

          {cards.map((card) => (
            <Card
              key={card.key}
              title={card.displayName}
              {...(card.aliases.length === 0
                ? {}
                : { subtitle: `נרשם גם כ: ${card.aliases.join(' · ')}` })}
              tone={card.currentBalanceMinor > 0 ? 'neutral' : 'primary'}
            >
              <div className="mb-3 flex flex-wrap gap-2">
                {card.currentBalanceMinor === 0 ? (
                  <Badge tone="success">אין יתרה</Badge>
                ) : (
                  <Badge tone="neutral">{card.activeDebtCount} חובות פעילים</Badge>
                )}
                {card.dueDatesNeedingReview.length === 0 ? null : (
                  <Badge tone="attention">מועד לבדיקה</Badge>
                )}
              </div>

              <StatRow
                label="יתרה נוכחית"
                value={
                  <Money amountMinor={card.currentBalanceMinor} currency={card.currency} />
                }
                hint={`מחושב מ־${card.ledger.length} תנועות`}
              />
              <StatRow
                label="המועד הבא"
                value={<DueDateInline due={card.nextDue ?? undefined} />}
              />

              <p className="mt-3">
                <Link
                  className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
                  href={`/lenders/${encodeURIComponent(card.key)}`}
                >
                  לכרטיס המלווה ולהיסטוריה המלאה
                </Link>
              </p>
            </Card>
          ))}
        </>
      )}

      {/*
        The two rare things, closed.

        Opening a lender by hand happens when a loan arrives outside a file, and
        swapping one debt for another happens a few times a year. Neither belongs
        between a person and the balance they came to read — and a repayment is
        deliberately not here at all: it is recorded on the lender's own card, or
        by saying so in the quick update, and a third way in would be a third
        place for a money rule to be relaxed.
      */}
      <Card>
        <Disclosure summary={copy.debts.moreActions}>
          <SectionTitle>{copy.debts.creditor}</SectionTitle>
          <ActionForm action={addDebtAction} submitLabel={screens.entry.save} resetOnSuccess>
            <>
              <TextField name="creditorName" label={copy.debts.creditor} maxLength={160} />
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField
                  name="kind"
                  label={screens.accounts.kind}
                  defaultValue="bank_loan"
                  options={[
                    { value: 'bank_loan', label: 'הלוואה מהבנק' },
                    { value: 'mortgage', label: copy.debts.mortgageTag },
                    { value: 'revolving_credit', label: 'אשראי מתגלגל' },
                    { value: 'overdraft', label: 'מינוס' },
                    { value: 'private_person', label: 'חוב לאדם פרטי' },
                    { value: 'institution', label: 'חוב למוסד' },
                    { value: 'other', label: 'אחר' },
                  ]}
                />
                <MoneyField name="openingBalanceMinor" label={copy.debts.balance} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  name="openedOn"
                  label={screens.entry.date}
                  type="date"
                  defaultValue={todayInJerusalem()}
                />
                <TextField
                  name="annualRatePercent"
                  label={copy.debts.cost}
                  hint={copy.debts.unknownCostNote}
                  required={false}
                  inputMode="decimal"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <MoneyField
                  name="minimumPaymentMinor"
                  label={copy.debts.monthly}
                  required={false}
                />
                <SelectField
                  name="urgency"
                  label={copy.debts.urgentTitle}
                  defaultValue="none"
                  options={[
                    { value: 'none', label: copy.debts.urgency['none'] ?? '' },
                    { value: 'watch', label: copy.debts.urgency['watch'] ?? '' },
                    { value: 'demanded', label: copy.debts.urgency['demanded'] ?? '' },
                    { value: 'legal', label: copy.debts.urgency['legal'] ?? '' },
                  ]}
                />
              </div>
            </>
          </ActionForm>

          {/*
            A rollover is three facts, and the form makes that visible: which
            debt was repaid, which one paid for it, and how much. The total does
            not move, which is exactly why it is recorded rather than inferred.
          */}
          {debtOptions.length < 2 ? null : (
            <>
              <SectionTitle>{copy.debts.swapTitle}</SectionTitle>
              <ActionForm action={recordRolloverAction} submitLabel={screens.entry.save}>
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <SelectField
                      name="fromDebtId"
                      label={copy.debts.repaid}
                      options={debtOptions}
                    />
                    <SelectField
                      name="toDebtId"
                      label={copy.debts.borrowed}
                      options={debtOptions}
                    />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <MoneyField name="amountMinor" label={screens.entry.amount} />
                    <TextField
                      name="occurredOn"
                      label={screens.entry.date}
                      type="date"
                      defaultValue={todayInJerusalem()}
                    />
                  </div>
                </>
              </ActionForm>
            </>
          )}
        </Disclosure>
      </Card>
    </AppShell>
  );
}
