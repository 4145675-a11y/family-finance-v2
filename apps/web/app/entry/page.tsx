import {
  addPlannedItemAction,
  recordDebtPaymentAction,
  recordExpenseAction,
  recordIncomeAction,
  recordMovementAction,
} from '../../lib/actions/entries';
import Link from 'next/link';

import { AppShell } from '../../components/app-shell';
import {
  ActionForm,
  CheckboxField,
  MoneyField,
  SelectField,
  TextAreaField,
  TextField,
} from '../../components/form';
import { NoHousehold, StatusChips } from '../../components/screen';
import { Card, Disclosure, EmptyPrompt, Notice } from '../../components/ui';
import { screens } from '../../lib/copy/screens';
import { loadDashboardView } from '../../lib/dashboard/load';
import { todayInJerusalem } from '../../lib/forms';

/**
 * Everything a family records by hand.
 *
 * One page rather than five, because the decision "is this an expense or a
 * transfer" is easier to make when both are visible than when they are behind
 * different menu items. Each form is one card, collapsed to what that particular
 * record actually needs — an expense does not ask about certainty, and a planned
 * item does not ask for a category it will not use.
 *
 * The order is the order a family uses them: what left, what came in, what moved
 * between our own accounts, what is coming, what we paid off a debt.
 */

export const dynamic = 'force-dynamic';

export default async function EntryPage() {
  const view = await loadDashboardView();

  if (view.document === null || view.snapshot === null) {
    return (
      <NoHousehold
        active="/entry"
        title={screens.entry.title}
        reason={view.descriptor.reason}
      />
    );
  }

  const { document, snapshot } = view;
  const today = todayInJerusalem();

  const accounts = document.accounts.filter((account) => account.closedAt === null);
  const householdAccounts = accounts.filter((account) => account.scope === 'household');
  const hasBusiness = document.businesses.length > 0;

  if (accounts.length === 0) {
    return (
      <AppShell
        source={view.descriptor}
        active="/entry"
        title={screens.entry.title}
        subtitle={screens.entry.subtitle}
        status={<StatusChips snapshot={snapshot} />}
      >
        <EmptyPrompt
          title={screens.entry.needAccount}
          body={screens.accounts.emptyHint}
          actionHref="/accounts"
          actionLabel={screens.entry.goToAccounts}
        />
      </AppShell>
    );
  }

  const accountOptions = accounts.map((account) => ({
    value: account.id,
    label: `${account.name}${account.displaySuffix === null ? '' : ` ••••${account.displaySuffix}`}`,
  }));

  const householdAccountOptions = householdAccounts.map((account) => ({
    value: account.id,
    label: account.name,
  }));

  const scopeOptions = hasBusiness
    ? [
        { value: 'household', label: screens.accounts.scopes['household'] ?? '' },
        { value: 'business', label: screens.accounts.scopes['business'] ?? '' },
      ]
    : [{ value: 'household', label: screens.accounts.scopes['household'] ?? '' }];

  const categories = document.categories.map((category) => ({
    value: category.id,
    label: category.name,
  }));

  const debts = document.debts
    .filter((debt) => debt.status === 'active')
    .map((debt) => ({ value: debt.id, label: debt.creditorName }));

  return (
    <AppShell
      source={view.descriptor}
      active="/entry"
      title={screens.entry.title}
      subtitle={screens.entry.subtitle}
      status={<StatusChips snapshot={snapshot} />}
    >
      <Card title={screens.entry.expenseTitle}>
        <ActionForm
          action={recordExpenseAction}
          submitLabel={screens.entry.save}
          resetOnSuccess
        >
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <MoneyField name="amountMinor" label={screens.entry.amount} />
              <TextField
                name="transactionDate"
                label={screens.entry.date}
                type="date"
                defaultValue={today}
              />
            </div>
            <TextField
              name="merchant"
              label={screens.entry.merchant}
              hint={screens.entry.merchantHint}
              maxLength={160}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                name="accountId"
                label={screens.entry.account}
                options={accountOptions}
              />
              <SelectField
                name="categoryId"
                label={screens.entry.category}
                required={false}
                emptyLabel={screens.entry.categoryNone}
                options={categories}
              />
            </div>
            {hasBusiness ? (
              <SelectField
                name="scope"
                label={screens.entry.scope}
                defaultValue="household"
                options={scopeOptions}
              />
            ) : null}
            <TextAreaField name="note" label={screens.entry.note} rows={2} />
          </>
        </ActionForm>
      </Card>

      <Card>
        <Disclosure summary={screens.entry.incomeTitle}>
          <ActionForm
            action={recordIncomeAction}
            submitLabel={screens.entry.save}
            resetOnSuccess
          >
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <MoneyField name="amountMinor" label={screens.entry.amount} />
                <TextField
                  name="transactionDate"
                  label={screens.entry.date}
                  type="date"
                  defaultValue={today}
                />
              </div>
              <TextField name="merchant" label={screens.entry.from} maxLength={160} />
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField
                  name="accountId"
                  label={screens.entry.account}
                  options={accountOptions}
                />
                {hasBusiness ? (
                  <SelectField
                    name="scope"
                    label={screens.entry.scope}
                    defaultValue="household"
                    options={scopeOptions}
                  />
                ) : null}
              </div>
            </>
          </ActionForm>
        </Disclosure>
      </Card>

      <Card>
        <Disclosure summary={screens.entry.movementTitle}>
          <Notice tone="primary">{screens.entry.movementHint}</Notice>
          <div className="mt-4">
            <ActionForm
              action={recordMovementAction}
              submitLabel={screens.entry.save}
              resetOnSuccess
            >
              <>
                <SelectField
                  name="kind"
                  label={screens.entry.movementKind}
                  defaultValue="transfer"
                  options={[
                    { value: 'transfer', label: screens.entry.movementKinds['transfer'] ?? '' },
                    {
                      value: 'settlement',
                      label: screens.entry.movementKinds['settlement'] ?? '',
                    },
                  ]}
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <SelectField
                    name="accountId"
                    label={screens.entry.account}
                    options={accountOptions}
                  />
                  <SelectField
                    name="counterpartAccountId"
                    label={screens.entry.toAccount}
                    options={accountOptions}
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <MoneyField name="amountMinor" label={screens.entry.amount} />
                  <TextField
                    name="transactionDate"
                    label={screens.entry.date}
                    type="date"
                    defaultValue={today}
                  />
                </div>
              </>
            </ActionForm>
          </div>
        </Disclosure>
      </Card>

      <Card>
        <Disclosure summary={screens.entry.plannedTitle}>
          <p className="mb-3 text-small text-text-secondary">{screens.entry.plannedHint}</p>
          <ActionForm
            action={addPlannedItemAction}
            submitLabel={screens.entry.save}
            resetOnSuccess
          >
            <>
              <TextField name="label" label={screens.entry.label} maxLength={160} />
              <div className="grid gap-4 sm:grid-cols-2">
                <MoneyField name="amountMinor" label={screens.entry.amount} />
                <SelectField
                  name="direction"
                  label={screens.entry.direction}
                  defaultValue="outflow"
                  options={[
                    { value: 'outflow', label: screens.entry.directions['outflow'] ?? '' },
                    { value: 'inflow', label: screens.entry.directions['inflow'] ?? '' },
                  ]}
                />
              </div>
              <SelectField
                name="certainty"
                label={screens.entry.certainty}
                hint={screens.entry.certaintyHint}
                defaultValue="certain"
                options={[
                  { value: 'certain', label: screens.entry.certainties['certain'] ?? '' },
                  { value: 'probable', label: screens.entry.certainties['probable'] ?? '' },
                  { value: 'possible', label: screens.entry.certainties['possible'] ?? '' },
                ]}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  name="expectedDate"
                  label={screens.entry.expectedDate}
                  type="date"
                  defaultValue={today}
                />
                <TextField
                  name="dueDate"
                  label={screens.entry.dueDate}
                  type="date"
                  required={false}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField
                  name="categoryId"
                  label={screens.entry.category}
                  required={false}
                  emptyLabel={screens.entry.categoryNone}
                  options={categories}
                />
                {hasBusiness ? (
                  <SelectField
                    name="scope"
                    label={screens.entry.scope}
                    defaultValue="household"
                    options={scopeOptions}
                  />
                ) : null}
              </div>
              <CheckboxField
                name="essential"
                label={screens.entry.essential}
                hint={screens.entry.essentialHint}
              />
            </>
          </ActionForm>
        </Disclosure>
      </Card>

      {debts.length === 0 ? null : (
        <Card>
          <Disclosure summary={screens.entry.debtTitle}>
            <Notice tone="primary">{screens.entry.debtHint}</Notice>
            <div className="mt-4">
              <ActionForm
                action={recordDebtPaymentAction}
                submitLabel={screens.entry.save}
                resetOnSuccess
              >
                <>
                  <SelectField name="debtId" label={screens.entry.debtTitle} options={debts} />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <MoneyField name="principalMinor" label={screens.entry.principal} />
                    <MoneyField
                      name="interestMinor"
                      label={screens.entry.interest}
                      required={false}
                    />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <SelectField
                      name="accountId"
                      label={screens.entry.account}
                      required={false}
                      emptyLabel={screens.common.none}
                      options={householdAccountOptions}
                    />
                    <TextField
                      name="occurredOn"
                      label={screens.entry.date}
                      type="date"
                      defaultValue={today}
                    />
                  </div>
                </>
              </ActionForm>
            </div>
          </Disclosure>
        </Card>
      )}

      {/*
       * Two ways onward, as links rather than as buttons.
       *
       * They were filled buttons, which made three primary controls compete on
       * one screen — the expense form's save among them. A link says "elsewhere";
       * a filled button says "do this now", and only one thing on a screen may.
       */}
      <p className="flex flex-wrap gap-x-5 gap-y-1 px-1">
        <Link
          href="/upload"
          className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
        >
          {screens.upload.title}
        </Link>
        <Link
          href="/accounts"
          className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
        >
          {screens.accounts.title}
        </Link>
      </p>
    </AppShell>
  );
}
