import { BUDGET_CATEGORY_KEYS } from '@family-finance/contracts';

import { AppShell } from '../../components/app-shell';
import { ActionForm, HiddenValue, SelectField, TextField } from '../../components/form';
import {
  Badge,
  Card,
  Disclosure,
  EmptyState,
  SectionTitle,
  StatRow,
} from '../../components/ui';
import { deleteRuleAction, toggleRuleAction, updateRuleAction } from '../../lib/actions/rules';
import { loadDashboardView } from '../../lib/dashboard/load';
import { CATEGORY_LABEL, CLASS_LABEL } from '../../lib/copy/classification';
import { formatBusinessDate } from '../../lib/format';

/**
 * The rules this household has made about its own statements.
 *
 * The screen exists because a classification a family cannot see is a
 * classification they cannot argue with. Every rule here was created by one of
 * them correcting a row and choosing to remember it; every one can be renamed,
 * re-pointed, switched off or deleted from this page.
 *
 * Switching off is offered beside deleting on purpose. A rule that looks wrong is
 * usually worth testing rather than destroying: turn it off, run the import
 * again, see what changes, turn it back on.
 */

export const dynamic = 'force-dynamic';

export default async function RulesPage() {
  const view = await loadDashboardView();
  const document = view.document;

  if (document === null) {
    return (
      <AppShell source={view.descriptor} active="/more" title="כללים">
        <EmptyState reason={view.descriptor.reason} />
      </AppShell>
    );
  }

  const rules = [...document.learnedRules].sort((a, b) =>
    a.createdAt === b.createdAt
      ? a.label.localeCompare(b.label, 'he')
      : a.createdAt < b.createdAt
        ? 1
        : -1,
  );
  const active = rules.filter((rule) => rule.enabled).length;

  const classOptions = Object.entries(CLASS_LABEL).map(([value, label]) => ({ value, label }));
  const categoryOptions = BUDGET_CATEGORY_KEYS.map((key) => ({
    value: key,
    label: CATEGORY_LABEL[key] ?? key,
  }));

  return (
    <AppShell
      source={view.descriptor}
      active="/more"
      title="כללים"
      subtitle="מה שאמרתם לנו על השורות בדף החשבון שלכם"
    >
      <Card title="מה זה">
        <p className="text-text-secondary">
          כשאתם מתקנים שורה ביבוא, אפשר לבקש שנזכור את התיקון. הכלל שנשמר חל רק על משק הבית הזה,
          ורק על שורות שמתאימות למה שכתוב בו. גם כשכלל מזהה שורה — השורה עדיין עוברת אישור, ושום
          יתרה לא זזה בלי שתאשרו.
        </p>
      </Card>

      {rules.length === 0 ? (
        <Card title="עוד אין כללים" tone="neutral">
          <p className="text-text-secondary">
            אחרי שתתקנו שורה ביבוא ותבקשו לזכור, הכלל יופיע כאן.
          </p>
        </Card>
      ) : (
        <>
          <Card title="סך הכול" tone="primary">
            <StatRow label="כללים" value={String(rules.length)} hint={`${active} פעילים`} />
          </Card>

          <SectionTitle>הכללים שלכם</SectionTitle>

          {rules.map((rule) => (
            <Card
              key={rule.id}
              title={rule.label}
              tone={rule.enabled ? 'neutral' : 'attention'}
            >
              <div className="mb-3 flex flex-wrap gap-2">
                <Badge tone={rule.enabled ? 'success' : 'neutral'}>
                  {rule.enabled ? 'פעיל' : 'כבוי'}
                </Badge>
                <Badge tone="neutral">{CLASS_LABEL[rule.class]}</Badge>
              </div>

              <StatRow label="חל על שורות שמכילות" value={rule.matcher.descriptionContains} />
              <StatRow
                label="כיוון"
                value={
                  rule.matcher.direction === null
                    ? 'שני הכיוונים'
                    : rule.matcher.direction === 'outflow'
                      ? 'כסף שיוצא'
                      : 'כסף שנכנס'
                }
              />
              {rule.budgetCategoryKey === null ? null : (
                <StatRow
                  label="קטגוריה"
                  value={CATEGORY_LABEL[rule.budgetCategoryKey] ?? rule.budgetCategoryKey}
                />
              )}
              {rule.counterparty === null ? null : (
                <StatRow label="למי" value={rule.counterparty} />
              )}
              <StatRow
                label="הופעל"
                value={`${rule.timesApplied} פעמים`}
                hint={`נשמר ב־${formatBusinessDate(rule.createdAt.slice(0, 10))}`}
              />

              <div className="mt-3 flex flex-wrap gap-3">
                <ActionForm
                  action={toggleRuleAction}
                  submitLabel={rule.enabled ? 'לכבות' : 'להפעיל'}
                >
                  <>
                    <HiddenValue name="ruleId" value={rule.id} />
                    <HiddenValue name="enabled" value={rule.enabled ? '' : 'on'} />
                  </>
                </ActionForm>
              </div>

              <Disclosure summary="לשנות את הכלל">
                <ActionForm action={updateRuleAction} submitLabel="לשמור">
                  <>
                    <HiddenValue name="ruleId" value={rule.id} />
                    <TextField name="label" label="שם הכלל" defaultValue={rule.label} />
                    <SelectField
                      name="class"
                      label="סוג"
                      defaultValue={rule.class}
                      emptyLabel=""
                      required
                      options={classOptions}
                    />
                    <SelectField
                      name="budgetCategoryKey"
                      label="קטגוריה"
                      defaultValue={rule.budgetCategoryKey ?? ''}
                      emptyLabel="בלי קטגוריה"
                      required={false}
                      options={categoryOptions}
                    />
                    <TextField
                      name="counterparty"
                      label="למי"
                      defaultValue={rule.counterparty ?? ''}
                      required={false}
                    />
                  </>
                </ActionForm>
              </Disclosure>

              <Disclosure summary="למחוק את הכלל">
                <p className="mb-3 text-text-secondary">
                  מחיקה אינה משנה שום שורה שכבר יובאה. היא רק אומרת שלא נזהה כך בפעם הבאה.
                </p>
                <ActionForm action={deleteRuleAction} submitLabel="למחוק" tone="danger">
                  <HiddenValue name="ruleId" value={rule.id} />
                </ActionForm>
              </Disclosure>
            </Card>
          ))}
        </>
      )}
    </AppShell>
  );
}
