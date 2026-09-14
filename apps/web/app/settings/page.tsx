import { updateSettingsAction } from '../../lib/actions/household';
import { AppShell } from '../../components/app-shell';
import { ActionForm, CheckboxField, MoneyField, TextField } from '../../components/form';
import { NoHousehold } from '../../components/screen';
import { Card, Notice } from '../../components/ui';
import { screens } from '../../lib/copy/screens';
import { toAmountInput } from '../../lib/format';
import { loadDashboardView } from '../../lib/dashboard/load';
import { accountScreen } from '../../lib/copy/security';
import { dataDirectory } from '../../lib/store/server';

/**
 * The few decisions that change how every other number is read.
 *
 * Everything on this page feeds a formula. `monthStartDay` decides what "this
 * month" means; the three reserve components decide the floor under safe spend
 * (02-FINANCIAL-RULES.md § רזרבה מינימלית, which forbids "three to six months" as
 * a first rule and takes the highest of four named components instead).
 *
 * There are no cosmetic preferences here. A setting that changes nothing is a
 * question asked of a family for no reason.
 */

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const view = await loadDashboardView();

  if (view.document === null) {
    return (
      <NoHousehold
        active="/more"
        title={screens.settings.title}
        reason={view.descriptor.reason}
      />
    );
  }

  const { settings } = view.document;

  return (
    <AppShell
      active="/more"
      title={screens.settings.title}
      subtitle={screens.settings.subtitle}
    >
      <Card>
        <ActionForm action={updateSettingsAction} submitLabel={screens.settings.save}>
          <>
            <TextField
              name="monthStartDay"
              label={screens.settings.monthStart}
              hint={screens.settings.monthStartHint}
              type="number"
              inputMode="numeric"
              defaultValue={String(settings.monthStartDay)}
            />

            <div className="mt-2 border-t border-border pt-4">
              <p className="font-semibold">{screens.settings.reserveTitle}</p>
              <p className="mt-1 mb-4 text-small text-text-secondary">
                {screens.settings.reserveHint}
              </p>

              <div className="flex flex-col gap-4">
                <MoneyField
                  name="manualReserveFloorMinor"
                  label={screens.settings.manualFloor}
                  required={false}
                  defaultValue={toAmountInput(settings.manualReserveFloorMinor)}
                />
                <MoneyField
                  name="incidentBufferMinor"
                  label={screens.settings.incidentBuffer}
                  hint={screens.settings.incidentBufferHint}
                  required={false}
                  defaultValue={toAmountInput(settings.incidentBufferMinor)}
                />
                <MoneyField
                  name="revolvingAvoidanceMinor"
                  label={screens.settings.revolvingAvoidance}
                  required={false}
                  defaultValue={toAmountInput(settings.revolvingAvoidanceMinor)}
                />
                <MoneyField
                  name="protectedReservesMinor"
                  label={screens.settings.protectedReserves}
                  hint={screens.settings.protectedReservesHint}
                  required={false}
                  defaultValue={toAmountInput(settings.protectedReservesMinor)}
                />
              </div>
            </div>

            <div className="mt-2 border-t border-border pt-4">
              <p className="font-semibold">{screens.settings.notificationsTitle}</p>
              <p className="mt-1 mb-3 text-small text-text-secondary">
                {screens.settings.notificationsHint}
              </p>
              <CheckboxField
                name="weeklyFoodGuidance"
                label={screens.settings.weeklyFood}
                defaultChecked={settings.notifications.weeklyFoodGuidance}
              />
              <CheckboxField
                name="balanceFreshnessReminder"
                label={screens.settings.freshnessReminder}
                defaultChecked={settings.notifications.balanceFreshnessReminder}
              />
            </div>
          </>
        </ActionForm>
      </Card>

      <Card title={screens.settings.dataTitle}>
        <p className="text-text-secondary">{screens.settings.dataLocationHint}</p>
        <p className="mt-2 rounded-control bg-surface-muted p-3 text-small">
          <bdi dir="ltr">{dataDirectory() ?? accountScreen.storedInDatabase}</bdi>
        </p>
        <div className="mt-4">
          <Notice tone="primary">{screens.setup.privacyBody}</Notice>
        </div>
      </Card>
    </AppShell>
  );
}
