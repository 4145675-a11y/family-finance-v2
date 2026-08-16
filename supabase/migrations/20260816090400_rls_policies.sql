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
create policy profiles_insert_self
  on public.profiles
  for insert
  to authenticated
  with check (id = (select auth.uid()));

-- Editing another person's display name is never permitted, not even a partner's.
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

create policy households_select_member
  on public.households
  for select
  to authenticated
  using (app.is_household_member(id));

-- The creator must be the caller. Without this check a client could create a
-- household attributed to someone else.
create policy households_insert_self_as_creator
  on public.households
  for insert
  to authenticated
  with check (created_by = (select auth.uid()));

-- Both partners may rename the household: permissions are equal by product rule.
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
create policy household_invitations_select_member
  on public.household_invitations
  for select
  to authenticated
  using (app.is_household_member(household_id));

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
