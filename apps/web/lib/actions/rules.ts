'use server';

import { BUDGET_CATEGORY_KEYS, transactionClassSchema } from '@family-finance/contracts';
import {
  addLearnedRule,
  deleteLearnedRule,
  updateLearnedRule,
} from '@family-finance/local-store';
import { ruleFromCorrection } from '@family-finance/transaction-intelligence';
import { revalidatePath } from 'next/cache';

import { FieldReader, failed, succeeded, type FormState } from '../forms';
import { householdStore } from '../store/server';
import { describe, refreshImportScreens } from './errors';

/**
 * The rules a household keeps about its own statements.
 *
 * Every one of these is something a person asked for. Nothing here runs as a
 * side effect of an import: a correction offers to become a rule, and only a
 * press on that offer creates one. A family that cannot explain why a row was
 * classified the way it was has been failed by the product, and rules nobody
 * chose are the fastest way to get there.
 */

const CLASS_VALUES = transactionClassSchema.options;

function refreshRules(): void {
  revalidatePath('/rules');
}

/**
 * Saves a rule from a row the family just corrected.
 *
 * The matcher is built from the durable words of the description, not the whole
 * line: next month's row carries a different reference, and a rule matching the
 * whole line would match once and never again.
 */
export async function saveRuleFromCorrectionAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const reader = new FieldReader(data);
  const description = reader.text('description', 'תיאור השורה', { max: 300 });
  const direction = reader.choice(
    'direction',
    'כיוון',
    ['inflow', 'outflow'] as const,
    'outflow',
  );
  const klass = reader.choice('class', 'סוג', CLASS_VALUES, 'purchase');
  const categoryKey = reader.optionalChoice('budgetCategoryKey', BUDGET_CATEGORY_KEYS);
  const counterparty = reader.optionalText('counterparty', 'למי');
  const debtId = reader.id('debtId', 'הלוואה');
  const accountId = reader.id('accountId', 'חשבון');
  const anyDirection = reader.boolean('anyDirection');

  if (!reader.ok) return failed('בואו נשלים כמה פרטים.', reader.errors);

  const draft = ruleFromCorrection({
    description,
    direction,
    class: klass,
    budgetCategoryKey: categoryKey ?? null,
    counterparty: counterparty ?? null,
    debtId,
    accountId,
    anyDirection,
  });

  if (draft === null) {
    return failed(
      'בשורה הזאת אין מילים קבועות להיתפס בהן — רק מספרים. כלל ממנה היה תופס אותה בלבד.',
    );
  }

  try {
    await (
      await householdStore()
    ).run((document, context) => addLearnedRule(document, draft, context));
  } catch (error) {
    return describe(error);
  }

  refreshRules();
  refreshImportScreens();
  return succeeded('הכלל נשמר. בפעם הבאה נזהה את השורה הזאת לבד.');
}

export async function updateRuleAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const reader = new FieldReader(data);
  const ruleId = reader.id('ruleId', 'כלל', { required: true });
  const label = reader.text('label', 'שם הכלל', { max: 120 });
  const klass = reader.choice('class', 'סוג', CLASS_VALUES, 'purchase');
  const categoryKey = reader.optionalChoice('budgetCategoryKey', BUDGET_CATEGORY_KEYS);
  const counterparty = reader.optionalText('counterparty', 'למי');

  if (!reader.ok || ruleId === null) return failed('בואו נשלים כמה פרטים.', reader.errors);

  try {
    await (
      await householdStore()
    ).run((document, context) =>
      updateLearnedRule(
        document,
        {
          ruleId,
          label,
          class: klass,
          budgetCategoryKey: categoryKey ?? null,
          counterparty: counterparty ?? null,
        },
        context,
      ),
    );
  } catch (error) {
    return describe(error);
  }

  refreshRules();
  return succeeded('הכלל עודכן.');
}

/**
 * Turns a rule off, or back on.
 *
 * Offered beside deleting because a family that suspects a rule is wrong should
 * be able to stop it, run the import again and see, without losing what the rule
 * said. Deleting would make that experiment destructive.
 */
export async function toggleRuleAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const reader = new FieldReader(data);
  const ruleId = reader.id('ruleId', 'כלל', { required: true });
  const enabled = reader.boolean('enabled');

  if (!reader.ok || ruleId === null) return failed('לא נבחר כלל.', reader.errors);

  try {
    await (
      await householdStore()
    ).run((document, context) => updateLearnedRule(document, { ruleId, enabled }, context));
  } catch (error) {
    return describe(error);
  }

  refreshRules();
  return succeeded(enabled ? 'הכלל פעיל שוב.' : 'הכלל כבוי. הוא נשמר ואפשר להחזיר אותו.');
}

export async function deleteRuleAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const reader = new FieldReader(data);
  const ruleId = reader.id('ruleId', 'כלל', { required: true });
  if (!reader.ok || ruleId === null) return failed('לא נבחר כלל.', reader.errors);

  try {
    await (
      await householdStore()
    ).run((document, context) => deleteLearnedRule(document, { ruleId }, context));
  } catch (error) {
    return describe(error);
  }

  refreshRules();
  return succeeded('הכלל נמחק.');
}
