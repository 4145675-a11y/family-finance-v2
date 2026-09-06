import { balanceOf } from '@family-finance/local-store';

import {
  acceptGapAction,
  closeAccountAction,
  recordBalanceAction,
} from '../../lib/actions/entries';
import { addAccountAction } from '../../lib/actions/household';
import { AppShell } from '../../components/app-shell';
import {
  ActionForm,
  HiddenValue,
  MoneyField,
  SelectField,
  TextField,
} from '../../components/form';
import { NoHousehold, StatusChips } from '../../components/screen';
import { Card, Disclosure, Money, Notice, SectionTitle, StatRow } from '../../components/ui';
import { copy } from '../../lib/copy/copy';
import { screens } from '../../lib/copy/screens';
import { loadDashboardView } from '../../lib/dashboard/load';
import { todayInJerusalem } from '../../lib/forms';
import { toAmountInput } from '../../lib/format';

/**
 * Accounts, balances and reconciliation.
 *
 * The screen exists for one job that nothing else can do: getting a confirmed
 * balance in. Everything the dashboard says about freshness, and half of what it
 * says about safety, rests on somebody having opened their bank app and copied a
 * number here. So the balance form is not buried in a settings page — it is on
 * every account row, and it takes three fields.
 *
 * When the copied number disagrees with our arithmetic, the difference is shown
 * with both figures and left for the family to close deliberately. It is never
 * absorbed (05-ARCHITECTURE-DATA.md § Reconciliation).
 */

export const dynamic = 'force-dynamic';

export default async function AccountsPage() {
  const view = await loadDashboardView();

  if (view.document === null || view.snapshot === null) {
    return (
      <NoHousehold
        active="/accounts"
        title={screens.accounts.title}
        reason={view.descriptor.reason}
      />
    );
  }

  const { document, snapshot } = view;
  const today = todayInJerusalem();
  const hasBusiness = document.businesses.length > 0;

  const open = document.accounts.filter((account) => account.closedAt === null);
  const closed = document.accounts.filter((account) => account.closedAt !== null);

  return (
    <AppShell
      source={view.descriptor}
      active="/accounts"
      title={screens.accounts.title}
      subtitle={screens.accounts.subtitle}
      status={<StatusChips snapshot={snapshot} />}
    >
      {open.length === 0 ? (
        <Notice tone="primary" title={screens.accounts.empty}>
          {screens.accounts.emptyHint}
        </Notice>
      ) : (
        open.map((account) => {
          const balance = balanceOf(document, account.id);
          const gap = Math.abs(balance.reconciliationGapMinor);

          return (
            <Card
              key={account.id}
              title={account.name}
              subtitle={[
                screens.accounts.kinds[account.kind],
                screens.accounts.scopes[account.scope],
                account.institution,
                account.displaySuffix === null ? null : `••••${account.displaySuffix}`,
              ]
                .filter((part): part is string => part !== null && part !== undefined)
                .join(' · ')}
            >
              <StatRow
                label={screens.accounts.balanceNow}
                value={
                  <Money
                    amountMinor={balance.computedMinor}
                    currency={snapshot.currency}
                    signed
                  />
                }
              />
              <StatRow
                label={screens.accounts.confirmed}
                value={
                  balance.verifiedMinor === null ? (
                    <span className="text-text-secondary">
                      {screens.accounts.neverConfirmed}
                    </span>
                  ) : (
                    <Money
                      amountMinor={balance.verifiedMinor}
                      currency={snapshot.currency}
                      signed
                    />
                  )
                }
                hint={
                  balance.verifiedAt === null
                    ? undefined
                    : screens.accounts.confirmedOn(balance.verifiedAt.slice(0, 10))
                }
              />

              {gap > 0 ? (
                <div className="mt-3">
                  <Notice tone="attention" title={screens.accounts.gapTitle}>
                    <p>{screens.accounts.gapExplain(gap)}</p>
                    <p className="mt-1.5">{screens.accounts.gapWhat}</p>
                    <div className="mt-3">
                      <ActionForm
                        action={acceptGapAction}
                        submitLabel={screens.accounts.gapAccept}
                        tone="secondary"
                      >
                        <>
                          <HiddenValue name="accountId" value={account.id} />
                          <HiddenValue name="differenceMinor" value={toAmountInput(gap)} />
                          <HiddenValue
                            name="direction"
                            value={balance.reconciliationGapMinor > 0 ? 'outflow' : 'inflow'}
                          />
                          <HiddenValue name="asOfDate" value={today} />
                          <p className="text-small text-text-secondary">
                            {screens.accounts.gapAcceptNote}
                          </p>
                        </>
                      </ActionForm>
                    </div>
                  </Notice>
                </div>
              ) : null}

              <Disclosure summary={screens.accounts.updateBalance} tone="action">
                <p className="mb-3 text-small text-text-secondary">
                  {screens.accounts.updateBalanceHint}
                </p>
                <ActionForm
                  action={recordBalanceAction}
                  submitLabel={screens.accounts.saveBalance}
                >
                  <>
                    <HiddenValue name="accountId" value={account.id} />
                    <MoneyField name="balanceMinor" label={screens.accounts.balanceValue} />
                    <SelectField
                      name="balanceDirection"
                      label={screens.accounts.openingDirection}
                      defaultValue={account.kind === 'credit_card' ? 'outflow' : 'inflow'}
                      options={[
                        { value: 'inflow', label: screens.accounts.directionHave },
                        { value: 'outflow', label: screens.accounts.directionOwe },
                      ]}
                    />
                    <TextField
                      name="verifiedOn"
                      label={screens.accounts.balanceDate}
                      type="date"
                      defaultValue={today}
                    />
                    <TextField
                      name="note"
                      label={screens.accounts.balanceNote}
                      required={false}
                      maxLength={280}
                    />
                  </>
                </ActionForm>
              </Disclosure>

              <Disclosure summary={screens.accounts.close}>
                <p className="mb-3 text-small text-text-secondary">
                  {screens.accounts.closeHint}
                </p>
                <ActionForm
                  action={closeAccountAction}
                  submitLabel={screens.accounts.close}
                  tone="danger"
                >
                  <HiddenValue name="accountId" value={account.id} />
                </ActionForm>
              </Disclosure>
            </Card>
          );
        })
      )}

      <SectionTitle>{screens.accounts.add}</SectionTitle>
      <Card>
        <ActionForm action={addAccountAction} submitLabel={screens.accounts.add} resetOnSuccess>
          <>
            <TextField
              name="name"
              label={screens.accounts.name}
              hint={screens.accounts.nameHint}
              maxLength={120}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                name="kind"
                label={screens.accounts.kind}
                defaultValue="bank_account"
                options={[
                  {
                    value: 'bank_account',
                    label: screens.accounts.kinds['bank_account'] ?? '',
                  },
                  { value: 'credit_card', label: screens.accounts.kinds['credit_card'] ?? '' },
                  { value: 'cash_wallet', label: screens.accounts.kinds['cash_wallet'] ?? '' },
                  { value: 'other', label: screens.accounts.kinds['other'] ?? '' },
                ]}
              />
              <SelectField
                name="scope"
                label={screens.accounts.scope}
                defaultValue="household"
                options={
                  hasBusiness
                    ? [
                        {
                          value: 'household',
                          label: screens.accounts.scopes['household'] ?? '',
                        },
                        { value: 'business', label: screens.accounts.scopes['business'] ?? '' },
                      ]
                    : [
                        {
                          value: 'household',
                          label: screens.accounts.scopes['household'] ?? '',
                        },
                      ]
                }
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                name="institution"
                label={screens.accounts.institution}
                required={false}
                maxLength={120}
              />
              <TextField
                name="displaySuffix"
                label={screens.accounts.suffix}
                hint={screens.accounts.suffixHint}
                required={false}
                inputMode="numeric"
                maxLength={4}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <MoneyField name="openingBalanceMinor" label={screens.accounts.opening} />
              <SelectField
                name="openingBalanceDirection"
                label={screens.accounts.openingDirection}
                defaultValue="inflow"
                options={[
                  { value: 'inflow', label: screens.accounts.directionHave },
                  { value: 'outflow', label: screens.accounts.directionOwe },
                ]}
              />
            </div>
            <TextField
              name="openingBalanceDate"
              label={screens.accounts.openingDate}
              type="date"
              defaultValue={today}
            />
          </>
        </ActionForm>
      </Card>

      {closed.length === 0 ? null : (
        <Card title={screens.accounts.closed}>
          {closed.map((account) => (
            <StatRow
              key={account.id}
              label={account.name}
              value={
                <Money
                  amountMinor={balanceOf(document, account.id).computedMinor}
                  currency={snapshot.currency}
                  signed
                />
              }
            />
          ))}
        </Card>
      )}

      <p className="px-1 text-small text-text-secondary">{copy.sections.allAccounts}</p>
    </AppShell>
  );
}
