import { setupStepKeys } from '@family-finance/contracts';

import {
  acknowledgePrivacyAction,
  addBusinessAction,
  addMemberAction,
  createHouseholdAction,
  declareNoBusinessAction,
  renameHouseholdAction,
} from '../../lib/actions/household';
import { AppShell } from '../../components/app-shell';
import { ActionForm, MoneyField, TextField } from '../../components/form';
import { Card, LinkButton, Meter, Notice, StatRow } from '../../components/ui';
import { screens } from '../../lib/copy/screens';
import { requireUnlocked } from '../../lib/auth/guard';
import { householdStore } from '../../lib/store/server';
import { SimpleAction } from '../../components/simple-action';
import { InviteForm } from '../../components/invite-form';

/**
 * First-time setup.
 *
 * Deliberately not a wizard. 03-UX-SPEC.md asks for save-and-continue, and the
 * reason is that a family setting this up at nine in the evening will be
 * interrupted — so every step stands alone, the order is a suggestion, and the
 * meter shows what is left rather than blocking on it.
 *
 * Nothing here asks for information the product does not use. Every field on this
 * page changes a number on another one.
 */

export const dynamic = 'force-dynamic';

export default async function SetupPage() {
  await requireUnlocked();
  const store = await householdStore();
  const document = await store.readDocumentOrNull();

  if (document === null) {
    return (
      <AppShell active="/more" title={screens.setup.title} subtitle={screens.setup.intro}>
        <Card>
          <ActionForm action={createHouseholdAction} submitLabel={screens.setup.create}>
            <>
              <TextField
                name="householdName"
                label={screens.setup.householdName}
                hint={screens.setup.householdNameHint}
                maxLength={120}
              />
              <TextField name="profileName" label={screens.setup.yourName} maxLength={80} />
            </>
          </ActionForm>
        </Card>

        <Card title={screens.setup.privacyTitle}>
          <p className="text-text-secondary">{screens.setup.privacyBody}</p>
        </Card>
      </AppShell>
    );
  }

  const done = setupStepKeys.filter((key) => document.setup[key]).length;
  const members = document.profiles;
  const business = document.businesses[0];

  return (
    <AppShell active="/more" title={screens.setup.title} subtitle={screens.setup.intro}>
      <Card>
        <Meter
          label={screens.setup.progressTitle}
          done={done}
          total={setupStepKeys.length}
          caption={screens.setup.progress(done, setupStepKeys.length)}
        />
        <ul className="mt-4 grid gap-1.5 sm:grid-cols-2">
          {setupStepKeys.map((key) => (
            <li key={key} className="flex items-baseline justify-between gap-3 py-1">
              <span className={document.setup[key] ? 'text-text-secondary' : 'font-medium'}>
                {screens.setup.steps[key]}
              </span>
              <span
                className={`text-small ${document.setup[key] ? 'text-success' : 'text-text-secondary'}`}
              >
                {document.setup[key] ? screens.setup.stepDone : screens.setup.stepOpen}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title={screens.setup.householdName}>
        <ActionForm action={renameHouseholdAction} submitLabel={screens.common.confirm}>
          <TextField
            name="name"
            label={screens.setup.householdName}
            defaultValue={document.household.name}
            maxLength={120}
          />
        </ActionForm>
      </Card>

      <Card title={screens.setup.members} subtitle={screens.setup.membersHint}>
        {members.map((profile) => (
          <StatRow key={profile.id} label={profile.displayName} value="" />
        ))}
        <div className="mt-4">
          {store.backend === 'supabase' ? (
            // A member is a real signed-in person here, so joining is by
            // invitation rather than by typing a name (ADR-0032).
            <InviteForm />
          ) : (
            <ActionForm
              action={addMemberAction}
              submitLabel={screens.setup.addMember}
              resetOnSuccess
              tone="secondary"
            >
              <TextField name="displayName" label={screens.setup.memberName} maxLength={80} />
            </ActionForm>
          )}
        </div>
      </Card>

      <Card title={screens.accounts.title} subtitle={screens.accounts.emptyHint}>
        {document.accounts.length === 0 ? (
          <p className="text-text-secondary">{screens.accounts.empty}</p>
        ) : (
          document.accounts.map((account) => (
            <StatRow
              key={account.id}
              label={account.name}
              value={screens.accounts.kinds[account.kind] ?? account.kind}
            />
          ))
        )}
        <div className="mt-4">
          <LinkButton href="/accounts" tone="secondary">
            {screens.accounts.add}
          </LinkButton>
        </div>
      </Card>

      <Card title={screens.setup.businessTitle} subtitle={screens.setup.businessHint}>
        {business !== undefined ? (
          <>
            <StatRow label={business.name} value={screens.accounts.scopes['business'] ?? ''} />
            <p className="mt-3 text-small text-text-secondary">
              {screens.setup.businessTaxRateHint}
            </p>
          </>
        ) : document.setup.businessDecided ? (
          <p className="text-text-secondary">{screens.setup.noBusinessDone}</p>
        ) : (
          <div className="flex flex-col gap-5">
            <ActionForm action={addBusinessAction} submitLabel={screens.setup.addBusiness}>
              <>
                <TextField name="name" label={screens.setup.businessName} maxLength={120} />
                <TextField
                  name="taxReserveRatePercent"
                  label={screens.setup.businessTaxRate}
                  hint={screens.setup.businessTaxRateHint}
                  inputMode="decimal"
                  defaultValue="25"
                />
                <MoneyField
                  name="operatingReserveMinor"
                  label={screens.setup.businessReserve}
                  hint={screens.setup.businessReserveHint}
                  required={false}
                />
              </>
            </ActionForm>

            <SimpleAction action={declareNoBusinessAction} label={screens.setup.noBusiness} />
          </div>
        )}
      </Card>

      <Card title={screens.setup.privacyTitle}>
        <p className="text-text-secondary">{screens.setup.privacyBody}</p>
        {document.setup.privacyExplained ? null : (
          <div className="mt-4">
            <SimpleAction action={acknowledgePrivacyAction} label={screens.setup.privacyAck} />
          </div>
        )}
      </Card>

      <Notice tone="primary">
        <p>{screens.setup.finish}</p>
        <div className="mt-3">
          <LinkButton href="/">{screens.setup.finish}</LinkButton>
        </div>
      </Notice>
    </AppShell>
  );
}
