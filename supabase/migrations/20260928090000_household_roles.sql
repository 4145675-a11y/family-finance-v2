-- Household roles — who may administer a membership.
--
-- 01-PRODUCT-SPEC.md says the partners hold equal permission: there is no role
-- that can overrule the other about money, and this migration does not create
-- one. Every policy on every financial table is untouched, and both an owner and
-- a member record, approve and read exactly the same things.
--
-- What it does create is a distinction about **administration**: who may invite
-- another person into the household, and who may revoke a membership. Until now
-- any active member could do both, which meant a person invited last week could
-- revoke the person who opened the household. That is not equality; it is an
-- absence of a rule, and the first time it matters it will matter a great deal.
--
-- Additive throughout. The column has a default, the backfill is deterministic,
-- and a household that existed before this ran comes out with exactly one owner.

-- ---------------------------------------------------------------------------
-- The role
-- ---------------------------------------------------------------------------

-- CREATE TYPE has no IF NOT EXISTS, and dropping a type a column depends on is
-- not an option. Creation is guarded instead, as elsewhere in this schema.
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'household_role' and n.nspname = 'public'
  ) then
    create type public.household_role as enum ('owner', 'member');
  end if;
end
$$;

alter table public.household_members
  add column if not exists role public.household_role not null default 'member';

comment on column public.household_members.role is
  'Administrative rights only: an owner may invite and revoke. Money permissions are equal for both roles (01-PRODUCT-SPEC.md).';

-- ---------------------------------------------------------------------------
-- Backfill: every household ends with exactly one owner, chosen deterministically
-- ---------------------------------------------------------------------------

-- The person who opened the household, where they are still an active member.
update public.household_members hm
set role = 'owner'
from public.households h
where h.id = hm.household_id
  and hm.profile_id = h.created_by
  and hm.status = 'active'
  and hm.role <> 'owner';

-- A household whose creator has left keeps working: the earliest active member
-- becomes the owner. Leaving it ownerless would mean nobody could ever invite
-- again, which is a worse outcome than promoting the person who has been there
-- longest.
with first_member as (
  select distinct on (hm.household_id) hm.id
  from public.household_members hm
  where hm.status = 'active'
    and not exists (
      select 1
      from public.household_members owner
      where owner.household_id = hm.household_id
        and owner.status = 'active'
        and owner.role = 'owner'
    )
  order by hm.household_id, hm.joined_at, hm.id
)
update public.household_members hm
set role = 'owner'
from first_member
where hm.id = first_member.id;

create index if not exists household_members_owner_idx
  on public.household_members (household_id)
  where status = 'active' and role = 'owner';

-- ---------------------------------------------------------------------------
-- Asking the question
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER for the same reason as app.is_household_member: a policy on
-- household_members must be able to ask about household_members without
-- re-entering its own policy. It takes a household id and returns a boolean, so
-- there is no row it could leak.
create or replace function app.is_household_owner(p_household_id uuid)
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
      and hm.role = 'owner'
  );
$$;

comment on function app.is_household_owner(uuid) is
  'True when the caller is an active owner of the household. Administration only; money permissions do not consult it.';

revoke all on function app.is_household_owner(uuid) from public, anon;
grant execute on function app.is_household_owner(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Where the first owner comes from
-- ---------------------------------------------------------------------------

-- The column defaults to 'member', and `public.create_household` inserts the
-- creator's membership without naming a role. Left alone, every household
-- created from today would have no owner at all and could never invite anybody
-- — a product that quietly stops working for new families while every test
-- about old ones still passes.
--
-- A trigger rather than an edit to that function, because a membership is
-- inserted from more than one place and the rule belongs to the table. It fires
-- only for the person who opened the household: an invitee joining is a member,
-- whoever else is or is not there.
create or replace function app.opener_is_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active'
     and new.role = 'member'
     and new.profile_id = (
       select h.created_by from public.households h where h.id = new.household_id
     )
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
  'The person who opened a household is its first owner. Applies wherever a membership is inserted, so no household can be created ownerless.';

drop trigger if exists household_members_opener_is_owner on public.household_members;
create trigger household_members_opener_is_owner
  before insert on public.household_members
  for each row execute function app.opener_is_owner();

comment on function public.create_household(text, text, text, text) is
  'Creates a household and the creator''s membership. The role is not named here: app.opener_is_owner() makes the opener the first owner, wherever the membership is inserted from.';

-- ---------------------------------------------------------------------------
-- What an update to a membership may do
-- ---------------------------------------------------------------------------

-- A trigger rather than a policy, because the invariants are about the change
-- and not about the row: WITH CHECK sees only the new values, so it cannot say
-- "a revoked membership may not come back" or "this was the last owner". Both of
-- those need OLD, and this is where OLD exists.
--
-- RLS decides who may attempt an update at all; this decides what an update is
-- allowed to be. Neither is a substitute for the other.
create or replace function app.guard_household_member_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A membership belongs to one person in one household, for its whole life.
  -- Moving it is indistinguishable from granting access to somewhere else.
  if new.household_id <> old.household_id or new.profile_id <> old.profile_id then
    raise exception 'a membership cannot be moved to another household or person'
      using errcode = 'check_violation';
  end if;

  /*
   * Re-activation is deliberately *not* forbidden here.
   *
   * It is tempting to make revocation one-way in this trigger, and the first
   * draft did. It breaks re-inviting somebody: `accept_household_invitation`
   * re-activates a revoked membership through `on conflict do update`, so a
   * person removed and later invited back would be refused at the door with a
   * message about a rule nobody meant to apply to them.
   *
   * The guarantee people actually need is narrower and is already held, by the
   * policy rather than by this trigger: a revoked person is not a member, so no
   * policy matches their update and they cannot restore themselves. Coming back
   * requires an owner to invite them and a token to be redeemed.
   */

  -- The last owner cannot be demoted or revoked. A household with no owner can
  -- never invite anyone again, and there is no way back from that state.
  if old.status = 'active' and old.role = 'owner'
     and (new.status <> 'active' or new.role <> 'owner') then
    if not exists (
      select 1
      from public.household_members other
      where other.household_id = old.household_id
        and other.id <> old.id
        and other.status = 'active'
        and other.role = 'owner'
    ) then
      raise exception 'a household keeps at least one owner'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

comment on function app.guard_household_member_update() is
  'Invariants a membership update must hold. Needs OLD, so it is a trigger rather than a WITH CHECK clause.';

drop trigger if exists household_members_guard_update on public.household_members;
create trigger household_members_guard_update
  before update on public.household_members
  for each row execute function app.guard_household_member_update();

-- ---------------------------------------------------------------------------
-- Policies: administration is the owner's, and only within their own household
-- ---------------------------------------------------------------------------

-- Replaced rather than added to. Two permissive UPDATE policies would be ORed
-- together, so the narrower one would stop narrowing anything.
drop policy if exists household_members_revoke_within_household on public.household_members;
drop policy if exists household_members_administer on public.household_members;
create policy household_members_administer
  on public.household_members
  for update
  to authenticated
  using (app.is_household_owner(household_id))
  with check (app.is_household_owner(household_id));

comment on policy household_members_administer on public.household_members is
  'An owner may revoke a membership or change a role, inside their own household. What the change may be is decided by the trigger.';

-- Inviting is administration. It was any member's; it is the owner's.
drop policy if exists household_invitations_insert_member on public.household_invitations;
drop policy if exists household_invitations_insert_owner on public.household_invitations;
create policy household_invitations_insert_owner
  on public.household_invitations
  for insert
  to authenticated
  with check (
    app.is_household_owner(household_id)
    and created_by = (select auth.uid())
  );

-- And so is withdrawing one.
drop policy if exists household_invitations_revoke_member on public.household_invitations;
drop policy if exists household_invitations_revoke_owner on public.household_invitations;
create policy household_invitations_revoke_owner
  on public.household_invitations
  for update
  to authenticated
  using (app.is_household_owner(household_id))
  with check (
    app.is_household_owner(household_id)
    and accepted_at is null
  );

-- ---------------------------------------------------------------------------
-- Acceptance gives the plain role
-- ---------------------------------------------------------------------------

-- The acceptance function inserts the membership. It runs SECURITY DEFINER and
-- therefore bypasses the policies above, which is correct — the token is the
-- authorisation. What it must not do is hand out an owner's rights: a person
-- arriving by invitation is a member, and an owner may promote them afterwards.
--
-- The column defaults to 'member', so the existing INSERT needs no change. This
-- states it so a future edit to that function cannot quietly change it without
-- this comment being in the diff.
comment on function public.accept_household_invitation(text) is
  'Redeems a one-time token and inserts an active membership with the default role, member. Promotion is a separate, deliberate act by an owner.';
