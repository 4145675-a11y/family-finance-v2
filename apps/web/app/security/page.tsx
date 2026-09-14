import { AppShell } from '../../components/app-shell';
import { ActionForm, CheckboxField, HiddenValue, TextField } from '../../components/form';
import { PasskeyEnrol, ReauthenticateButton } from '../../components/passkey';
import { Card, DataTable, Disclosure, Notice, StatRow } from '../../components/ui';
import {
  removePasskeyAction,
  turnOffLockAction,
  updateLockSettingsAction,
} from '../../lib/actions/passkeys';
import { configuredAuthOrigin } from '../../lib/auth/origin';
import { sessionContext } from '../../lib/auth/session';
import { authFilePath } from '../../lib/auth/store';
import { authScreen } from '../../lib/copy/security';
import { screens } from '../../lib/copy/screens';
import { formatDateTime } from '../../lib/format';

/**
 * Setting up and living with the lock.
 *
 * The page is organised around the two questions a person actually has — "is
 * this on?" and "what happens if I lose the laptop?" — and it answers the second
 * one before offering to turn the first one on. A security feature whose
 * recovery story is discovered later is a security feature that eventually locks
 * a family out of their own money.
 *
 * Everything destructive here needs Windows Hello again, and the page shows the
 * re-authentication prompt in place of the controls rather than letting a person
 * fill a form in and be refused at the end of it.
 */

export const dynamic = 'force-dynamic';

export default async function SecurityPage() {
  const context = await sessionContext();
  const origin = configuredAuthOrigin();
  const state = context.state;

  const passkeys = state.credentials;
  const recentLog = [...state.log].reverse().slice(0, 20);

  /* Enrolling the first passkey is open; everything else on this page needs a
     fresh Windows Hello. When the lock is on and the check is stale, the
     controls are replaced by the prompt rather than shown and then refused. */
  const managing = passkeys.length === 0 || context.recentlyVerified;

  return (
    <AppShell active="/more" title={authScreen.title}>
      {origin.usable ? null : (
        <Notice tone="danger" title={authScreen.originTitle}>
          <p>{authScreen.originExplain}</p>
        </Notice>
      )}

      {origin.usable && !context.atAuthOrigin ? (
        <Notice tone="attention" title={authScreen.originTitle}>
          <p>{authScreen.originExplain}</p>
          <p className="mt-2">{authScreen.originFix(origin.origin)}</p>
          <p className="mt-2 text-small">{authScreen.originSameMachine}</p>
        </Notice>
      ) : null}

      <Card title={authScreen.setupTitle}>
        {passkeys.length === 0 ? (
          <p className="mb-4 text-text-secondary">{authScreen.setupIntro}</p>
        ) : null}
        <h3 className="font-semibold">{authScreen.setupExplainTitle}</h3>
        <ul className="mt-2 flex list-disc flex-col gap-2 pe-5 text-text-secondary">
          {authScreen.setupExplain.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="mt-4 font-medium">{authScreen.biometricNever}</p>

        {context.atAuthOrigin ? (
          <div className="mt-6 border-t border-border pt-5">
            {managing ? (
              <PasskeyEnrol
                label={passkeys.length === 0 ? authScreen.enrol : authScreen.addAnother}
              />
            ) : (
              <ReauthenticateButton actionKey="passkey_add" />
            )}
            {passkeys.length > 0 ? (
              <p className="mt-3 text-small text-text-secondary">{authScreen.addAnotherNote}</p>
            ) : null}
          </div>
        ) : null}
      </Card>

      {passkeys.length === 0 ? null : (
        <Card title={authScreen.passkeysTitle}>
          <DataTable
            caption={authScreen.passkeysTitle}
            columns={['שם', authScreen.passkeyAdded, authScreen.passkeyLastUsed, 'איפה נשמר']}
            rows={passkeys.map((passkey) => ({
              key: passkey.credentialId,
              cells: [
                <span key="label">{passkey.label}</span>,
                <span key="added">{formatDateTime(passkey.createdAt)}</span>,
                <span key="used">
                  {passkey.lastUsedAt === null
                    ? authScreen.passkeyNeverUsed
                    : formatDateTime(passkey.lastUsedAt)}
                </span>,
                <span key="where">
                  {passkey.backedUp ? authScreen.passkeySynced : authScreen.passkeyThisDevice}
                </span>,
              ],
            }))}
          />

          {!managing ? (
            <div className="mt-5 border-t border-border pt-5">
              <ReauthenticateButton actionKey="passkey_remove" />
            </div>
          ) : passkeys.length > 1 ? (
            <div className="mt-5 border-t border-border pt-5">
              {passkeys.map((passkey) => (
                <div key={passkey.credentialId} className="mb-4">
                  <ActionForm
                    action={removePasskeyAction}
                    submitLabel={`${authScreen.remove}: ${passkey.label}`}
                    tone="secondary"
                  >
                    <HiddenValue name="credentialId" value={passkey.credentialId} />
                  </ActionForm>
                </div>
              ))}
            </div>
          ) : null}
        </Card>
      )}

      {passkeys.length === 0 ? null : (
        <Card title={authScreen.settingsTitle}>
          {managing ? (
            <ActionForm action={updateLockSettingsAction} submitLabel={screens.entry.save}>
              <TextField
                name="idleTimeoutMinutes"
                label={authScreen.idleLabel}
                hint={authScreen.idleHint}
                inputMode="numeric"
                defaultValue={String(state.idleTimeoutMinutes)}
              />
            </ActionForm>
          ) : (
            <ReauthenticateButton actionKey="lock_settings" />
          )}
        </Card>
      )}

      <Card title={authScreen.recoveryTitle}>
        <ul className="flex list-disc flex-col gap-2 pe-5 text-text-secondary">
          {authScreen.recovery.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="mt-4">{authScreen.recoveryHonest}</p>
      </Card>

      <Card title={authScreen.protectsTitle}>
        <ul className="flex list-disc flex-col gap-2 pe-5 text-text-secondary">
          {authScreen.protects.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>

        <h3 className="mt-5 font-semibold">{authScreen.notProtectsTitle}</h3>
        <ul className="mt-2 flex list-disc flex-col gap-2 pe-5 text-text-secondary">
          {authScreen.notProtects.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>

        <Disclosure summary={authScreen.storedTitle}>
          <ul className="flex list-disc flex-col gap-2 pe-5 text-text-secondary">
            {authScreen.stored.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <StatRow label="הכתובת הנתמכת" value={<span>{origin.origin}</span>} />
          <StatRow label="מזהה האתר (RP ID)" value={<span>{origin.rpId}</span>} />
          <StatRow label="קובץ הכניסה" value={<span>{authFilePath()}</span>} />
        </Disclosure>
      </Card>

      {passkeys.length === 0 ? null : (
        <Card title={authScreen.lockOffTitle} tone="attention">
          <p className="text-text-secondary">{authScreen.lockOffExplain}</p>
          {managing ? (
            <div className="mt-4">
              <ActionForm action={turnOffLockAction} submitLabel={authScreen.lockOffConfirm}>
                <CheckboxField name="confirm" label={authScreen.lockOffExplain} />
              </ActionForm>
            </div>
          ) : (
            <div className="mt-4">
              <ReauthenticateButton actionKey="lock_off" />
            </div>
          )}
        </Card>
      )}

      <Card title={authScreen.logTitle}>
        {recentLog.length === 0 ? (
          <p className="text-text-secondary">{authScreen.logEmpty}</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {recentLog.map((entry) => (
              <li key={entry.id} className="border-b border-border pb-3 last:border-b-0">
                <p className="font-medium">
                  {authScreen.logEvents[entry.event] ?? entry.event}
                </p>
                <p className="mt-1 text-small text-text-secondary">
                  {formatDateTime(entry.at)}
                  {entry.reason === null ? '' : ` · ${entry.reason}`}
                </p>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </AppShell>
  );
}
