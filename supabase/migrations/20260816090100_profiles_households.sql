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

create trigger households_touch_updated_at
  before update on public.households
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- household_members
-- ---------------------------------------------------------------------------

create type public.membership_status as enum ('active', 'revoked');

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
