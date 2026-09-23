import { randomUUID } from 'node:crypto';

import type { DebtEventKind } from '@family-finance/contracts';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AppShell } from '../../../components/app-shell';
import { DueDateLines } from '../../../components/due-date';
import {
  ActionForm,
  HiddenValue,
  MoneyField,
  SelectField,
  TextField,
} from '../../../components/form';
import {
  Badge,
  Card,
  DataTable,
  Disclosure,
  EmptyState,
  Money,
  SectionTitle,
  StatRow,
} from '../../../components/ui';
import { recordLedgerActionAction } from '../../../lib/actions/lenders';
import { loadDashboardView } from '../../../lib/dashboard/load';
import { formatBusinessDate } from '../../../lib/format';
import { todayInJerusalem } from '../../../lib/forms';
import { lenderCard } from '../../../lib/lenders';

/**
 * One lender: what is owed, and every step that got there.
 *
 * The balance at the top is not a field. It is the sum of the column below it,
 * and the page says so in those words — a family that has been told a number
 * should be able to see the arithmetic without asking anyone. Each line carries
 * the running balance after it, so "why is it this much" is answered by reading
 * down.
 *
 * Nothing on this screen edits history. A wrong figure is corrected by recording
 * a correction, which appears as its own line with its own direction. That is the
 * difference between a ledger and a spreadsheet cell, and it is the whole reason
 * the balance can be trusted.
 */

export const dynamic = 'force-dynamic';

/** Hebrew for each ledger action, and whether it is money or a fact. */
const ACTION_LABEL: Record<DebtEventKind, string> = {
  opening_balance: 'יתרת פתיחה',
  new_principal: 'הלוואה נוספת',
  principal_payment: 'תשלום',
  interest_charge: 'ריבית שנוספה',
  fee_charge: 'עמלה שנוספה',
  interest_paid: 'ריבית ששולמה',
  fee_paid: 'עמלה ששולמה',
  balance_correction: 'תיקון',
  write_off: 'מחיקת חוב',
  note: 'הערה',
};

const FILTERABLE_KINDS: readonly DebtEventKind[] = [
  'opening_balance',
  'new_principal',
  'principal_payment',
  'balance_correction',
  'write_off',
  'note',
];

export default async function LenderCardPage({
  params,
  searchParams,
}: {
  params: Promise<{ lender: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const view = await loadDashboardView();
  const document = view.document;

  if (document === null) {
    return (
      <AppShell source={view.descriptor} active="/more" title="כרטיס מלווה">
        <EmptyState reason={view.descriptor.reason} />
      </AppShell>
    );
  }

  const { lender } = await params;
  const filters = await searchParams;
  const today = todayInJerusalem();
  const card = lenderCard(document, today, decodeURIComponent(lender));
  if (card === null) notFound();

  const single = (key: string): string | null => {
    const value = filters[key];
    return typeof value === 'string' && value !== '' ? value : null;
  };

  const kindFilter = single('kind');
  const debtFilter = single('debt');
  const fromFilter = single('from');
  const toFilter = single('to');

  const lines = card.ledger.filter((line) => {
    if (kindFilter !== null && line.kind !== kindFilter) return false;
    if (debtFilter !== null && line.debtId !== debtFilter) return false;
    if (fromFilter !== null && line.occurredOn < fromFilter) return false;
    if (toFilter !== null && line.occurredOn > toFilter) return false;
    return true;
  });

  /*
   * One identifier per render of this page, carried by the "add an action"
   * form. It is what makes a second submission of the same form a no-op rather
   * than a second payment.
   */
  const submissionId = randomUUID();

  const filtered = lines.length !== card.ledger.length;
  const debtOptions = card.debts.map((debt) => ({
    value: debt.id,
    label: `${debt.creditorName} · נפתח ${formatBusinessDate(debt.openedOn)}`,
  }));

  return (
    <AppShell
      source={view.descriptor}
      active="/more"
      title={card.displayName}
      subtitle={
        card.aliases.length === 0 ? 'כרטיס מלווה' : `נרשם גם כ: ${card.aliases.join(' · ')}`
      }
    >
      <Card title="יתרה נוכחית" tone="primary">
        <StatRow
          label="מה שנשאר לשלם"
          value={<Money amountMinor={card.currentBalanceMinor} currency={card.currency} />}
          hint="זה אינו שדה שנרשם — זהו הסכום של כל התנועות למטה"
        />
        <StatRow label="חובות פעילים" value={String(card.activeDebtCount)} />
        <StatRow label="תנועות בהיסטוריה" value={String(card.ledger.length)} />

        <div className="mt-3 rounded-control bg-surface-muted p-3 text-text-secondary">
          <p className="font-medium">איך חושב הסכום</p>
          <p className="mt-1">
            כל שורה בהיסטוריה מוסיפה או מחסירה. יתרת פתיחה והלוואה נוספת מוסיפות; תשלום ומחיקת
            חוב מחסירים; תיקון הולך לכיוון שנרשם בו; הערה אינה משנה דבר. הטור ״יתרה אחרי״ מראה
            את המצב אחרי כל שורה.
          </p>
        </div>
      </Card>

      {card.dueDatesNeedingReview.length === 0 ? null : (
        <Card title="מועד שצריך להשלים" tone="attention">
          <p className="text-text-secondary">כך זה נכתב בקובץ. לא קבענו תאריך, כדי לא לנחש.</p>
          <div className="mt-3 flex flex-col gap-3">
            {card.dueDatesNeedingReview.map((entry) => (
              <DueDateLines key={entry.debtId} due={entry.due} />
            ))}
          </div>
        </Card>
      )}

      <SectionTitle>החובות של המלווה הזה</SectionTitle>
      {card.debts.map((debt) => (
        <Card
          key={debt.id}
          title={debt.creditorName}
          subtitle={`נפתח ${formatBusinessDate(debt.openedOn)}`}
        >
          <div className="mb-3 flex flex-wrap gap-2">
            <Badge tone={debt.status === 'active' ? 'neutral' : 'success'}>
              {debt.status === 'active' ? 'פעיל' : debt.status === 'settled' ? 'נפרע' : 'נמחק'}
            </Badge>
          </div>
          {debt.dueDate === undefined ? null : (
            <div className="border-b border-border py-2">
              <p className="mb-1 text-text-secondary">מועד לתשלום</p>
              <DueDateLines due={debt.dueDate} />
            </div>
          )}
          {debt.notes === null ? null : <StatRow label="הערה" value={debt.notes} />}
        </Card>
      ))}

      <SectionTitle>היסטוריה</SectionTitle>

      <Card title="סינון">
        <form className="flex flex-col gap-3" method="get">
          <SelectField
            name="kind"
            label="סוג הפעולה"
            defaultValue={kindFilter ?? ''}
            emptyLabel="הכול"
            required={false}
            options={FILTERABLE_KINDS.map((kind) => ({
              value: kind,
              label: ACTION_LABEL[kind],
            }))}
          />
          {debtOptions.length < 2 ? null : (
            <SelectField
              name="debt"
              label="חוב"
              defaultValue={debtFilter ?? ''}
              emptyLabel="הכול"
              required={false}
              options={debtOptions}
            />
          )}
          <TextField
            name="from"
            label="מתאריך"
            type="date"
            defaultValue={fromFilter ?? ''}
            required={false}
          />
          <TextField
            name="to"
            label="עד תאריך"
            type="date"
            defaultValue={toFilter ?? ''}
            required={false}
          />
          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              className="min-h-11 rounded-control bg-primary px-4 py-2 font-medium text-surface hover:bg-primary-hover"
            >
              הצג
            </button>
            {filtered ? (
              <Link
                className="self-center underline"
                href={`/lenders/${encodeURIComponent(card.key)}`}
              >
                לנקות סינון
              </Link>
            ) : null}
          </div>
        </form>
      </Card>

      {filtered ? (
        <p className="text-text-secondary">
          מוצגות {lines.length} מתוך {card.ledger.length} תנועות. היתרה שלמעלה היא של כל
          ההיסטוריה, לא של הסינון.
        </p>
      ) : null}

      <DataTable
        caption={`ההיסטוריה של ${card.displayName}`}
        columns={['תאריך', 'פעולה', 'סכום', 'יתרה אחרי', 'הערה']}
        rows={lines.map((line) => ({
          key: line.eventId,
          cells: [
            formatBusinessDate(line.occurredOn),
            <span key="kind">
              {ACTION_LABEL[line.kind]}
              {line.importBatchId === null ? null : (
                <>
                  {' '}
                  <Link className="underline" href={`/imports/${line.importBatchId}`}>
                    מיבוא
                  </Link>
                </>
              )}
            </span>,
            line.direction === 0 ? (
              <span key="amount" className="text-text-secondary">
                —
              </span>
            ) : (
              <span key="amount">
                {line.direction === 1 ? '+' : '−'}
                <Money amountMinor={line.amountMinor} currency={card.currency} />
              </span>
            ),
            <Money key="after" amountMinor={line.balanceAfterMinor} currency={card.currency} />,
            line.note ?? '',
          ],
        }))}
      />

      <SectionTitle>להוסיף פעולה</SectionTitle>
      <Card title="פעולה חדשה בכרטיס">
        <Disclosure summary="לרשום תשלום, הלוואה נוספת, תיקון או הערה">
          <ActionForm action={recordLedgerActionAction} submitLabel="לרשום">
            <>
              <HiddenValue name="debtId" value={card.debts[0]?.id ?? ''} />
              {/*
               * Rendered once with this page, and the identifier the ledger line
               * will carry. Submitting the form twice — a double press, a retry
               * after a slow save — records the payment once.
               */}
              <HiddenValue name="idempotencyKey" value={submissionId} />
              {debtOptions.length < 2 ? null : (
                <SelectField
                  name="debtId"
                  label="על איזה חוב"
                  defaultValue={card.debts[0]?.id ?? ''}
                  emptyLabel=""
                  required
                  options={debtOptions}
                />
              )}
              <SelectField
                name="kind"
                label="סוג הפעולה"
                defaultValue="principal_payment"
                emptyLabel=""
                required
                options={FILTERABLE_KINDS.filter((kind) => kind !== 'opening_balance').map(
                  (kind) => ({ value: kind, label: ACTION_LABEL[kind] }),
                )}
              />
              <MoneyField name="amountMinor" label="סכום (בהערה אין צורך)" required={false} />
              <SelectField
                name="correctionEffect"
                label="בתיקון — לאיזה כיוון"
                defaultValue="decrease"
                emptyLabel=""
                required={false}
                options={[
                  { value: 'decrease', label: 'להקטין את החוב' },
                  { value: 'increase', label: 'להגדיל את החוב' },
                ]}
              />
              <TextField name="occurredOn" label="תאריך" type="date" defaultValue={today} />
              <TextField name="note" label="הערה" required={false} />
            </>
          </ActionForm>
        </Disclosure>
      </Card>
    </AppShell>
  );
}
