import { z } from 'zod';

/**
 * Identity contracts — the shapes crossing the boundary between the database,
 * the server layer and the UI.
 *
 * 05-ARCHITECTURE-DATA.md places these in `packages/contracts` so that the same
 * definition validates a database row, a server action input and a form. A shape
 * that exists only as a TypeScript type is erased at runtime and validates
 * nothing; every contract here parses.
 */

export const uuidSchema = z.uuid();

/** ISO-8601 timestamp, always stored UTC (02-FINANCIAL-RULES.md). */
export const timestampSchema = z.iso.datetime({ offset: true });

/**
 * Optimistic concurrency counter. The database owns it: a client sends the
 * version it read, and the server rejects the write if it has moved on.
 */
export const versionSchema = z.number().int().positive();

export const membershipStatusSchema = z.enum(['active', 'revoked']);
export type MembershipStatus = z.infer<typeof membershipStatusSchema>;

export const localeSchema = z.enum(['he-IL', 'en-US']);

export const profileSchema = z.object({
  id: uuidSchema,
  displayName: z.string().trim().min(1).max(80),
  locale: localeSchema,
  timeZone: z.string().min(1),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  version: versionSchema,
});
export type Profile = z.infer<typeof profileSchema>;

export const householdSchema = z.object({
  id: uuidSchema,
  name: z.string().trim().min(1).max(120),
  createdBy: uuidSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  version: versionSchema,
});
export type Household = z.infer<typeof householdSchema>;

export const householdMemberSchema = z.object({
  id: uuidSchema,
  householdId: uuidSchema,
  profileId: uuidSchema,
  status: membershipStatusSchema,
  invitedBy: uuidSchema.nullable(),
  joinedAt: timestampSchema,
  revokedAt: timestampSchema.nullable(),
  version: versionSchema,
});
export type HouseholdMember = z.infer<typeof householdMemberSchema>;

/**
 * An invitation as the application is allowed to see it.
 *
 * There is deliberately no `token` field. 07-SECURITY-PRIVACY.md requires the
 * token to be hashed at rest; the plaintext exists only inside the invite link
 * at the moment of creation, and never in a record that could be logged or
 * serialised into a response.
 */
export const householdInvitationSchema = z.object({
  id: uuidSchema,
  householdId: uuidSchema,
  invitedEmail: z.email(),
  createdBy: uuidSchema,
  expiresAt: timestampSchema,
  acceptedAt: timestampSchema.nullable(),
  revokedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  version: versionSchema,
});
export type HouseholdInvitation = z.infer<typeof householdInvitationSchema>;

/**
 * The invitation token, constrained where it is created.
 *
 * 32 bytes of randomness rendered base64url is 43 characters; the acceptance
 * function in the database rejects anything shorter than 32, so the two ends
 * agree on a minimum that leaves no room for a guessable token.
 */
export const invitationTokenSchema = z
  .string()
  .min(43)
  .max(256)
  .regex(/^[A-Za-z0-9_-]+$/, 'token must be base64url');

export const createHouseholdInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
});
export type CreateHouseholdInput = z.infer<typeof createHouseholdInputSchema>;

export const inviteToHouseholdInputSchema = z.object({
  householdId: uuidSchema,
  email: z.email(),
  /** Bounded so an invitation cannot be made effectively permanent. */
  expiresInHours: z.number().int().min(1).max(336).default(168),
});
export type InviteToHouseholdInput = z.infer<typeof inviteToHouseholdInputSchema>;

export const acceptInvitationInputSchema = z.object({
  token: invitationTokenSchema,
});
export type AcceptInvitationInput = z.infer<typeof acceptInvitationInputSchema>;

export const revokeMembershipInputSchema = z.object({
  householdId: uuidSchema,
  profileId: uuidSchema,
  expectedVersion: versionSchema,
});
export type RevokeMembershipInput = z.infer<typeof revokeMembershipInputSchema>;

/**
 * Audit entry as written by the application.
 *
 * `beforeState` and `afterState` carry reduced field images only.
 * 07-SECURITY-PRIVACY.md forbids secrets, whole documents and card data here.
 */
export const auditEventSchema = z.object({
  id: uuidSchema,
  householdId: uuidSchema.nullable(),
  actorProfileId: uuidSchema.nullable(),
  action: z.string().min(1).max(80),
  entityType: z.string().min(1).max(80),
  entityId: uuidSchema.nullable(),
  beforeState: z.record(z.string(), z.unknown()).nullable(),
  afterState: z.record(z.string(), z.unknown()).nullable(),
  occurredAt: timestampSchema,
});
export type AuditEvent = z.infer<typeof auditEventSchema>;
