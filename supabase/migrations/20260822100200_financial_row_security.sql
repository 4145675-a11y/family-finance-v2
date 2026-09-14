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
