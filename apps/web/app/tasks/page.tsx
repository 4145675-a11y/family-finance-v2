import { addTaskAction, updateTaskAction } from '../../lib/actions/entries';
import { AppShell } from '../../components/app-shell';
import {
  ActionForm,
  HiddenValue,
  MoneyField,
  SelectField,
  TextAreaField,
  TextField,
} from '../../components/form';
import { NoHousehold, StatusChips } from '../../components/screen';
import { Badge, Card, EmptyPrompt, Money, SectionTitle, StatRow } from '../../components/ui';
import { screens } from '../../lib/copy/screens';
import { loadDashboardView } from '../../lib/dashboard/load';
import { formatBusinessDate } from '../../lib/format';

/**
 * The family's action list.
 *
 * Deliberately small. 01-PRODUCT-SPEC.md asks for one practical action, not a
 * task manager, so this has a title, a reason, a person, a date and a state —
 * and nothing else. No priorities, no projects, no tags: every one of those would
 * start competing with the financial screens for attention, which is the opposite
 * of what a family under pressure needs.
 *
 * Completing a task changes nothing financial. That separation is the point: the
 * money moves when the money moves, and a checkbox is a note to each other.
 */

export const dynamic = 'force-dynamic';

export default async function TasksPage() {
  const view = await loadDashboardView();

  if (view.document === null || view.snapshot === null) {
    return (
      <NoHousehold
        active="/tasks"
        title={screens.tasks.title}
        reason={view.descriptor.reason}
      />
    );
  }

  const { document, snapshot } = view;

  const open = document.tasks.filter((task) => task.status === 'open');
  const finished = document.tasks.filter((task) => task.status !== 'open');

  const members = document.profiles.map((profile) => ({
    value: profile.id,
    label: profile.displayName,
  }));
  const debts = document.debts
    .filter((debt) => debt.status === 'active')
    .map((debt) => ({ value: debt.id, label: debt.creditorName }));

  const memberName = (memberId: string | null): string =>
    memberId === null
      ? screens.tasks.whoNobody
      : (members.find((member) => member.value === memberId)?.label ?? screens.tasks.whoNobody);

  return (
    <AppShell
      source={view.descriptor}
      active="/tasks"
      title={screens.tasks.title}
      subtitle={screens.tasks.subtitle}
      status={<StatusChips snapshot={snapshot} />}
    >
      {open.length === 0 ? (
        <EmptyPrompt title={screens.tasks.empty} body={screens.tasks.emptyHint} />
      ) : (
        open.map((task) => (
          <Card key={task.id} title={task.title}>
            {task.reason === null ? null : <p className="text-text-secondary">{task.reason}</p>}
            <div className="mt-2 flex flex-wrap gap-2">
              {task.origin === 'recommendation' ? (
                <Badge tone="primary">{screens.tasks.fromRecommendation}</Badge>
              ) : null}
              <Badge>{memberName(task.assignedMemberId)}</Badge>
              {task.dueOn === null ? null : (
                <Badge tone="attention">{formatBusinessDate(task.dueOn)}</Badge>
              )}
            </div>

            {task.amountMinor === null ? null : (
              <div className="mt-3">
                <StatRow
                  label={screens.tasks.amount}
                  value={<Money amountMinor={task.amountMinor} currency={snapshot.currency} />}
                />
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-3">
              <ActionForm action={updateTaskAction} submitLabel={screens.tasks.markDone}>
                <>
                  <HiddenValue name="taskId" value={task.id} />
                  <HiddenValue name="status" value="done" />
                </>
              </ActionForm>
              <ActionForm
                action={updateTaskAction}
                submitLabel={screens.tasks.dismiss}
                tone="secondary"
              >
                <>
                  <HiddenValue name="taskId" value={task.id} />
                  <HiddenValue name="status" value="dismissed" />
                </>
              </ActionForm>
            </div>
          </Card>
        ))
      )}

      <SectionTitle>{screens.tasks.add}</SectionTitle>
      <Card>
        <ActionForm action={addTaskAction} submitLabel={screens.tasks.add} resetOnSuccess>
          <>
            <TextField name="title" label={screens.tasks.what} maxLength={160} />
            <TextAreaField name="reason" label={screens.tasks.why} rows={2} />
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                name="assignedMemberId"
                label={screens.tasks.who}
                required={false}
                emptyLabel={screens.tasks.whoNobody}
                options={members}
              />
              <TextField name="dueOn" label={screens.tasks.due} type="date" required={false} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <MoneyField name="amountMinor" label={screens.tasks.amount} required={false} />
              {debts.length === 0 ? null : (
                <SelectField
                  name="relatedDebtId"
                  label={screens.tasks.relatedDebt}
                  required={false}
                  emptyLabel={screens.common.none}
                  options={debts}
                />
              )}
            </div>
          </>
        </ActionForm>
      </Card>

      {finished.length === 0 ? null : (
        <Card title={screens.tasks.done}>
          {finished.map((task) => (
            <StatRow
              key={task.id}
              label={task.title}
              value={
                <Badge tone={task.status === 'done' ? 'success' : 'neutral'}>
                  {task.status === 'done' ? screens.tasks.done : screens.tasks.dismissed}
                </Badge>
              }
              hint={
                task.completedAt === null
                  ? undefined
                  : formatBusinessDate(task.completedAt.slice(0, 10))
              }
            />
          ))}
        </Card>
      )}
    </AppShell>
  );
}
