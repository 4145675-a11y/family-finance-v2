-- Milestone 9 — passkeys, devices and notifications.
--
-- Two subjects that share one property: they are the parts of the system that
-- know about *people and their devices* rather than about money. Everything
-- here is scoped to a profile, not just to a household, because a passkey
-- belongs to one person and a phone belongs to one person.
--
-- The rule that shapes every table below, from ADR-0028 and 07-SECURITY-PRIVACY.md:
--
--   No biometric information is stored. Anywhere. Ever.
--
-- Windows Hello checks the fingerprint inside the device and answers with a
-- signature. What is kept here is a public key — the same class of thing a web
-- server keeps about a TLS client. There is deliberately no column in which a
-- template, an image or a score could be placed even by mistake.

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'webauthn_challenge_purpose' and n.nspname = 'public'
  ) then
    create type public.webauthn_challenge_purpose as enum (
      'registration', 'authentication', 'reauthentication'
    );
  end if;

  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'notification_category' and n.nspname = 'public'
  ) then
    create type public.notification_category as enum (
      'security',        -- a sign-in from a new device, a passkey removed
      'checks',          -- a post-dated check due, overdue, or returned
      'payments',        -- an expected payment approaching, income that did not arrive
      'forecast',        -- a material shortfall ahead
      'imports',         -- a document finished processing, rows awaiting approval
      'tasks',           -- a task due or overdue
      'data_quality',    -- balances have gone stale
      'weekly_summary'
    );
  end if;

  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'notification_delivery_state' and n.nspname = 'public'
  ) then
    create type public.notification_delivery_state as enum (
      'pending', 'sent', 'failed', 'expired', 'suppressed'
    );
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- webauthn_credentials — a public key and a label, and nothing else
-- ---------------------------------------------------------------------------

create table if not exists public.webauthn_credentials (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,

  -- base64url of the credential id the authenticator generated.
  credential_id text not null check (length(credential_id) between 1 and 2000),

  -- base64url of the COSE public key. A public key: it verifies, it cannot sign.
  public_key_cose text not null check (length(public_key_cose) between 1 and 4000),

  -- COSE algorithm identifier: -7 ES256, -257 RS256, -8 EdDSA.
  algorithm integer not null check (algorithm between -65536 and 65536),

  -- Advances on every assertion for authenticators that keep one. A counter
  -- that fails to advance is the published signal of a copied credential.
  sign_count bigint not null default 0 check (sign_count >= 0),

  -- The relying party this credential was enrolled against.
  --
  -- Stored, and checked on every assertion, because it is what stops a passkey
  -- created against `localhost` during development from being accepted by the
  -- production deployment. ADR-0029 measured that the two are different origins
  -- to the browser; this makes them different rows to the server as well.
  rp_id text not null check (length(btrim(rp_id)) between 1 and 253),
  origin text not null check (length(btrim(origin)) between 1 and 300),

  -- The authenticator model, when it reported one. NULL for `attestation: none`,
  -- which is what this build requests.
  aaguid text check (aaguid is null or aaguid ~ '^[0-9a-f-]{36}$'),

  -- What the person called it: "המחשב של יוסי". Their words, not a device string.
  label text not null check (length(btrim(label)) between 1 and 80),

  -- True when the platform says the passkey is synchronised to an account.
  backed_up boolean not null default false,

  created_at   timestamptz not null default now(),
  last_used_at timestamptz,

  -- One credential id per relying party. The same authenticator may legitimately
  -- hold a credential for localhost and one for the production domain.
  constraint webauthn_credentials_unique_per_rp unique (credential_id, rp_id)
);

comment on table public.webauthn_credentials is
  'Public keys for passkey sign-in. No biometric information is stored here or anywhere else: there is no column that could hold it.';
comment on column public.webauthn_credentials.rp_id is
  'The relying party the credential was enrolled against. Checked on every assertion, so a development passkey cannot open production.';
comment on column public.webauthn_credentials.sign_count is
  'Signature counter. Must advance for authenticators that keep one; both-zero means the authenticator keeps none, which is not a clone signal.';

create index if not exists webauthn_credentials_profile_idx
  on public.webauthn_credentials (profile_id, rp_id);

-- ---------------------------------------------------------------------------
-- webauthn_challenges — issued once, usable once, briefly
-- ---------------------------------------------------------------------------

create table if not exists public.webauthn_challenges (
  id         uuid primary key default gen_random_uuid(),
  -- NULL during registration bootstrap, when there is not yet a profile.
  profile_id uuid references public.profiles (id) on delete cascade,

  -- base64url of 32 random bytes.
  value   text not null check (length(value) between 20 and 200),
  purpose public.webauthn_challenge_purpose not null,

  -- For a re-authentication, the session it was issued to. Without this a
  -- challenge minted for one browser could be answered by another.
  session_id text check (length(session_id) <= 200),
  -- What the re-authentication is for, so the screen can name it.
  action_key text check (length(action_key) <= 60),

  created_at timestamptz not null default now(),
  -- Short, because it need not be long. Replay is defeated by single use; this
  -- bounds the window in which a captured challenge is even a candidate.
  expires_at timestamptz not null,

  -- Set the moment it is used, for any outcome including failure. That is what
  -- makes it single-use: a replayed assertion answers a challenge that is gone.
  consumed_at timestamptz,

  constraint webauthn_challenges_expiry_after_creation check (expires_at > created_at)
);

comment on table public.webauthn_challenges is
  'One challenge, one use. Consumed on every outcome including failure, so a captured assertion cannot be replayed.';

create index if not exists webauthn_challenges_expiry_idx
  on public.webauthn_challenges (expires_at)
  where consumed_at is null;

-- ---------------------------------------------------------------------------
-- push_subscriptions — one row per device, per person
-- ---------------------------------------------------------------------------

create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,

  -- The push service endpoint the browser gave us. Treated as a capability:
  -- anyone holding it can deliver to that device, so it is protected by RLS and
  -- never leaves the server.
  endpoint text not null check (length(btrim(endpoint)) between 1 and 1000),

  -- The subscription's own public key and auth secret, produced by the browser.
  -- These encrypt the payload to the device; they are not household credentials
  -- and grant no access to anything here.
  p256dh text not null check (length(btrim(p256dh)) between 1 and 200),
  auth   text not null check (length(btrim(auth)) between 1 and 100),

  -- What the person calls this device, so one can be revoked by name.
  device_label text check (length(btrim(device_label)) <= 80),

  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  -- Set when the push service reports the endpoint is gone. Kept rather than
  -- deleted so a device that disappears is visible rather than merely absent.
  expired_at    timestamptz,

  constraint push_subscriptions_endpoint_unique unique (endpoint)
);

comment on table public.push_subscriptions is
  'One browser on one device. The VAPID private key that signs to these lives only in the server environment and never in this table.';

create index if not exists push_subscriptions_profile_idx
  on public.push_subscriptions (profile_id)
  where expired_at is null;

-- ---------------------------------------------------------------------------
-- notification_preferences — opt-in, per person
-- ---------------------------------------------------------------------------

create table if not exists public.notification_preferences (
  profile_id   uuid primary key references public.profiles (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,

  -- Every category is off until the person turns it on. A financial application
  -- that starts by pushing notifications has decided something for a family that
  -- was theirs to decide.
  security       boolean not null default false,
  checks         boolean not null default false,
  payments       boolean not null default false,
  forecast       boolean not null default false,
  imports        boolean not null default false,
  tasks          boolean not null default false,
  data_quality   boolean not null default false,
  weekly_summary boolean not null default false,

  -- Lock-screen text is generic unless the person asks otherwise. A push that
  -- says "1,500 ₪ to the gemach tomorrow" is readable by anyone holding the
  -- phone, and the default must not assume that is acceptable.
  detailed_lock_screen boolean not null default false,

  -- Quiet hours, in the household's own timezone. Equal values mean no quiet
  -- period rather than a zero-length one.
  quiet_hours_start time,
  quiet_hours_end   time,

  -- When a daily reminder may arrive, and how far ahead a due date warns.
  preferred_hour   integer not null default 9 check (preferred_hour between 0 and 23),
  lead_time_days   integer not null default 3 check (lead_time_days between 0 and 30),

  -- Which day the weekly summary lands on. 0 = Sunday, matching the Israeli week.
  weekly_summary_day integer not null default 0 check (weekly_summary_day between 0 and 6),

  updated_at timestamptz not null default now(),

  constraint notification_preferences_quiet_hours_paired check (
    (quiet_hours_start is null) = (quiet_hours_end is null)
  )
);

comment on table public.notification_preferences is
  'Opt-in, per person, per category. Everything defaults to off, and lock-screen text defaults to generic.';
comment on column public.notification_preferences.detailed_lock_screen is
  'Off by default. A lock screen is readable by whoever is holding the phone, so amounts and names stay inside the authenticated app.';

drop trigger if exists notification_preferences_touch_updated_at on public.notification_preferences;
create trigger notification_preferences_touch_updated_at
  before update on public.notification_preferences
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- notification_deliveries — what was sent, never what it said
-- ---------------------------------------------------------------------------
--
-- This table is an audit trail and a deduplication ledger. It is deliberately
-- incapable of holding the content of a notification: there is no body column,
-- no amount, no debt name, no document name. A notification log that records
-- what it notified about is a second copy of the household's finances in a
-- place nobody thinks to protect.

create table if not exists public.notification_deliveries (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  profile_id   uuid not null references public.profiles (id) on delete cascade,

  category public.notification_category not null,

  -- What this notification is *about*, as an opaque key: the check id and the
  -- day, the batch id, the task id. Two runs of the scheduler produce the same
  -- key, and the unique index below turns that into one delivery.
  subject_key text not null check (length(btrim(subject_key)) between 1 and 200),

  -- Where it went. NULL for an in-app notification, which has no endpoint.
  subscription_id uuid references public.push_subscriptions (id) on delete set null,

  state    public.notification_delivery_state not null default 'pending',
  -- A short machine-readable reason, never a message body.
  reason   text check (length(btrim(reason)) <= 80),
  attempts integer not null default 0 check (attempts >= 0 and attempts <= 10),

  -- Read in the application. An in-app notification that was seen stops being
  -- offered; a push that was never opened does not.
  read_at timestamptz,

  created_at timestamptz not null default now(),
  sent_at    timestamptz,

  constraint notification_deliveries_sent_state check (
    (state = 'sent') = (sent_at is not null)
  )
);

comment on table public.notification_deliveries is
  'That a notification happened, and nothing about what it said. There is no body column on purpose: a log of financial alerts is a copy of the finances.';
comment on column public.notification_deliveries.subject_key is
  'An opaque identity for the thing notified about. Two scheduler runs produce the same key, which the unique index turns into one delivery.';

-- The deduplication rule. One person is told about one subject once.
create unique index if not exists notification_deliveries_dedupe_idx
  on public.notification_deliveries (profile_id, category, subject_key);

create index if not exists notification_deliveries_unread_idx
  on public.notification_deliveries (profile_id, created_at desc)
  where read_at is null;

create index if not exists notification_deliveries_retry_idx
  on public.notification_deliveries (state, created_at)
  where state in ('pending', 'failed');

-- ---------------------------------------------------------------------------
-- Cross-household reference
-- ---------------------------------------------------------------------------

create or replace function app.assert_notification_references()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ok boolean;
begin
  -- The person being notified must actually be in the household the
  -- notification is about. Without this, a delivery row could pair one
  -- household's subject with another household's member.
  select exists (
    select 1 from public.household_members m
    where m.profile_id = new.profile_id
      and m.household_id = new.household_id
      and m.status = 'active'
  ) into v_ok;

  if not v_ok then
    raise exception 'a notification must be addressed to an active member of the household it concerns';
  end if;

  return new;
end;
$$;

drop trigger if exists notification_deliveries_assert_references on public.notification_deliveries;
create trigger notification_deliveries_assert_references
  before insert or update on public.notification_deliveries
  for each row execute function app.assert_notification_references();

drop trigger if exists notification_preferences_assert_references on public.notification_preferences;
create trigger notification_preferences_assert_references
  before insert or update on public.notification_preferences
  for each row execute function app.assert_notification_references();
