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
