-- Who may bring a household into existence.
--
-- Until now `public.create_household` was SECURITY DEFINER and granted to every
-- authenticated user: anyone who could sign in could mint a household and become
-- its owner. That is the right shape for a product anyone may sign up for, and
-- the wrong one for this product, where one person decides which families exist.
--
-- This migration introduces a **platform owner** — an administrative identity
-- that is deliberately *not* a financial one. A platform owner may create a
-- household, appoint its first owner, see how many people are in it, revoke an
-- invitation, disable it and remove somebody. They may not read a single shekel
-- of it: no policy on any financial table mentions them, and a test says so.
--
-- Additive throughout. Every new table is created empty, every new column has a
-- default, and the one behaviour that changes — who may call create_household —
-- changes in a function body rather than in a policy, so nothing that already
-- works stops working for anybody who is already inside a household.

-- ---------------------------------------------------------------------------
-- The platform owner
-- ---------------------------------------------------------------------------

create table if not exists public.platform_admins (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  -- Why this person holds it. Read by a human, never by the application.
  note       text check (length(btrim(note)) <= 200),
  created_at timestamptz not null default now()
);

comment on table public.platform_admins is
  'Administrative identities. Membership here grants no access to any household''s financial data — only the right to create, disable and staff households.';

alter table public.platform_admins enable row level security;
alter table public.platform_admins force row level security;

-- Deliberately no INSERT, UPDATE or DELETE policy.
--
-- Appointing a platform owner is an act on the database, performed in the SQL
-- editor through the function below — never something an application request can
-- do. A table with no write policy cannot be written by any browser session,
-- whatever a server action believes.
drop policy if exists platform_admins_select_self on public.platform_admins;
create policy platform_admins_select_self
  on public.platform_admins
  for select
  to authenticated
  using (profile_id = (select auth.uid()));

-- Privileges as well as policies. A policy narrows what a role may reach; it
-- does not hand the role the table in the first place.
grant select on public.platform_admins to authenticated;

comment on policy platform_admins_select_self on public.platform_admins is
  'A person may learn that they themselves hold it. The list of administrators is not readable by anyone through the API.';

-- SECURITY DEFINER so a policy may ask the question without granting the asker
-- the right to read the table. It takes nothing and returns a boolean.
create or replace function app.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.platform_admins pa
    where pa.profile_id = (select auth.uid())
  );
$$;

comment on function app.is_platform_admin() is
  'True when the caller is a platform owner. Administrative only: no financial policy consults it.';

revoke all on function app.is_platform_admin() from public, anon;
grant execute on function app.is_platform_admin() to authenticated;

-- The same question, where an application can reach it.
--
-- PostgREST exposes `public` and not `app`, so a screen asking "should I render
-- the administrative section?" needs a door in this schema. It answers only
-- about the caller, so there is nothing here to leak.
create or replace function public.is_platform_owner()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select app.is_platform_admin();
$$;

revoke all on function public.is_platform_owner() from public, anon;
grant execute on function public.is_platform_owner() to authenticated;

-- ---------------------------------------------------------------------------
-- Appointing one
-- ---------------------------------------------------------------------------

-- Runnable only from the SQL editor, by the migration role. It is explicitly
-- **not** granted to `authenticated`, so no signed-in session can reach it and
-- no server action can call it by mistake. Appointing an administrator is a
-- deliberate act on the database, and this keeps it that way.
create or replace function app.appoint_platform_admin(p_email text, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
begin
  select u.id into v_profile from auth.users u where lower(u.email) = lower(btrim(p_email));
  if v_profile is null then
    raise exception 'no account exists for that address; they must sign in once first'
      using errcode = 'P0002';
  end if;

  -- A person who has signed in but never joined a household has no profile row.
  if not exists (select 1 from public.profiles where id = v_profile) then
    insert into public.profiles (id, display_name)
    values (v_profile, left(coalesce(split_part(btrim(p_email), '@', 1), 'מנהל'), 80));
  end if;

  insert into public.platform_admins (profile_id, note)
  values (v_profile, left(btrim(coalesce(p_note, '')), 200))
  on conflict (profile_id) do update set note = excluded.note;

  return v_profile;
end;
$$;

comment on function app.appoint_platform_admin(text, text) is
  'Appoints a platform owner by email. Not granted to any application role: run it in the SQL editor.';

revoke all on function app.appoint_platform_admin(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Whether a stranger may ask for a household at all
-- ---------------------------------------------------------------------------

create table if not exists public.platform_settings (
  -- One row, enforced by the type of its key.
  id                         boolean primary key default true check (id),
  household_requests_enabled boolean not null default false,
  updated_at                 timestamptz not null default now()
);

insert into public.platform_settings (id) values (true) on conflict (id) do nothing;

comment on table public.platform_settings is
  'One row. Whether a person without an invitation may ask for a household; off unless the platform owner turns it on.';

alter table public.platform_settings enable row level security;
alter table public.platform_settings force row level security;

-- Anybody signed in may learn whether asking is possible: the sign-up screen
-- has to decide whether to show a request form or only the invitation box.
drop policy if exists platform_settings_select_authenticated on public.platform_settings;
create policy platform_settings_select_authenticated
  on public.platform_settings
  for select
  to authenticated
  using (true);

drop policy if exists platform_settings_update_admin on public.platform_settings;
create policy platform_settings_update_admin
  on public.platform_settings
  for update
  to authenticated
  using (app.is_platform_admin())
  with check (app.is_platform_admin() and id);

-- ---------------------------------------------------------------------------
-- Asking for one
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'household_request_status' and n.nspname = 'public'
  ) then
    create type public.household_request_status as enum ('pending', 'approved', 'declined');
  end if;
end
$$;

create table if not exists public.household_requests (
  id             uuid primary key default gen_random_uuid(),
  requested_by   uuid not null references public.profiles (id) on delete cascade,
  household_name text not null check (length(btrim(household_name)) between 1 and 120),
  note           text check (length(btrim(note)) <= 500),
  status         public.household_request_status not null default 'pending',
  decided_by     uuid references public.profiles (id) on delete set null,
  decided_at     timestamptz,
  -- Set when an approval created one, so the trail from request to household is
  -- a link rather than a guess.
  household_id   uuid references public.households (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- The optimistic-concurrency counter every table here carries, and which
  -- app.touch_updated_at() bumps on every update. Without it that trigger fails.
  version        integer not null default 1,

  constraint household_requests_decided_fields_together check (
    (status = 'pending' and decided_at is null and decided_by is null)
    or (status <> 'pending' and decided_at is not null)
  )
);

-- For a database where an earlier run of this migration already created the
-- table without it. `create table if not exists` adds no column.
alter table public.household_requests add column if not exists version integer not null default 1;

comment on table public.household_requests is
  'A person asking for a household. Nothing is created by asking: an approval by a platform owner is what creates one.';

create unique index if not exists household_requests_one_pending_per_person
  on public.household_requests (requested_by)
  where status = 'pending';

drop trigger if exists household_requests_touch_updated_at on public.household_requests;
create trigger household_requests_touch_updated_at
  before update on public.household_requests
  for each row execute function app.touch_updated_at();

alter table public.household_requests enable row level security;
alter table public.household_requests force row level security;

-- A person sees their own request and nobody else's; a platform owner sees all
-- of them, because deciding on them is the whole job.
drop policy if exists household_requests_select_own_or_admin on public.household_requests;
create policy household_requests_select_own_or_admin
  on public.household_requests
  for select
  to authenticated
  using (requested_by = (select auth.uid()) or app.is_platform_admin());

-- Deliberately no INSERT policy: asking goes through `public.request_household`,
-- which checks that asking is open at all. Without that check a person could
-- insert a request while requests are disabled.

-- Only a platform owner decides, and deciding may never rewrite what was asked.
drop policy if exists household_requests_decide_admin on public.household_requests;
create policy household_requests_decide_admin
  on public.household_requests
  for update
  to authenticated
  using (app.is_platform_admin())
  with check (app.is_platform_admin());

grant select on public.platform_settings to authenticated;
grant update on public.platform_settings to authenticated;
grant select on public.household_requests to authenticated;
grant update on public.household_requests to authenticated;

create or replace function public.request_household(p_household_name text, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid := (select auth.uid());
  v_claims  jsonb;
  v_request uuid;
begin
  if v_profile is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  if not (select s.household_requests_enabled from public.platform_settings s where s.id) then
    raise exception 'household requests are closed' using errcode = 'P0001';
  end if;

  if p_household_name is null or length(btrim(p_household_name)) = 0 then
    raise exception 'a household needs a name' using errcode = '22023';
  end if;

  -- A person who has signed in and never joined anything has no profile yet.
  if not exists (select 1 from public.profiles where id = v_profile) then
    v_claims := coalesce(auth.jwt(), '{}'::jsonb);
    insert into public.profiles (id, display_name)
    values (
      v_profile,
      left(coalesce(
        nullif(btrim(v_claims -> 'user_metadata' ->> 'display_name'), ''),
        nullif(split_part(v_claims ->> 'email', '@', 1), ''),
        'מבקש/ת'
      ), 80)
    );
  end if;

  insert into public.household_requests (requested_by, household_name, note)
  values (v_profile, btrim(p_household_name), nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_request;

  return v_request;
end;
$$;

revoke all on function public.request_household(text, text) from public, anon;
grant execute on function public.request_household(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- A household that has been switched off
-- ---------------------------------------------------------------------------

alter table public.households
  add column if not exists disabled_at timestamptz;

comment on column public.households.disabled_at is
  'Set by a platform owner. A disabled household is invisible to its members through every policy, because membership itself stops answering.';

-- The one change that disables a household everywhere at once.
--
-- Every policy in this schema — all thirty-four tables — is anchored to
-- app.is_household_member(). Teaching that one function about `disabled_at` is
-- what makes "disabled" mean disabled, rather than thirty-four opportunities to
-- forget one.
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
    join public.households h on h.id = hm.household_id
    where hm.household_id = p_household_id
      and hm.profile_id = (select auth.uid())
      and hm.status = 'active'
      and h.disabled_at is null
  );
$$;

create or replace function app.current_household_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select hm.household_id
  from public.household_members hm
  join public.households h on h.id = hm.household_id
  where hm.profile_id = (select auth.uid())
    and hm.status = 'active'
    and h.disabled_at is null;
$$;

-- ---------------------------------------------------------------------------
-- The first owner of a household nobody is in yet
-- ---------------------------------------------------------------------------

-- Widened from "the person named in created_by" to "the first active member".
--
-- A platform owner creates a household and does **not** join it — that is the
-- whole point of keeping their access administrative. So the household exists
-- with no members at all, and the person who redeems its invitation is its first
-- owner. For a household that already has an owner this does nothing, so an
-- ordinary invitee is still an ordinary member.
create or replace function app.opener_is_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active'
     and new.role = 'member'
     and not exists (
       select 1
       from public.household_members hm
       where hm.household_id = new.household_id
         and hm.status = 'active'
         and hm.role = 'owner'
     )
  then
    new.role := 'owner';
  end if;
  return new;
end;
$$;

comment on function app.opener_is_owner() is
  'The first active member of a household is its owner. Covers both the person who creates one and the first owner invited into an empty one.';

-- ---------------------------------------------------------------------------
-- Creating a household is now an administrative act
-- ---------------------------------------------------------------------------

-- The policy, not only the function.
--
-- `households_insert_self_as_creator` asked whether the creator was the caller
-- and never whether the caller could create one at all — so closing the function
-- would have left the table itself open, and a single INSERT would have walked
-- round the whole thing. A test found it, which is the argument for writing the
-- test before believing the function.
drop policy if exists households_insert_self_as_creator on public.households;
drop policy if exists households_insert_platform_owner on public.households;
create policy households_insert_platform_owner
  on public.households
  for insert
  to authenticated
  with check (created_by = (select auth.uid()) and app.is_platform_admin());

comment on policy households_insert_platform_owner on public.households is
  'A household is brought into existence by the platform owner, in their own name. The SECURITY DEFINER creation functions are the supported route; this is what stops the unsupported one.';

-- The self-service path, closed.
--
-- The body changes rather than the grant, so the refusal is a sentence a person
-- can read instead of a permission error. Everything else about the function is
-- untouched: it still bootstraps a profile, still writes settings and setup
-- progress, still records an audit event.
create or replace function public.create_household(
  p_name text,
  p_profile_display_name text default null,
  p_currency text default 'ILS',
  p_time_zone text default 'Asia/Jerusalem'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid := (select auth.uid());
  v_household uuid;
begin
  if v_profile is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  if not app.is_platform_admin() then
    raise exception 'a household is created by the platform owner, from an invitation'
      using errcode = '42501';
  end if;

  if p_name is null or length(btrim(p_name)) = 0 then
    raise exception 'a household needs a name' using errcode = '22023';
  end if;

  if not exists (select 1 from public.profiles where id = v_profile) then
    if p_profile_display_name is null or length(btrim(p_profile_display_name)) = 0 then
      raise exception 'a profile display name is required for a first household'
        using errcode = '22023';
    end if;
    insert into public.profiles (id, display_name, time_zone)
    values (v_profile, btrim(p_profile_display_name), coalesce(p_time_zone, 'Asia/Jerusalem'));
  end if;

  insert into public.households (name, created_by)
  values (btrim(p_name), v_profile)
  returning id into v_household;

  insert into public.household_members (household_id, profile_id, status)
  values (v_household, v_profile, 'active');

  insert into public.household_settings (household_id, currency, time_zone)
  values (v_household, coalesce(p_currency, 'ILS'), coalesce(p_time_zone, 'Asia/Jerusalem'));

  insert into public.setup_progress (household_id, household_named)
  values (v_household, true);

  perform public.record_audit_event(v_household, 'household.created', 'households', v_household);

  return v_household;
end;
$$;

-- ---------------------------------------------------------------------------
-- What a platform owner actually does
-- ---------------------------------------------------------------------------

-- One statement, one transaction: the household, its settings, and the single
-- invitation that will make somebody its owner. A failure anywhere leaves no
-- half-made household for a person to stumble into.
--
-- The platform owner does **not** become a member. The household is created
-- empty, and the first person to redeem the invitation becomes its owner by way
-- of app.opener_is_owner().
create or replace function public.admin_create_household_with_owner(
  p_name text,
  p_owner_email text,
  p_valid_for interval default interval '7 days'
)
returns table (household_id uuid, token text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin     uuid := (select auth.uid());
  v_household uuid;
  v_token     text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  if v_admin is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if not app.is_platform_admin() then
    raise exception 'only the platform owner creates a household' using errcode = '42501';
  end if;
  if p_name is null or length(btrim(p_name)) = 0 then
    raise exception 'a household needs a name' using errcode = '22023';
  end if;
  if p_owner_email is null or position('@' in p_owner_email) < 2 then
    raise exception 'the first owner needs an email address' using errcode = '22023';
  end if;

  insert into public.households (name, created_by)
  values (btrim(p_name), v_admin)
  returning id into v_household;

  insert into public.household_settings (household_id) values (v_household);
  insert into public.setup_progress (household_id, household_named) values (v_household, true);

  insert into public.household_invitations
    (household_id, invited_email, token_hash, created_by, expires_at)
  values
    (v_household, btrim(lower(p_owner_email)), extensions.digest(v_token, 'sha256'), v_admin,
     now() + coalesce(p_valid_for, interval '7 days'));

  /*
   * Written directly rather than through `record_audit_event`, which refuses a
   * household the caller does not belong to. That refusal is right — and this is
   * the one case it cannot cover, because a platform owner creating a household
   * deliberately does not join it.
   */
  insert into public.audit_events (household_id, actor_profile_id, action, entity_type, entity_id)
  values (v_household, v_admin, 'household.created_by_platform_owner', 'households', v_household);

  return query select v_household, v_token;
end;
$$;

revoke all on function public.admin_create_household_with_owner(text, text, interval)
  from public, anon;
grant execute on function public.admin_create_household_with_owner(text, text, interval)
  to authenticated;

-- Approving a request is the same act, with the request marked and linked.
create or replace function public.approve_household_request(
  p_request_id uuid,
  p_owner_email text default null,
  p_valid_for interval default interval '7 days'
)
returns table (household_id uuid, token text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin   uuid := (select auth.uid());
  v_request public.household_requests%rowtype;
  v_email   text;
  v_result  record;
begin
  if not app.is_platform_admin() then
    raise exception 'only the platform owner approves a request' using errcode = '42501';
  end if;

  select * into v_request from public.household_requests where id = p_request_id for update;
  if not found then
    raise exception 'no such request' using errcode = 'P0002';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'that request has already been decided' using errcode = 'P0001';
  end if;

  -- The address the household is handed to: whatever the owner typed, or the
  -- sign-in address of the person who asked.
  v_email := coalesce(
    nullif(btrim(coalesce(p_owner_email, '')), ''),
    (select u.email from auth.users u where u.id = v_request.requested_by)
  );
  if v_email is null then
    raise exception 'no address to invite' using errcode = '22023';
  end if;

  select * into v_result
  from public.admin_create_household_with_owner(v_request.household_name, v_email, p_valid_for);

  update public.household_requests
  set status = 'approved',
      decided_by = v_admin,
      decided_at = now(),
      household_id = v_result.household_id
  where id = p_request_id;

  return query select v_result.household_id, v_result.token;
end;
$$;

revoke all on function public.approve_household_request(uuid, text, interval) from public, anon;
grant execute on function public.approve_household_request(uuid, text, interval) to authenticated;

create or replace function public.decline_household_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_platform_admin() then
    raise exception 'only the platform owner decides a request' using errcode = '42501';
  end if;
  update public.household_requests
  set status = 'declined', decided_by = (select auth.uid()), decided_at = now()
  where id = p_request_id and status = 'pending';
end;
$$;

revoke all on function public.decline_household_request(uuid) from public, anon;
grant execute on function public.decline_household_request(uuid) to authenticated;

-- Switching a household off, and on again.
create or replace function public.admin_set_household_disabled(
  p_household_id uuid,
  p_disabled boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_platform_admin() then
    raise exception 'only the platform owner disables a household' using errcode = '42501';
  end if;
  update public.households
  set disabled_at = case when p_disabled then now() else null end
  where id = p_household_id;
end;
$$;

revoke all on function public.admin_set_household_disabled(uuid, boolean) from public, anon;
grant execute on function public.admin_set_household_disabled(uuid, boolean) to authenticated;

-- Removing somebody, when the household's own owner cannot or will not.
create or replace function public.admin_revoke_membership(
  p_household_id uuid,
  p_profile_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_platform_admin() then
    raise exception 'only the platform owner removes a member from outside' using errcode = '42501';
  end if;
  -- The last-owner rule is a trigger, not a policy, so it holds here too: a
  -- platform owner cannot leave a household unable to ever invite again.
  update public.household_members
  set status = 'revoked', revoked_at = now()
  where household_id = p_household_id and profile_id = p_profile_id and status = 'active';
end;
$$;

revoke all on function public.admin_revoke_membership(uuid, uuid) from public, anon;
grant execute on function public.admin_revoke_membership(uuid, uuid) to authenticated;

-- Withdrawing an invitation that has not been redeemed.
create or replace function public.admin_revoke_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_platform_admin() then
    raise exception 'only the platform owner withdraws an invitation from outside'
      using errcode = '42501';
  end if;
  update public.household_invitations
  set revoked_at = now(), revoked_by = (select auth.uid())
  where id = p_invitation_id and accepted_at is null and revoked_at is null;
end;
$$;

revoke all on function public.admin_revoke_invitation(uuid) from public, anon;
grant execute on function public.admin_revoke_invitation(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- What a platform owner may see
-- ---------------------------------------------------------------------------

-- Names and counts. Deliberately not a single figure of money: the point of the
-- role is that it can staff a household without reading it.
create or replace function public.admin_household_overview()
returns table (
  household_id    uuid,
  name            text,
  created_at      timestamptz,
  disabled_at     timestamptz,
  member_count    integer,
  owner_count     integer,
  pending_invites integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    h.id,
    h.name,
    h.created_at,
    h.disabled_at,
    (select count(*)::int from public.household_members m
      where m.household_id = h.id and m.status = 'active'),
    (select count(*)::int from public.household_members m
      where m.household_id = h.id and m.status = 'active' and m.role = 'owner'),
    (select count(*)::int from public.household_invitations i
      where i.household_id = h.id and i.accepted_at is null and i.revoked_at is null
        and i.expires_at > now())
  from public.households h
  where app.is_platform_admin()
  order by h.created_at;
$$;

revoke all on function public.admin_household_overview() from public, anon;
grant execute on function public.admin_household_overview() to authenticated;

comment on function public.admin_household_overview() is
  'Households, their staffing and their state — for the platform owner. Returns nothing at all to anybody else, and no financial figure to anybody.';
