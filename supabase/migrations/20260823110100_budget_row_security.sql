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
