import { z } from 'zod';

import { timestampSchema, uuidSchema, versionSchema } from './identity';
import { amountMinorSchema, businessDateSchema } from './money';

/**
 * Family tasks — the small bridge between a recommendation and something done.
 *
 * 01-PRODUCT-SPEC.md asks for one practical action, not a task manager, and this
 * shape is kept deliberately thin for that reason: a title, why it matters, who
 * is doing it, when, and whether it happened. There is no priority field, no
 * project, no tags. Anything richer would start competing with the financial
 * screens for the family's attention, which is the opposite of the point.
 *
 * `origin` is what keeps the link honest. A task the engine suggested says so, and
 * names the number it came from, so a family can always ask "why is this here".
 */

export const taskStatusSchema = z.enum(['open', 'done', 'dismissed']);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

/**
 * Where the task came from.
 *
 * `recommendation` means the engine's next action produced it. It is still only a
 * proposal: creating the task is the user's act, and nothing financial changes
 * when one is completed.
 */
export const taskOriginSchema = z.enum(['manual', 'recommendation']);
export type TaskOrigin = z.infer<typeof taskOriginSchema>;

export const familyTaskSchema = z
  .object({
    id: uuidSchema,
    householdId: uuidSchema,
    title: z.string().trim().min(1).max(160),
    /** Why it matters, in the family's own words or the engine's reason code. */
    reason: z.string().trim().max(500).nullable(),
    origin: taskOriginSchema,
    /** The engine action key this came from, when it came from one. */
    recommendationKey: z.string().trim().max(80).nullable(),
    /** The sum at stake, when the task is about a specific amount. */
    amountMinor: amountMinorSchema.nullable(),
    /** The debt, account or import this task is about. */
    relatedDebtId: uuidSchema.nullable(),
    relatedAccountId: uuidSchema.nullable(),
    /** Which member took it on. Null means nobody has yet. */
    assignedMemberId: uuidSchema.nullable(),
    dueOn: businessDateSchema.nullable(),
    /** When to look at it again, for something that could not be finished today. */
    followUpOn: businessDateSchema.nullable(),
    status: taskStatusSchema,
    completedAt: timestampSchema.nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    version: versionSchema,
  })
  .refine((task) => (task.status === 'done') === (task.completedAt !== null), {
    message: 'a completed task records when it was completed',
    path: ['completedAt'],
  })
  .refine((task) => (task.origin === 'recommendation') === (task.recommendationKey !== null), {
    message: 'a task from a recommendation names the recommendation',
    path: ['recommendationKey'],
  });
export type FamilyTask = z.infer<typeof familyTaskSchema>;

export const createTaskInputSchema = z.object({
  title: z.string().trim().min(1).max(160),
  reason: z.string().trim().max(500).nullable(),
  origin: taskOriginSchema,
  recommendationKey: z.string().trim().max(80).nullable(),
  amountMinor: amountMinorSchema.nullable(),
  relatedDebtId: uuidSchema.nullable(),
  relatedAccountId: uuidSchema.nullable(),
  assignedMemberId: uuidSchema.nullable(),
  dueOn: businessDateSchema.nullable(),
});
export type CreateTaskInput = z.infer<typeof createTaskInputSchema>;
