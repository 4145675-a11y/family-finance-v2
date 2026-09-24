import Link from 'next/link';

import { AppShell } from '../../components/app-shell';
import { DueDateInline } from '../../components/due-date';
import { Badge, Card, EmptyState, Money, SectionTitle, StatRow } from '../../components/ui';
import { loadDashboardView } from '../../lib/dashboard/load';
import { todayInJerusalem } from '../../lib/forms';
import { lenderCards } from '../../lib/lenders';

/**
 * Who the household owes money to, one card each.
 *
 * Grouped by lender rather than by debt, because that is the unit a family
 * actually thinks in: "how much do we owe the gemach" is one question even when
 * it is two loans. Each balance is replayed from that lender's events, so the
 * figure here and the ledger behind it cannot disagree.
 *
 * Due dates are printed in both calendars wherever they appear. A date the file
 * expressed in the Hebrew calendar leads with the Hebrew form, because that is
 * what the family wrote and what they will recognise.
 */

export const dynamic = 'force-dynamic';

export default async function LendersPage() {
  const view = await loadDashboardView();
  const document = view.document;

  if (document === null) {
    return (
      <AppShell source={view.descriptor} active="/lenders" title="מלווים">
        <EmptyState reason={view.descriptor.reason} />
      </AppShell>
    );
  }

  const today = todayInJerusalem();
  const cards = lenderCards(document, today);
  const currency = document.settings.currency;
  const totalMinor = cards.reduce((total, card) => total + card.currentBalanceMinor, 0);
  const needingReview = cards.filter((card) => card.dueDatesNeedingReview.length > 0);

  return (
    <AppShell
      source={view.descriptor}
      active="/lenders"
      title="מלווים"
      subtitle="למי אנחנו חייבים, וכמה — לפי ההיסטוריה עצמה"
    >
      {cards.length === 0 ? (
        <Card title="עוד אין מלווים" tone="neutral">
          <p className="text-text-secondary">
            אחרי שמעלים קובץ חובות ומאשרים אותו, כל מלווה יקבל כאן כרטיס עם כל ההיסטוריה שלו.
          </p>
        </Card>
      ) : (
        <>
          <Card title="סך הכול" tone="primary">
            <StatRow
              label="מה שנשאר לשלם לכל המלווים"
              value={<Money amountMinor={totalMinor} currency={currency} />}
              hint={`${cards.length} מלווים · הסכום מחושב מהתנועות, לא נרשם בנפרד`}
            />
          </Card>

          {needingReview.length === 0 ? null : (
            <Card title="מועדים שצריך להשלים" tone="attention">
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
    </AppShell>
  );
}
