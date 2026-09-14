-- Every migration in this repository, in one atomic transaction.
--
-- GENERATED FILE. Do not edit.
--   source: supabase/migrations/*.sql
--   regenerate: npm run db:build
--   verified by: tools/manual-sql.test.mjs
--
-- Contains 15 migrations, in filename order:
--   1. 20260816090000_identity_foundation.sql
--   2. 20260816090100_profiles_households.sql
--   3. 20260816090200_invitations.sql
--   4. 20260816090300_audit_events.sql
--   5. 20260816090400_rls_policies.sql
--   6. 20260822100000_financial_accounts.sql
--   7. 20260822100100_debt_domain.sql
--   8. 20260822100200_financial_row_security.sql
--   9. 20260823110000_budgets.sql
--   10. 20260823110100_budget_row_security.sql
--   11. 20260908120000_gemach_and_checks.sql
--   12. 20260908120100_imports_and_documents.sql
--   13. 20260908120200_household_settings_and_tasks.sql
--   14. 20260908120300_access_and_notifications.sql
--   15. 20260908120400_new_tables_row_security.sql
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

-- >>> BEGIN MIGRATION: 20260823110000_budgets.sql
-- Milestone 6b — the monthly budget.
--
-- 01-PRODUCT-SPEC.md § Must: "תקציב קטגוריאלי מוצע, לא מופעל ללא אישור".
-- Two shapes carry that rule:
--
--   * A budget is a plan. Nothing in these tables is a balance, and no column can
--     be mistaken for one. Changing a plan never moves money.
--   * Moving money between categories is a proposal until a person approves it.
--     `budget_changes` exists precisely so that enlarging food at the expense of
--     something else is a visible, audited decision rather than a silent edit —
--     a budget that can grow on its own has stopped being a budget.
--
-- Every object here is re-runnable (ADR-0015).

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'budget_status' and n.nspname = 'public'
  ) then
    create type public.budget_status as enum ('draft', 'active', 'archived');
  end if;

  -- A fixed set, not free text: the copy layer names each one in plain Hebrew and
  -- the weekly food guidance attaches to a stable key. 01-PRODUCT-SPEC.md
  -- § מחוץ לתכולה forbids recommending cuts to religious or educational spending,
  -- so those are ordinary categories here and never candidates for elimination.
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'budget_category_key' and n.nspname = 'public'
  ) then
    create type public.budget_category_key as enum (
      'food', 'housing_and_bills', 'transport_and_fuel', 'health', 'education',
      'clothing', 'celebrations_and_gifts', 'cash_and_small', 'holidays', 'other'
    );
  end if;

  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'budget_change_status' and n.nspname = 'public'
  ) then
    create type public.budget_change_status as enum ('proposed', 'approved', 'rejected');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- budgets
-- ---------------------------------------------------------------------------

create table if not exists public.budgets (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  -- The month this budget plans, as YYYY-MM in the household's time zone.
  period        text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  status        public.budget_status not null default 'draft',
  currency      text not null default 'ILS' check (currency ~ '^[A-Z]{3}$'),
  -- 03-UX-SPEC.md: a first month is a low-confidence draft. The flag travels with
  -- the row so no screen has to infer it from dates.
  is_first_month_draft boolean not null default false,
  created_by    uuid not null references public.profiles (id) on delete restrict,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  version       integer not null default 1,

  constraint budgets_one_per_period unique (household_id, period)
);

comment on table public.budgets is
  'A monthly plan. Holds no money and changes no balance.';

drop trigger if exists budgets_touch_updated_at on public.budgets;
create trigger budgets_touch_updated_at
  before update on public.budgets
  for each row execute function app.touch_updated_at();

create index if not exists budgets_household_period_idx
  on public.budgets (household_id, period desc);

drop trigger if exists budgets_audit on public.budgets;
create trigger budgets_audit
  after insert or update on public.budgets
  for each row execute function app.audit_row_change(
    'budgets', 'id', 'period', 'status', 'currency', 'is_first_month_draft'
  );

-- ---------------------------------------------------------------------------
-- budget_lines
-- ---------------------------------------------------------------------------

create table if not exists public.budget_lines (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  budget_id     uuid not null references public.budgets (id) on delete cascade,
  category_id   uuid not null references public.categories (id) on delete restrict,
  category_key  public.budget_category_key not null,
  planned_minor bigint not null check (app.is_valid_amount_minor(planned_minor)),
  -- Food is the category a family steers weekly, so it is the one that also
  -- produces guidance on the home screen. The flag is data, not a hard-coded name.
  weekly_guidance boolean not null default false,
  note          text check (length(btrim(note)) <= 280),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  version       integer not null default 1,

  constraint budget_lines_one_per_category unique (budget_id, category_id)
);

comment on column public.budget_lines.planned_minor is
  'Planned spending for the period. A plan, never a balance.';

drop trigger if exists budget_lines_touch_updated_at on public.budget_lines;
create trigger budget_lines_touch_updated_at
  before update on public.budget_lines
  for each row execute function app.touch_updated_at();

create index if not exists budget_lines_budget_idx
  on public.budget_lines (budget_id);

create index if not exists budget_lines_weekly_idx
  on public.budget_lines (household_id)
  where weekly_guidance;

drop trigger if exists budget_lines_audit on public.budget_lines;
create trigger budget_lines_audit
  after insert or update on public.budget_lines
  for each row execute function app.audit_row_change(
    'budget_lines', 'id', 'budget_id', 'category_id', 'category_key',
    'planned_minor', 'weekly_guidance'
  );

-- ---------------------------------------------------------------------------
-- budget_changes
-- ---------------------------------------------------------------------------

-- A transfer between categories, and never an increase. If the family wants more
-- for food, something else gives, and this row records which — with who proposed
-- it and who approved it.
create table if not exists public.budget_changes (
  id               uuid primary key default gen_random_uuid(),
  household_id     uuid not null references public.households (id) on delete cascade,
  budget_id        uuid not null references public.budgets (id) on delete cascade,
  from_category_id uuid not null references public.categories (id) on delete restrict,
  to_category_id   uuid not null references public.categories (id) on delete restrict,
  amount_minor     bigint not null check (app.is_valid_amount_minor(amount_minor) and amount_minor > 0),
  reason           text check (length(btrim(reason)) <= 280),
  status           public.budget_change_status not null default 'proposed',
  proposed_by      uuid not null references public.profiles (id) on delete restrict,
  approved_by      uuid references public.profiles (id) on delete set null,
  approved_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  version          integer not null default 1,

  constraint budget_changes_distinct_categories check (from_category_id <> to_category_id),
  constraint budget_changes_approval_is_recorded check (
    (status = 'approved') = (approved_at is not null)
  )
);

comment on table public.budget_changes is
  'Proposed movements of planned money between categories. Proposed until approved, and audited either way.';

drop trigger if exists budget_changes_touch_updated_at on public.budget_changes;
create trigger budget_changes_touch_updated_at
  before update on public.budget_changes
  for each row execute function app.touch_updated_at();

create index if not exists budget_changes_budget_idx
  on public.budget_changes (budget_id, created_at desc);

create index if not exists budget_changes_pending_idx
  on public.budget_changes (household_id)
  where status = 'proposed';

drop trigger if exists budget_changes_audit on public.budget_changes;
create trigger budget_changes_audit
  after insert or update on public.budget_changes
  for each row execute function app.audit_row_change(
    'budget_changes', 'id', 'budget_id', 'from_category_id', 'to_category_id',
    'amount_minor', 'status', 'approved_at'
  );
-- <<< END MIGRATION: 20260823110000_budgets.sql

-- >>> BEGIN MIGRATION: 20260823110100_budget_row_security.sql
-- Milestone 6b — Row Level Security for the budget tables.
--
-- Same rules as every other private table: enabled and forced, one policy per
-- command, membership as the only boundary, no DELETE on anything.
--
-- And the same hazard as the financial tables: foreign keys are checked with the
-- table owner's privileges and are not filtered by RLS, so every policy that
-- accepts a reference proves the referenced row is visible to the caller.

create or replace function app.household_owns_budget(
  p_household_id uuid,
  p_budget_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select p_budget_id is null or exists (
    select 1 from public.budgets b
    where b.id = p_budget_id and b.household_id = p_household_id
  );
$$;

do $$
begin
  execute 'revoke all on function app.household_owns_budget(uuid, uuid) from public, anon';
  execute 'grant execute on function app.household_owns_budget(uuid, uuid) to authenticated';
end
$$;

-- ---------------------------------------------------------------------------
-- budgets
-- ---------------------------------------------------------------------------

alter table public.budgets enable row level security;
alter table public.budgets force row level security;

drop policy if exists budgets_select_member on public.budgets;
create policy budgets_select_member
  on public.budgets
  for select
  to authenticated
  using (app.is_household_member(household_id));

drop policy if exists budgets_insert_member on public.budgets;
create policy budgets_insert_member
  on public.budgets
  for insert
  to authenticated
  with check (
    app.is_household_member(household_id)
    and created_by = (select auth.uid())
  );

drop policy if exists budgets_update_member on public.budgets;
create policy budgets_update_member
  on public.budgets
  for update
  to authenticated
  using (app.is_household_member(household_id))
  with check (app.is_household_member(household_id));

-- ---------------------------------------------------------------------------
-- budget_lines
-- ---------------------------------------------------------------------------

alter table public.budget_lines enable row level security;
alter table public.budget_lines force row level security;

drop policy if exists budget_lines_select_member on public.budget_lines;
create policy budget_lines_select_member
  on public.budget_lines
  for select
  to authenticated
  using (app.is_household_member(household_id));

drop policy if exists budget_lines_insert_member on public.budget_lines;
create policy budget_lines_insert_member
  on public.budget_lines
  for insert
  to authenticated
  with check (
    app.is_household_member(household_id)
    and app.household_owns_budget(household_id, budget_id)
    and app.household_owns_category(household_id, category_id)
  );

drop policy if exists budget_lines_update_member on public.budget_lines;
create policy budget_lines_update_member
  on public.budget_lines
  for update
  to authenticated
  using (app.is_household_member(household_id))
  with check (
    app.is_household_member(household_id)
    and app.household_owns_budget(household_id, budget_id)
    and app.household_owns_category(household_id, category_id)
  );

-- ---------------------------------------------------------------------------
-- budget_changes
-- ---------------------------------------------------------------------------

alter table public.budget_changes enable row level security;
alter table public.budget_changes force row level security;

drop policy if exists budget_changes_select_member on public.budget_changes;
create policy budget_changes_select_member
  on public.budget_changes
  for select
  to authenticated
  using (app.is_household_member(household_id));

drop policy if exists budget_changes_insert_member on public.budget_changes;
create policy budget_changes_insert_member
  on public.budget_changes
  for insert
  to authenticated
  with check (
    app.is_household_member(household_id)
    and app.household_owns_budget(household_id, budget_id)
    and app.household_owns_category(household_id, from_category_id)
    and app.household_owns_category(household_id, to_category_id)
    and proposed_by = (select auth.uid())
  );

-- Approving or rejecting a proposal is an UPDATE, and either partner may do it:
-- 01-PRODUCT-SPEC.md gives them equal permission and one approval is enough.
drop policy if exists budget_changes_update_member on public.budget_changes;
create policy budget_changes_update_member
  on public.budget_changes
  for update
  to authenticated
  using (app.is_household_member(household_id))
  with check (app.is_household_member(household_id));

-- No DELETE anywhere here. A rejected proposal stays as a rejected proposal:
-- the history of what was considered is part of the audit trail.

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on public.budgets from anon, authenticated;
revoke all on public.budget_lines from anon, authenticated;
revoke all on public.budget_changes from anon, authenticated;

grant select, insert, update on public.budgets to authenticated;
grant select, insert, update on public.budget_lines to authenticated;
grant select, insert, update on public.budget_changes to authenticated;
-- <<< END MIGRATION: 20260823110100_budget_row_security.sql

-- >>> BEGIN MIGRATION: 20260908120000_gemach_and_checks.sql
-- Milestone 9 — gemach loans and the post-dated checks that repay them.
--
-- ADR-0030 is the authority, and the one sentence it turns on is the reason this
-- migration exists as its own set of tables rather than columns on `debts`:
--
--   Handing a check to the gemach changes no number.
--   The bank honouring it changes exactly two, exactly once.
--
-- Three separate facts, three separate records, and the schema is shaped so they
-- cannot be merged:
--
--   1. The debt exists          -> public.debts + an opening_balance event
--   2. A check was handed over  -> a row here, and nothing else moves
--   3. The bank honoured it     -> a transaction AND a principal_payment, both
--                                  linked from the check row
--
-- The links in (3) are what make double counting structurally impossible rather
-- than merely unlikely. A check carries at most one `cleared_transaction_id` and
-- at most one `debt_event_id`, and both are permitted only in the `cleared`
-- state — so a statement imported twice cannot produce two repayments for one
-- piece of paper.
--
-- `due` is deliberately not a stored status. It is what today's date makes of a
-- check nobody has cashed; storing it would mean a value that is correct when
-- written and quietly wrong the next morning, with a family depending on a
-- background job to tell them a check is late. Urgency is derived on read, in
-- packages/finance-engine, and only there.

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------

-- A gemach is its own kind of creditor. Not `institution` and not
-- `private_person`: it charges no interest, which changes what progress means,
-- and it is repaid through paper handed over in advance, which no other kind is.
--
-- ADD VALUE is separated from any use of the value. PostgreSQL will not let a
-- new enum label be used in the same transaction that created it, so the tables
-- below reference `debt_kind` only through foreign keys, never as a literal.
alter type public.debt_kind add value if not exists 'gemach';

do $$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'check_status' and n.nspname = 'public'
  ) then
    -- What has actually happened to the paper. `cleared` is the only state in
    -- which money moved.
    create type public.check_status as enum (
      'prepared',   -- written, still in the chequebook, nobody else can cash it
      'delivered',  -- handed over; can be presented at any moment
      'deposited',  -- known to be at the bank, not yet honoured
      'cleared',    -- the bank paid it
      'returned',   -- presented and not honoured; not a payment
      'cancelled',  -- withdrawn by agreement, with a reason
      'replaced'    -- swapped for another check, which is linked
    );
  end if;

  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'check_source' and n.nspname = 'public'
  ) then
    create type public.check_source as enum ('manual', 'import', 'reconciliation');
  end if;

  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'repayment_cadence' and n.nspname = 'public'
  ) then
    -- Monthly is the only cadence a gemach uses in practice. Kept as an enum so
    -- adding another is a migration rather than a free-text field nobody parses.
    create type public.repayment_cadence as enum ('monthly');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- repayment_plans — what was agreed, which is not what has been written
-- ---------------------------------------------------------------------------
--
-- Separate from the checks because either can exist without the other: a plan
-- may be agreed before a single check is written, and checks can be handed over
-- for an arrangement nobody wrote down. Keeping them apart is what lets the
-- product answer "do the checks actually cover what we owe?" — a question with
-- no meaning if the plan is defined as the sum of the checks.

create table if not exists public.repayment_plans (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  debt_id       uuid not null references public.debts (id) on delete cascade,

  -- The arrangement in the family's own words. Never parsed, only shown.
  agreement_summary text check (length(btrim(agreement_summary)) <= 1000),

  installment_count        integer not null check (installment_count between 1 and 600),
  installment_amount_minor bigint  not null
    check (app.is_valid_amount_minor(installment_amount_minor) and installment_amount_minor > 0),

  -- A different last payment, when the total does not divide evenly. NULL when
  -- every installment is the same.
  final_installment_amount_minor bigint
    check (final_installment_amount_minor is null
      or (app.is_valid_amount_minor(final_installment_amount_minor)
          and final_installment_amount_minor > 0)),

  first_due_date date not null,
  cadence        public.repayment_cadence not null default 'monthly',

  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version    integer not null default 1,

  -- One agreement per debt. A second row would be a second answer to "what did
  -- we agree", and the screens would have to choose between them.
  constraint repayment_plans_one_per_debt unique (debt_id)
);

comment on table public.repayment_plans is
  'What was agreed with the lender. The checks are the paper; this is the arrangement, and the two are compared rather than merged.';
comment on column public.repayment_plans.final_installment_amount_minor is
  'A different last payment when the total does not divide evenly. NULL when every installment is equal.';

drop trigger if exists repayment_plans_touch_updated_at on public.repayment_plans;
create trigger repayment_plans_touch_updated_at
  before update on public.repayment_plans
  for each row execute function app.touch_updated_at();

create index if not exists repayment_plans_household_idx
  on public.repayment_plans (household_id, debt_id);

-- ---------------------------------------------------------------------------
-- post_dated_checks — the paper, and what has happened to it
-- ---------------------------------------------------------------------------

create table if not exists public.post_dated_checks (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,

  -- Every check repays exactly one debt, and is drawn on exactly one account.
  debt_id    uuid not null references public.debts (id) on delete cascade,
  account_id uuid not null references public.financial_accounts (id) on delete restrict,

  -- Optional, because a borrower does not always write them down and a model
  -- that demands one produces invented data. Digits only: anything else is
  -- somebody typing a note into the wrong field.
  check_number text check (check_number is null or check_number ~ '^[0-9]{1,12}$'),

  amount_minor bigint not null
    check (app.is_valid_amount_minor(amount_minor) and amount_minor > 0),
  currency text not null default 'ILS' check (currency ~ '^[A-Z]{3}$'),

  -- The date printed on the paper: the earliest it should be presented.
  due_date date not null,
  -- When it was physically handed over. NULL until it is.
  delivered_on date,

  payee_name text not null check (length(btrim(payee_name)) between 1 and 160),
  installment_number integer check (installment_number is null or installment_number between 1 and 600),
  note text check (length(btrim(note)) <= 500),

  source public.check_source not null default 'manual',
  status public.check_status not null default 'prepared',

  -- Set only in `cleared`. The two links below are the whole defence against
  -- one piece of paper becoming two repayments.
  cleared_on            date,
  cleared_transaction_id uuid references public.transactions (id) on delete restrict,
  debt_event_id          uuid references public.debt_events (id) on delete restrict,

  returned_on date,
  -- Required for `cancelled` and `returned`. Blame-free wording is a product
  -- rule; that it exists at all is a schema rule.
  resolution_reason text check (length(btrim(resolution_reason)) <= 300),

  replaced_by_check_id uuid references public.post_dated_checks (id) on delete restrict,
  replaces_check_id    uuid references public.post_dated_checks (id) on delete restrict,

  -- The import batch that proposed the clearing, when one did.
  import_batch_id uuid,

  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version    integer not null default 1,

  -- --- the invariants that keep "delivered" and "paid" apart ---------------

  -- A clearing date exists exactly when the check cleared.
  constraint checks_cleared_date_matches_status check (
    (status = 'cleared') = (cleared_on is not null)
  ),

  -- Only a cleared check may point at money. Without this a check could carry a
  -- transaction while sitting in somebody's drawer, and the household would have
  -- paid for paper the bank has never seen.
  constraint checks_transaction_only_when_cleared check (
    cleared_transaction_id is null or status = 'cleared'
  ),
  constraint checks_debt_event_only_when_cleared check (
    debt_event_id is null or status = 'cleared'
  ),

  -- A returned check records when it came back.
  constraint checks_returned_date_when_returned check (
    status <> 'returned' or returned_on is not null
  ),

  -- The returned date outlives the returned status, in one direction only. A
  -- check that bounced and was then cancelled or replaced still bounced, and
  -- erasing the date would delete the fact a family most needs later. What must
  -- not happen is a date surviving onto a check that is back in play, so
  -- re-presenting one clears it.
  constraint checks_returned_date_allowed_states check (
    returned_on is null or status in ('returned', 'cancelled', 'replaced')
  ),

  -- A replaced check names its replacement.
  constraint checks_replacement_link_matches_status check (
    (status = 'replaced') = (replaced_by_check_id is not null)
  ),

  -- Cancelling or recording a return needs a reason on the record.
  constraint checks_resolution_reason_required check (
    status not in ('cancelled', 'returned') or resolution_reason is not null
  ),

  -- Never handed over, so it cannot have reached the bank. `cancelled` and
  -- `replaced` are permitted alongside `prepared` because both are things that
  -- happen to a check still in the chequebook — torn up, or rewritten.
  constraint checks_undelivered_states check (
    delivered_on is not null or status in ('prepared', 'cancelled', 'replaced')
  ),

  constraint checks_no_self_replacement check (
    replaces_check_id is null or replaces_check_id <> id
  ),
  constraint checks_no_self_replacement_forward check (
    replaced_by_check_id is null or replaced_by_check_id <> id
  )
);

comment on table public.post_dated_checks is
  'One row per piece of paper. Handing one over moves no money; only `cleared` does, and then exactly once through the two links recorded here.';
comment on column public.post_dated_checks.cleared_transaction_id is
  'The cash movement the clearing created. Permitted only in the cleared state: this link is what stops one check becoming two repayments.';
comment on column public.post_dated_checks.debt_event_id is
  'The principal_payment the clearing created. Permitted only in the cleared state.';
comment on column public.post_dated_checks.due_date is
  'The date printed on the check. "Due" and "overdue" are derived from this on read and are never stored.';

drop trigger if exists post_dated_checks_touch_updated_at on public.post_dated_checks;
create trigger post_dated_checks_touch_updated_at
  before update on public.post_dated_checks
  for each row execute function app.touch_updated_at();

-- A check number is unique within the account it is drawn on, and only when one
-- was supplied. Two different chequebooks legitimately share numbers, and most
-- families do not record them at all — so this is a partial index rather than a
-- column constraint. Cancelled and replaced checks still occupy their number:
-- the paper exists, and the bank will honour it if it turns up.
create unique index if not exists post_dated_checks_number_per_account_idx
  on public.post_dated_checks (account_id, check_number)
  where check_number is not null;

-- One cash movement belongs to at most one check. The application refuses to
-- clear a check twice; this refuses two checks to claim the same debit.
create unique index if not exists post_dated_checks_transaction_idx
  on public.post_dated_checks (cleared_transaction_id)
  where cleared_transaction_id is not null;

create unique index if not exists post_dated_checks_debt_event_idx
  on public.post_dated_checks (debt_event_id)
  where debt_event_id is not null;

-- The question every screen asks: what is still out there, and when.
create index if not exists post_dated_checks_outstanding_idx
  on public.post_dated_checks (household_id, due_date)
  where status in ('prepared', 'delivered', 'deposited');

create index if not exists post_dated_checks_debt_idx
  on public.post_dated_checks (debt_id, due_date);

-- Matching an imported bank debit looks for account + exact amount.
create index if not exists post_dated_checks_match_idx
  on public.post_dated_checks (account_id, amount_minor)
  where status in ('prepared', 'delivered', 'deposited');

drop trigger if exists post_dated_checks_audit on public.post_dated_checks;
create trigger post_dated_checks_audit
  after insert or update on public.post_dated_checks
  for each row execute function app.audit_row_change(
    'post_dated_checks', 'id', 'status', 'amount_minor', 'currency',
    'due_date', 'delivered_on', 'cleared_on', 'returned_on', 'debt_id'
  );

-- ---------------------------------------------------------------------------
-- Cross-household references
-- ---------------------------------------------------------------------------
--
-- Foreign keys are checked with the table owner's privileges and are not
-- filtered by Row Level Security, so a member of household A could otherwise
-- name household B's debt or account in one of these columns and the constraint
-- would accept it. The RLS policies prove visibility of every referenced row;
-- this trigger proves they belong to the same household, which is the stronger
-- statement and holds even for a service-role caller.

create or replace function app.assert_check_references()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_debt_household uuid;
  v_account_household uuid;
  v_replaced_household uuid;
begin
  select household_id into v_debt_household
  from public.debts where id = new.debt_id;

  if v_debt_household is null or v_debt_household <> new.household_id then
    raise exception 'a check must repay a debt belonging to the same household';
  end if;

  select household_id into v_account_household
  from public.financial_accounts where id = new.account_id;

  if v_account_household is null or v_account_household <> new.household_id then
    raise exception 'a check must be drawn on an account belonging to the same household';
  end if;

  if new.replaced_by_check_id is not null then
    select household_id into v_replaced_household
    from public.post_dated_checks where id = new.replaced_by_check_id;

    if v_replaced_household is null or v_replaced_household <> new.household_id then
      raise exception 'a check may only be replaced by a check in the same household';
    end if;
  end if;

  if new.replaces_check_id is not null then
    select household_id into v_replaced_household
    from public.post_dated_checks where id = new.replaces_check_id;

    if v_replaced_household is null or v_replaced_household <> new.household_id then
      raise exception 'a check may only replace a check in the same household';
    end if;
  end if;

  return new;
end;
$$;

comment on function app.assert_check_references() is
  'Foreign keys ignore RLS. This proves a check''s debt, account and replacement links all belong to the same household.';

drop trigger if exists post_dated_checks_assert_references on public.post_dated_checks;
create trigger post_dated_checks_assert_references
  before insert or update on public.post_dated_checks
  for each row execute function app.assert_check_references();

-- The same hazard for a repayment plan naming another household's debt.
create or replace function app.assert_repayment_plan_references()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_debt_household uuid;
begin
  select household_id into v_debt_household
  from public.debts where id = new.debt_id;

  if v_debt_household is null or v_debt_household <> new.household_id then
    raise exception 'a repayment plan must belong to the same household as its debt';
  end if;

  return new;
end;
$$;

drop trigger if exists repayment_plans_assert_references on public.repayment_plans;
create trigger repayment_plans_assert_references
  before insert or update on public.repayment_plans
  for each row execute function app.assert_repayment_plan_references();
-- <<< END MIGRATION: 20260908120000_gemach_and_checks.sql

-- >>> BEGIN MIGRATION: 20260908120100_imports_and_documents.sql
-- Milestone 9 — uploaded documents, staged proposals, and the approval boundary.
--
-- 05-ARCHITECTURE-DATA.md § Imports and `IMP-DRAFT-001` are the authority, and
-- one sentence from CLAUDE.md is what these tables are shaped around:
--
--   draft לא truth
--
-- A spreadsheet a bank produced is a claim about a family's money, not the money
-- itself. Until a person has looked at a proposed row and said yes, it may not
-- move a single balance, budget, debt or forecast.
--
-- The schema enforces that structurally rather than by convention:
--
--   * proposals live in their own table and are referenced by nothing that
--     computes a balance. No view, no trigger and no foreign key leads from a
--     financial table back to `import_proposals`;
--   * the link runs the other way. `committed_record_id` is written when a
--     proposal became a record, so a batch can be reversed and every record it
--     created can be found;
--   * a batch cannot be approved while any row is still `pending`. Silence is
--     never consent, and that is a CHECK rather than a code path;
--   * `raw`, `proposed` and `correction` are three separate columns. What the
--     document said, what the parser read, and what the reviewer decided are
--     never merged — a reviewer must always be able to see all three.
--
-- The uploaded bytes themselves are NOT stored here. They live in a private
-- Supabase Storage bucket under an unguessable household-scoped path; this table
-- holds the metadata and the hash. A financial database is the wrong place for
-- a multi-megabyte PDF, and a row that could hold one is a row that eventually
-- does.

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'import_file_kind' and n.nspname = 'public'
  ) then
    create type public.import_file_kind as enum ('xlsx', 'csv', 'pdf');
  end if;

  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'import_batch_status' and n.nspname = 'public'
  ) then
    -- `failed` is separated from `rejected`: one is the software not managing to
    -- read the file, the other is a person deciding it should not be used. They
    -- mean different things to a reader of the import history.
    create type public.import_batch_status as enum (
      'extracting', 'needs_review', 'approved', 'rejected', 'failed', 'reversed'
    );
  end if;

  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'import_document_type' and n.nspname = 'public'
  ) then
    create type public.import_document_type as enum (
      'bank_statement', 'credit_card_statement', 'loan_schedule',
      'mortgage_schedule', 'private_debt_list', 'household_income_expense',
      'business_income_expense', 'balance_summary', 'budget_file',
      'general_table', 'unrecognised'
    );
  end if;

  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'proposal_kind' and n.nspname = 'public'
  ) then
    create type public.proposal_kind as enum (
      'account', 'transaction', 'balance', 'debt',
      'debt_payment', 'planned_item', 'budget_line'
    );
  end if;

  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'review_state' and n.nspname = 'public'
  ) then
    -- `pending` is the only state a row can be created in.
    create type public.review_state as enum ('pending', 'included', 'excluded');
  end if;

  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'duplicate_verdict' and n.nspname = 'public'
  ) then
    create type public.duplicate_verdict as enum (
      'new', 'possible_duplicate', 'likely_duplicate'
    );
  end if;

  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'document_retention_state' and n.nspname = 'public'
  ) then
    -- Where the bytes are in their life. `quarantined` is the state on arrival:
    -- stored, hashed, and not yet read by anything.
    create type public.document_retention_state as enum (
      'quarantined', 'parsed', 'retained', 'purged'
    );
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- import_source_files — the metadata of what was uploaded
-- ---------------------------------------------------------------------------

create table if not exists public.import_source_files (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,

  -- Kept only so a reviewer can see which file they picked. It never becomes a
  -- path: 07-SECURITY-PRIVACY.md's traversal rule is kept structurally, by
  -- addressing objects with a generated id instead of a supplied name.
  display_name text not null check (length(btrim(display_name)) between 1 and 300),

  -- The object key inside the private bucket. Household-scoped and unguessable.
  storage_path text not null check (length(btrim(storage_path)) between 1 and 500),

  kind       public.import_file_kind not null,
  byte_size  bigint not null check (byte_size > 0 and byte_size <= 20971520),
  sha256     text not null check (sha256 ~ '^[0-9a-f]{64}$'),

  -- What the browser claimed. Recorded, never trusted: the format is decided
  -- from the bytes.
  declared_mime_type text check (length(btrim(declared_mime_type)) <= 200),

  retention_state public.document_retention_state not null default 'quarantined',
  purged_at       timestamptz,

  uploaded_by uuid not null references public.profiles (id) on delete restrict,
  uploaded_at timestamptz not null default now(),

  constraint import_source_files_purged_state check (
    (retention_state = 'purged') = (purged_at is not null)
  ),

  -- One object per household path. Two rows pointing at the same bytes would
  -- make deletion ambiguous.
  constraint import_source_files_path_unique unique (household_id, storage_path)
);

comment on table public.import_source_files is
  'Metadata for an uploaded document. The bytes live in a private Storage bucket; this row holds the hash, the size and where to find them.';
comment on column public.import_source_files.sha256 is
  'Hash of the uploaded bytes. Used to recognise the same file arriving twice, which is shown to a reviewer and never acted on automatically.';
comment on column public.import_source_files.storage_path is
  'Object key in the private bucket. Generated, never derived from the supplied filename.';

create index if not exists import_source_files_household_idx
  on public.import_source_files (household_id, uploaded_at desc);

-- The same file uploaded twice is recognised, not refused: a family may
-- legitimately re-upload after a mistake, and the duplicate is surfaced to the
-- reviewer instead.
create index if not exists import_source_files_hash_idx
  on public.import_source_files (household_id, sha256);

-- ---------------------------------------------------------------------------
-- import_batches — one upload, and where its review stands
-- ---------------------------------------------------------------------------

create table if not exists public.import_batches (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references public.households (id) on delete cascade,
  source_file_id uuid not null references public.import_source_files (id) on delete restrict,

  status        public.import_batch_status not null default 'extracting',
  document_type public.import_document_type not null default 'unrecognised',

  -- Detection is a hint that steers the review, never a fact that skips it.
  document_confidence_bp integer not null default 0
    check (document_confidence_bp between 0 and 10000),

  rows_proposed integer not null default 0 check (rows_proposed >= 0),
  rows_scanned  integer not null default 0 check (rows_scanned >= 0),
  truncated     boolean not null default false,

  -- Why extraction failed, when it did. A code, not a sentence: the Hebrew
  -- belongs in the copy layer where it can be reviewed as product language.
  failure_code text check (length(btrim(failure_code)) <= 80),

  -- Which account the file appears to be about, when the user picked one.
  target_account_id uuid references public.financial_accounts (id) on delete restrict,

  approved_at timestamptz,
  approved_by uuid references public.profiles (id) on delete restrict,
  reversed_at timestamptz,
  reversed_by uuid references public.profiles (id) on delete restrict,

  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version    integer not null default 1,

  -- An approval records who and when, together.
  constraint import_batches_approval_complete check (
    (approved_at is null) = (approved_by is null)
  ),
  constraint import_batches_reversal_complete check (
    (reversed_at is null) = (reversed_by is null)
  ),
  -- Only an approved batch can have been approved, and only an approved batch
  -- can be reversed. Neither is reachable from `failed`.
  constraint import_batches_approved_status check (
    approved_at is null or status in ('approved', 'reversed')
  ),
  constraint import_batches_reversed_status check (
    reversed_at is null or status = 'reversed'
  ),
  constraint import_batches_failure_code_when_failed check (
    failure_code is null or status = 'failed'
  )
);

comment on table public.import_batches is
  'One uploaded document being reviewed. Nothing here affects a balance: approval is what crosses that boundary, and it is recorded with who and when.';

drop trigger if exists import_batches_touch_updated_at on public.import_batches;
create trigger import_batches_touch_updated_at
  before update on public.import_batches
  for each row execute function app.touch_updated_at();

create index if not exists import_batches_household_idx
  on public.import_batches (household_id, created_at desc);

create index if not exists import_batches_open_idx
  on public.import_batches (household_id)
  where status = 'needs_review';

drop trigger if exists import_batches_audit on public.import_batches;
create trigger import_batches_audit
  after insert or update on public.import_batches
  for each row execute function app.audit_row_change(
    'import_batches', 'id', 'status', 'document_type', 'rows_proposed'
  );

-- ---------------------------------------------------------------------------
-- import_proposals — what the document said, and what it would become
-- ---------------------------------------------------------------------------

create table if not exists public.import_proposals (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  batch_id     uuid not null references public.import_batches (id) on delete cascade,

  kind public.proposal_kind not null,

  -- Exactly where in the document this came from, so any number can be traced
  -- back to the row a person can look at.
  location_sheet_name text check (length(location_sheet_name) <= 200),
  location_page       integer check (location_page is null or location_page between 1 and 10000),
  location_row        integer check (location_row is null or location_row between 1 and 1000000),
  location_snippet    text check (length(location_snippet) <= 1000),

  -- Three separate columns, never merged. What the file said, what the parser
  -- read it as, and what the reviewer changed it to.
  raw        jsonb not null,
  proposed   jsonb not null,
  correction jsonb,

  confidence_bp integer not null default 0 check (confidence_bp between 0 and 10000),
  warnings      text[] not null default '{}',

  duplicate_verdict public.duplicate_verdict not null default 'new',
  duplicate_of_id   uuid,

  review_state public.review_state not null default 'pending',

  -- Which account, debt or check the row attaches to once approved.
  target_account_id uuid references public.financial_accounts (id) on delete restrict,
  target_debt_id    uuid references public.debts (id) on delete restrict,
  target_check_id   uuid references public.post_dated_checks (id) on delete restrict,

  -- The record created when the batch was approved. NULL until then. This is
  -- the only link between a proposal and financial truth, and it points from
  -- the proposal outward — nothing that computes a balance reads this table.
  committed_record_id uuid,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version    integer not null default 1,

  -- A duplicate verdict must name the record it matched.
  constraint import_proposals_duplicate_names_record check (
    duplicate_verdict = 'new' or duplicate_of_id is not null
  ),
  -- A row that was never included cannot have created a record.
  constraint import_proposals_committed_only_when_included check (
    committed_record_id is null or review_state = 'included'
  )
);

comment on table public.import_proposals is
  'A staged row. Never read by anything that computes a balance: approval copies it into a financial table, and `committed_record_id` records where it went.';
comment on column public.import_proposals.raw is
  'What the document said, verbatim. Never rewritten by a correction.';
comment on column public.import_proposals.correction is
  'What the reviewer changed it to. Stored beside the parsed value, never over it.';
comment on column public.import_proposals.target_check_id is
  'The post-dated check this row is the clearing of, once a person says so. Never filled in automatically, however confident the match.';

drop trigger if exists import_proposals_touch_updated_at on public.import_proposals;
create trigger import_proposals_touch_updated_at
  before update on public.import_proposals
  for each row execute function app.touch_updated_at();

create index if not exists import_proposals_batch_idx
  on public.import_proposals (batch_id, created_at);

create index if not exists import_proposals_pending_idx
  on public.import_proposals (household_id)
  where review_state = 'pending';

-- ---------------------------------------------------------------------------
-- Approval is all-or-nothing, and silence is not consent
-- ---------------------------------------------------------------------------
--
-- The application refuses to approve a batch with an undecided row. This is the
-- same rule in the database, so it holds for any caller — including a
-- service-role worker, which RLS does not constrain.

create or replace function app.assert_batch_ready_for_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pending integer;
  v_included integer;
begin
  if new.status <> 'approved' or old.status = 'approved' then
    return new;
  end if;

  select
    count(*) filter (where review_state = 'pending'),
    count(*) filter (where review_state = 'included')
  into v_pending, v_included
  from public.import_proposals
  where batch_id = new.id;

  if v_pending > 0 then
    raise exception 'this import still has % undecided row(s); silence is not consent', v_pending;
  end if;

  if v_included = 0 then
    raise exception 'no row was included, so there is nothing to approve';
  end if;

  return new;
end;
$$;

comment on function app.assert_batch_ready_for_approval() is
  'A batch cannot become approved while a row is still pending. Enforced in the database so it holds for callers RLS does not constrain.';

drop trigger if exists import_batches_assert_ready on public.import_batches;
create trigger import_batches_assert_ready
  before update on public.import_batches
  for each row execute function app.assert_batch_ready_for_approval();

-- ---------------------------------------------------------------------------
-- Cross-household references
-- ---------------------------------------------------------------------------

create or replace function app.assert_import_references()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household uuid;
begin
  if tg_table_name = 'import_batches' then
    select household_id into v_household
    from public.import_source_files where id = new.source_file_id;
    if v_household is null or v_household <> new.household_id then
      raise exception 'an import batch must reference a file belonging to the same household';
    end if;

    if new.target_account_id is not null then
      select household_id into v_household
      from public.financial_accounts where id = new.target_account_id;
      if v_household is null or v_household <> new.household_id then
        raise exception 'an import batch must target an account belonging to the same household';
      end if;
    end if;

    return new;
  end if;

  -- import_proposals
  select household_id into v_household
  from public.import_batches where id = new.batch_id;
  if v_household is null or v_household <> new.household_id then
    raise exception 'a proposal must belong to the same household as its batch';
  end if;

  if new.target_account_id is not null then
    select household_id into v_household
    from public.financial_accounts where id = new.target_account_id;
    if v_household is null or v_household <> new.household_id then
      raise exception 'a proposal must target an account belonging to the same household';
    end if;
  end if;

  if new.target_debt_id is not null then
    select household_id into v_household
    from public.debts where id = new.target_debt_id;
    if v_household is null or v_household <> new.household_id then
      raise exception 'a proposal must target a debt belonging to the same household';
    end if;
  end if;

  if new.target_check_id is not null then
    select household_id into v_household
    from public.post_dated_checks where id = new.target_check_id;
    if v_household is null or v_household <> new.household_id then
      raise exception 'a proposal must target a check belonging to the same household';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists import_batches_assert_references on public.import_batches;
create trigger import_batches_assert_references
  before insert or update on public.import_batches
  for each row execute function app.assert_import_references();

drop trigger if exists import_proposals_assert_references on public.import_proposals;
create trigger import_proposals_assert_references
  before insert or update on public.import_proposals
  for each row execute function app.assert_import_references();

-- The check table's import link, now that batches exist.
alter table public.post_dated_checks
  drop constraint if exists post_dated_checks_import_batch_fkey;
alter table public.post_dated_checks
  add constraint post_dated_checks_import_batch_fkey
  foreign key (import_batch_id) references public.import_batches (id) on delete set null;
-- <<< END MIGRATION: 20260908120100_imports_and_documents.sql

-- >>> BEGIN MIGRATION: 20260908120200_household_settings_and_tasks.sql
-- Milestone 9 — household settings, setup progress, and the family task list.
--
-- These are the collections the local store has carried since M7 that had no
-- table yet. None of them is money, and that is exactly why they are worth
-- getting right: settings decide how money is *interpreted* (which day a month
-- starts, what reserve floor applies), and a wrong value here moves every figure
-- on every screen without any of them looking wrong.

-- ---------------------------------------------------------------------------
-- household_settings — one row per household
-- ---------------------------------------------------------------------------

create table if not exists public.household_settings (
  household_id uuid primary key references public.households (id) on delete cascade,

  currency  text not null default 'ILS' check (currency ~ '^[A-Z]{3}$'),
  -- Israel. Stored rather than assumed, because every date boundary in the
  -- product — a month start, a check falling due, a weekly food window —
  -- depends on it, and a server in another region must not shift them.
  time_zone text not null default 'Asia/Jerusalem'
    check (length(btrim(time_zone)) between 1 and 60),

  -- The day a household's month begins. Salary rarely arrives on the 1st, and a
  -- budget measured against the wrong window is a budget nobody trusts.
  month_start_day integer not null default 1 check (month_start_day between 1 and 28),

  -- 02-FINANCIAL-RULES.md § רזרבה מינימלית: the floor is the highest of these,
  -- and NULL means "not set", never zero.
  manual_reserve_floor_minor  bigint check (manual_reserve_floor_minor is null
    or app.is_valid_amount_minor(manual_reserve_floor_minor)),
  incident_buffer_minor       bigint check (incident_buffer_minor is null
    or app.is_valid_amount_minor(incident_buffer_minor)),
  revolving_avoidance_minor   bigint check (revolving_avoidance_minor is null
    or app.is_valid_amount_minor(revolving_avoidance_minor)),

  -- Money already earmarked for something else. Not part of the floor; simply
  -- not available to spend.
  protected_reserves_minor bigint not null default 0
    check (app.is_valid_amount_minor(protected_reserves_minor)),

  -- Notification preferences that belong to the household rather than a device.
  weekly_food_guidance        boolean not null default true,
  balance_freshness_reminder  boolean not null default true,
  balance_freshness_days      integer not null default 7
    check (balance_freshness_days between 1 and 90),

  updated_at timestamptz not null default now(),
  version    integer not null default 1
);

comment on table public.household_settings is
  'How this household reads its own money: currency, calendar, month boundary and reserve components. One row per household, created with it.';
comment on column public.household_settings.month_start_day is
  'Capped at 28 so every month has the day. A budget window that silently moves in February is a budget window nobody can reconcile.';
comment on column public.household_settings.manual_reserve_floor_minor is
  'NULL means not set. Never treated as zero: an unset floor and a floor of nothing are different claims.';

drop trigger if exists household_settings_touch_updated_at on public.household_settings;
create trigger household_settings_touch_updated_at
  before update on public.household_settings
  for each row execute function app.touch_updated_at();

drop trigger if exists household_settings_audit on public.household_settings;
create trigger household_settings_audit
  after insert or update on public.household_settings
  for each row execute function app.audit_row_change(
    'household_settings', 'household_id', 'currency', 'month_start_day'
  );

-- ---------------------------------------------------------------------------
-- setup_progress — what the household has told us so far
-- ---------------------------------------------------------------------------
--
-- Deliberately booleans rather than a percentage. "You are 60% set up" is a
-- number nobody can act on; "you have not confirmed a balance yet" is.

create table if not exists public.setup_progress (
  household_id uuid primary key references public.households (id) on delete cascade,

  household_named               boolean not null default false,
  members_added                 boolean not null default false,
  accounts_added                boolean not null default false,
  balances_confirmed            boolean not null default false,
  business_decided              boolean not null default false,
  debts_recorded                boolean not null default false,
  recurring_income_recorded     boolean not null default false,
  recurring_obligations_recorded boolean not null default false,
  budget_started                boolean not null default false,
  privacy_explained             boolean not null default false,

  updated_at timestamptz not null default now()
);

comment on table public.setup_progress is
  'Which parts of the opening picture the household has completed. Booleans, not a score: a percentage is not something a person can act on.';

drop trigger if exists setup_progress_touch_updated_at on public.setup_progress;
create trigger setup_progress_touch_updated_at
  before update on public.setup_progress
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- family_tasks — the recommendation, with a name against it
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'task_status' and n.nspname = 'public'
  ) then
    create type public.task_status as enum ('open', 'done', 'dropped');
  end if;
end
$$;

create table if not exists public.family_tasks (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,

  title  text not null check (length(btrim(title)) between 1 and 200),
  -- Why this is worth doing, in the words the home screen used when it
  -- suggested it. Carried so a task still makes sense a week later.
  reason text check (length(btrim(reason)) <= 500),

  -- Which recommendation produced it, when one did. A code, not a sentence.
  recommendation_key text check (length(btrim(recommendation_key)) <= 60),

  status public.task_status not null default 'open',

  -- Whose it is. NULL is a real answer: a task the couple has not assigned.
  assigned_member_id uuid references public.household_members (id) on delete set null,

  due_on      date,
  completed_at timestamptz,

  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version    integer not null default 1,

  constraint family_tasks_completed_matches_status check (
    (status = 'done') = (completed_at is not null)
  )
);

comment on table public.family_tasks is
  'A recommendation that became something with a name against it. Creating one changes no figure — that separation is the point.';

drop trigger if exists family_tasks_touch_updated_at on public.family_tasks;
create trigger family_tasks_touch_updated_at
  before update on public.family_tasks
  for each row execute function app.touch_updated_at();

create index if not exists family_tasks_open_idx
  on public.family_tasks (household_id, due_on)
  where status = 'open';

-- ---------------------------------------------------------------------------
-- Cross-household reference
-- ---------------------------------------------------------------------------

create or replace function app.assert_task_references()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household uuid;
begin
  if new.assigned_member_id is not null then
    select household_id into v_household
    from public.household_members where id = new.assigned_member_id;

    if v_household is null or v_household <> new.household_id then
      raise exception 'a task can only be assigned to a member of the same household';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists family_tasks_assert_references on public.family_tasks;
create trigger family_tasks_assert_references
  before insert or update on public.family_tasks
  for each row execute function app.assert_task_references();

-- ---------------------------------------------------------------------------
-- idempotency_keys — the same request twice is one effect
-- ---------------------------------------------------------------------------
--
-- A phone on a poor connection retries. A user double-taps. A worker restarts
-- mid-job. None of those may approve an import twice or clear a check twice.
--
-- The check state machine already refuses a second clearing by name, which is
-- the stronger defence. This is the general one, for operations that have no
-- such state to lean on.

create table if not exists public.idempotency_keys (
  household_id uuid not null references public.households (id) on delete cascade,
  -- Supplied by the caller: stable for one logical operation, unguessable.
  key          text not null check (length(btrim(key)) between 8 and 200),
  operation    text not null check (length(btrim(operation)) between 1 and 80),

  -- What the first attempt produced, so a retry can be answered identically
  -- rather than re-executed.
  result_record_id uuid,
  created_at       timestamptz not null default now(),
  -- Retention: long enough to cover any plausible retry, short enough that the
  -- table does not grow without bound.
  expires_at       timestamptz not null default (now() + interval '7 days'),

  primary key (household_id, key)
);

comment on table public.idempotency_keys is
  'One logical operation, one effect. A retry finds its key and is answered with the original result instead of running again.';

create index if not exists idempotency_keys_expiry_idx
  on public.idempotency_keys (expires_at);
-- <<< END MIGRATION: 20260908120200_household_settings_and_tasks.sql

-- >>> BEGIN MIGRATION: 20260908120300_access_and_notifications.sql
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
-- <<< END MIGRATION: 20260908120300_access_and_notifications.sql

-- >>> BEGIN MIGRATION: 20260908120400_new_tables_row_security.sql
-- Milestone 9 — Row Level Security for every table this milestone added.
--
-- Same rules as the earlier security migrations: enabled AND forced on every
-- table, one policy per command, membership as the only isolation boundary, and
-- no DELETE on anything that represents money or history.
--
-- Two boundaries are in play here, and the difference matters.
--
--   * **Household-scoped** — checks, plans, imports, settings, tasks. Either
--     spouse may read and write them, because 01-PRODUCT-SPEC.md says either may
--     approve ordinary household updates and the product has always worked that
--     way.
--
--   * **Person-scoped** — passkeys, push subscriptions, notification
--     preferences. These are *not* shared. Tamar must not be able to read or
--     remove Aharon's passkey, and a shared household is not a shared identity.
--     Scoped by `app.current_profile_id()`, never by membership.
--
-- The foreign-key hazard from 20260822100200 applies to every new table too:
-- constraints are checked with the owner's privileges and ignore RLS, so a
-- member of household A could otherwise name household B's row in a reference
-- column. Each policy that accepts a reference proves the referenced row is
-- visible; the BEFORE triggers added with the tables prove the stronger
-- statement — same household — and hold even for a service-role caller.

-- ---------------------------------------------------------------------------
-- Reference ownership helpers
-- ---------------------------------------------------------------------------
--
-- SECURITY INVOKER, like their siblings: these read tables that carry their own
-- policies, so an invisible row simply does not exist as far as the check is
-- concerned. A definer here would see everything and defeat the point.

create or replace function app.household_owns_check(
  p_household_id uuid,
  p_check_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select p_check_id is null or exists (
    select 1 from public.post_dated_checks c
    where c.id = p_check_id and c.household_id = p_household_id
  );
$$;

create or replace function app.household_owns_import_batch(
  p_household_id uuid,
  p_batch_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select p_batch_id is null or exists (
    select 1 from public.import_batches b
    where b.id = p_batch_id and b.household_id = p_household_id
  );
$$;

create or replace function app.household_owns_source_file(
  p_household_id uuid,
  p_file_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select p_file_id is null or exists (
    select 1 from public.import_source_files f
    where f.id = p_file_id and f.household_id = p_household_id
  );
$$;

create or replace function app.household_owns_member(
  p_household_id uuid,
  p_member_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select p_member_id is null or exists (
    select 1 from public.household_members m
    where m.id = p_member_id and m.household_id = p_household_id
  );
$$;

do $$
declare
  v_function text;
begin
  foreach v_function in array array[
    'app.household_owns_check(uuid, uuid)',
    'app.household_owns_import_batch(uuid, uuid)',
    'app.household_owns_source_file(uuid, uuid)',
    'app.household_owns_member(uuid, uuid)'
  ]
  loop
    execute format('revoke all on function %s from public, anon', v_function);
    execute format('grant execute on function %s to authenticated', v_function);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- Table privileges
-- ---------------------------------------------------------------------------
--
-- Revoked from everyone first, then granted narrowly. `anon` receives nothing at
-- all: an unauthenticated caller has no business knowing these tables exist.
--
-- DELETE is granted on exactly two tables. Everything else is corrected by a
-- reversing record, never by removal — 02-FINANCIAL-RULES.md's history rule.

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'public.post_dated_checks',
    'public.repayment_plans',
    'public.import_source_files',
    'public.import_batches',
    'public.import_proposals',
    'public.household_settings',
    'public.setup_progress',
    'public.family_tasks',
    'public.idempotency_keys',
    'public.webauthn_credentials',
    'public.webauthn_challenges',
    'public.push_subscriptions',
    'public.notification_preferences',
    'public.notification_deliveries'
  ]
  loop
    execute format('revoke all on table %s from public, anon, authenticated', v_table);
    execute format('grant select, insert, update on table %s to authenticated', v_table);
  end loop;

  -- A passkey must be removable: a lost laptop is exactly the case the feature
  -- exists for. A push subscription must be revocable per device. Neither is
  -- financial history.
  execute 'grant delete on table public.webauthn_credentials to authenticated';
  execute 'grant delete on table public.push_subscriptions to authenticated';
end
$$;

-- ---------------------------------------------------------------------------
-- post_dated_checks — household-scoped
-- ---------------------------------------------------------------------------

alter table public.post_dated_checks enable row level security;
alter table public.post_dated_checks force row level security;

drop policy if exists post_dated_checks_select_member on public.post_dated_checks;
create policy post_dated_checks_select_member
  on public.post_dated_checks
  for select
  to authenticated
  using (app.is_household_member(household_id));

drop policy if exists post_dated_checks_insert_member on public.post_dated_checks;
create policy post_dated_checks_insert_member
  on public.post_dated_checks
  for insert
  to authenticated
  with check (
    app.is_household_member(household_id)
    and app.household_owns_debt(household_id, debt_id)
    and app.household_owns_account(household_id, account_id)
    and app.household_owns_check(household_id, replaced_by_check_id)
    and app.household_owns_check(household_id, replaces_check_id)
    and app.household_owns_transaction(household_id, cleared_transaction_id)
    and app.household_owns_debt_event(household_id, debt_event_id)
  );

drop policy if exists post_dated_checks_update_member on public.post_dated_checks;
create policy post_dated_checks_update_member
  on public.post_dated_checks
  for update
  to authenticated
  using (app.is_household_member(household_id))
  with check (
    app.is_household_member(household_id)
    and app.household_owns_debt(household_id, debt_id)
    and app.household_owns_account(household_id, account_id)
    and app.household_owns_check(household_id, replaced_by_check_id)
    and app.household_owns_check(household_id, replaces_check_id)
    and app.household_owns_transaction(household_id, cleared_transaction_id)
    and app.household_owns_debt_event(household_id, debt_event_id)
  );

-- ---------------------------------------------------------------------------
-- repayment_plans — household-scoped
-- ---------------------------------------------------------------------------

alter table public.repayment_plans enable row level security;
alter table public.repayment_plans force row level security;

drop policy if exists repayment_plans_select_member on public.repayment_plans;
create policy repayment_plans_select_member
  on public.repayment_plans
  for select to authenticated
  using (app.is_household_member(household_id));

drop policy if exists repayment_plans_insert_member on public.repayment_plans;
create policy repayment_plans_insert_member
  on public.repayment_plans
  for insert to authenticated
  with check (
    app.is_household_member(household_id)
    and app.household_owns_debt(household_id, debt_id)
  );

drop policy if exists repayment_plans_update_member on public.repayment_plans;
create policy repayment_plans_update_member
  on public.repayment_plans
  for update to authenticated
  using (app.is_household_member(household_id))
  with check (
    app.is_household_member(household_id)
    and app.household_owns_debt(household_id, debt_id)
  );

-- ---------------------------------------------------------------------------
-- import_source_files — household-scoped
-- ---------------------------------------------------------------------------

alter table public.import_source_files enable row level security;
alter table public.import_source_files force row level security;

drop policy if exists import_source_files_select_member on public.import_source_files;
create policy import_source_files_select_member
  on public.import_source_files
  for select to authenticated
  using (app.is_household_member(household_id));

drop policy if exists import_source_files_insert_member on public.import_source_files;
create policy import_source_files_insert_member
  on public.import_source_files
  for insert to authenticated
  with check (app.is_household_member(household_id));

drop policy if exists import_source_files_update_member on public.import_source_files;
create policy import_source_files_update_member
  on public.import_source_files
  for update to authenticated
  using (app.is_household_member(household_id))
  with check (app.is_household_member(household_id));

-- ---------------------------------------------------------------------------
-- import_batches — household-scoped
-- ---------------------------------------------------------------------------

alter table public.import_batches enable row level security;
alter table public.import_batches force row level security;

drop policy if exists import_batches_select_member on public.import_batches;
create policy import_batches_select_member
  on public.import_batches
  for select to authenticated
  using (app.is_household_member(household_id));

drop policy if exists import_batches_insert_member on public.import_batches;
create policy import_batches_insert_member
  on public.import_batches
  for insert to authenticated
  with check (
    app.is_household_member(household_id)
    and app.household_owns_source_file(household_id, source_file_id)
    and app.household_owns_account(household_id, target_account_id)
  );

drop policy if exists import_batches_update_member on public.import_batches;
create policy import_batches_update_member
  on public.import_batches
  for update to authenticated
  using (app.is_household_member(household_id))
  with check (
    app.is_household_member(household_id)
    and app.household_owns_source_file(household_id, source_file_id)
    and app.household_owns_account(household_id, target_account_id)
  );

-- ---------------------------------------------------------------------------
-- import_proposals — household-scoped
-- ---------------------------------------------------------------------------

alter table public.import_proposals enable row level security;
alter table public.import_proposals force row level security;

drop policy if exists import_proposals_select_member on public.import_proposals;
create policy import_proposals_select_member
  on public.import_proposals
  for select to authenticated
  using (app.is_household_member(household_id));

drop policy if exists import_proposals_insert_member on public.import_proposals;
create policy import_proposals_insert_member
  on public.import_proposals
  for insert to authenticated
  with check (
    app.is_household_member(household_id)
    and app.household_owns_import_batch(household_id, batch_id)
    and app.household_owns_account(household_id, target_account_id)
    and app.household_owns_debt(household_id, target_debt_id)
    and app.household_owns_check(household_id, target_check_id)
  );

drop policy if exists import_proposals_update_member on public.import_proposals;
create policy import_proposals_update_member
  on public.import_proposals
  for update to authenticated
  using (app.is_household_member(household_id))
  with check (
    app.is_household_member(household_id)
    and app.household_owns_import_batch(household_id, batch_id)
    and app.household_owns_account(household_id, target_account_id)
    and app.household_owns_debt(household_id, target_debt_id)
    and app.household_owns_check(household_id, target_check_id)
  );

-- ---------------------------------------------------------------------------
-- household_settings, setup_progress, family_tasks, idempotency_keys
-- ---------------------------------------------------------------------------

alter table public.household_settings enable row level security;
alter table public.household_settings force row level security;

drop policy if exists household_settings_select_member on public.household_settings;
create policy household_settings_select_member
  on public.household_settings for select to authenticated
  using (app.is_household_member(household_id));

drop policy if exists household_settings_insert_member on public.household_settings;
create policy household_settings_insert_member
  on public.household_settings for insert to authenticated
  with check (app.is_household_member(household_id));

drop policy if exists household_settings_update_member on public.household_settings;
create policy household_settings_update_member
  on public.household_settings for update to authenticated
  using (app.is_household_member(household_id))
  with check (app.is_household_member(household_id));

alter table public.setup_progress enable row level security;
alter table public.setup_progress force row level security;

drop policy if exists setup_progress_select_member on public.setup_progress;
create policy setup_progress_select_member
  on public.setup_progress for select to authenticated
  using (app.is_household_member(household_id));

drop policy if exists setup_progress_insert_member on public.setup_progress;
create policy setup_progress_insert_member
  on public.setup_progress for insert to authenticated
  with check (app.is_household_member(household_id));

drop policy if exists setup_progress_update_member on public.setup_progress;
create policy setup_progress_update_member
  on public.setup_progress for update to authenticated
  using (app.is_household_member(household_id))
  with check (app.is_household_member(household_id));

alter table public.family_tasks enable row level security;
alter table public.family_tasks force row level security;

drop policy if exists family_tasks_select_member on public.family_tasks;
create policy family_tasks_select_member
  on public.family_tasks for select to authenticated
  using (app.is_household_member(household_id));

drop policy if exists family_tasks_insert_member on public.family_tasks;
create policy family_tasks_insert_member
  on public.family_tasks for insert to authenticated
  with check (
    app.is_household_member(household_id)
    and app.household_owns_member(household_id, assigned_member_id)
  );

drop policy if exists family_tasks_update_member on public.family_tasks;
create policy family_tasks_update_member
  on public.family_tasks for update to authenticated
  using (app.is_household_member(household_id))
  with check (
    app.is_household_member(household_id)
    and app.household_owns_member(household_id, assigned_member_id)
  );

alter table public.idempotency_keys enable row level security;
alter table public.idempotency_keys force row level security;

drop policy if exists idempotency_keys_select_member on public.idempotency_keys;
create policy idempotency_keys_select_member
  on public.idempotency_keys for select to authenticated
  using (app.is_household_member(household_id));

drop policy if exists idempotency_keys_insert_member on public.idempotency_keys;
create policy idempotency_keys_insert_member
  on public.idempotency_keys for insert to authenticated
  with check (app.is_household_member(household_id));

drop policy if exists idempotency_keys_update_member on public.idempotency_keys;
create policy idempotency_keys_update_member
  on public.idempotency_keys for update to authenticated
  using (app.is_household_member(household_id))
  with check (app.is_household_member(household_id));

-- ---------------------------------------------------------------------------
-- Person-scoped tables
-- ---------------------------------------------------------------------------
--
-- A shared household is not a shared identity. These are scoped to the profile,
-- so Tamar cannot read, change or remove Aharon's passkey — and neither can a
-- household member who has been revoked but still holds a session.

alter table public.webauthn_credentials enable row level security;
alter table public.webauthn_credentials force row level security;

drop policy if exists webauthn_credentials_select_own on public.webauthn_credentials;
create policy webauthn_credentials_select_own
  on public.webauthn_credentials for select to authenticated
  using (profile_id = app.current_profile_id());

drop policy if exists webauthn_credentials_insert_own on public.webauthn_credentials;
create policy webauthn_credentials_insert_own
  on public.webauthn_credentials for insert to authenticated
  with check (profile_id = app.current_profile_id());

drop policy if exists webauthn_credentials_update_own on public.webauthn_credentials;
create policy webauthn_credentials_update_own
  on public.webauthn_credentials for update to authenticated
  using (profile_id = app.current_profile_id())
  with check (profile_id = app.current_profile_id());

drop policy if exists webauthn_credentials_delete_own on public.webauthn_credentials;
create policy webauthn_credentials_delete_own
  on public.webauthn_credentials for delete to authenticated
  using (profile_id = app.current_profile_id());

-- Challenges are written by the server before a profile is necessarily known
-- (registration bootstrap), so the readable set is deliberately narrow: a
-- challenge is looked up by the server, not browsed by a client.
alter table public.webauthn_challenges enable row level security;
alter table public.webauthn_challenges force row level security;

drop policy if exists webauthn_challenges_select_own on public.webauthn_challenges;
create policy webauthn_challenges_select_own
  on public.webauthn_challenges for select to authenticated
  using (profile_id is not null and profile_id = app.current_profile_id());

drop policy if exists webauthn_challenges_insert_own on public.webauthn_challenges;
create policy webauthn_challenges_insert_own
  on public.webauthn_challenges for insert to authenticated
  with check (profile_id is null or profile_id = app.current_profile_id());

drop policy if exists webauthn_challenges_update_own on public.webauthn_challenges;
create policy webauthn_challenges_update_own
  on public.webauthn_challenges for update to authenticated
  using (profile_id is not null and profile_id = app.current_profile_id())
  with check (profile_id is not null and profile_id = app.current_profile_id());

alter table public.push_subscriptions enable row level security;
alter table public.push_subscriptions force row level security;

drop policy if exists push_subscriptions_select_own on public.push_subscriptions;
create policy push_subscriptions_select_own
  on public.push_subscriptions for select to authenticated
  using (profile_id = app.current_profile_id());

drop policy if exists push_subscriptions_insert_own on public.push_subscriptions;
create policy push_subscriptions_insert_own
  on public.push_subscriptions for insert to authenticated
  with check (profile_id = app.current_profile_id());

drop policy if exists push_subscriptions_update_own on public.push_subscriptions;
create policy push_subscriptions_update_own
  on public.push_subscriptions for update to authenticated
  using (profile_id = app.current_profile_id())
  with check (profile_id = app.current_profile_id());

drop policy if exists push_subscriptions_delete_own on public.push_subscriptions;
create policy push_subscriptions_delete_own
  on public.push_subscriptions for delete to authenticated
  using (profile_id = app.current_profile_id());

alter table public.notification_preferences enable row level security;
alter table public.notification_preferences force row level security;

drop policy if exists notification_preferences_select_own on public.notification_preferences;
create policy notification_preferences_select_own
  on public.notification_preferences for select to authenticated
  using (profile_id = app.current_profile_id());

drop policy if exists notification_preferences_insert_own on public.notification_preferences;
create policy notification_preferences_insert_own
  on public.notification_preferences for insert to authenticated
  with check (
    profile_id = app.current_profile_id()
    and app.is_household_member(household_id)
  );

drop policy if exists notification_preferences_update_own on public.notification_preferences;
create policy notification_preferences_update_own
  on public.notification_preferences for update to authenticated
  using (profile_id = app.current_profile_id())
  with check (
    profile_id = app.current_profile_id()
    and app.is_household_member(household_id)
  );

-- A delivery record is readable only by the person it was addressed to. The
-- household boundary is not enough here: what Aharon was reminded about is not
-- automatically Tamar's to read.
alter table public.notification_deliveries enable row level security;
alter table public.notification_deliveries force row level security;

drop policy if exists notification_deliveries_select_own on public.notification_deliveries;
create policy notification_deliveries_select_own
  on public.notification_deliveries for select to authenticated
  using (profile_id = app.current_profile_id());

drop policy if exists notification_deliveries_insert_own on public.notification_deliveries;
create policy notification_deliveries_insert_own
  on public.notification_deliveries for insert to authenticated
  with check (
    profile_id = app.current_profile_id()
    and app.is_household_member(household_id)
  );

-- Update is how a notification is marked read. Nothing else about a delivery
-- record is a person's to change.
drop policy if exists notification_deliveries_update_own on public.notification_deliveries;
create policy notification_deliveries_update_own
  on public.notification_deliveries for update to authenticated
  using (profile_id = app.current_profile_id())
  with check (profile_id = app.current_profile_id());
-- <<< END MIGRATION: 20260908120400_new_tables_row_security.sql

commit;
