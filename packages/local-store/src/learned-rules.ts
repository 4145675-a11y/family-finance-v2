import type { CreateLearnedRuleInput, LearnedRule } from '@family-finance/contracts';

import { auditEvent, withAudit } from './audit';
import { CommandError, type CommandContext, type CommandResult } from './commands';
import type { StoreDocument } from './document';

/**
 * The rules a household has made about its own statements.
 *
 * Four operations and no more: create one from a correction, change one, turn one
 * off, delete one. Every one of them is something a person asked for — nothing
 * here creates a rule as a side effect of anything else, because a rule the
 * family did not choose is a classification they cannot explain later.
 *
 * Disabling is offered beside deleting on purpose. A family that suspects a rule
 * is wrong should be able to stop it without losing what it said, try the import
 * again, and turn it back on. Deleting would make that experiment destructive.
 *
 * Isolation needs no enforcement here: the rules live in the household's own
 * document, so a rule cannot be read from a household it is not in.
 */

const MAX_RULES = 2_000;

export function addLearnedRule(
  document: StoreDocument,
  input: CreateLearnedRuleInput,
  context: CommandContext,
): CommandResult<string> {
  if (document.learnedRules.length >= MAX_RULES) {
    throw new CommandError('too_many_rules', 'there are already too many rules');
  }

  const matcher = input.matcher.descriptionContains.trim();
  if (matcher.length < 2) {
    throw new CommandError('rule_too_broad', 'a rule needs something to match on');
  }

  /*
   * The same matcher twice is not an error and not a second rule: it is the
   * family saying the same thing again, usually because they corrected two rows
   * that look alike. Returning the existing rule keeps the list honest.
   */
  const existing = document.learnedRules.find(
    (rule) =>
      rule.matcher.descriptionContains === matcher &&
      rule.matcher.direction === input.matcher.direction &&
      rule.matcher.accountId === input.matcher.accountId,
  );
  if (existing !== undefined) {
    return { document, value: existing.id, alreadyRecorded: true };
  }

  const rule: LearnedRule = {
    id: crypto.randomUUID(),
    householdId: document.household.id,
    label: input.label.trim(),
    matcher: { ...input.matcher, descriptionContains: matcher },
    class: input.class,
    budgetCategoryKey: input.budgetCategoryKey,
    counterparty: input.counterparty,
    debtId: input.debtId,
    enabled: true,
    timesApplied: 0,
    createdBy: context.actorProfileId,
    createdAt: context.now,
    updatedAt: context.now,
    version: 1,
  };

  return {
    document: withAudit({ ...document, learnedRules: [...document.learnedRules, rule] }, [
      auditEvent({
        householdId: document.household.id,
        actorProfileId: context.actorProfileId,
        action: 'rule.added',
        entityType: 'learned_rule',
        entityId: rule.id,
        after: { id: rule.id, label: rule.label, class: rule.class },
        occurredAt: context.now,
      }),
    ]),
    value: rule.id,
  };
}

export interface UpdateLearnedRuleInput {
  readonly ruleId: string;
  readonly label?: string;
  readonly enabled?: boolean;
  readonly class?: LearnedRule['class'];
  readonly budgetCategoryKey?: LearnedRule['budgetCategoryKey'];
  readonly counterparty?: string | null;
  readonly debtId?: string | null;
}

export function updateLearnedRule(
  document: StoreDocument,
  input: UpdateLearnedRuleInput,
  context: CommandContext,
): CommandResult<string> {
  const rule = document.learnedRules.find((candidate) => candidate.id === input.ruleId);
  if (rule === undefined) throw new CommandError('unknown_rule', 'that rule does not exist');

  const updated: LearnedRule = {
    ...rule,
    label: input.label?.trim() ?? rule.label,
    enabled: input.enabled ?? rule.enabled,
    class: input.class ?? rule.class,
    budgetCategoryKey:
      input.budgetCategoryKey === undefined ? rule.budgetCategoryKey : input.budgetCategoryKey,
    counterparty: input.counterparty === undefined ? rule.counterparty : input.counterparty,
    // A debt only belongs to a repayment rule; changing the class away from one
    // drops it rather than leaving a link that can no longer be reached.
    debtId:
      (input.class ?? rule.class) === 'loan_repayment'
        ? input.debtId === undefined
          ? rule.debtId
          : input.debtId
        : null,
    updatedAt: context.now,
    version: rule.version + 1,
  };

  return {
    document: withAudit(
      {
        ...document,
        learnedRules: document.learnedRules.map((candidate) =>
          candidate.id === rule.id ? updated : candidate,
        ),
      },
      [
        auditEvent({
          householdId: document.household.id,
          actorProfileId: context.actorProfileId,
          action: 'rule.updated',
          entityType: 'learned_rule',
          entityId: rule.id,
          before: { id: rule.id, enabled: rule.enabled, class: rule.class },
          after: { id: updated.id, enabled: updated.enabled, class: updated.class },
          occurredAt: context.now,
        }),
      ],
    ),
    value: rule.id,
  };
}

export function deleteLearnedRule(
  document: StoreDocument,
  input: { ruleId: string },
  context: CommandContext,
): CommandResult<string> {
  const rule = document.learnedRules.find((candidate) => candidate.id === input.ruleId);
  if (rule === undefined) throw new CommandError('unknown_rule', 'that rule does not exist');

  return {
    document: withAudit(
      {
        ...document,
        learnedRules: document.learnedRules.filter((candidate) => candidate.id !== rule.id),
      },
      [
        auditEvent({
          householdId: document.household.id,
          actorProfileId: context.actorProfileId,
          action: 'rule.deleted',
          entityType: 'learned_rule',
          entityId: rule.id,
          before: { id: rule.id, label: rule.label },
          occurredAt: context.now,
        }),
      ],
    ),
    value: rule.id,
  };
}

/** Records that a rule was applied, for the list the family manages. */
export function noteRuleApplied(
  document: StoreDocument,
  ruleIds: readonly string[],
): StoreDocument {
  if (ruleIds.length === 0) return document;
  const counts = new Map<string, number>();
  for (const id of ruleIds) counts.set(id, (counts.get(id) ?? 0) + 1);

  return {
    ...document,
    learnedRules: document.learnedRules.map((rule) => {
      const applied = counts.get(rule.id);
      return applied === undefined
        ? rule
        : { ...rule, timesApplied: rule.timesApplied + applied };
    }),
  };
}

/** The rules the classifier should consult, in the order it should try them. */
export function activeLearnedRules(document: StoreDocument): readonly LearnedRule[] {
  return (
    document.learnedRules
      .filter((rule) => rule.enabled)
      // The most specific matcher first, so a narrow rule is not shadowed by a
      // broad one the family wrote earlier.
      .sort(
        (a, b) => b.matcher.descriptionContains.length - a.matcher.descriptionContains.length,
      )
  );
}
