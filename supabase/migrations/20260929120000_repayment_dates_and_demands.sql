-- When a loan is expected to be repaid, and every time the lender asked.
--
-- Two facts a family had nowhere to put, and they are different in kind.
--
--   1. **What is expected.** A loan can have a repayment date; a loan can have
--      been agreed with *no* repayment date at all, which is the ordinary shape
--      of a loan from a relative and a real fact about it; and a loan can simply
--      never have been asked about. A single nullable date tells the second from
--      the third not at all — it turns "we agreed there is no deadline" into
--      "nobody has filled this in", which is the sentence the family would then
--      be nagged about for ever. So two columns, and three states.
--
--   2. **What was demanded.** A lender who asked in Elul, again in Tishrei, and
--      again with a deadline is telling a story. `debts.last_demand_at` is one
--      column that erases it on every overwrite, so demands get their own table,
--      exactly as post-dated checks did and for the same reason: each one is a
--      fact with a date.
--
-- A demand moves no money and changes no term. It is not a debt event, so no
-- balance shifts; it is not a transaction, so no account shifts; and it touches
-- no column of `debts`, so the status and the closed date are the same
-- afterwards as before. That is what lets it be recorded against a loan that has
-- already been repaid — and a lender who comes back after a settled loan is
-- precisely the case a family cannot afford to have no way to write down.
--
-- Additive only. No column is dropped, no row is rewritten, every statement is
-- guarded, and the file is safe to run twice.

-- ---------------------------------------------------------------------------
-- 1. What is expected about repayment
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'repayment_expectation' and n.nspname = 'public'
  ) then
    -- Two values, not three. The third state is the column being NULL, which is
    -- what every loan recorded before today already is: nothing was ever said.
    create type public.repayment_expectation as enum ('dated', 'none');
  end if;
end
$$;

alter table public.debts
  add column if not exists repayment_expectation public.repayment_expectation;

alter table public.debts
  add column if not exists expected_repayment_on date;

comment on column public.debts.repayment_expectation is
  'NULL: nothing recorded. ''none'': agreed with no repayment date. ''dated'': see expected_repayment_on.';
comment on column public.debts.expected_repayment_on is
  'When the whole loan is expected to be repaid. Not payment_due_day (a monthly instalment) and not expected_call_date (the lender may ask early).';

-- The pair cannot contradict itself: a date without a declaration, or a
-- declaration of 'none' with a date beside it, would each be a record that says
-- two things.
--
-- Written as a CASE on the declaration, because the two shorter ways of saying
-- it both have the same hole, and an integration test caught both.
--
-- A CHECK constraint passes on NULL as well as on true, and NULL is exactly
-- what a comparison against a NULL column returns. So
-- `(repayment_expectation = 'dated') = (expected_repayment_on is not null)`
-- passes whenever the expectation is NULL, and so does a three-branch OR: its
-- `repayment_expectation = 'dated'` branch is NULL rather than false, and
-- `false or null or false` is NULL. Either way a row could carry a repayment
-- date while declaring nothing about repayment — a date the screen would never
-- show and nothing would ever clear.
--
-- A CASE on `is null` avoids it: every branch returns a real boolean, so the
-- constraint has no third answer to pass on.
--
-- Dropped and re-added rather than created only when absent, so that re-running
-- this file over a database that already has an earlier version of the
-- constraint replaces it instead of leaving it in place.
alter table public.debts
  drop constraint if exists debts_repayment_expectation_matches_date;

alter table public.debts
  add constraint debts_repayment_expectation_matches_date check (
    case
      -- Nothing recorded: there can be no date either.
      when repayment_expectation is null then expected_repayment_on is null
      -- A date was given: it has to be there.
      when repayment_expectation = 'dated' then expected_repayment_on is not null
      -- Agreed with no date: there must be none.
      else expected_repayment_on is null
    end
  );

-- The row-level trail now records these two as well. A trigger's argument list
-- is fixed at creation, so the old one is dropped and a new one takes its place.
--
-- Under a new name, following the convention ADR-0045 set when it replaced
-- `households_insert_self_as_creator`: an object redefined in a later migration
-- is renamed rather than recreated, so that "this name is created in two files"
-- stays a reliable signal of an accident. `tools/migrations.test.mjs` enforces
-- it, which is how this line came to be written this way.
drop trigger if exists debts_audit on public.debts;
drop trigger if exists debts_audit_with_repayment on public.debts;
create trigger debts_audit_with_repayment
  after insert or update on public.debts
  for each row execute function app.audit_row_change(
    'debts', 'id', 'kind', 'status', 'currency', 'effective_annual_rate_bp',
    'minimum_payment_minor', 'urgency', 'closed_at',
    'repayment_expectation', 'expected_repayment_on'
  );

-- ---------------------------------------------------------------------------
-- 2. Every time the lender asked to be repaid
-- ---------------------------------------------------------------------------

create table if not exists public.debt_repayment_demands (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  debt_id       uuid not null references public.debts (id) on delete cascade,

  -- The day the lender asked. Supplied by the caller, defaulted to today by the
  -- form and never guessed here: a demand recorded a week late is still a demand
  -- made on the day it was made.
  demanded_on   date not null,

  -- By when they asked to be paid. NULL when they named no date, which is not
  -- the same as asking for it today.
  requested_deadline date,

  -- How much was asked for, when a figure was named. NULL is not zero: a lender
  -- who said "I need it back" without a number has demanded something, and a 0
  -- here would be a figure nobody stated. Nothing derives a balance from this.
  amount_minor  bigint
    check (amount_minor is null or app.is_valid_amount_minor(amount_minor)),

  note          text check (length(btrim(note)) <= 500),
  created_by    uuid not null references public.profiles (id) on delete restrict,
  created_at    timestamptz not null default now(),

  constraint debt_repayment_demands_deadline_not_before_demand check (
    requested_deadline is null or requested_deadline >= demanded_on
  )
);

comment on table public.debt_repayment_demands is
  'One row per time a lender asked to be repaid. Moves no money and changes no term, which is why it is allowed on a closed debt.';

create index if not exists debt_repayment_demands_debt_idx
  on public.debt_repayment_demands (debt_id, demanded_on desc, created_at desc);

create index if not exists debt_repayment_demands_household_idx
  on public.debt_repayment_demands (household_id, demanded_on desc);

drop trigger if exists debt_repayment_demands_audit on public.debt_repayment_demands;
create trigger debt_repayment_demands_audit
  after insert on public.debt_repayment_demands
  for each row execute function app.audit_row_change(
    'debt_repayment_demands', 'id', 'debt_id', 'demanded_on',
    'requested_deadline', 'amount_minor'
  );

-- ---------------------------------------------------------------------------
-- 3. Row-level security
-- ---------------------------------------------------------------------------
--
-- Anchored on `app.is_household_member()` like every other table in the schema,
-- so a household that is disabled disappears from this table at the same moment
-- it disappears from the rest (ADR-0045 § 5).

alter table public.debt_repayment_demands enable row level security;
alter table public.debt_repayment_demands force row level security;

drop policy if exists debt_repayment_demands_select_member on public.debt_repayment_demands;
create policy debt_repayment_demands_select_member
  on public.debt_repayment_demands
  for select
  to authenticated
  using (app.is_household_member(household_id));

drop policy if exists debt_repayment_demands_insert_member on public.debt_repayment_demands;
create policy debt_repayment_demands_insert_member
  on public.debt_repayment_demands
  for insert
  to authenticated
  with check (
    app.is_household_member(household_id)
    -- The debt must be this household's. Without it a member could file a demand
    -- against a debt in another family by naming its identifier.
    and app.household_owns_debt(household_id, debt_id)
    and created_by = (select auth.uid())
  );

-- Neither UPDATE nor DELETE, for the reason debt_events has neither: what was
-- asked, and when, is a fact. A mistake is corrected by recording what actually
-- happened, not by editing the record of the asking.

revoke all on public.debt_repayment_demands from anon, authenticated;
grant select, insert on public.debt_repayment_demands to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Writing the two new facts
-- ---------------------------------------------------------------------------
--
-- Composed rather than restated, for the reason ADR-0037 gives: the five hundred
-- lines of `apply_household_changes` have been exercised against a real
-- database, and the last time one of its functions was restated to add a key a
-- transcription slip stopped every household loading. Each of these is small,
-- separate, and called from the same entry point inside the same transaction.

create or replace function app.apply_debt_repayment_expectations(
  p_household_id uuid,
  p_changes jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_changes ? 'debtRepaymentExpectations' then
    /*
     * Only the debts the change set names. A save that touched a loan for some
     * other reason must not rewrite a date nobody edited, and the application
     * sends this key only for the debts whose expectation actually moved.
     *
     * A withdrawn expectation arrives as two nulls rather than as an absence, so
     * clearing a date reaches the database. The pair is written together and the
     * table constraint refuses any combination that would say two things.
     */
    update public.debts d set
      repayment_expectation = (r.value ->> 'repayment_expectation')::public.repayment_expectation,
      expected_repayment_on = (r.value ->> 'expected_repayment_on')::date
    from jsonb_array_elements(
      coalesce(p_changes -> 'debtRepaymentExpectations' -> 'upsert', '[]'::jsonb)
    ) as r(value)
    where d.household_id = p_household_id
      and d.id = (r.value ->> 'id')::uuid;
  end if;
end
$$;

comment on function app.apply_debt_repayment_expectations(uuid, jsonb) is
  'Writes the expected-repayment columns for the debts a change set names, and only those.';

revoke all on function app.apply_debt_repayment_expectations(uuid, jsonb) from public, anon;
grant execute on function app.apply_debt_repayment_expectations(uuid, jsonb) to authenticated;

create or replace function app.apply_repayment_demands(
  p_household_id uuid,
  p_changes jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_changes ? 'repaymentDemands' then
    /*
     * Insert only, and `do nothing` on a repeat rather than `do update`. The
     * identifier comes from the form that rendered, so a second submission of
     * the same demand names a row that is already here — and a demand is a fact
     * about a past moment, so the first writing of it is the right one to keep.
     *
     * household_id is forced to the household being changed, whatever the client
     * sent, and created_by is left as the row carries it because the policy
     * insists it be the caller.
     */
    insert into public.debt_repayment_demands (
      id, household_id, debt_id, demanded_on, requested_deadline,
      amount_minor, note, created_by, created_at
    )
    select
      r.id,
      p_household_id,
      r.debt_id,
      r.demanded_on,
      r.requested_deadline,
      r.amount_minor,
      r.note,
      r.created_by,
      coalesce(r.created_at, now())
    from jsonb_to_recordset(coalesce(p_changes -> 'repaymentDemands' -> 'upsert', '[]'::jsonb))
      as r(
        id uuid,
        debt_id uuid,
        demanded_on date,
        requested_deadline date,
        amount_minor bigint,
        note text,
        created_by uuid,
        created_at timestamptz
      )
    on conflict (id) do nothing;
  end if;
end
$$;

comment on function app.apply_repayment_demands(uuid, jsonb) is
  'Appends repayment demands. Insert-only and idempotent on the row identifier; touches no debt, event or transaction.';

revoke all on function app.apply_repayment_demands(uuid, jsonb) from public, anon;
grant execute on function app.apply_repayment_demands(uuid, jsonb) to authenticated;

-- The entry point, now composing five: the records, this household's rules, the
-- due dates a debt carries, what is expected about its repayment, and the times
-- it was demanded. One statement, therefore one transaction — the version check
-- inside `apply_household_changes` raises on a conflict and rolls all of it back
-- together.
--
-- A new name rather than a replacement of `apply_household_document`. A function
-- replaced in place cannot be told from the older one, so a deployment whose
-- migration has not been applied yet would accept the call and drop the new
-- facts without a word; a distinct name makes that PGRST202, which the transport
-- turns into a refusal the family can act on instead of a false success.
create or replace function public.save_household_document(
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
  v_result jsonb;
begin
  v_result := public.apply_household_changes(p_household_id, p_expected_version, p_changes);
  perform app.apply_learned_rule_changes(p_household_id, p_changes);
  perform app.apply_debt_due_dates(p_household_id, p_changes);
  perform app.apply_debt_repayment_expectations(p_household_id, p_changes);
  perform app.apply_repayment_demands(p_household_id, p_changes);
  return v_result;
end
$$;

comment on function public.save_household_document(uuid, integer, jsonb) is
  'Applies a document change set: records, classification rules, due dates, '
  'expected repayment and repayment demands. One transaction.';

revoke all on function public.save_household_document(uuid, integer, jsonb) from public, anon;
grant execute on function public.save_household_document(uuid, integer, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Reading them back
-- ---------------------------------------------------------------------------
--
-- `load_household_document` keeps its name and its body. The body moves to
-- `app.load_household_core` **verbatim** — this file's text for it was extracted
-- from the migration that defined it rather than retyped, because the one thing
-- that has actually gone wrong here before is a transcription slip in a restated
-- function. The public entry point is then a composition: the core document plus
-- one key.
--
-- Keeping the name means a database that has not had this file applied still has
-- a complete, working loader, and the application reads it without a fallback.

create or replace function app.load_household_core(p_household_id uuid)
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
    -- What this household decided its own statement lines mean (ADR-0036).
    'learnedRules', (select coalesce(jsonb_agg(to_jsonb(lr) order by lr.created_at, lr.id), '[]'::jsonb)
                     from public.learned_rules lr where lr.household_id = h.id),
    -- Command-level entries only (dotted actions): the row-level trail the
    -- triggers write stays in the table for forensics and is not the family's
    -- activity feed.
    'audit', (select coalesce(jsonb_agg(to_jsonb(a) order by a.occurred_at, a.id), '[]'::jsonb)
              from public.audit_events a where a.household_id = h.id and a.action like '%.%')
  ) end
  from (select * from public.households where id = p_household_id) h;
$$;

comment on function app.load_household_core(uuid) is
  'The household document without the collections added after it was written. Not called directly; public.load_household_document composes it.';

revoke all on function app.load_household_core(uuid) from public, anon;
grant execute on function app.load_household_core(uuid) to authenticated;

create or replace function public.load_household_document(p_household_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when s.doc is null then null
    else s.doc || jsonb_build_object(
      'repaymentDemands', (
        select coalesce(
          jsonb_agg(to_jsonb(d) order by d.demanded_on, d.created_at, d.id),
          '[]'::jsonb
        )
        from public.debt_repayment_demands d
        where d.household_id = p_household_id
      )
    )
  end
  from (select app.load_household_core(p_household_id) as doc) s;
$$;

comment on function public.load_household_document(uuid) is
  'One household as a document, under the caller''s own policies. NULL when the caller is not a member. Voided and removed rows are not included.';

revoke all on function public.load_household_document(uuid) from public, anon;
grant execute on function public.load_household_document(uuid) to authenticated;
