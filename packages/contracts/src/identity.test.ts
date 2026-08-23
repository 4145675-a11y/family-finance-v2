import { randomUUID } from 'node:crypto';

import { describe, expect, test } from 'vitest';

import {
  acceptInvitationInputSchema,
  auditEventSchema,
  createHouseholdInputSchema,
  householdInvitationSchema,
  invitationTokenSchema,
  inviteToHouseholdInputSchema,
  membershipStatusSchema,
  profileSchema,
} from './identity';

const now = new Date().toISOString();

describe('profileSchema', () => {
  const valid = {
    id: randomUUID(),
    displayName: 'אהרן',
    locale: 'he-IL' as const,
    timeZone: 'Asia/Jerusalem',
    createdAt: now,
    updatedAt: now,
    version: 1,
  };

  test('accepts a Hebrew display name', () => {
    expect(profileSchema.parse(valid).displayName).toBe('אהרן');
  });

  test('rejects a blank display name', () => {
    expect(() => profileSchema.parse({ ...valid, displayName: '   ' })).toThrow();
  });

  test('rejects a non-UUID id', () => {
    expect(() => profileSchema.parse({ ...valid, id: 'not-a-uuid' })).toThrow();
  });

  test('rejects version zero — the database starts at one', () => {
    expect(() => profileSchema.parse({ ...valid, version: 0 })).toThrow();
  });

  test('requires an offset on timestamps so UTC is unambiguous', () => {
    expect(() => profileSchema.parse({ ...valid, createdAt: '2026-08-16T10:00:00' })).toThrow();
  });
});

describe('membershipStatusSchema', () => {
  test('accepts the two states the database defines', () => {
    expect(membershipStatusSchema.parse('active')).toBe('active');
    expect(membershipStatusSchema.parse('revoked')).toBe('revoked');
  });

  test('rejects anything else', () => {
    expect(() => membershipStatusSchema.parse('pending')).toThrow();
    expect(() => membershipStatusSchema.parse('owner')).toThrow();
  });
});

describe('householdInvitationSchema', () => {
  const valid = {
    id: randomUUID(),
    householdId: randomUUID(),
    invitedEmail: 'partner@example.test',
    createdBy: randomUUID(),
    expiresAt: now,
    acceptedAt: null,
    revokedAt: null,
    createdAt: now,
    version: 1,
  };

  test('parses a pending invitation', () => {
    expect(householdInvitationSchema.parse(valid).acceptedAt).toBeNull();
  });

  test('carries no token field, and strips one if supplied', () => {
    const parsed = householdInvitationSchema.parse({ ...valid, token: 'super-secret-token' });
    expect(parsed).not.toHaveProperty('token');
  });

  test('rejects a malformed email', () => {
    expect(() => householdInvitationSchema.parse({ ...valid, invitedEmail: 'nope' })).toThrow();
  });
});

describe('invitationTokenSchema', () => {
  /** 32 random bytes as base64url — what the server will generate. */
  const realistic = Buffer.from(
    Array.from({ length: 32 }, (_, i) => (i * 7 + 11) % 256),
  ).toString('base64url');

  test('accepts a 32-byte base64url token', () => {
    expect(invitationTokenSchema.parse(realistic)).toBe(realistic);
  });

  test('rejects a short token that could be guessed', () => {
    expect(() => invitationTokenSchema.parse('abc123')).toThrow();
  });

  test('rejects characters outside base64url', () => {
    expect(() => invitationTokenSchema.parse(`${realistic.slice(0, 42)}+/`)).toThrow();
  });

  test('the minimum length matches what the database function enforces', () => {
    // accept_household_invitation() rejects tokens shorter than 32 characters.
    // The contract is stricter (43), so no token that passes here is refused there.
    const boundary = 'a'.repeat(43);
    expect(invitationTokenSchema.parse(boundary)).toBe(boundary);
    expect(() => invitationTokenSchema.parse('a'.repeat(42))).toThrow();
  });
});

describe('acceptInvitationInputSchema', () => {
  test('requires a token that satisfies the token contract', () => {
    expect(() => acceptInvitationInputSchema.parse({ token: 'short' })).toThrow();
  });
});

describe('inviteToHouseholdInputSchema', () => {
  const base = { householdId: randomUUID(), email: 'partner@example.test' };

  test('defaults to a seven day expiry', () => {
    expect(inviteToHouseholdInputSchema.parse(base).expiresInHours).toBe(168);
  });

  test('caps expiry at two weeks so an invite cannot become permanent', () => {
    expect(() =>
      inviteToHouseholdInputSchema.parse({ ...base, expiresInHours: 337 }),
    ).toThrow();
  });

  test('rejects a zero or negative expiry', () => {
    expect(() => inviteToHouseholdInputSchema.parse({ ...base, expiresInHours: 0 })).toThrow();
  });
});

describe('createHouseholdInputSchema', () => {
  test('trims the name', () => {
    expect(createHouseholdInputSchema.parse({ name: '  משפחה  ' }).name).toBe('משפחה');
  });

  test('rejects an empty name', () => {
    expect(() => createHouseholdInputSchema.parse({ name: '' })).toThrow();
  });
});

describe('auditEventSchema', () => {
  test('accepts reduced before/after images', () => {
    const parsed = auditEventSchema.parse({
      id: randomUUID(),
      householdId: randomUUID(),
      actorProfileId: randomUUID(),
      action: 'household.renamed',
      entityType: 'households',
      entityId: randomUUID(),
      beforeState: { name: 'old' },
      afterState: { name: 'new' },
      occurredAt: now,
    });
    expect(parsed.beforeState).toEqual({ name: 'old' });
  });

  test('allows a null household for account-level events', () => {
    const parsed = auditEventSchema.parse({
      id: randomUUID(),
      householdId: null,
      actorProfileId: randomUUID(),
      action: 'profile.created',
      entityType: 'profiles',
      entityId: randomUUID(),
      beforeState: null,
      afterState: null,
      occurredAt: now,
    });
    expect(parsed.householdId).toBeNull();
  });
});
