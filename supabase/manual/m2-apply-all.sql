-- Milestone 2 — all migrations, in one atomic transaction.
--
-- GENERATED FILE. Do not edit.
--   source: supabase/migrations/*.sql
--   regenerate: npm run db:build:m2
--   verified by: tools/manual-sql.test.mjs
--
-- Contains 5 migrations, in filename order:
--   1. 20260816090000_identity_foundation.sql
--   2. 20260816090100_profiles_households.sql
--   3. 20260816090200_invitations.sql
--   4. 20260816090300_audit_events.sql
--   5. 20260816090400_rls_policies.sql
--
-- Safe to run more than once: every trigger and policy is dropped before it is
-- created, and the enum is created under an existence check (ADR-0015). Running
-- this after migrations 1-2 are already applied produces the same schema.
--
-- Atomic: if any statement fails, COMMIT is never reached and the entire
-- transaction rolls back. There is no partially applied state.
--
-- Paste into an EMPTY SQL Editor window and run once.

begin;

-- >>> BEGIN MIGRATION: 20260816090000_identity_foundation.sql
-- Milestone 2 — Identity foundation.
--
-- Creates the private schema that holds security helpers, the shared column
-- conventions from 05-ARCHITECTURE-DATA.md (UUID, timestamps, actor, version),
-- and the updated_at trigger used by every mutable table.
--
-- Nothing in this file grants access. Every table's access is defined by the
-- policies in 20260816090400_rls_policies.sql, and every private table is
-- denied by default until a policy allows a specific operation.

create extension if not exists "pgcrypto" with schema extensions;
create extension if not exists "citext" with schema extensions;

-- Helpers live outside `public` so they are not exposed through PostgREST.
create schema if not exists app;

revoke all on schema app from public, anon, authenticated;
grant usage on schema app to authenticated;

comment on schema app is
  'Security helpers and internal functions. Not exposed through the API.';

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function app.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  -- `version` is the optimistic-concurrency counter required by
  -- 05-ARCHITECTURE-DATA.md. It is owned by the database, never by the client:
  -- a client that sends its own value cannot skip or replay a version.
  new.version := old.version + 1;
  return new;
end;
$$;

comment on function app.touch_updated_at() is
  'BEFORE UPDATE trigger: sets updated_at and increments version server-side.';

-- ---------------------------------------------------------------------------
-- Current actor
-- ---------------------------------------------------------------------------

-- auth.uid() wrapped so that policies read the same way everywhere and so the
-- call is stable within a statement (PostgreSQL can then cache it per query).
create or replace function app.current_profile_id()
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select auth.uid();
$$;

comment on function app.current_profile_id() is
  'The authenticated profile making the request, or NULL when unauthenticated.';
-- <<< END MIGRATION: 20260816090000_identity_foundation.sql

-- >>> BEGIN MIGRATION: 20260816090100_profiles_households.sql
-- Milestone 2 — profiles, households and membership.
--
-- 01-PRODUCT-SPEC.md: the two partners hold equal permission. There is no owner
-- role that can overrule the other, and no hidden second approval. Membership is
-- therefore a simple active/revoked state, not a permission ladder.

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text not null check (length(btrim(display_name)) between 1 and 80),
  locale        text not null default 'he-IL' check (locale in ('he-IL', 'en-US')),
  time_zone     text not null default 'Asia/Jerusalem',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  version       integer not null default 1
);

comment on table public.profiles is
  'One row per authenticated person. Deleted with the auth user.';

-- PostgreSQL has no CREATE TRIGGER IF NOT EXISTS, so every trigger is dropped
-- first. This is what makes the migration safe to re-run after a partial or
-- mistaken application; see ADR-0015.
drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- households
-- ---------------------------------------------------------------------------

create table if not exists public.households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 1 and 120),
  -- The creator is kept for audit. It confers no extra permission: partners are
  -- equal, so this column must never appear in a policy as a privilege test.
  created_by  uuid not null references public.profiles (id) on delete restrict,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  version     integer not null default 1
);

comment on table public.households is
  'A family unit. Financial data in later milestones is scoped to a household.';
comment on column public.households.created_by is
  'Audit only. Confers no privilege; both partners have equal permission.';

drop trigger if exists households_touch_updated_at on public.households;
create trigger households_touch_updated_at
  before update on public.households
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- household_members
-- ---------------------------------------------------------------------------

-- CREATE TYPE has no IF NOT EXISTS either. Dropping the type is not an option
-- once a column depends on it, so creation is guarded instead.
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'membership_status' and n.nspname = 'public'
  ) then
    create type public.membership_status as enum ('active', 'revoked');
  end if;
end
$$;

create table if not exists public.household_members (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  profile_id    uuid not null references public.profiles (id) on delete cascade,
  status        public.membership_status not null default 'active',
  invited_by    uuid references public.profiles (id) on delete set null,
  joined_at     timestamptz not null default now(),
  revoked_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  version       integer not null default 1,

  -- One membership row per person per household. This is what makes a repeated
  -- invitation acceptance idempotent rather than duplicating access.
  constraint household_members_unique_membership unique (household_id, profile_id),
  constraint household_members_revoked_at_matches_status check (
    (status = 'revoked' and revoked_at is not null)
    or (status = 'active' and revoked_at is null)
  )
);

comment on table public.household_members is
  'Membership edge between a profile and a household. Revocation is a state change, never a delete, so history survives.';

drop trigger if exists household_members_touch_updated_at on public.household_members;
create trigger household_members_touch_updated_at
  before update on public.household_members
  for each row execute function app.touch_updated_at();

create index if not exists household_members_household_idx
  on public.household_members (household_id)
  where status = 'active';

create index if not exists household_members_profile_idx
  on public.household_members (profile_id)
  where status = 'active';

-- ---------------------------------------------------------------------------
-- Membership helper
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER on purpose: policies on household_members must ask "is the
-- caller a member?" without re-entering the same table's policy, which would
-- recurse. The function is owned by the migration role, reads one table, takes
-- only a household id, and returns a boolean — it cannot leak rows.
--
-- `set search_path = ''` forces fully-qualified names so the function cannot be
-- hijacked by a caller-controlled search_path.
create or replace function app.is_household_member(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members hm
    where hm.household_id = p_household_id
      and hm.profile_id = (select auth.uid())
      and hm.status = 'active'
  );
$$;

comment on function app.is_household_member(uuid) is
  'True when the caller holds an active membership in the household. SECURITY DEFINER to avoid policy recursion on household_members.';

revoke all on function app.is_household_member(uuid) from public, anon;
grant execute on function app.is_household_member(uuid) to authenticated;

-- Every household the caller belongs to. Used by policies on profiles so that
-- partners can see each other, and by later milestones for scoping.
create or replace function app.current_household_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select hm.household_id
  from public.household_members hm
  where hm.profile_id = (select auth.uid())
    and hm.status = 'active';
$$;

revoke all on function app.current_household_ids() from public, anon;
grant execute on function app.current_household_ids() to authenticated;
-- <<< END MIGRATION: 20260816090100_profiles_households.sql

-- >>> BEGIN MIGRATION: 20260816090200_invitations.sql
-- Milestone 2 — household invitations.
--
-- 07-SECURITY-PRIVACY.md requires the invitation token to be hashed, one-time,
-- revocable and expiring. The plaintext token exists only in the invite link the
-- inviter sends; the database stores nothing that can be replayed if it leaks.

create table if not exists public.household_invitations (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  invited_email extensions.citext not null check (position('@' in invited_email) > 1),

  -- SHA-256 of the plaintext token. The token itself is never stored, never
  -- logged and never returned by a query. A stolen database dump yields no
  -- usable invitation.
  token_hash    bytea not null,

  created_by    uuid not null references public.profiles (id) on delete restrict,
  expires_at    timestamptz not null,
  accepted_at   timestamptz,
  accepted_by   uuid references public.profiles (id) on delete set null,
  revoked_at    timestamptz,
  revoked_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  version       integer not null default 1,

  constraint household_invitations_token_hash_unique unique (token_hash),
  constraint household_invitations_expires_after_creation check (expires_at > created_at),
  constraint household_invitations_accepted_fields_together check (
    (accepted_at is null and accepted_by is null)
    or (accepted_at is not null and accepted_by is not null)
  ),
  -- An invitation cannot be both accepted and revoked. Without this, a race
  -- between accept and revoke could leave a row that reads as either.
  constraint household_invitations_not_both_accepted_and_revoked check (
    accepted_at is null or revoked_at is null
  )
);

comment on table public.household_invitations is
  'Pending invitations. Stores only the SHA-256 of the token; plaintext lives solely in the invite link.';
comment on column public.household_invitations.token_hash is
  'SHA-256 digest. Never store, log or return the plaintext token.';

drop trigger if exists household_invitations_touch_updated_at on public.household_invitations;
create trigger household_invitations_touch_updated_at
  before update on public.household_invitations
  for each row execute function app.touch_updated_at();

create index if not exists household_invitations_household_idx
  on public.household_invitations (household_id);

-- Lookup path for acceptance: only rows that are still usable.
create index if not exists household_invitations_pending_idx
  on public.household_invitations (token_hash)
  where accepted_at is null and revoked_at is null;

-- ---------------------------------------------------------------------------
-- Acceptance
-- ---------------------------------------------------------------------------

-- Acceptance cannot be a plain INSERT by the invitee: the invitee is not yet a
-- member, so no sane policy on household_members would let them add themselves.
-- This SECURITY DEFINER function is the only path in, and it validates every
-- condition before granting membership.
create or replace function public.accept_household_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id   uuid := (select auth.uid());
  v_token_hash   bytea;
  v_invitation   public.household_invitations%rowtype;
begin
  if v_profile_id is null then
    raise exception 'authentication required'
      using errcode = '28000';
  end if;

  if p_token is null or length(btrim(p_token)) < 32 then
    raise exception 'invalid invitation token'
      using errcode = '22023';
  end if;

  v_token_hash := extensions.digest(p_token, 'sha256');

  -- FOR UPDATE serialises concurrent acceptances of the same token, so the
  -- one-time guarantee holds even under a double click or a replayed request.
  select * into v_invitation
  from public.household_invitations
  where token_hash = v_token_hash
  for update;

  if not found then
    raise exception 'invitation not found'
      using errcode = 'P0002';
  end if;

  if v_invitation.revoked_at is not null then
    raise exception 'invitation revoked'
      using errcode = 'P0001';
  end if;

  if v_invitation.expires_at <= now() then
    raise exception 'invitation expired'
      using errcode = 'P0001';
  end if;

  if v_invitation.accepted_at is not null then
    -- Already accepted. Accepting twice from the same profile is idempotent;
    -- from a different profile it is a replay attempt and must fail.
    if v_invitation.accepted_by = v_profile_id then
      return v_invitation.household_id;
    end if;
    raise exception 'invitation already accepted'
      using errcode = 'P0001';
  end if;

  insert into public.household_members (household_id, profile_id, invited_by, status)
  values (v_invitation.household_id, v_profile_id, v_invitation.created_by, 'active')
  on conflict (household_id, profile_id) do update
    set status     = 'active',
        revoked_at = null;

  update public.household_invitations
  set accepted_at = now(),
      accepted_by = v_profile_id
  where id = v_invitation.id;

  return v_invitation.household_id;
end;
$$;

comment on function public.accept_household_invitation(text) is
  'Redeems an invitation token. Validates revocation, expiry and single use, then grants membership. The only path by which a non-member joins a household.';

revoke all on function public.accept_household_invitation(text) from public, anon;
grant execute on function public.accept_household_invitation(text) to authenticated;
-- <<< END MIGRATION: 20260816090200_invitations.sql

-- >>> BEGIN MIGRATION: 20260816090300_audit_events.sql
-- Milestone 2 — append-only audit.
--
-- 07-SECURITY-PRIVACY.md: "append-only DB enforcement", metadata only, no
-- secrets and no full documents. Enforcement lives in the database, because an
-- audit trail that the application layer can rewrite is not an audit trail.

create table if not exists public.audit_events (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid references public.households (id) on delete cascade,
  actor_profile_id uuid references public.profiles (id) on delete set null,

  action        text not null check (length(btrim(action)) between 1 and 80),
  entity_type   text not null check (length(btrim(entity_type)) between 1 and 80),
  entity_id     uuid,

  -- Reduced before/after images. 07-SECURITY-PRIVACY.md forbids secrets, full
  -- documents and card data here; callers pass only the changed fields.
  before_state  jsonb,
  after_state   jsonb,

  request_id    uuid,
  device_id     uuid,
  occurred_at   timestamptz not null default now()
);

comment on table public.audit_events is
  'Append-only audit trail. UPDATE and DELETE are rejected by trigger for every role, including table owners.';
comment on column public.audit_events.before_state is
  'Reduced field-level image. Never secrets, full documents or card data.';

create index if not exists audit_events_household_time_idx
  on public.audit_events (household_id, occurred_at desc);

create index if not exists audit_events_entity_idx
  on public.audit_events (entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- Append-only enforcement
-- ---------------------------------------------------------------------------

create or replace function app.reject_audit_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'audit_events is append-only; % is not permitted', tg_op
    using errcode = '42501';
end;
$$;

comment on function app.reject_audit_mutation() is
  'Raises on any UPDATE or DELETE against audit_events.';

-- A statement-level trigger fires even when the statement matches no rows, so
-- an attempted `delete from audit_events` fails loudly instead of silently
-- succeeding against zero visible rows.
drop trigger if exists audit_events_block_update on public.audit_events;
create trigger audit_events_block_update
  before update on public.audit_events
  execute function app.reject_audit_mutation();

drop trigger if exists audit_events_block_delete on public.audit_events;
create trigger audit_events_block_delete
  before delete on public.audit_events
  execute function app.reject_audit_mutation();

-- ---------------------------------------------------------------------------
-- Recording
-- ---------------------------------------------------------------------------

-- Writing audit rows goes through this function so the actor is taken from the
-- session rather than from client input. A client cannot forge another actor.
create or replace function public.record_audit_event(
  p_household_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid default null,
  p_before jsonb default null,
  p_after jsonb default null,
  p_request_id uuid default null,
  p_device_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_id    uuid;
begin
  if v_actor is null then
    raise exception 'authentication required'
      using errcode = '28000';
  end if;

  -- A caller may only write audit rows for a household they belong to.
  if p_household_id is not null and not app.is_household_member(p_household_id) then
    raise exception 'not a member of household %', p_household_id
      using errcode = '42501';
  end if;

  insert into public.audit_events (
    household_id, actor_profile_id, action, entity_type, entity_id,
    before_state, after_state, request_id, device_id
  )
  values (
    p_household_id, v_actor, p_action, p_entity_type, p_entity_id,
    p_before, p_after, p_request_id, p_device_id
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.record_audit_event(uuid, text, text, uuid, jsonb, jsonb, uuid, uuid) is
  'Appends an audit row with the actor taken from the session. Rejects writes for households the caller does not belong to.';

revoke all on function public.record_audit_event(uuid, text, text, uuid, jsonb, jsonb, uuid, uuid) from public, anon;
grant execute on function public.record_audit_event(uuid, text, text, uuid, jsonb, jsonb, uuid, uuid) to authenticated;
-- <<< END MIGRATION: 20260816090300_audit_events.sql

-- >>> BEGIN MIGRATION: 20260816090400_rls_policies.sql
-- Milestone 2 — Row Level Security.
--
-- 07-SECURITY-PRIVACY.md: "DB-side RLS לכל טבלה פרטית; UI אינו גבול אבטחה".
--
-- Rules applied throughout:
--   * RLS is enabled AND forced on every table, so even the table owner is
--     subject to policy. Only roles that bypass RLS (postgres, service_role)
--     are exempt, and those never reach the browser.
--   * Policies are written per command. There is no `for all` policy, because
--     a single permissive rule tends to grant more than intended over time.
--   * Every policy is anchored to app.is_household_member(). Membership is the
--     one isolation boundary; nothing is scoped by created_by or by client input.
--   * No DELETE policy is granted anywhere in this milestone. Identity records
--     are revoked, not erased, so history survives.

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.profiles force row level security;

-- A person sees their own profile, and the profiles of people they share a
-- household with — the partner needs a name to display. Nothing wider.
drop policy if exists profiles_select_self_or_co_member on public.profiles;
create policy profiles_select_self_or_co_member
  on public.profiles
  for select
  to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1
      from public.household_members hm
      where hm.profile_id = public.profiles.id
        and hm.status = 'active'
        and hm.household_id in (select app.current_household_ids())
    )
  );

-- A profile row is created for the authenticated user and no one else.
drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self
  on public.profiles
  for insert
  to authenticated
  with check (id = (select auth.uid()));

-- Editing another person's display name is never permitted, not even a partner's.
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self
  on public.profiles
  for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- households
-- ---------------------------------------------------------------------------

alter table public.households enable row level security;
alter table public.households force row level security;

drop policy if exists households_select_member on public.households;
create policy households_select_member
  on public.households
  for select
  to authenticated
  using (app.is_household_member(id));

-- The creator must be the caller. Without this check a client could create a
-- household attributed to someone else.
drop policy if exists households_insert_self_as_creator on public.households;
create policy households_insert_self_as_creator
  on public.households
  for insert
  to authenticated
  with check (created_by = (select auth.uid()));

-- Both partners may rename the household: permissions are equal by product rule.
drop policy if exists households_update_member on public.households;
create policy households_update_member
  on public.households
  for update
  to authenticated
  using (app.is_household_member(id))
  with check (app.is_household_member(id));

-- ---------------------------------------------------------------------------
-- household_members
-- ---------------------------------------------------------------------------

alter table public.household_members enable row level security;
alter table public.household_members force row level security;

drop policy if exists household_members_select_same_household on public.household_members;
create policy household_members_select_same_household
  on public.household_members
  for select
  to authenticated
  using (app.is_household_member(household_id));

-- Deliberately no INSERT policy.
--
-- Joining a household happens only through public.accept_household_invitation(),
-- which is SECURITY DEFINER and validates the token. If members could INSERT
-- directly, anyone who learned a household id could add themselves to it — the
-- exact isolation break this milestone exists to prevent.

-- Revocation, and only revocation. A member may revoke a membership in their own
-- household; the WITH CHECK clause forbids the reverse direction, so this policy
-- cannot be used to re-activate a revoked member or to move a row to another
-- household.
drop policy if exists household_members_revoke_within_household on public.household_members;
create policy household_members_revoke_within_household
  on public.household_members
  for update
  to authenticated
  using (app.is_household_member(household_id))
  with check (
    app.is_household_member(household_id)
    and status = 'revoked'
  );

-- ---------------------------------------------------------------------------
-- household_invitations
-- ---------------------------------------------------------------------------

alter table public.household_invitations enable row level security;
alter table public.household_invitations force row level security;

-- Only existing members see invitations, and only for their own household. The
-- invitee does not read this table at all: they redeem a token through the
-- acceptance function, which needs no visibility here.
drop policy if exists household_invitations_select_member on public.household_invitations;
create policy household_invitations_select_member
  on public.household_invitations
  for select
  to authenticated
  using (app.is_household_member(household_id));

drop policy if exists household_invitations_insert_member on public.household_invitations;
create policy household_invitations_insert_member
  on public.household_invitations
  for insert
  to authenticated
  with check (
    app.is_household_member(household_id)
    and created_by = (select auth.uid())
  );

-- Revoking is an UPDATE by a member. Acceptance is not performed through this
-- policy — it runs inside the SECURITY DEFINER function — so a member cannot
-- mark an invitation accepted on someone else's behalf.
drop policy if exists household_invitations_revoke_member on public.household_invitations;
create policy household_invitations_revoke_member
  on public.household_invitations
  for update
  to authenticated
  using (app.is_household_member(household_id))
  with check (
    app.is_household_member(household_id)
    and accepted_at is null
  );

-- ---------------------------------------------------------------------------
-- audit_events
-- ---------------------------------------------------------------------------

alter table public.audit_events enable row level security;
alter table public.audit_events force row level security;

drop policy if exists audit_events_select_member on public.audit_events;
create policy audit_events_select_member
  on public.audit_events
  for select
  to authenticated
  using (household_id is not null and app.is_household_member(household_id));

-- No INSERT policy: rows are appended through public.record_audit_event(), which
-- stamps the actor from the session. No UPDATE or DELETE policy, and the triggers
-- in the previous migration reject those operations regardless of role.

-- ---------------------------------------------------------------------------
-- Table-level grants
-- ---------------------------------------------------------------------------

-- RLS filters rows; grants decide whether the command is available at all.
-- Both are needed: a missing policy with a broad grant still exposes the verb.
revoke all on all tables in schema public from anon, authenticated;

grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.households to authenticated;
grant select, update on public.household_members to authenticated;
grant select, insert, update on public.household_invitations to authenticated;
grant select on public.audit_events to authenticated;

-- `anon` is the unauthenticated role. It reaches no application table: every
-- policy above is restricted to `authenticated`, and no grant is issued here.
-- <<< END MIGRATION: 20260816090400_rls_policies.sql

commit;
