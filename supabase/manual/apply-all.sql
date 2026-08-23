-- Every migration in this repository, in one atomic transaction.
--
-- GENERATED FILE. Do not edit.
--   source: supabase/migrations/*.sql
--   regenerate: npm run db:build
--   verified by: tools/manual-sql.test.mjs
--
-- Contains 8 migrations, in filename order:
--   1. 20260816090000_identity_foundation.sql
--   2. 20260816090100_profiles_households.sql
--   3. 20260816090200_invitations.sql
--   4. 20260816090300_audit_events.sql
--   5. 20260816090400_rls_policies.sql
--   6. 20260822100000_financial_accounts.sql
--   7. 20260822100100_debt_domain.sql
--   8. 20260822100200_financial_row_security.sql
--
-- Safe to run more than once: every trigger and policy is dropped before it is
-- created, and every enum is created under an existence check (ADR-0015). Running
-- this over a partially applied schema produces the same result as a clean run.
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

-- >>> BEGIN MIGRATION: 20260822100000_financial_accounts.sql
-- Milestone 3 — financial accounts and the opening picture.
--
-- 01-PRODUCT-SPEC.md § Must: accounts, cards, cash, business, opening balances,
-- future items and manual transactions, all separated by scope so the household
-- and the business can be read apart and together without double counting.
--
-- Two structural decisions carried through this file:
--
--   * `scope` on a stored row is household or business, never consolidated.
--     Consolidated is a reading of the two, and a row that claimed it would be
--     counted twice (02-FINANCIAL-RULES.md § Scopes ותנועות).
--   * Amounts are non-negative integers in minor units, with a direction column
--     carrying the meaning (FIN-MONEY-001). No column holds a signed amount.
--
-- Every object here is re-runnable per ADR-0015.

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------

-- CREATE TYPE has no IF NOT EXISTS, and dropping a type that a column depends on
-- is not an option, so each one is created under an existence check.
do $$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'record_scope' and n.nspname = 'public'
  ) then
    create type public.record_scope as enum ('household', 'business');
  end if;

  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'flow_direction' and n.nspname = 'public'
  ) then
    create type public.flow_direction as enum ('inflow', 'outflow');
  end if;

  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'account_kind' and n.nspname = 'public'
  ) then
    create type public.account_kind as enum
      ('bank_account', 'credit_card', 'cash_wallet', 'other');
  end if;

  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'balance_source' and n.nspname = 'public'
  ) then
    create type public.balance_source as enum ('manual_entry', 'statement', 'import');
  end if;

  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'transaction_kind' and n.nspname = 'public'
  ) then
    create type public.transaction_kind as enum
      ('expense', 'income', 'transfer', 'settlement', 'refund', 'correction');
  end if;

  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'transaction_status' and n.nspname = 'public'
  ) then
    create type public.transaction_status as enum
      ('draft', 'confirmed', 'reconciled', 'void');
  end if;

  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'certainty_level' and n.nspname = 'public'
  ) then
    create type public.certainty_level as enum ('possible', 'probable', 'certain');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Shared money constraint
-- ---------------------------------------------------------------------------

-- The ceiling matches MAX_AMOUNT_MINOR in packages/contracts/src/money.ts: high
-- enough that no real household reaches it, low enough that summing a household's
-- rows stays inside exact integer arithmetic.
create or replace function app.is_valid_amount_minor(p_amount bigint)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select p_amount >= 0 and p_amount <= 1000000000000000;
$$;

comment on function app.is_valid_amount_minor(bigint) is
  'FIN-MONEY-001: a stored amount is a non-negative integer of minor units within the aggregation-safe range.';

-- ---------------------------------------------------------------------------
-- businesses
-- ---------------------------------------------------------------------------

create table if not exists public.businesses (
  id                  uuid primary key default gen_random_uuid(),
  household_id        uuid not null references public.households (id) on delete cascade,
  name                text not null check (length(btrim(name)) between 1 and 120),
  -- Basis points, so a 25% reserve is 2500 and no floating point is stored.
  tax_reserve_rate_bp integer not null default 0 check (tax_reserve_rate_bp between 0 and 10000),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  version             integer not null default 1
);

comment on table public.businesses is
  'A business belonging to the household. Its money is tracked apart from household money and only a safe transfer moves between them.';

drop trigger if exists businesses_touch_updated_at on public.businesses;
create trigger businesses_touch_updated_at
  before update on public.businesses
  for each row execute function app.touch_updated_at();

create index if not exists businesses_household_idx
  on public.businesses (household_id);

-- ---------------------------------------------------------------------------
-- financial_accounts
-- ---------------------------------------------------------------------------

create table if not exists public.financial_accounts (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  business_id  uuid references public.businesses (id) on delete restrict,
  scope        public.record_scope not null,
  kind         public.account_kind not null,
  name         text not null check (length(btrim(name)) between 1 and 120),
  institution  text check (length(btrim(institution)) <= 120),
  currency     text not null default 'ILS' check (currency ~ '^[A-Z]{3}$'),

  -- 07-SECURITY-PRIVACY.md forbids storing a full card number anywhere. Four
  -- digits are enough to recognise the card and useless to an attacker.
  display_suffix text check (display_suffix ~ '^[0-9]{4}$'),

  opening_balance_minor     bigint not null
    check (app.is_valid_amount_minor(opening_balance_minor)),
  opening_balance_direction public.flow_direction not null,
  opening_balance_date      date not null,

  closed_at    timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  version      integer not null default 1,

  -- A business-scoped account names its business; a household account has none.
  -- Without this a business account could drift out of every business report.
  constraint financial_accounts_business_matches_scope check (
    (scope = 'business' and business_id is not null)
    or (scope = 'household' and business_id is null)
  )
);

comment on table public.financial_accounts is
  'Bank accounts, credit cards and cash wallets. A credit card balance is money owed, which is why direction is stored rather than a sign.';
comment on column public.financial_accounts.display_suffix is
  'Last four digits only. A full card number is never stored, logged or audited.';

drop trigger if exists financial_accounts_touch_updated_at on public.financial_accounts;
create trigger financial_accounts_touch_updated_at
  before update on public.financial_accounts
  for each row execute function app.touch_updated_at();

create index if not exists financial_accounts_household_idx
  on public.financial_accounts (household_id, scope)
  where closed_at is null;

create index if not exists financial_accounts_business_idx
  on public.financial_accounts (business_id)
  where business_id is not null;

-- ---------------------------------------------------------------------------
-- account_balance_snapshots
-- ---------------------------------------------------------------------------

-- 05-ARCHITECTURE-DATA.md § Reconciliation: a computed balance is compared to a
-- balance the user verified against the institution. Freshness on the dashboard
-- is measured from verified_at, so an old snapshot lowers confidence rather than
-- silently passing as current.
create table if not exists public.account_balance_snapshots (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  account_id   uuid not null references public.financial_accounts (id) on delete cascade,
  balance_minor bigint not null check (app.is_valid_amount_minor(balance_minor)),
  balance_direction public.flow_direction not null,
  verified_at  timestamptz not null,
  source       public.balance_source not null,
  note         text check (length(btrim(note)) <= 280),
  created_by   uuid not null references public.profiles (id) on delete restrict,
  created_at   timestamptz not null default now()
);

comment on table public.account_balance_snapshots is
  'A balance confirmed against the real institution at a point in time. Append-only in practice: a newer snapshot supersedes an older one rather than editing it.';

create index if not exists account_balance_snapshots_account_time_idx
  on public.account_balance_snapshots (account_id, verified_at desc);

-- ---------------------------------------------------------------------------
-- categories
-- ---------------------------------------------------------------------------

create table if not exists public.categories (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name         text not null check (length(btrim(name)) between 1 and 80),
  scope        public.record_scope not null,
  -- Essential needs are the first claim in the allocation waterfall
  -- (02-FINANCIAL-RULES.md § מפל הקצאת כסף), so the flag is data, not a guess.
  essential    boolean not null default false,
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  version      integer not null default 1,

  constraint categories_unique_name_per_scope unique (household_id, scope, name)
);

comment on column public.categories.essential is
  'Marks a need that the allocation waterfall funds before anything else.';

drop trigger if exists categories_touch_updated_at on public.categories;
create trigger categories_touch_updated_at
  before update on public.categories
  for each row execute function app.touch_updated_at();

create index if not exists categories_household_idx
  on public.categories (household_id, scope)
  where archived_at is null;

-- ---------------------------------------------------------------------------
-- transactions
-- ---------------------------------------------------------------------------

create table if not exists public.transactions (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  account_id   uuid not null references public.financial_accounts (id) on delete restrict,
  -- Present for transfers and settlements, forbidden otherwise.
  counterpart_account_id uuid references public.financial_accounts (id) on delete restrict,
  scope        public.record_scope not null,
  kind         public.transaction_kind not null,
  direction    public.flow_direction not null,
  amount_minor bigint not null check (app.is_valid_amount_minor(amount_minor)),
  currency     text not null default 'ILS' check (currency ~ '^[A-Z]{3}$'),
  status       public.transaction_status not null default 'draft',
  category_id  uuid references public.categories (id) on delete set null,
  merchant     text check (length(btrim(merchant)) <= 160),

  -- The date roles are kept apart (02-FINANCIAL-RULES.md § מוסכמות). Collapsing
  -- them is what makes a card charge appear in the wrong month.
  transaction_date date not null,
  posting_date     date,
  value_date       date,

  refunds_transaction_id  uuid references public.transactions (id) on delete restrict,
  corrects_transaction_id uuid references public.transactions (id) on delete restrict,

  note         text check (length(btrim(note)) <= 500),
  created_by   uuid not null references public.profiles (id) on delete restrict,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  version      integer not null default 1,

  -- A transfer moves money between two accounts we own; anything else has one
  -- side. Both halves of the rule are enforced so neither shape can drift.
  constraint transactions_counterpart_matches_kind check (
    (kind in ('transfer', 'settlement') and counterpart_account_id is not null)
    or (kind not in ('transfer', 'settlement') and counterpart_account_id is null)
  ),
  constraint transactions_counterpart_is_other_account check (
    counterpart_account_id is null or counterpart_account_id <> account_id
  ),
  -- A refund points at what it reverses, and only a refund may.
  constraint transactions_refund_links_source check (
    (kind = 'refund') = (refunds_transaction_id is not null)
  ),
  constraint transactions_correction_links_source check (
    corrects_transaction_id is null or kind = 'correction'
  )
);

comment on table public.transactions is
  'Money movements. Nothing is deleted: a mistake becomes a void status or a correction row, so history survives.';
comment on column public.transactions.status is
  'draft is never truth and void is never counted (CLAUDE.md).';

drop trigger if exists transactions_touch_updated_at on public.transactions;
create trigger transactions_touch_updated_at
  before update on public.transactions
  for each row execute function app.touch_updated_at();

create index if not exists transactions_household_date_idx
  on public.transactions (household_id, transaction_date desc);

create index if not exists transactions_account_date_idx
  on public.transactions (account_id, transaction_date desc);

create index if not exists transactions_status_idx
  on public.transactions (household_id, status);

-- ---------------------------------------------------------------------------
-- transaction_splits
-- ---------------------------------------------------------------------------

create table if not exists public.transaction_splits (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references public.households (id) on delete cascade,
  transaction_id uuid not null references public.transactions (id) on delete cascade,
  category_id    uuid references public.categories (id) on delete set null,
  scope          public.record_scope not null,
  amount_minor   bigint not null check (app.is_valid_amount_minor(amount_minor)),
  note           text check (length(btrim(note)) <= 280),
  created_at     timestamptz not null default now()
);

comment on table public.transaction_splits is
  'Parts of one transaction, typically splitting a mixed household/business charge. Splits sum exactly to the transaction amount.';

create index if not exists transaction_splits_transaction_idx
  on public.transaction_splits (transaction_id);

-- The invariant "splits שווים למקור" (02-FINANCIAL-RULES.md § אינווריאנטים) cannot
-- be a row check, because it is a property of the set. It is enforced by a
-- DEFERRABLE constraint trigger so that a multi-row edit is judged once, at
-- commit, on the final state — not midway through, when it is legitimately
-- inconsistent.
create or replace function app.assert_splits_match_transaction()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_transaction_id uuid := coalesce(new.transaction_id, old.transaction_id);
  v_amount bigint;
  v_split_total bigint;
  v_split_count integer;
begin
  select t.amount_minor into v_amount
  from public.transactions t
  where t.id = v_transaction_id;

  -- The parent is gone (household cascade). There is nothing left to reconcile.
  if not found then
    return null;
  end if;

  select coalesce(sum(s.amount_minor), 0), count(*)
    into v_split_total, v_split_count
  from public.transaction_splits s
  where s.transaction_id = v_transaction_id;

  -- Zero splits means the transaction is simply not split, which is valid.
  if v_split_count > 0 and v_split_total <> v_amount then
    raise exception
      'splits for transaction % total % but the transaction is %',
      v_transaction_id, v_split_total, v_amount
      using errcode = '23514';
  end if;

  return null;
end;
$$;

comment on function app.assert_splits_match_transaction() is
  'Deferred constraint: when a transaction has splits, they sum exactly to its amount.';

drop trigger if exists transaction_splits_sum_matches on public.transaction_splits;
create constraint trigger transaction_splits_sum_matches
  after insert or update or delete on public.transaction_splits
  deferrable initially deferred
  for each row execute function app.assert_splits_match_transaction();

-- ---------------------------------------------------------------------------
-- cashflow_items
-- ---------------------------------------------------------------------------

-- Future inflows and outflows. This is the table the forecast reads, and the one
-- place certainty is most easily confused with liquidity: `certainty` says how
-- sure we are the event happens, never whether the money is available today
-- (02-FINANCIAL-RULES.md § נזילות מול ודאות).
create table if not exists public.cashflow_items (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  scope        public.record_scope not null,
  account_id   uuid references public.financial_accounts (id) on delete set null,
  direction    public.flow_direction not null,
  amount_minor bigint not null check (app.is_valid_amount_minor(amount_minor)),
  currency     text not null default 'ILS' check (currency ~ '^[A-Z]{3}$'),
  label        text not null check (length(btrim(label)) between 1 and 160),
  category_id  uuid references public.categories (id) on delete set null,
  certainty    public.certainty_level not null,
  expected_date date not null,
  due_date      date,
  essential     boolean not null default false,
  settled_transaction_id uuid references public.transactions (id) on delete set null,
  created_by   uuid not null references public.profiles (id) on delete restrict,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  version      integer not null default 1
);

comment on column public.cashflow_items.certainty is
  'Confidence that the event happens. Not a liquidity statement: certain money that has not arrived is still not cash.';

drop trigger if exists cashflow_items_touch_updated_at on public.cashflow_items;
create trigger cashflow_items_touch_updated_at
  before update on public.cashflow_items
  for each row execute function app.touch_updated_at();

create index if not exists cashflow_items_household_expected_idx
  on public.cashflow_items (household_id, expected_date)
  where settled_transaction_id is null;

create index if not exists cashflow_items_due_idx
  on public.cashflow_items (household_id, due_date)
  where due_date is not null and settled_transaction_id is null;

-- ---------------------------------------------------------------------------
-- Automatic audit
-- ---------------------------------------------------------------------------

-- 07-SECURITY-PRIVACY.md requires every change to a household, business, debt,
-- opening balance or permission to be audited with actor and time. Doing it in
-- the application would leave the trail dependent on the caller remembering; a
-- trigger cannot be forgotten.
--
-- SECURITY DEFINER because audit_events has no INSERT policy for `authenticated`
-- by design — rows arrive only through code that stamps the actor from the
-- session, never from client input.
--
-- The recorded image is reduced to the column names passed as trigger arguments.
-- Free-text columns (notes, promises, merchant) are deliberately never passed:
-- 07-SECURITY-PRIVACY.md keeps the audit to metadata.
create or replace function app.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entity   text := tg_argv[0];
  v_keys     text[] := tg_argv[1:array_length(tg_argv, 1) - 1];
  v_before   jsonb;
  v_after    jsonb;
  v_row      jsonb;
  v_household uuid;
  v_entity_id uuid;
begin
  if tg_op <> 'INSERT' then
    select jsonb_object_agg(entry.key, entry.value) into v_before
    from jsonb_each(to_jsonb(old)) as entry
    where entry.key = any(v_keys);
  end if;

  if tg_op <> 'DELETE' then
    select jsonb_object_agg(entry.key, entry.value) into v_after
    from jsonb_each(to_jsonb(new)) as entry
    where entry.key = any(v_keys);
  end if;

  v_row := to_jsonb(coalesce(new, old));
  v_household := (v_row ->> 'household_id')::uuid;
  v_entity_id := (v_row ->> 'id')::uuid;

  insert into public.audit_events (
    household_id, actor_profile_id, action, entity_type, entity_id,
    before_state, after_state
  )
  values (
    v_household,
    (select auth.uid()),
    lower(tg_op),
    v_entity,
    v_entity_id,
    v_before,
    v_after
  );

  return null;
end;
$$;

comment on function app.audit_row_change() is
  'AFTER trigger: appends a reduced audit image. Arguments are the entity name followed by the column names allowed into the trail.';

revoke all on function app.audit_row_change() from public, anon, authenticated;

drop trigger if exists financial_accounts_audit on public.financial_accounts;
create trigger financial_accounts_audit
  after insert or update on public.financial_accounts
  for each row execute function app.audit_row_change(
    'financial_accounts', 'id', 'scope', 'kind', 'currency',
    'opening_balance_minor', 'opening_balance_direction', 'opening_balance_date', 'closed_at'
  );

drop trigger if exists account_balance_snapshots_audit on public.account_balance_snapshots;
create trigger account_balance_snapshots_audit
  after insert on public.account_balance_snapshots
  for each row execute function app.audit_row_change(
    'account_balance_snapshots', 'id', 'account_id', 'balance_minor',
    'balance_direction', 'verified_at', 'source'
  );

drop trigger if exists businesses_audit on public.businesses;
create trigger businesses_audit
  after insert or update on public.businesses
  for each row execute function app.audit_row_change(
    'businesses', 'id', 'tax_reserve_rate_bp'
  );
-- <<< END MIGRATION: 20260822100000_financial_accounts.sql

-- >>> BEGIN MIGRATION: 20260822100100_debt_domain.sql
-- Milestone 4 — the debt domain.
--
-- 02-FINANCIAL-RULES.md § גלגול חוב והחלפת נושה is the authority. Three rules are
-- built into the shape of these tables rather than left to application code:
--
--   1. Debt events are the truth. A balance is derived by replaying what happened,
--      never stored as a number that someone typed over the previous one. There is
--      deliberately no `current_balance_minor` column to drift out of date.
--   2. Repaying one creditor with another creditor's money is three facts: the old
--      debt was repaid, a new debt was created, and a link explains what funded the
--      repayment. The link changes no balance.
--   3. A link that was inferred from amount and timing is a proposal until a person
--      confirms it.
--
-- The balance is computed in packages/finance-engine, and only there. A second
-- implementation in SQL would be a second definition of "how much do we owe", and
-- the two would eventually disagree.

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'debt_kind' and n.nspname = 'public'
  ) then
    create type public.debt_kind as enum (
      'mortgage', 'bank_loan', 'revolving_credit', 'overdraft',
      'private_person', 'institution', 'other'
    );
  end if;

  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'debt_status' and n.nspname = 'public'
  ) then
    create type public.debt_status as enum ('active', 'settled', 'written_off');
  end if;

  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'debt_urgency' and n.nspname = 'public'
  ) then
    create type public.debt_urgency as enum ('none', 'watch', 'demanded', 'legal');
  end if;

  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'relationship_sensitivity' and n.nspname = 'public'
  ) then
    create type public.relationship_sensitivity as enum ('low', 'medium', 'high');
  end if;

  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'debt_event_kind' and n.nspname = 'public'
  ) then
    create type public.debt_event_kind as enum (
      'opening_balance', 'new_principal', 'principal_payment',
      'interest_charge', 'fee_charge', 'interest_paid', 'fee_paid',
      'balance_correction', 'write_off'
    );
  end if;

  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'correction_effect' and n.nspname = 'public'
  ) then
    create type public.correction_effect as enum ('increase', 'decrease');
  end if;

  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'rollover_source' and n.nspname = 'public'
  ) then
    create type public.rollover_source as enum ('user_confirmed', 'system_suggested');
  end if;

  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'rollover_status' and n.nspname = 'public'
  ) then
    create type public.rollover_status as enum ('proposed', 'confirmed', 'rejected');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- debts
-- ---------------------------------------------------------------------------

create table if not exists public.debts (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  kind          public.debt_kind not null,
  creditor_name text not null check (length(btrim(creditor_name)) between 1 and 160),
  currency      text not null default 'ILS' check (currency ~ '^[A-Z]{3}$'),
  status        public.debt_status not null default 'active',

  -- Basis points. NULL means the rate is unknown, and unknown is not zero:
  -- § קדימות חובות forbids claiming a precise saving when the rate is missing.
  effective_annual_rate_bp integer
    check (effective_annual_rate_bp is null or effective_annual_rate_bp between 0 and 1000000),

  minimum_payment_minor bigint
    check (minimum_payment_minor is null or app.is_valid_amount_minor(minimum_payment_minor)),
  payment_due_day integer check (payment_due_day is null or payment_due_day between 1 and 31),

  urgency       public.debt_urgency not null default 'none',

  -- Private-debt fields. 02-FINANCIAL-RULES.md § חובות לאנשים lists them, and
  -- states that a personal relationship is never silently converted into interest.
  promise_summary          text check (length(btrim(promise_summary)) <= 500),
  relationship_sensitivity public.relationship_sensitivity,
  partial_payment_allowed  boolean,
  last_demand_at           timestamptz,
  last_conversation_at     timestamptz,
  expected_call_date       date,

  notes         text check (length(btrim(notes)) <= 1000),
  opened_on     date not null,
  closed_at     timestamptz,
  created_by    uuid not null references public.profiles (id) on delete restrict,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  version       integer not null default 1,

  -- The relationship fields exist for a debt owed to a person and for no other
  -- kind. Enforced in both directions so an institutional debt cannot acquire a
  -- "sensitivity" that would then influence a ranking.
  constraint debts_relationship_fields_match_kind check (
    (kind = 'private_person'
      and relationship_sensitivity is not null
      and partial_payment_allowed is not null)
    or (kind <> 'private_person'
      and relationship_sensitivity is null
      and partial_payment_allowed is null)
  )
);

comment on table public.debts is
  'One row per creditor relationship. Balances are not stored here: they are replayed from debt_events.';
comment on column public.debts.effective_annual_rate_bp is
  'Effective annual cost in basis points. NULL means unknown, which is never treated as zero.';

drop trigger if exists debts_touch_updated_at on public.debts;
create trigger debts_touch_updated_at
  before update on public.debts
  for each row execute function app.touch_updated_at();

create index if not exists debts_household_idx
  on public.debts (household_id, kind)
  where status = 'active';

create index if not exists debts_urgency_idx
  on public.debts (household_id, urgency)
  where status = 'active';

drop trigger if exists debts_audit on public.debts;
create trigger debts_audit
  after insert or update on public.debts
  for each row execute function app.audit_row_change(
    'debts', 'id', 'kind', 'status', 'currency', 'effective_annual_rate_bp',
    'minimum_payment_minor', 'urgency', 'closed_at'
  );

-- ---------------------------------------------------------------------------
-- debt_events
-- ---------------------------------------------------------------------------

create table if not exists public.debt_events (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  debt_id       uuid not null references public.debts (id) on delete cascade,
  kind          public.debt_event_kind not null,
  amount_minor  bigint not null check (app.is_valid_amount_minor(amount_minor)),
  currency      text not null default 'ILS' check (currency ~ '^[A-Z]{3}$'),
  occurred_on   date not null,

  -- Only a correction carries an explicit direction. Every other kind takes its
  -- effect from the table in packages/contracts/src/debt.ts, so a row cannot
  -- claim an effect that contradicts its kind.
  correction_effect public.correction_effect,

  transaction_id uuid references public.transactions (id) on delete set null,
  note          text check (length(btrim(note)) <= 500),
  created_by    uuid not null references public.profiles (id) on delete restrict,
  created_at    timestamptz not null default now(),

  constraint debt_events_correction_direction check (
    (kind = 'balance_correction') = (correction_effect is not null)
  )
);

comment on table public.debt_events is
  'What happened to a debt. Append-only in intent: a mistake is corrected with a balance_correction event, which stays visibly separate from a repayment.';
comment on column public.debt_events.kind is
  'interest_paid and fee_paid do not reduce the balance: paying interest is not progress on principal.';

create index if not exists debt_events_debt_time_idx
  on public.debt_events (debt_id, occurred_on, created_at);

create index if not exists debt_events_household_time_idx
  on public.debt_events (household_id, occurred_on desc);

drop trigger if exists debt_events_audit on public.debt_events;
create trigger debt_events_audit
  after insert on public.debt_events
  for each row execute function app.audit_row_change(
    'debt_events', 'id', 'debt_id', 'kind', 'amount_minor', 'occurred_on', 'correction_effect'
  );

-- ---------------------------------------------------------------------------
-- debt_rollovers
-- ---------------------------------------------------------------------------

create table if not exists public.debt_rollovers (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  from_debt_id  uuid not null references public.debts (id) on delete cascade,
  to_debt_id    uuid not null references public.debts (id) on delete cascade,
  repayment_event_id   uuid not null references public.debt_events (id) on delete cascade,
  origination_event_id uuid not null references public.debt_events (id) on delete cascade,
  amount_minor  bigint not null check (app.is_valid_amount_minor(amount_minor)),
  occurred_on   date not null,
  source        public.rollover_source not null,
  status        public.rollover_status not null default 'proposed',
  confidence_bp integer check (confidence_bp is null or confidence_bp between 0 and 10000),
  notes         text check (length(btrim(notes)) <= 500),
  confirmed_by  uuid references public.profiles (id) on delete set null,
  confirmed_at  timestamptz,
  created_by    uuid not null references public.profiles (id) on delete restrict,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  version       integer not null default 1,

  constraint debt_rollovers_distinct_debts check (from_debt_id <> to_debt_id),
  constraint debt_rollovers_confirmation_is_recorded check (
    (status = 'confirmed') = (confirmed_at is not null)
  ),
  constraint debt_rollovers_inference_states_confidence check (
    source <> 'system_suggested' or confidence_bp is not null
  ),
  -- One link per pair of events. This is what makes confirming twice idempotent
  -- rather than producing a second link that would double-count the rollover
  -- (08-TEST-PLAN.md § גלגולי חוב).
  constraint debt_rollovers_one_per_event_pair
    unique (repayment_event_id, origination_event_id)
);

comment on table public.debt_rollovers is
  'Explains what funded a repayment. Changes no balance: the debt events are the truth and this row is the explanation.';

drop trigger if exists debt_rollovers_touch_updated_at on public.debt_rollovers;
create trigger debt_rollovers_touch_updated_at
  before update on public.debt_rollovers
  for each row execute function app.touch_updated_at();

create index if not exists debt_rollovers_household_idx
  on public.debt_rollovers (household_id, occurred_on desc);

create index if not exists debt_rollovers_from_debt_idx
  on public.debt_rollovers (from_debt_id);

create index if not exists debt_rollovers_to_debt_idx
  on public.debt_rollovers (to_debt_id);

-- A link must describe events that actually exist, on the debts it names, of the
-- kinds it claims, in the same household. Without this a row could assert a
-- funding relationship between unrelated events and quietly change what the debt
-- meter reports as progress.
create or replace function app.assert_rollover_references()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_repayment public.debt_events%rowtype;
  v_origination public.debt_events%rowtype;
begin
  select * into v_repayment
  from public.debt_events e where e.id = new.repayment_event_id;

  if not found then
    raise exception 'repayment event % does not exist', new.repayment_event_id
      using errcode = '23503';
  end if;

  select * into v_origination
  from public.debt_events e where e.id = new.origination_event_id;

  if not found then
    raise exception 'origination event % does not exist', new.origination_event_id
      using errcode = '23503';
  end if;

  if v_repayment.debt_id <> new.from_debt_id then
    raise exception 'repayment event belongs to debt %, not %',
      v_repayment.debt_id, new.from_debt_id using errcode = '23514';
  end if;

  if v_origination.debt_id <> new.to_debt_id then
    raise exception 'origination event belongs to debt %, not %',
      v_origination.debt_id, new.to_debt_id using errcode = '23514';
  end if;

  if v_repayment.kind <> 'principal_payment' then
    raise exception 'a rollover is funded by a principal_payment, not a %', v_repayment.kind
      using errcode = '23514';
  end if;

  if v_origination.kind <> 'new_principal' then
    raise exception 'a rollover creates new_principal, not a %', v_origination.kind
      using errcode = '23514';
  end if;

  if v_repayment.household_id <> new.household_id
     or v_origination.household_id <> new.household_id then
    raise exception 'a rollover cannot span households' using errcode = '42501';
  end if;

  -- The link cannot claim to have funded more than either event moved.
  if new.amount_minor > v_repayment.amount_minor
     or new.amount_minor > v_origination.amount_minor then
    raise exception 'rollover amount % exceeds the events it links', new.amount_minor
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function app.assert_rollover_references() is
  'Validates that a rollover link points at a real principal_payment and new_principal in the same household, for no more than either event moved.';

drop trigger if exists debt_rollovers_validate_references on public.debt_rollovers;
create trigger debt_rollovers_validate_references
  before insert or update on public.debt_rollovers
  for each row execute function app.assert_rollover_references();

drop trigger if exists debt_rollovers_audit on public.debt_rollovers;
create trigger debt_rollovers_audit
  after insert or update on public.debt_rollovers
  for each row execute function app.audit_row_change(
    'debt_rollovers', 'id', 'from_debt_id', 'to_debt_id', 'amount_minor',
    'occurred_on', 'source', 'status', 'confidence_bp'
  );
-- <<< END MIGRATION: 20260822100100_debt_domain.sql

-- >>> BEGIN MIGRATION: 20260822100200_financial_row_security.sql
-- Milestones 3 and 4 — Row Level Security for the financial and debt tables.
--
-- Same rules as the identity migration (20260816090400_rls_policies.sql):
-- enabled AND forced on every table, one policy per command, membership as the
-- only isolation boundary, and no DELETE on anything that represents money.
--
-- One hazard is specific to this milestone. Foreign keys are checked with the
-- privileges of the table owner and are NOT filtered by Row Level Security, so a
-- member of household A can name a row belonging to household B in a foreign key
-- column and the constraint will happily accept it. Membership on the row being
-- written is therefore not enough: every policy that accepts a reference also
-- proves the referenced row is visible to the caller. That is what the
-- app.household_owns_* helpers below are for.

-- ---------------------------------------------------------------------------
-- Reference ownership helpers
-- ---------------------------------------------------------------------------

-- SECURITY INVOKER on purpose, unlike app.is_household_member(). These read
-- tables that already carry their own policies, so running them as the caller
-- means an invisible row simply does not exist as far as the check is concerned.
-- A definer here would see everything and defeat the point.

create or replace function app.household_owns_account(
  p_household_id uuid,
  p_account_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select p_account_id is null or exists (
    select 1 from public.financial_accounts a
    where a.id = p_account_id and a.household_id = p_household_id
  );
$$;

create or replace function app.household_owns_business(
  p_household_id uuid,
  p_business_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select p_business_id is null or exists (
    select 1 from public.businesses b
    where b.id = p_business_id and b.household_id = p_household_id
  );
$$;

create or replace function app.household_owns_transaction(
  p_household_id uuid,
  p_transaction_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select p_transaction_id is null or exists (
    select 1 from public.transactions t
    where t.id = p_transaction_id and t.household_id = p_household_id
  );
$$;

create or replace function app.household_owns_category(
  p_household_id uuid,
  p_category_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select p_category_id is null or exists (
    select 1 from public.categories c
    where c.id = p_category_id and c.household_id = p_household_id
  );
$$;

create or replace function app.household_owns_debt(
  p_household_id uuid,
  p_debt_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select p_debt_id is null or exists (
    select 1 from public.debts d
    where d.id = p_debt_id and d.household_id = p_household_id
  );
$$;

create or replace function app.household_owns_debt_event(
  p_household_id uuid,
  p_event_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select p_event_id is null or exists (
    select 1 from public.debt_events e
    where e.id = p_event_id and e.household_id = p_household_id
  );
$$;

do $$
declare
  v_function text;
begin
  foreach v_function in array array[
    'app.household_owns_account(uuid, uuid)',
    'app.household_owns_business(uuid, uuid)',
    'app.household_owns_transaction(uuid, uuid)',
    'app.household_owns_category(uuid, uuid)',
    'app.household_owns_debt(uuid, uuid)',
    'app.household_owns_debt_event(uuid, uuid)'
  ]
  loop
    execute format('revoke all on function %s from public, anon', v_function);
    execute format('grant execute on function %s to authenticated', v_function);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- businesses
-- ---------------------------------------------------------------------------

alter table public.businesses enable row level security;
alter table public.businesses force row level security;

drop policy if exists businesses_select_member on public.businesses;
create policy businesses_select_member
  on public.businesses
  for select
  to authenticated
  using (app.is_household_member(household_id));

drop policy if exists businesses_insert_member on public.businesses;
create policy businesses_insert_member
  on public.businesses
  for insert
  to authenticated
  with check (app.is_household_member(household_id));

drop policy if exists businesses_update_member on public.businesses;
create policy businesses_update_member
  on public.businesses
  for update
  to authenticated
  using (app.is_household_member(household_id))
  with check (app.is_household_member(household_id));

-- ---------------------------------------------------------------------------
-- financial_accounts
-- ---------------------------------------------------------------------------

alter table public.financial_accounts enable row level security;
alter table public.financial_accounts force row level security;

drop policy if exists financial_accounts_select_member on public.financial_accounts;
create policy financial_accounts_select_member
  on public.financial_accounts
  for select
  to authenticated
  using (app.is_household_member(household_id));

drop policy if exists financial_accounts_insert_member on public.financial_accounts;
create policy financial_accounts_insert_member
  on public.financial_accounts
  for insert
  to authenticated
  with check (
    app.is_household_member(household_id)
    and app.household_owns_business(household_id, business_id)
  );

drop policy if exists financial_accounts_update_member on public.financial_accounts;
create policy financial_accounts_update_member
  on public.financial_accounts
  for update
  to authenticated
  using (app.is_household_member(household_id))
  with check (
    app.is_household_member(household_id)
    and app.household_owns_business(household_id, business_id)
  );

-- ---------------------------------------------------------------------------
-- account_balance_snapshots
-- ---------------------------------------------------------------------------

alter table public.account_balance_snapshots enable row level security;
alter table public.account_balance_snapshots force row level security;

drop policy if exists account_balance_snapshots_select_member on public.account_balance_snapshots;
create policy account_balance_snapshots_select_member
  on public.account_balance_snapshots
  for select
  to authenticated
  using (app.is_household_member(household_id));

drop policy if exists account_balance_snapshots_insert_member on public.account_balance_snapshots;
create policy account_balance_snapshots_insert_member
  on public.account_balance_snapshots
  for insert
  to authenticated
  with check (
    app.is_household_member(household_id)
    and app.household_owns_account(household_id, account_id)
    and created_by = (select auth.uid())
  );

-- No UPDATE and no DELETE. A reconciliation record is a statement about a moment
-- in time; correcting it means recording a newer one, not rewriting history.

-- ---------------------------------------------------------------------------
-- categories
-- ---------------------------------------------------------------------------

alter table public.categories enable row level security;
alter table public.categories force row level security;

drop policy if exists categories_select_member on public.categories;
create policy categories_select_member
  on public.categories
  for select
  to authenticated
  using (app.is_household_member(household_id));

drop policy if exists categories_insert_member on public.categories;
create policy categories_insert_member
  on public.categories
  for insert
  to authenticated
  with check (app.is_household_member(household_id));

drop policy if exists categories_update_member on public.categories;
create policy categories_update_member
  on public.categories
  for update
  to authenticated
  using (app.is_household_member(household_id))
  with check (app.is_household_member(household_id));

-- ---------------------------------------------------------------------------
-- transactions
-- ---------------------------------------------------------------------------

alter table public.transactions enable row level security;
alter table public.transactions force row level security;

drop policy if exists transactions_select_member on public.transactions;
create policy transactions_select_member
  on public.transactions
  for select
  to authenticated
  using (app.is_household_member(household_id));

drop policy if exists transactions_insert_member on public.transactions;
create policy transactions_insert_member
  on public.transactions
  for insert
  to authenticated
  with check (
    app.is_household_member(household_id)
    and app.household_owns_account(household_id, account_id)
    and app.household_owns_account(household_id, counterpart_account_id)
    and app.household_owns_category(household_id, category_id)
    and app.household_owns_transaction(household_id, refunds_transaction_id)
    and app.household_owns_transaction(household_id, corrects_transaction_id)
    and created_by = (select auth.uid())
  );

-- Both partners may edit: 01-PRODUCT-SPEC.md gives them equal permission. The
-- audit trail records who changed what, which is the control here — not a role.
drop policy if exists transactions_update_member on public.transactions;
create policy transactions_update_member
  on public.transactions
  for update
  to authenticated
  using (app.is_household_member(household_id))
  with check (
    app.is_household_member(household_id)
    and app.household_owns_account(household_id, account_id)
    and app.household_owns_account(household_id, counterpart_account_id)
    and app.household_owns_category(household_id, category_id)
  );

-- No DELETE policy. Money records are voided or corrected, never erased
-- (05-ARCHITECTURE-DATA.md: "כספים לא נמחקים; void/correction").

-- ---------------------------------------------------------------------------
-- transaction_splits
-- ---------------------------------------------------------------------------

alter table public.transaction_splits enable row level security;
alter table public.transaction_splits force row level security;

drop policy if exists transaction_splits_select_member on public.transaction_splits;
create policy transaction_splits_select_member
  on public.transaction_splits
  for select
  to authenticated
  using (app.is_household_member(household_id));

drop policy if exists transaction_splits_insert_member on public.transaction_splits;
create policy transaction_splits_insert_member
  on public.transaction_splits
  for insert
  to authenticated
  with check (
    app.is_household_member(household_id)
    and app.household_owns_transaction(household_id, transaction_id)
    and app.household_owns_category(household_id, category_id)
  );

drop policy if exists transaction_splits_update_member on public.transaction_splits;
create policy transaction_splits_update_member
  on public.transaction_splits
  for update
  to authenticated
  using (app.is_household_member(household_id))
  with check (
    app.is_household_member(household_id)
    and app.household_owns_transaction(household_id, transaction_id)
    and app.household_owns_category(household_id, category_id)
  );

-- The one DELETE policy in the schema, and it is deliberate. A split is a
-- classification of a transaction, not a money record: removing every split
-- leaves the transaction and its amount untouched, it only stops the amount from
-- being divided. The deferred constraint trigger still holds afterwards, because
-- "no splits" is a valid state and a partial set is not.
drop policy if exists transaction_splits_delete_member on public.transaction_splits;
create policy transaction_splits_delete_member
  on public.transaction_splits
  for delete
  to authenticated
  using (app.is_household_member(household_id));

-- ---------------------------------------------------------------------------
-- cashflow_items
-- ---------------------------------------------------------------------------

alter table public.cashflow_items enable row level security;
alter table public.cashflow_items force row level security;

drop policy if exists cashflow_items_select_member on public.cashflow_items;
create policy cashflow_items_select_member
  on public.cashflow_items
  for select
  to authenticated
  using (app.is_household_member(household_id));

drop policy if exists cashflow_items_insert_member on public.cashflow_items;
create policy cashflow_items_insert_member
  on public.cashflow_items
  for insert
  to authenticated
  with check (
    app.is_household_member(household_id)
    and app.household_owns_account(household_id, account_id)
    and app.household_owns_category(household_id, category_id)
    and app.household_owns_transaction(household_id, settled_transaction_id)
    and created_by = (select auth.uid())
  );

drop policy if exists cashflow_items_update_member on public.cashflow_items;
create policy cashflow_items_update_member
  on public.cashflow_items
  for update
  to authenticated
  using (app.is_household_member(household_id))
  with check (
    app.is_household_member(household_id)
    and app.household_owns_account(household_id, account_id)
    and app.household_owns_category(household_id, category_id)
    and app.household_owns_transaction(household_id, settled_transaction_id)
  );

-- ---------------------------------------------------------------------------
-- debts
-- ---------------------------------------------------------------------------

alter table public.debts enable row level security;
alter table public.debts force row level security;

drop policy if exists debts_select_member on public.debts;
create policy debts_select_member
  on public.debts
  for select
  to authenticated
  using (app.is_household_member(household_id));

drop policy if exists debts_insert_member on public.debts;
create policy debts_insert_member
  on public.debts
  for insert
  to authenticated
  with check (
    app.is_household_member(household_id)
    and created_by = (select auth.uid())
  );

drop policy if exists debts_update_member on public.debts;
create policy debts_update_member
  on public.debts
  for update
  to authenticated
  using (app.is_household_member(household_id))
  with check (app.is_household_member(household_id));

-- ---------------------------------------------------------------------------
-- debt_events
-- ---------------------------------------------------------------------------

alter table public.debt_events enable row level security;
alter table public.debt_events force row level security;

drop policy if exists debt_events_select_member on public.debt_events;
create policy debt_events_select_member
  on public.debt_events
  for select
  to authenticated
  using (app.is_household_member(household_id));

drop policy if exists debt_events_insert_member on public.debt_events;
create policy debt_events_insert_member
  on public.debt_events
  for insert
  to authenticated
  with check (
    app.is_household_member(household_id)
    and app.household_owns_debt(household_id, debt_id)
    and app.household_owns_transaction(household_id, transaction_id)
    and created_by = (select auth.uid())
  );

-- Neither UPDATE nor DELETE. Debt events are the truth about what happened; an
-- error is fixed with a balance_correction event, which stays visible as a
-- correction and is never counted as a repayment.

-- ---------------------------------------------------------------------------
-- debt_rollovers
-- ---------------------------------------------------------------------------

alter table public.debt_rollovers enable row level security;
alter table public.debt_rollovers force row level security;

drop policy if exists debt_rollovers_select_member on public.debt_rollovers;
create policy debt_rollovers_select_member
  on public.debt_rollovers
  for select
  to authenticated
  using (app.is_household_member(household_id));

drop policy if exists debt_rollovers_insert_member on public.debt_rollovers;
create policy debt_rollovers_insert_member
  on public.debt_rollovers
  for insert
  to authenticated
  with check (
    app.is_household_member(household_id)
    and app.household_owns_debt(household_id, from_debt_id)
    and app.household_owns_debt(household_id, to_debt_id)
    and app.household_owns_debt_event(household_id, repayment_event_id)
    and app.household_owns_debt_event(household_id, origination_event_id)
    and created_by = (select auth.uid())
  );

-- Confirming or rejecting a proposed link is an UPDATE. A person must be able to
-- do it, because an inferred link is only a proposal until they do.
drop policy if exists debt_rollovers_update_member on public.debt_rollovers;
create policy debt_rollovers_update_member
  on public.debt_rollovers
  for update
  to authenticated
  using (app.is_household_member(household_id))
  with check (
    app.is_household_member(household_id)
    and app.household_owns_debt(household_id, from_debt_id)
    and app.household_owns_debt(household_id, to_debt_id)
  );

-- ---------------------------------------------------------------------------
-- Table-level grants
-- ---------------------------------------------------------------------------

-- Policies filter rows; grants decide whether the verb exists at all. A table
-- with no policy for a command is already closed, but revoking first means a
-- future policy cannot accidentally open a verb that was never intended.
revoke all on public.businesses from anon, authenticated;
revoke all on public.financial_accounts from anon, authenticated;
revoke all on public.account_balance_snapshots from anon, authenticated;
revoke all on public.categories from anon, authenticated;
revoke all on public.transactions from anon, authenticated;
revoke all on public.transaction_splits from anon, authenticated;
revoke all on public.cashflow_items from anon, authenticated;
revoke all on public.debts from anon, authenticated;
revoke all on public.debt_events from anon, authenticated;
revoke all on public.debt_rollovers from anon, authenticated;

grant select, insert, update on public.businesses to authenticated;
grant select, insert, update on public.financial_accounts to authenticated;
grant select, insert on public.account_balance_snapshots to authenticated;
grant select, insert, update on public.categories to authenticated;
grant select, insert, update on public.transactions to authenticated;
grant select, insert, update, delete on public.transaction_splits to authenticated;
grant select, insert, update on public.cashflow_items to authenticated;
grant select, insert, update on public.debts to authenticated;
grant select, insert on public.debt_events to authenticated;
grant select, insert, update on public.debt_rollovers to authenticated;

-- `anon` receives nothing. An unauthenticated caller reaches no financial table.
-- <<< END MIGRATION: 20260822100200_financial_row_security.sql

commit;
