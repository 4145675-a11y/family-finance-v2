-- Production Data Layer (ADR-0032) — the schema the application actually reads
-- and writes through, and the defects the behavioural RLS suites found.
--
-- Nothing here edits an applied migration. Every correction is forward:
-- policies that change get a new name, functions are replaced, columns are
-- added. Re-runnable per ADR-0015.
--
-- What this migration adds, and why each piece exists:
--
--   1. Defects found by running allow/deny against the real database:
--      `setup_progress` and `notification_preferences` carry the
--      touch_updated_at trigger but no `version` column, so no UPDATE on either
--      table could ever succeed; and `audit_row_change` derived entity_id from
--      `id`, which tables keyed by household_id/profile_id do not have.
--   2. Columns the application contracts require and the schema lacked
--      (`businesses.operating_reserve_minor`, the task fields, batch summary).
--   3. Import provenance on the records an import creates, so a batch can be
--      reversed and every record it produced found — the local store has
--      carried this since M7.
--   4. Void markers instead of deletion. The local store physically removed a
--      reversed import's snapshots and debt events and a removed planned item;
--      02-FINANCIAL-RULES.md says "void/correction, not deletion", and the
--      DELETE grants stay exactly where they were. The marked rows stay for
--      history and are simply not loaded.
--   5. The two entry points the application uses: load one household as a
--      document, and apply a set of changes atomically. Both SECURITY INVOKER,
--      so row-level security is the authority for every statement inside.
--   6. `create_household()` — until now there was no path by which the person
--      who created a household became a member of it — and
--      `create_household_invitation()`.

-- ---------------------------------------------------------------------------
-- 1. Defects
-- ---------------------------------------------------------------------------

alter table public.setup_progress
  add column if not exists version integer not null default 1;

alter table public.notification_preferences
  add column if not exists version integer not null default 1;

-- entity_id: the row's id, or the key that identifies a one-per-household /
-- one-per-person row. Otherwise identical to the M3 version.
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
  v_entity_id := coalesce(
    (v_row ->> 'id')::uuid,
    (v_row ->> 'household_id')::uuid,
    (v_row ->> 'profile_id')::uuid
  );

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

-- ---------------------------------------------------------------------------
-- 2. Columns the contracts require
-- ---------------------------------------------------------------------------

alter table public.businesses
  add column if not exists operating_reserve_minor bigint not null default 0;
alter table public.businesses
  drop constraint if exists businesses_operating_reserve_valid;
alter table public.businesses
  add constraint businesses_operating_reserve_valid
  check (app.is_valid_amount_minor(operating_reserve_minor));

do $$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'task_origin' and n.nspname = 'public'
  ) then
    create type public.task_origin as enum ('manual', 'recommendation');
  end if;
end
$$;

-- The application's task status is 'dismissed'; the M9 enum said 'dropped'.
-- A label cannot be renamed in place safely, so the application's value is
-- added and 'dropped' stays unused.
alter type public.task_status add value if not exists 'dismissed';

alter table public.family_tasks
  add column if not exists origin public.task_origin not null default 'manual',
  add column if not exists amount_minor bigint,
  add column if not exists related_debt_id uuid references public.debts (id) on delete set null,
  add column if not exists related_account_id uuid references public.financial_accounts (id) on delete set null,
  add column if not exists follow_up_on date;

alter table public.family_tasks
  drop constraint if exists family_tasks_recommendation_key_check;
alter table public.family_tasks
  drop constraint if exists family_tasks_recommendation_key_length;
alter table public.family_tasks
  add constraint family_tasks_recommendation_key_length
  check (recommendation_key is null or length(btrim(recommendation_key)) <= 80);
alter table public.family_tasks
  drop constraint if exists family_tasks_amount_valid;
alter table public.family_tasks
  add constraint family_tasks_amount_valid
  check (amount_minor is null or app.is_valid_amount_minor(amount_minor));
alter table public.family_tasks
  drop constraint if exists family_tasks_recommendation_names_key;
alter table public.family_tasks
  add constraint family_tasks_recommendation_names_key
  check ((origin = 'recommendation') = (recommendation_key is not null));

-- The reference trigger now also proves the related debt and account belong
-- to the same household. Same function name, so the existing trigger binding
-- stays; only the body changes.
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

  if new.related_debt_id is not null then
    select household_id into v_household
    from public.debts where id = new.related_debt_id;
    if v_household is null or v_household <> new.household_id then
      raise exception 'a task can only relate to a debt of the same household';
    end if;
  end if;

  if new.related_account_id is not null then
    select household_id into v_household
    from public.financial_accounts where id = new.related_account_id;
    if v_household is null or v_household <> new.household_id then
      raise exception 'a task can only relate to an account of the same household';
    end if;
  end if;

  return new;
end;
$$;

drop policy if exists family_tasks_insert_member on public.family_tasks;
drop policy if exists family_tasks_insert_member_v2 on public.family_tasks;
create policy family_tasks_insert_member_v2
  on public.family_tasks for insert to authenticated
  with check (
    app.is_household_member(household_id)
    and app.household_owns_member(household_id, assigned_member_id)
    and app.household_owns_debt(household_id, related_debt_id)
    and app.household_owns_account(household_id, related_account_id)
    and created_by = (select auth.uid())
  );

drop policy if exists family_tasks_update_member on public.family_tasks;
drop policy if exists family_tasks_update_member_v2 on public.family_tasks;
create policy family_tasks_update_member_v2
  on public.family_tasks for update to authenticated
  using (app.is_household_member(household_id))
  with check (
    app.is_household_member(household_id)
    and app.household_owns_member(household_id, assigned_member_id)
    and app.household_owns_debt(household_id, related_debt_id)
    and app.household_owns_account(household_id, related_account_id)
  );

alter table public.import_batches
  add column if not exists summary jsonb not null default '{}'::jsonb,
  add column if not exists warnings text[] not null default '{}',
  add column if not exists rejected_at timestamptz;
alter table public.import_batches
  drop constraint if exists import_batches_rejected_status;
alter table public.import_batches
  add constraint import_batches_rejected_status
  check (rejected_at is null or status = 'rejected');

-- ---------------------------------------------------------------------------
-- 3. Import provenance
-- ---------------------------------------------------------------------------

alter table public.transactions
  add column if not exists import_batch_id uuid references public.import_batches (id) on delete set null,
  add column if not exists import_proposal_id uuid references public.import_proposals (id) on delete set null,
  add column if not exists source_fingerprint text;
alter table public.transactions
  drop constraint if exists transactions_source_fingerprint_length;
alter table public.transactions
  add constraint transactions_source_fingerprint_length
  check (source_fingerprint is null or length(source_fingerprint) <= 400);

alter table public.account_balance_snapshots
  add column if not exists import_batch_id uuid references public.import_batches (id) on delete set null;
alter table public.debt_events
  add column if not exists import_batch_id uuid references public.import_batches (id) on delete set null;
alter table public.cashflow_items
  add column if not exists import_batch_id uuid references public.import_batches (id) on delete set null;

create index if not exists transactions_import_batch_idx
  on public.transactions (import_batch_id) where import_batch_id is not null;
create index if not exists account_balance_snapshots_import_batch_idx
  on public.account_balance_snapshots (import_batch_id) where import_batch_id is not null;
create index if not exists debt_events_import_batch_idx
  on public.debt_events (import_batch_id) where import_batch_id is not null;

create or replace function app.household_owns_import_proposal(
  p_household_id uuid,
  p_proposal_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select p_proposal_id is null or exists (
    select 1 from public.import_proposals p
    where p.id = p_proposal_id and p.household_id = p_household_id
  );
$$;

do $$
begin
  execute 'revoke all on function app.household_owns_import_proposal(uuid, uuid) from public, anon';
  execute 'grant execute on function app.household_owns_import_proposal(uuid, uuid) to authenticated';
end
$$;

-- The provenance columns are references, and references ignore RLS: every
-- policy that accepts one proves it. Same rules as before, plus the two links.
drop policy if exists transactions_insert_member on public.transactions;
drop policy if exists transactions_insert_member_v2 on public.transactions;
create policy transactions_insert_member_v2
  on public.transactions for insert to authenticated
  with check (
    app.is_household_member(household_id)
    and app.household_owns_account(household_id, account_id)
    and app.household_owns_account(household_id, counterpart_account_id)
    and app.household_owns_category(household_id, category_id)
    and app.household_owns_transaction(household_id, refunds_transaction_id)
    and app.household_owns_transaction(household_id, corrects_transaction_id)
    and app.household_owns_import_batch(household_id, import_batch_id)
    and app.household_owns_import_proposal(household_id, import_proposal_id)
    and created_by = (select auth.uid())
  );

drop policy if exists transactions_update_member on public.transactions;
drop policy if exists transactions_update_member_v2 on public.transactions;
create policy transactions_update_member_v2
  on public.transactions for update to authenticated
  using (app.is_household_member(household_id))
  with check (
    app.is_household_member(household_id)
    and app.household_owns_account(household_id, account_id)
    and app.household_owns_account(household_id, counterpart_account_id)
    and app.household_owns_category(household_id, category_id)
    and app.household_owns_import_batch(household_id, import_batch_id)
    and app.household_owns_import_proposal(household_id, import_proposal_id)
  );

drop policy if exists account_balance_snapshots_insert_member on public.account_balance_snapshots;
drop policy if exists account_balance_snapshots_insert_member_v2 on public.account_balance_snapshots;
create policy account_balance_snapshots_insert_member_v2
  on public.account_balance_snapshots for insert to authenticated
  with check (
    app.is_household_member(household_id)
    and app.household_owns_account(household_id, account_id)
    and app.household_owns_import_batch(household_id, import_batch_id)
    and created_by = (select auth.uid())
  );

drop policy if exists debt_events_insert_member on public.debt_events;
drop policy if exists debt_events_insert_member_v2 on public.debt_events;
create policy debt_events_insert_member_v2
  on public.debt_events for insert to authenticated
  with check (
    app.is_household_member(household_id)
    and app.household_owns_debt(household_id, debt_id)
    and app.household_owns_transaction(household_id, transaction_id)
    and app.household_owns_import_batch(household_id, import_batch_id)
    and created_by = (select auth.uid())
  );

drop policy if exists cashflow_items_insert_member on public.cashflow_items;
drop policy if exists cashflow_items_insert_member_v2 on public.cashflow_items;
create policy cashflow_items_insert_member_v2
  on public.cashflow_items for insert to authenticated
  with check (
    app.is_household_member(household_id)
    and app.household_owns_account(household_id, account_id)
    and app.household_owns_category(household_id, category_id)
    and app.household_owns_transaction(household_id, settled_transaction_id)
    and app.household_owns_import_batch(household_id, import_batch_id)
    and created_by = (select auth.uid())
  );

drop policy if exists cashflow_items_update_member on public.cashflow_items;
drop policy if exists cashflow_items_update_member_v2 on public.cashflow_items;
create policy cashflow_items_update_member_v2
  on public.cashflow_items for update to authenticated
  using (app.is_household_member(household_id))
  with check (
    app.is_household_member(household_id)
    and app.household_owns_account(household_id, account_id)
    and app.household_owns_category(household_id, category_id)
    and app.household_owns_transaction(household_id, settled_transaction_id)
    and app.household_owns_import_batch(household_id, import_batch_id)
  );

-- ---------------------------------------------------------------------------
-- 4. Void markers instead of deletion
-- ---------------------------------------------------------------------------
--
-- A reversed import must stop counting the snapshots and debt events it
-- created; a family may remove a planned item they no longer expect. None of
-- that is deletion: the row keeps its history and is simply not loaded.
--
-- On the two append-only tables the only permitted change is the mark itself,
-- in one direction. That is enforced by a trigger rather than by the policy,
-- because a policy cannot say which column changed.

alter table public.account_balance_snapshots
  add column if not exists voided_at timestamptz;
alter table public.debt_events
  add column if not exists voided_at timestamptz;
alter table public.cashflow_items
  add column if not exists removed_at timestamptz;

create or replace function app.only_void_mark_changes()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.voided_at is not null then
    raise exception '% is voided and cannot change again', tg_table_name
      using errcode = '42501';
  end if;
  if new.voided_at is null then
    raise exception 'the only permitted change to % is voiding it', tg_table_name
      using errcode = '42501';
  end if;
  if (to_jsonb(old) - 'voided_at') <> (to_jsonb(new) - 'voided_at') then
    raise exception 'voiding a % row may change nothing but voided_at', tg_table_name
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function app.only_void_mark_changes() is
  'BEFORE UPDATE on append-only money rows: permits setting voided_at once and nothing else.';

drop trigger if exists account_balance_snapshots_only_void on public.account_balance_snapshots;
create trigger account_balance_snapshots_only_void
  before update on public.account_balance_snapshots
  for each row execute function app.only_void_mark_changes();

drop trigger if exists debt_events_only_void on public.debt_events;
create trigger debt_events_only_void
  before update on public.debt_events
  for each row execute function app.only_void_mark_changes();

drop policy if exists account_balance_snapshots_void_member on public.account_balance_snapshots;
create policy account_balance_snapshots_void_member
  on public.account_balance_snapshots for update to authenticated
  using (app.is_household_member(household_id))
  with check (app.is_household_member(household_id) and voided_at is not null);

drop policy if exists debt_events_void_member on public.debt_events;
create policy debt_events_void_member
  on public.debt_events for update to authenticated
  using (app.is_household_member(household_id))
  with check (app.is_household_member(household_id) and voided_at is not null);

grant update on public.account_balance_snapshots to authenticated;
grant update on public.debt_events to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Household bootstrap and invitations
-- ---------------------------------------------------------------------------

-- The only path by which a person becomes the first member of a household.
-- SECURITY DEFINER because household_members has, deliberately, no INSERT
-- policy: a person may not add themselves to an arbitrary household. Here the
-- household is created in the same statement, by the same person, so the
-- membership is the definition of "creator" rather than a privilege.
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
  if p_name is null or length(btrim(p_name)) = 0 then
    raise exception 'a household needs a name' using errcode = '22023';
  end if;

  -- A brand-new person has an auth user and no profile yet.
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

comment on function public.create_household(text, text, text, text) is
  'Creates a household with the caller as its first member, plus its settings and setup rows. The only way a creator becomes a member.';

revoke all on function public.create_household(text, text, text, text) from public, anon;
grant execute on function public.create_household(text, text, text, text) to authenticated;

-- Mints an invitation token. SECURITY INVOKER: the INSERT policy on
-- household_invitations decides whether the caller may invite. The plaintext
-- is returned once and never stored.
create or replace function public.create_household_invitation(
  p_household_id uuid,
  p_email text,
  p_valid_for interval default interval '7 days'
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  insert into public.household_invitations
    (household_id, invited_email, token_hash, created_by, expires_at)
  values
    (p_household_id, p_email, extensions.digest(v_token, 'sha256'), (select auth.uid()),
     now() + coalesce(p_valid_for, interval '7 days'));

  return v_token;
end;
$$;

revoke all on function public.create_household_invitation(uuid, text, interval) from public, anon;
grant execute on function public.create_household_invitation(uuid, text, interval) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. The household as one document
-- ---------------------------------------------------------------------------
--
-- SECURITY INVOKER: every sub-select below is filtered by the caller's
-- policies, so a household the caller does not belong to comes back as NULL —
-- not as an empty document, which would look like a household with nothing in
-- it. Voided and removed rows are not loaded; they are history, not state.

create or replace function public.load_household_document(p_household_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select case when h.id is null then null else jsonb_build_object(
    'household', to_jsonb(h),
    'settings', (select to_jsonb(s) from public.household_settings s where s.household_id = h.id),
    'setup', (select to_jsonb(s) from public.setup_progress s where s.household_id = h.id),
    'members', (select coalesce(jsonb_agg(to_jsonb(m) order by m.joined_at, m.id), '[]'::jsonb)
                from public.household_members m where m.household_id = h.id),
    'profiles', (select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at, p.id), '[]'::jsonb)
                 from public.profiles p
                 where p.id in (select m.profile_id from public.household_members m where m.household_id = h.id)),
    'invitations', (select coalesce(jsonb_agg(to_jsonb(i) - 'token_hash' order by i.created_at, i.id), '[]'::jsonb)
                    from public.household_invitations i where i.household_id = h.id),
    'businesses', (select coalesce(jsonb_agg(to_jsonb(b) order by b.created_at, b.id), '[]'::jsonb)
                   from public.businesses b where b.household_id = h.id),
    'accounts', (select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at, a.id), '[]'::jsonb)
                 from public.financial_accounts a where a.household_id = h.id),
    'categories', (select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at, c.id), '[]'::jsonb)
                   from public.categories c where c.household_id = h.id),
    'balanceSnapshots', (select coalesce(jsonb_agg(to_jsonb(s) order by s.verified_at, s.created_at, s.id), '[]'::jsonb)
                         from public.account_balance_snapshots s where s.household_id = h.id and s.voided_at is null),
    'transactions', (select coalesce(jsonb_agg(to_jsonb(t) order by t.transaction_date, t.created_at, t.id), '[]'::jsonb)
                     from public.transactions t where t.household_id = h.id),
    'cashflowItems', (select coalesce(jsonb_agg(to_jsonb(c) order by c.expected_date, c.created_at, c.id), '[]'::jsonb)
                      from public.cashflow_items c where c.household_id = h.id and c.removed_at is null),
    'debts', (select coalesce(jsonb_agg(to_jsonb(d) order by d.created_at, d.id), '[]'::jsonb)
              from public.debts d where d.household_id = h.id),
    'debtEvents', (select coalesce(jsonb_agg(to_jsonb(e) order by e.occurred_on, e.created_at, e.id), '[]'::jsonb)
                   from public.debt_events e where e.household_id = h.id and e.voided_at is null),
    'rollovers', (select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at, r.id), '[]'::jsonb)
                  from public.debt_rollovers r where r.household_id = h.id),
    'checks', (select coalesce(jsonb_agg(to_jsonb(c) order by c.due_date, c.created_at, c.id), '[]'::jsonb)
               from public.post_dated_checks c where c.household_id = h.id),
    'repaymentPlans', (select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at, p.id), '[]'::jsonb)
                       from public.repayment_plans p where p.household_id = h.id),
    'budgets', (select coalesce(jsonb_agg(to_jsonb(b) order by b.period, b.id), '[]'::jsonb)
                from public.budgets b where b.household_id = h.id),
    'budgetLines', (select coalesce(jsonb_agg(to_jsonb(l) order by l.created_at, l.id), '[]'::jsonb)
                    from public.budget_lines l where l.household_id = h.id),
    'tasks', (select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at, t.id), '[]'::jsonb)
              from public.family_tasks t where t.household_id = h.id),
    'importSourceFiles', (select coalesce(jsonb_agg(to_jsonb(f) order by f.uploaded_at, f.id), '[]'::jsonb)
                          from public.import_source_files f where f.household_id = h.id),
    'importBatches', (select coalesce(jsonb_agg(to_jsonb(b) order by b.created_at, b.id), '[]'::jsonb)
                      from public.import_batches b where b.household_id = h.id),
    'importProposals', (select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at, p.id), '[]'::jsonb)
                        from public.import_proposals p where p.household_id = h.id),
    -- Command-level entries only (dotted actions): the row-level trail the
    -- triggers write stays in the table for forensics and is not the family's
    -- activity feed.
    'audit', (select coalesce(jsonb_agg(to_jsonb(a) order by a.occurred_at, a.id), '[]'::jsonb)
              from public.audit_events a where a.household_id = h.id and a.action like '%.%')
  ) end
  from (select * from public.households where id = p_household_id) h;
$$;

comment on function public.load_household_document(uuid) is
  'One household as a document, under the caller''s own policies. NULL when the caller is not a member. Voided and removed rows are not included.';

revoke all on function public.load_household_document(uuid) from public, anon;
grant execute on function public.load_household_document(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Applying a set of changes, atomically
-- ---------------------------------------------------------------------------
--
-- The application loads the document, runs a pure command, and sends the
-- difference here: per table, the rows to upsert, and for the three tables
-- that support it, the rows to mark. One call, one transaction, one lock on
-- the household row, one optimistic check on its version.
--
-- SECURITY INVOKER: every INSERT and UPDATE below is judged by the caller's
-- policies. household_id is forced to the household being changed, so a row
-- cannot be smuggled into another household regardless of what the client
-- sent; created_by on inserts is whatever the row carries, and every policy
-- that cares insists it be the caller.

create or replace function public.apply_household_changes(
  p_household_id uuid,
  p_expected_version integer,
  p_changes jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_version integer;
  v_audit jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  -- Visible only to a member, and locked for the rest of this transaction.
  select version into v_version
  from public.households where id = p_household_id
  for update;

  if v_version is null then
    raise exception 'not a member of household %', p_household_id using errcode = '42501';
  end if;
  if p_expected_version is not null and v_version <> p_expected_version then
    raise exception 'the household changed since it was read (version % is not %)',
      v_version, p_expected_version using errcode = '40001';
  end if;

  -- --- household -----------------------------------------------------------
  if p_changes ? 'household' then
    update public.households set name = coalesce(p_changes -> 'household' ->> 'name', name)
    where id = p_household_id;
  end if;

  if p_changes ? 'settings' then
    insert into public.household_settings
      (household_id, currency, time_zone, month_start_day, manual_reserve_floor_minor,
       incident_buffer_minor, revolving_avoidance_minor, protected_reserves_minor,
       weekly_food_guidance, balance_freshness_reminder, balance_freshness_days)
    select p_household_id, r.currency, r.time_zone, r.month_start_day, r.manual_reserve_floor_minor,
           r.incident_buffer_minor, r.revolving_avoidance_minor, r.protected_reserves_minor,
           r.weekly_food_guidance, r.balance_freshness_reminder, r.balance_freshness_days
    from jsonb_to_record(p_changes -> 'settings') as r(
      currency text, time_zone text, month_start_day integer, manual_reserve_floor_minor bigint,
      incident_buffer_minor bigint, revolving_avoidance_minor bigint, protected_reserves_minor bigint,
      weekly_food_guidance boolean, balance_freshness_reminder boolean, balance_freshness_days integer)
    on conflict (household_id) do update set
      currency = excluded.currency, time_zone = excluded.time_zone,
      month_start_day = excluded.month_start_day,
      manual_reserve_floor_minor = excluded.manual_reserve_floor_minor,
      incident_buffer_minor = excluded.incident_buffer_minor,
      revolving_avoidance_minor = excluded.revolving_avoidance_minor,
      protected_reserves_minor = excluded.protected_reserves_minor,
      weekly_food_guidance = excluded.weekly_food_guidance,
      balance_freshness_reminder = excluded.balance_freshness_reminder,
      balance_freshness_days = excluded.balance_freshness_days;
  end if;

  if p_changes ? 'setup' then
    insert into public.setup_progress
      (household_id, household_named, members_added, accounts_added, balances_confirmed,
       business_decided, debts_recorded, recurring_income_recorded,
       recurring_obligations_recorded, budget_started, privacy_explained)
    select p_household_id, r.household_named, r.members_added, r.accounts_added, r.balances_confirmed,
           r.business_decided, r.debts_recorded, r.recurring_income_recorded,
           r.recurring_obligations_recorded, r.budget_started, r.privacy_explained
    from jsonb_to_record(p_changes -> 'setup') as r(
      household_named boolean, members_added boolean, accounts_added boolean,
      balances_confirmed boolean, business_decided boolean, debts_recorded boolean,
      recurring_income_recorded boolean, recurring_obligations_recorded boolean,
      budget_started boolean, privacy_explained boolean)
    on conflict (household_id) do update set
      household_named = excluded.household_named, members_added = excluded.members_added,
      accounts_added = excluded.accounts_added, balances_confirmed = excluded.balances_confirmed,
      business_decided = excluded.business_decided, debts_recorded = excluded.debts_recorded,
      recurring_income_recorded = excluded.recurring_income_recorded,
      recurring_obligations_recorded = excluded.recurring_obligations_recorded,
      budget_started = excluded.budget_started, privacy_explained = excluded.privacy_explained;
  end if;

  -- --- people --------------------------------------------------------------
  -- Only the caller's own profile is theirs to change; the policy enforces it.
  if p_changes ? 'profiles' then
    update public.profiles p
    set display_name = r.display_name, locale = r.locale, time_zone = r.time_zone
    from jsonb_to_recordset(p_changes -> 'profiles' -> 'upsert') as r(
      id uuid, display_name text, locale text, time_zone text)
    where p.id = r.id;
  end if;

  -- Membership is never inserted here (invitations only); revocation is an update.
  if p_changes ? 'members' then
    update public.household_members m
    set status = r.status, revoked_at = r.revoked_at
    from jsonb_to_recordset(p_changes -> 'members' -> 'upsert') as r(
      id uuid, status public.membership_status, revoked_at timestamptz)
    where m.id = r.id and m.household_id = p_household_id;
  end if;

  -- --- businesses, accounts, categories -----------------------------------
  if p_changes ? 'businesses' then
    insert into public.businesses
      (id, household_id, name, tax_reserve_rate_bp, operating_reserve_minor, created_at, updated_at, version)
    select r.id, p_household_id, r.name, r.tax_reserve_rate_bp, r.operating_reserve_minor,
           coalesce(r.created_at, now()), coalesce(r.updated_at, now()), coalesce(r.version, 1)
    from jsonb_to_recordset(p_changes -> 'businesses' -> 'upsert') as r(
      id uuid, name text, tax_reserve_rate_bp integer, operating_reserve_minor bigint,
      created_at timestamptz, updated_at timestamptz, version integer)
    on conflict (id) do update set
      name = excluded.name, tax_reserve_rate_bp = excluded.tax_reserve_rate_bp,
      operating_reserve_minor = excluded.operating_reserve_minor;
  end if;

  if p_changes ? 'accounts' then
    insert into public.financial_accounts
      (id, household_id, business_id, scope, kind, name, institution, currency, display_suffix,
       opening_balance_minor, opening_balance_direction, opening_balance_date, closed_at,
       created_at, updated_at, version)
    select r.id, p_household_id, r.business_id, r.scope, r.kind, r.name, r.institution, r.currency,
           r.display_suffix, r.opening_balance_minor, r.opening_balance_direction,
           r.opening_balance_date, r.closed_at,
           coalesce(r.created_at, now()), coalesce(r.updated_at, now()), coalesce(r.version, 1)
    from jsonb_to_recordset(p_changes -> 'accounts' -> 'upsert') as r(
      id uuid, business_id uuid, scope public.record_scope, kind public.account_kind, name text,
      institution text, currency text, display_suffix text, opening_balance_minor bigint,
      opening_balance_direction public.flow_direction, opening_balance_date date,
      closed_at timestamptz, created_at timestamptz, updated_at timestamptz, version integer)
    on conflict (id) do update set
      business_id = excluded.business_id, scope = excluded.scope, kind = excluded.kind,
      name = excluded.name, institution = excluded.institution, currency = excluded.currency,
      display_suffix = excluded.display_suffix,
      opening_balance_minor = excluded.opening_balance_minor,
      opening_balance_direction = excluded.opening_balance_direction,
      opening_balance_date = excluded.opening_balance_date, closed_at = excluded.closed_at;
  end if;

  if p_changes ? 'categories' then
    insert into public.categories
      (id, household_id, name, scope, essential, archived_at, created_at, updated_at, version)
    select r.id, p_household_id, r.name, r.scope, r.essential, r.archived_at,
           coalesce(r.created_at, now()), coalesce(r.updated_at, now()), coalesce(r.version, 1)
    from jsonb_to_recordset(p_changes -> 'categories' -> 'upsert') as r(
      id uuid, name text, scope public.record_scope, essential boolean, archived_at timestamptz,
      created_at timestamptz, updated_at timestamptz, version integer)
    on conflict (id) do update set
      name = excluded.name, scope = excluded.scope, essential = excluded.essential,
      archived_at = excluded.archived_at;
  end if;

  -- --- debts (before transactions: a transaction may settle a debt event later) --
  if p_changes ? 'debts' then
    insert into public.debts
      (id, household_id, kind, creditor_name, currency, status, effective_annual_rate_bp,
       minimum_payment_minor, payment_due_day, urgency, promise_summary,
       relationship_sensitivity, partial_payment_allowed, last_demand_at, last_conversation_at,
       expected_call_date, notes, opened_on, closed_at, created_by, created_at, updated_at, version)
    select r.id, p_household_id, r.kind, r.creditor_name, r.currency, r.status,
           r.effective_annual_rate_bp, r.minimum_payment_minor, r.payment_due_day, r.urgency,
           r.promise_summary, r.relationship_sensitivity, r.partial_payment_allowed,
           r.last_demand_at, r.last_conversation_at, r.expected_call_date, r.notes, r.opened_on,
           r.closed_at, r.created_by,
           coalesce(r.created_at, now()), coalesce(r.updated_at, now()), coalesce(r.version, 1)
    from jsonb_to_recordset(p_changes -> 'debts' -> 'upsert') as r(
      id uuid, kind public.debt_kind, creditor_name text, currency text, status public.debt_status,
      effective_annual_rate_bp integer, minimum_payment_minor bigint, payment_due_day integer,
      urgency public.debt_urgency, promise_summary text,
      relationship_sensitivity public.relationship_sensitivity, partial_payment_allowed boolean,
      last_demand_at timestamptz, last_conversation_at timestamptz, expected_call_date date,
      notes text, opened_on date, closed_at timestamptz, created_by uuid,
      created_at timestamptz, updated_at timestamptz, version integer)
    on conflict (id) do update set
      kind = excluded.kind, creditor_name = excluded.creditor_name, currency = excluded.currency,
      status = excluded.status, effective_annual_rate_bp = excluded.effective_annual_rate_bp,
      minimum_payment_minor = excluded.minimum_payment_minor,
      payment_due_day = excluded.payment_due_day, urgency = excluded.urgency,
      promise_summary = excluded.promise_summary,
      relationship_sensitivity = excluded.relationship_sensitivity,
      partial_payment_allowed = excluded.partial_payment_allowed,
      last_demand_at = excluded.last_demand_at, last_conversation_at = excluded.last_conversation_at,
      expected_call_date = excluded.expected_call_date, notes = excluded.notes,
      opened_on = excluded.opened_on, closed_at = excluded.closed_at;
  end if;

  -- --- transactions --------------------------------------------------------
  if p_changes ? 'transactions' then
    insert into public.transactions
      (id, household_id, account_id, counterpart_account_id, scope, kind, direction, amount_minor,
       currency, status, category_id, merchant, transaction_date, posting_date, value_date,
       refunds_transaction_id, corrects_transaction_id, note, import_batch_id, import_proposal_id,
       source_fingerprint, created_by, created_at, updated_at, version)
    select r.id, p_household_id, r.account_id, r.counterpart_account_id, r.scope, r.kind,
           r.direction, r.amount_minor, r.currency, r.status, r.category_id, r.merchant,
           r.transaction_date, r.posting_date, r.value_date, r.refunds_transaction_id,
           r.corrects_transaction_id, r.note, r.import_batch_id, r.import_proposal_id,
           r.source_fingerprint, r.created_by,
           coalesce(r.created_at, now()), coalesce(r.updated_at, now()), coalesce(r.version, 1)
    from jsonb_to_recordset(p_changes -> 'transactions' -> 'upsert') as r(
      id uuid, account_id uuid, counterpart_account_id uuid, scope public.record_scope,
      kind public.transaction_kind, direction public.flow_direction, amount_minor bigint,
      currency text, status public.transaction_status, category_id uuid, merchant text,
      transaction_date date, posting_date date, value_date date, refunds_transaction_id uuid,
      corrects_transaction_id uuid, note text, import_batch_id uuid, import_proposal_id uuid,
      source_fingerprint text, created_by uuid, created_at timestamptz, updated_at timestamptz,
      version integer)
    on conflict (id) do update set
      account_id = excluded.account_id, counterpart_account_id = excluded.counterpart_account_id,
      scope = excluded.scope, kind = excluded.kind, direction = excluded.direction,
      amount_minor = excluded.amount_minor, currency = excluded.currency, status = excluded.status,
      category_id = excluded.category_id, merchant = excluded.merchant,
      transaction_date = excluded.transaction_date, posting_date = excluded.posting_date,
      value_date = excluded.value_date, refunds_transaction_id = excluded.refunds_transaction_id,
      corrects_transaction_id = excluded.corrects_transaction_id, note = excluded.note,
      import_batch_id = excluded.import_batch_id, import_proposal_id = excluded.import_proposal_id,
      source_fingerprint = excluded.source_fingerprint;
  end if;

  -- --- balance snapshots: inserted, or voided ------------------------------
  if p_changes ? 'balanceSnapshots' then
    insert into public.account_balance_snapshots
      (id, household_id, account_id, balance_minor, balance_direction, verified_at, source, note,
       import_batch_id, created_by, created_at)
    select r.id, p_household_id, r.account_id, r.balance_minor, r.balance_direction, r.verified_at,
           r.source, r.note, r.import_batch_id, r.created_by, coalesce(r.created_at, now())
    from jsonb_to_recordset(p_changes -> 'balanceSnapshots' -> 'upsert') as r(
      id uuid, account_id uuid, balance_minor bigint, balance_direction public.flow_direction,
      verified_at timestamptz, source public.balance_source, note text, import_batch_id uuid,
      created_by uuid, created_at timestamptz)
    on conflict (id) do nothing;

    update public.account_balance_snapshots
    set voided_at = now()
    where household_id = p_household_id and voided_at is null
      and id in (select value::uuid from jsonb_array_elements_text(coalesce(p_changes -> 'balanceSnapshots' -> 'void', '[]'::jsonb)));
  end if;

  -- --- cashflow items: upserted, or removed --------------------------------
  if p_changes ? 'cashflowItems' then
    insert into public.cashflow_items
      (id, household_id, scope, account_id, direction, amount_minor, currency, label, category_id,
       certainty, expected_date, due_date, essential, settled_transaction_id, import_batch_id,
       created_by, created_at, updated_at, version)
    select r.id, p_household_id, r.scope, r.account_id, r.direction, r.amount_minor, r.currency,
           r.label, r.category_id, r.certainty, r.expected_date, r.due_date, r.essential,
           r.settled_transaction_id, r.import_batch_id, r.created_by,
           coalesce(r.created_at, now()), coalesce(r.updated_at, now()), coalesce(r.version, 1)
    from jsonb_to_recordset(p_changes -> 'cashflowItems' -> 'upsert') as r(
      id uuid, scope public.record_scope, account_id uuid, direction public.flow_direction,
      amount_minor bigint, currency text, label text, category_id uuid,
      certainty public.certainty_level, expected_date date, due_date date, essential boolean,
      settled_transaction_id uuid, import_batch_id uuid, created_by uuid,
      created_at timestamptz, updated_at timestamptz, version integer)
    on conflict (id) do update set
      scope = excluded.scope, account_id = excluded.account_id, direction = excluded.direction,
      amount_minor = excluded.amount_minor, currency = excluded.currency, label = excluded.label,
      category_id = excluded.category_id, certainty = excluded.certainty,
      expected_date = excluded.expected_date, due_date = excluded.due_date,
      essential = excluded.essential, settled_transaction_id = excluded.settled_transaction_id,
      import_batch_id = excluded.import_batch_id;

    update public.cashflow_items
    set removed_at = now()
    where household_id = p_household_id and removed_at is null
      and id in (select value::uuid from jsonb_array_elements_text(coalesce(p_changes -> 'cashflowItems' -> 'remove', '[]'::jsonb)));
  end if;

  -- --- debt events: inserted, or voided ------------------------------------
  if p_changes ? 'debtEvents' then
    insert into public.debt_events
      (id, household_id, debt_id, kind, amount_minor, currency, occurred_on, correction_effect,
       transaction_id, note, import_batch_id, created_by, created_at)
    select r.id, p_household_id, r.debt_id, r.kind, r.amount_minor, r.currency, r.occurred_on,
           r.correction_effect, r.transaction_id, r.note, r.import_batch_id, r.created_by,
           coalesce(r.created_at, now())
    from jsonb_to_recordset(p_changes -> 'debtEvents' -> 'upsert') as r(
      id uuid, debt_id uuid, kind public.debt_event_kind, amount_minor bigint, currency text,
      occurred_on date, correction_effect public.correction_effect, transaction_id uuid, note text,
      import_batch_id uuid, created_by uuid, created_at timestamptz)
    on conflict (id) do nothing;

    update public.debt_events
    set voided_at = now()
    where household_id = p_household_id and voided_at is null
      and id in (select value::uuid from jsonb_array_elements_text(coalesce(p_changes -> 'debtEvents' -> 'void', '[]'::jsonb)));
  end if;

  if p_changes ? 'rollovers' then
    insert into public.debt_rollovers
      (id, household_id, from_debt_id, to_debt_id, repayment_event_id, origination_event_id,
       amount_minor, occurred_on, source, status, confidence_bp, notes, confirmed_by, confirmed_at,
       created_by, created_at, updated_at, version)
    select r.id, p_household_id, r.from_debt_id, r.to_debt_id, r.repayment_event_id,
           r.origination_event_id, r.amount_minor, r.occurred_on, r.source, r.status,
           r.confidence_bp, r.notes, r.confirmed_by, r.confirmed_at, r.created_by,
           coalesce(r.created_at, now()), coalesce(r.updated_at, now()), coalesce(r.version, 1)
    from jsonb_to_recordset(p_changes -> 'rollovers' -> 'upsert') as r(
      id uuid, from_debt_id uuid, to_debt_id uuid, repayment_event_id uuid,
      origination_event_id uuid, amount_minor bigint, occurred_on date,
      source public.rollover_source, status public.rollover_status, confidence_bp integer,
      notes text, confirmed_by uuid, confirmed_at timestamptz, created_by uuid,
      created_at timestamptz, updated_at timestamptz, version integer)
    on conflict (id) do update set
      status = excluded.status, confidence_bp = excluded.confidence_bp, notes = excluded.notes,
      confirmed_by = excluded.confirmed_by, confirmed_at = excluded.confirmed_at;
  end if;

  -- --- gemach: plans and checks --------------------------------------------
  if p_changes ? 'repaymentPlans' then
    insert into public.repayment_plans
      (id, household_id, debt_id, agreement_summary, installment_count, installment_amount_minor,
       final_installment_amount_minor, first_due_date, cadence, created_by, created_at, updated_at, version)
    select r.id, p_household_id, r.debt_id, r.agreement_summary, r.installment_count,
           r.installment_amount_minor, r.final_installment_amount_minor, r.first_due_date,
           coalesce(r.cadence, 'monthly'), r.created_by,
           coalesce(r.created_at, now()), coalesce(r.updated_at, now()), coalesce(r.version, 1)
    from jsonb_to_recordset(p_changes -> 'repaymentPlans' -> 'upsert') as r(
      id uuid, debt_id uuid, agreement_summary text, installment_count integer,
      installment_amount_minor bigint, final_installment_amount_minor bigint, first_due_date date,
      cadence public.repayment_cadence, created_by uuid, created_at timestamptz,
      updated_at timestamptz, version integer)
    on conflict (id) do update set
      agreement_summary = excluded.agreement_summary, installment_count = excluded.installment_count,
      installment_amount_minor = excluded.installment_amount_minor,
      final_installment_amount_minor = excluded.final_installment_amount_minor,
      first_due_date = excluded.first_due_date, cadence = excluded.cadence;
  end if;

  if p_changes ? 'checks' then
    insert into public.post_dated_checks
      (id, household_id, debt_id, account_id, check_number, amount_minor, currency, due_date,
       delivered_on, payee_name, installment_number, note, source, status, cleared_on,
       cleared_transaction_id, debt_event_id, returned_on, resolution_reason,
       replaced_by_check_id, replaces_check_id, import_batch_id, created_by, created_at,
       updated_at, version)
    select r.id, p_household_id, r.debt_id, r.account_id, r.check_number, r.amount_minor,
           r.currency, r.due_date, r.delivered_on, r.payee_name, r.installment_number, r.note,
           r.source, r.status, r.cleared_on, r.cleared_transaction_id, r.debt_event_id,
           r.returned_on, r.resolution_reason, r.replaced_by_check_id, r.replaces_check_id,
           r.import_batch_id, r.created_by,
           coalesce(r.created_at, now()), coalesce(r.updated_at, now()), coalesce(r.version, 1)
    from jsonb_to_recordset(p_changes -> 'checks' -> 'upsert') as r(
      id uuid, debt_id uuid, account_id uuid, check_number text, amount_minor bigint,
      currency text, due_date date, delivered_on date, payee_name text, installment_number integer,
      note text, source public.check_source, status public.check_status, cleared_on date,
      cleared_transaction_id uuid, debt_event_id uuid, returned_on date, resolution_reason text,
      replaced_by_check_id uuid, replaces_check_id uuid, import_batch_id uuid, created_by uuid,
      created_at timestamptz, updated_at timestamptz, version integer)
    -- Ordered so a check that names its replacement is written after it.
    on conflict (id) do update set
      debt_id = excluded.debt_id, account_id = excluded.account_id,
      check_number = excluded.check_number, amount_minor = excluded.amount_minor,
      currency = excluded.currency, due_date = excluded.due_date,
      delivered_on = excluded.delivered_on, payee_name = excluded.payee_name,
      installment_number = excluded.installment_number, note = excluded.note,
      source = excluded.source, status = excluded.status, cleared_on = excluded.cleared_on,
      cleared_transaction_id = excluded.cleared_transaction_id,
      debt_event_id = excluded.debt_event_id, returned_on = excluded.returned_on,
      resolution_reason = excluded.resolution_reason,
      replaced_by_check_id = excluded.replaced_by_check_id,
      replaces_check_id = excluded.replaces_check_id, import_batch_id = excluded.import_batch_id;
  end if;

  -- --- budget ---------------------------------------------------------------
  if p_changes ? 'budgets' then
    insert into public.budgets
      (id, household_id, period, status, currency, is_first_month_draft, created_by,
       created_at, updated_at, version)
    select r.id, p_household_id, r.period, r.status, r.currency, r.is_first_month_draft,
           r.created_by, coalesce(r.created_at, now()), coalesce(r.updated_at, now()),
           coalesce(r.version, 1)
    from jsonb_to_recordset(p_changes -> 'budgets' -> 'upsert') as r(
      id uuid, period text, status public.budget_status, currency text,
      is_first_month_draft boolean, created_by uuid, created_at timestamptz,
      updated_at timestamptz, version integer)
    on conflict (id) do update set
      period = excluded.period, status = excluded.status, currency = excluded.currency,
      is_first_month_draft = excluded.is_first_month_draft;
  end if;

  if p_changes ? 'budgetLines' then
    insert into public.budget_lines
      (id, household_id, budget_id, category_id, category_key, planned_minor, weekly_guidance,
       note, created_at, updated_at, version)
    select r.id, p_household_id, r.budget_id, r.category_id, r.category_key, r.planned_minor,
           r.weekly_guidance, r.note, coalesce(r.created_at, now()), coalesce(r.updated_at, now()),
           coalesce(r.version, 1)
    from jsonb_to_recordset(p_changes -> 'budgetLines' -> 'upsert') as r(
      id uuid, budget_id uuid, category_id uuid, category_key public.budget_category_key,
      planned_minor bigint, weekly_guidance boolean, note text, created_at timestamptz,
      updated_at timestamptz, version integer)
    on conflict (id) do update set
      category_id = excluded.category_id, category_key = excluded.category_key,
      planned_minor = excluded.planned_minor, weekly_guidance = excluded.weekly_guidance,
      note = excluded.note;
  end if;

  -- --- tasks ----------------------------------------------------------------
  if p_changes ? 'tasks' then
    insert into public.family_tasks
      (id, household_id, title, reason, origin, recommendation_key, amount_minor, related_debt_id,
       related_account_id, assigned_member_id, due_on, follow_up_on, status, completed_at,
       created_by, created_at, updated_at, version)
    select r.id, p_household_id, r.title, r.reason, r.origin, r.recommendation_key, r.amount_minor,
           r.related_debt_id, r.related_account_id, r.assigned_member_id, r.due_on, r.follow_up_on,
           r.status, r.completed_at, coalesce(r.created_by, (select auth.uid())),
           coalesce(r.created_at, now()), coalesce(r.updated_at, now()), coalesce(r.version, 1)
    from jsonb_to_recordset(p_changes -> 'tasks' -> 'upsert') as r(
      id uuid, title text, reason text, origin public.task_origin, recommendation_key text,
      amount_minor bigint, related_debt_id uuid, related_account_id uuid, assigned_member_id uuid,
      due_on date, follow_up_on date, status public.task_status, completed_at timestamptz,
      created_by uuid, created_at timestamptz, updated_at timestamptz, version integer)
    on conflict (id) do update set
      title = excluded.title, reason = excluded.reason, origin = excluded.origin,
      recommendation_key = excluded.recommendation_key, amount_minor = excluded.amount_minor,
      related_debt_id = excluded.related_debt_id, related_account_id = excluded.related_account_id,
      assigned_member_id = excluded.assigned_member_id, due_on = excluded.due_on,
      follow_up_on = excluded.follow_up_on, status = excluded.status,
      completed_at = excluded.completed_at;
  end if;

  -- --- imports --------------------------------------------------------------
  if p_changes ? 'importSourceFiles' then
    insert into public.import_source_files
      (id, household_id, display_name, storage_path, kind, byte_size, sha256, declared_mime_type,
       retention_state, purged_at, uploaded_by, uploaded_at)
    select r.id, p_household_id, r.display_name, r.storage_path, r.kind, r.byte_size, r.sha256,
           r.declared_mime_type, coalesce(r.retention_state, 'quarantined'), r.purged_at,
           coalesce(r.uploaded_by, (select auth.uid())), coalesce(r.uploaded_at, now())
    from jsonb_to_recordset(p_changes -> 'importSourceFiles' -> 'upsert') as r(
      id uuid, display_name text, storage_path text, kind public.import_file_kind,
      byte_size bigint, sha256 text, declared_mime_type text,
      retention_state public.document_retention_state, purged_at timestamptz,
      uploaded_by uuid, uploaded_at timestamptz)
    on conflict (id) do update set
      retention_state = excluded.retention_state, purged_at = excluded.purged_at;
  end if;

  if p_changes ? 'importBatches' then
    insert into public.import_batches
      (id, household_id, source_file_id, status, document_type, document_confidence_bp,
       rows_proposed, rows_scanned, truncated, failure_code, target_account_id, summary, warnings,
       approved_at, approved_by, rejected_at, reversed_at, reversed_by, created_by, created_at,
       updated_at, version)
    select r.id, p_household_id, r.source_file_id, r.status, r.document_type,
           r.document_confidence_bp, coalesce(r.rows_proposed, 0), coalesce(r.rows_scanned, 0),
           coalesce(r.truncated, false), r.failure_code, r.target_account_id,
           coalesce(r.summary, '{}'::jsonb), coalesce(r.warnings, '{}'), r.approved_at,
           r.approved_by, r.rejected_at, r.reversed_at, r.reversed_by,
           coalesce(r.created_by, (select auth.uid())),
           coalesce(r.created_at, now()), coalesce(r.updated_at, now()), coalesce(r.version, 1)
    from jsonb_to_recordset(p_changes -> 'importBatches' -> 'upsert') as r(
      id uuid, source_file_id uuid, status public.import_batch_status,
      document_type public.import_document_type, document_confidence_bp integer,
      rows_proposed integer, rows_scanned integer, truncated boolean, failure_code text,
      target_account_id uuid, summary jsonb, warnings text[], approved_at timestamptz,
      approved_by uuid, rejected_at timestamptz, reversed_at timestamptz, reversed_by uuid,
      created_by uuid, created_at timestamptz, updated_at timestamptz, version integer)
    on conflict (id) do update set
      status = excluded.status, document_type = excluded.document_type,
      document_confidence_bp = excluded.document_confidence_bp,
      rows_proposed = excluded.rows_proposed, rows_scanned = excluded.rows_scanned,
      truncated = excluded.truncated, failure_code = excluded.failure_code,
      target_account_id = excluded.target_account_id, summary = excluded.summary,
      warnings = excluded.warnings, approved_at = excluded.approved_at,
      approved_by = excluded.approved_by, rejected_at = excluded.rejected_at,
      reversed_at = excluded.reversed_at, reversed_by = excluded.reversed_by;
  end if;

  if p_changes ? 'importProposals' then
    insert into public.import_proposals
      (id, household_id, batch_id, kind, location_sheet_name, location_page, location_row,
       location_snippet, raw, proposed, correction, confidence_bp, warnings, duplicate_verdict,
       duplicate_of_id, review_state, target_account_id, target_debt_id, target_check_id,
       committed_record_id, created_at, updated_at, version)
    select r.id, p_household_id, r.batch_id, r.kind, r.location_sheet_name, r.location_page,
           r.location_row, r.location_snippet, coalesce(r.raw, '[]'::jsonb),
           coalesce(r.proposed, '{}'::jsonb), r.correction, coalesce(r.confidence_bp, 0),
           coalesce(r.warnings, '{}'), coalesce(r.duplicate_verdict, 'new'), r.duplicate_of_id,
           coalesce(r.review_state, 'pending'), r.target_account_id, r.target_debt_id,
           r.target_check_id, r.committed_record_id,
           coalesce(r.created_at, now()), coalesce(r.updated_at, now()), coalesce(r.version, 1)
    from jsonb_to_recordset(p_changes -> 'importProposals' -> 'upsert') as r(
      id uuid, batch_id uuid, kind public.proposal_kind, location_sheet_name text,
      location_page integer, location_row integer, location_snippet text, raw jsonb,
      proposed jsonb, correction jsonb, confidence_bp integer, warnings text[],
      duplicate_verdict public.duplicate_verdict, duplicate_of_id uuid,
      review_state public.review_state, target_account_id uuid, target_debt_id uuid,
      target_check_id uuid, committed_record_id uuid, created_at timestamptz,
      updated_at timestamptz, version integer)
    on conflict (id) do update set
      correction = excluded.correction, confidence_bp = excluded.confidence_bp,
      warnings = excluded.warnings, duplicate_verdict = excluded.duplicate_verdict,
      duplicate_of_id = excluded.duplicate_of_id, review_state = excluded.review_state,
      target_account_id = excluded.target_account_id, target_debt_id = excluded.target_debt_id,
      target_check_id = excluded.target_check_id, committed_record_id = excluded.committed_record_id;
  end if;

  -- --- the command's own audit entries -------------------------------------
  -- Appended through record_audit_event, which stamps the actor from the
  -- session; the client's actor field is never trusted.
  if p_changes ? 'audit' then
    for v_audit in select value from jsonb_array_elements(p_changes -> 'audit') loop
      perform public.record_audit_event(
        p_household_id,
        v_audit ->> 'action',
        v_audit ->> 'entity_type',
        (v_audit ->> 'entity_id')::uuid,
        v_audit -> 'before_state',
        v_audit -> 'after_state'
      );
    end loop;
  end if;

  -- The household row is the document's revision: every apply bumps it, so a
  -- concurrent apply against the old version fails the check above.
  update public.households set updated_at = now() where id = p_household_id
  returning version into v_version;

  return jsonb_build_object('version', v_version);
end;
$$;

comment on function public.apply_household_changes(uuid, integer, jsonb) is
  'Applies one command''s changes atomically under the caller''s policies. Locks the household row and checks its version; every apply bumps it.';

revoke all on function public.apply_household_changes(uuid, integer, jsonb) from public, anon;
grant execute on function public.apply_household_changes(uuid, integer, jsonb) to authenticated;
