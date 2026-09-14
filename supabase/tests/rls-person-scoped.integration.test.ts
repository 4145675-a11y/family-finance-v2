/**
 * Row-level security for the person-scoped tables of M9: webauthn_credentials,
 * webauthn_challenges, push_subscriptions, notification_preferences,
 * notification_deliveries.
 *
 * A shared household is not a shared identity. Everything here belongs to one
 * person: a partner in the same household must not read, change or remove it.
 * Deletion is granted on exactly two tables, and only for one's own rows — a
 * lost laptop is what the passkey feature exists for.
 */

import { describe, expect, test } from 'vitest';

import {
  expectRejection,
  ownerInsert,
  PERMISSION_DENIED,
  rowCountAs,
  rowsAs,
  useHouseholdFixture,
} from './harness';

const ids = {
  credAlice: '',
  credBob: '',
  challengeAlice: '',
  challengeBootstrap: '',
  pushAlice: '',
  deliveryAlice: '',
};

const { alice, bob, carol, mallory, householdA, householdB } = useHouseholdFixture(
  async (client, f) => {
    const credential = (profile: string, label: string) =>
      ownerInsert('webauthn_credentials', {
        profile_id: profile,
        credential_id: `cred-${profile}`,
        public_key_cose: 'pQECAyYgASFYIA',
        algorithm: -7,
        rp_id: 'localhost',
        origin: 'http://localhost:3100',
        label,
      });
    ids.credAlice = await credential(f.alice.id, 'המחשב של אליס');
    ids.credBob = await credential(f.bob.id, 'הטלפון של בוב');

    ids.challengeAlice = await ownerInsert('webauthn_challenges', {
      profile_id: f.alice.id,
      value: 'a'.repeat(43),
      purpose: 'authentication',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });
    ids.challengeBootstrap = await ownerInsert('webauthn_challenges', {
      profile_id: null,
      value: 'b'.repeat(43),
      purpose: 'registration',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });

    ids.pushAlice = await ownerInsert('push_subscriptions', {
      profile_id: f.alice.id,
      endpoint: `https://push.example.test/${f.alice.id}`,
      p256dh: 'p256dh-key',
      auth: 'auth-secret',
      device_label: 'הטלפון של אליס',
    });

    await client.query(
      `insert into public.notification_preferences (profile_id, household_id, checks) values ($1, $2, true)`,
      [f.alice.id, f.householdA],
    );

    ids.deliveryAlice = await ownerInsert('notification_deliveries', {
      household_id: f.householdA,
      profile_id: f.alice.id,
      category: 'checks',
      subject_key: 'check:1:2026-10-10',
    });
  },
);

const TABLES = [
  'webauthn_credentials',
  'webauthn_challenges',
  'push_subscriptions',
  'notification_preferences',
  'notification_deliveries',
] as const;

describe('unauthenticated and unaffiliated callers', () => {
  test.each(TABLES)('anon cannot select from %s', async (table) => {
    const error = await expectRejection('anon', `select * from public.${table} limit 1`);
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  test.each(TABLES)('a person in no household sees nothing in %s', async (table) => {
    expect(await rowsAs(mallory, `select * from public.${table}`)).toHaveLength(0);
  });
});

describe('webauthn_credentials — a passkey belongs to one person', () => {
  test('a partner in the same household cannot see the other’s passkey', async () => {
    const byAlice = (
      await rowsAs<{ id: string }>(alice, 'select id from public.webauthn_credentials')
    ).map((r) => r.id);
    expect(byAlice).toEqual([ids.credAlice]);

    expect(
      await rowsAs(bob, 'select id from public.webauthn_credentials where id = $1', [
        ids.credAlice,
      ]),
    ).toHaveLength(0);
  });

  test('a person enrols a passkey for themselves and not for anyone else', async () => {
    const insert = `insert into public.webauthn_credentials
      (profile_id, credential_id, public_key_cose, algorithm, rp_id, origin, label)
      values ($1, $2, 'pQECAyYgASFYIA', -7, 'localhost', 'http://localhost:3100', 'חדש')`;
    expect(await rowCountAs(alice, insert, [alice.id, 'cred-new-alice'])).toBe(1);

    const forOther = await expectRejection(alice, insert, [bob.id, 'cred-planted']);
    expect(forOther?.code).toBe(PERMISSION_DENIED);
  });

  test('the same credential cannot be enrolled twice for the same relying party', async () => {
    const error = await expectRejection(
      alice,
      `insert into public.webauthn_credentials
         (profile_id, credential_id, public_key_cose, algorithm, rp_id, origin, label)
       values ($1, $2, 'pQECAyYgASFYIA', -7, 'localhost', 'http://localhost:3100', 'שוב')`,
      [alice.id, `cred-${alice.id}`],
    );
    expect(error?.code).toBe('23505');
  });

  test('a person removes their own passkey; a partner’s removal touches nothing', async () => {
    expect(
      await rowCountAs(bob, 'delete from public.webauthn_credentials where id = $1', [
        ids.credAlice,
      ]),
    ).toBe(0);
    expect(
      await rowCountAs(alice, 'delete from public.webauthn_credentials where id = $1', [
        ids.credAlice,
      ]),
    ).toBe(1);
  });

  test('a passkey cannot be handed to another person', async () => {
    const error = await expectRejection(
      alice,
      'update public.webauthn_credentials set profile_id = $1 where id = $2',
      [bob.id, ids.credAlice],
    );
    expect(error?.code).toBe(PERMISSION_DENIED);
  });
});

describe('webauthn_challenges — issued once, usable once, by the server', () => {
  test('a bootstrap challenge with no profile is readable by nobody', async () => {
    for (const actor of [alice, bob, carol]) {
      expect(
        await rowsAs(actor, 'select id from public.webauthn_challenges where id = $1', [
          ids.challengeBootstrap,
        ]),
      ).toHaveLength(0);
    }
  });

  test('a person reads and consumes only their own challenge', async () => {
    expect(
      await rowsAs(alice, 'select id from public.webauthn_challenges where id = $1', [
        ids.challengeAlice,
      ]),
    ).toHaveLength(1);
    expect(
      await rowsAs(bob, 'select id from public.webauthn_challenges where id = $1', [
        ids.challengeAlice,
      ]),
    ).toHaveLength(0);

    expect(
      await rowCountAs(
        bob,
        'update public.webauthn_challenges set consumed_at = now() where id = $1',
        [ids.challengeAlice],
      ),
    ).toBe(0);
    expect(
      await rowCountAs(
        alice,
        'update public.webauthn_challenges set consumed_at = now() where id = $1',
        [ids.challengeAlice],
      ),
    ).toBe(1);
  });

  test('a challenge is minted for oneself or for nobody yet, never for someone else', async () => {
    const insert = `insert into public.webauthn_challenges (profile_id, value, purpose, expires_at)
      values ($1, $2, 'authentication', now() + interval '2 minutes')`;
    expect(await rowCountAs(alice, insert, [alice.id, 'c'.repeat(43)])).toBe(1);
    expect(await rowCountAs(alice, insert, [null, 'd'.repeat(43)])).toBe(1);

    const forOther = await expectRejection(alice, insert, [bob.id, 'e'.repeat(43)]);
    expect(forOther?.code).toBe(PERMISSION_DENIED);
  });

  test('a challenge cannot expire before it was created, and cannot be deleted', async () => {
    const backwards = await expectRejection(
      alice,
      `insert into public.webauthn_challenges (profile_id, value, purpose, expires_at)
       values ($1, $2, 'authentication', now() - interval '1 minute')`,
      [alice.id, 'f'.repeat(43)],
    );
    expect(backwards?.code).toBe('23514');

    const remove = await expectRejection(
      alice,
      'delete from public.webauthn_challenges where id = $1',
      [ids.challengeAlice],
    );
    expect(remove?.code).toBe(PERMISSION_DENIED);
  });
});

describe('push_subscriptions — one device, one person', () => {
  test('a partner cannot see, change or revoke the other’s device', async () => {
    expect(
      await rowsAs(bob, 'select id from public.push_subscriptions where id = $1', [
        ids.pushAlice,
      ]),
    ).toHaveLength(0);
    expect(
      await rowCountAs(
        bob,
        'update public.push_subscriptions set expired_at = now() where id = $1',
        [ids.pushAlice],
      ),
    ).toBe(0);
    expect(
      await rowCountAs(bob, 'delete from public.push_subscriptions where id = $1', [
        ids.pushAlice,
      ]),
    ).toBe(0);
  });

  test('a person registers, marks expired, and revokes their own device', async () => {
    const insert = `insert into public.push_subscriptions (profile_id, endpoint, p256dh, auth)
      values ($1, $2, 'k', 's')`;
    expect(await rowCountAs(bob, insert, [bob.id, 'https://push.example.test/bob-1'])).toBe(1);

    const forOther = await expectRejection(bob, insert, [
      alice.id,
      'https://push.example.test/x',
    ]);
    expect(forOther?.code).toBe(PERMISSION_DENIED);

    expect(
      await rowCountAs(
        alice,
        'update public.push_subscriptions set expired_at = now() where id = $1',
        [ids.pushAlice],
      ),
    ).toBe(1);
    expect(
      await rowCountAs(alice, 'delete from public.push_subscriptions where id = $1', [
        ids.pushAlice,
      ]),
    ).toBe(1);
  });
});

describe('notification_preferences — opt-in, per person, inside their household', () => {
  test('a partner cannot read the other’s preferences', async () => {
    expect(
      await rowsAs(alice, 'select profile_id from public.notification_preferences'),
    ).toHaveLength(1);
    expect(
      await rowsAs(
        bob,
        'select profile_id from public.notification_preferences where profile_id = $1',
        [alice.id],
      ),
    ).toHaveLength(0);
  });

  test('preferences are created for oneself, in a household one belongs to', async () => {
    const insert = `insert into public.notification_preferences (profile_id, household_id, checks) values ($1, $2, true)`;
    expect(await rowCountAs(bob, insert, [bob.id, householdA])).toBe(1);

    // Bob is not a member of B: the SECURITY DEFINER membership trigger refuses
    // before the policy is consulted.
    const wrongHousehold = await expectRejection(bob, insert, [bob.id, householdB]);
    expect(wrongHousehold?.code).toBe('P0001');
    expect(wrongHousehold?.message).toMatch(/active member of the household/);

    // Carol is a member of B, so the trigger is satisfied — and the policy then
    // refuses a row for somebody other than the caller.
    const forOther = await expectRejection(bob, insert, [carol.id, householdB]);
    expect(forOther?.code).toBe(PERMISSION_DENIED);

    const unaffiliated = await expectRejection(mallory, insert, [mallory.id, householdA]);
    expect(unaffiliated?.code).toBe('P0001');
  });

  test('quiet hours come as a pair', async () => {
    const error = await expectRejection(
      alice,
      `update public.notification_preferences set quiet_hours_start = '22:00' where profile_id = $1`,
      [alice.id],
    );
    expect(error?.code).toBe('23514');
  });

  test('a person changes their own preferences; a partner changes nothing', async () => {
    expect(
      await rowCountAs(
        bob,
        `update public.notification_preferences set detailed_lock_screen = true where profile_id = $1`,
        [alice.id],
      ),
    ).toBe(0);
    expect(
      await rowCountAs(
        alice,
        `update public.notification_preferences set detailed_lock_screen = true where profile_id = $1`,
        [alice.id],
      ),
    ).toBe(1);
  });
});

describe('notification_deliveries — that a person was told, never what', () => {
  test('a delivery is readable only by the person it was addressed to', async () => {
    expect(
      await rowsAs(alice, 'select id from public.notification_deliveries where id = $1', [
        ids.deliveryAlice,
      ]),
    ).toHaveLength(1);
    expect(
      await rowsAs(bob, 'select id from public.notification_deliveries where id = $1', [
        ids.deliveryAlice,
      ]),
    ).toHaveLength(0);
  });

  test('a delivery is recorded for oneself in one’s own household, and deduplicated', async () => {
    const insert = `insert into public.notification_deliveries (household_id, profile_id, category, subject_key)
      values ($1, $2, 'tasks', $3)`;
    expect(await rowCountAs(bob, insert, [householdA, bob.id, 'task:1'])).toBe(1);

    const duplicate = await expectRejection(alice, insert, [
      householdA,
      alice.id,
      'check:1:2026-10-10',
    ]);
    // Same person, same category? No — a different category is a different subject.
    expect(duplicate).toBeNull();

    const sameSubject = await expectRejection(
      alice,
      `insert into public.notification_deliveries (household_id, profile_id, category, subject_key)
       values ($1, $2, 'checks', 'check:1:2026-10-10')`,
      [householdA, alice.id],
    );
    expect(sameSubject?.code, 'one person, one subject, one delivery').toBe('23505');

    const wrongHousehold = await expectRejection(alice, insert, [
      householdB,
      alice.id,
      'task:2',
    ]);
    expect(wrongHousehold?.code, 'the membership trigger refuses first').toBe('P0001');
  });

  test('the owner cannot address a delivery to someone outside the household either', async () => {
    const error = await expectRejection(
      'owner',
      `insert into public.notification_deliveries (household_id, profile_id, category, subject_key)
       values ($1, $2, 'tasks', 'task:9')`,
      [householdB, alice.id],
    );
    expect(error?.message).toMatch(/active member of the household it concerns/);
  });

  test('a person marks their own delivery read; nobody else can, and nobody deletes', async () => {
    expect(
      await rowCountAs(
        bob,
        'update public.notification_deliveries set read_at = now() where id = $1',
        [ids.deliveryAlice],
      ),
    ).toBe(0);
    expect(
      await rowCountAs(
        alice,
        'update public.notification_deliveries set read_at = now() where id = $1',
        [ids.deliveryAlice],
      ),
    ).toBe(1);
    const remove = await expectRejection(
      alice,
      'delete from public.notification_deliveries where id = $1',
      [ids.deliveryAlice],
    );
    expect(remove?.code).toBe(PERMISSION_DENIED);
  });
});
