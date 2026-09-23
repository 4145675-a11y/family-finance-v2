-- Transaction intelligence: household rules, and the suggestion beside each row.
--
-- Additive only. One new table, one new column, and two functions replaced with
-- versions that carry them. No column is dropped, no type is narrowed, no
-- existing row is rewritten, and every statement is safe to run twice.
--
-- What is stored and what is not:
--
--   * `learned_rules` is what a household decided a kind of statement line means.
--     It is created only by a person correcting a row and asking for the
--     correction to be remembered. It belongs to one household, which is enforced
--     by RLS here and is structural in the document the application reads.
--   * `import_proposals.classification` is the suggestion the classifier made
--     about one row, stored beside the raw row rather than merged into it. It
--     changes no amount, no direction and no date; it exists so that "why was
--     this called a bank fee" is answerable months later, together with the rule
--     that produced it and the confidence it was offered at.
--
-- Nothing here lets a suggestion move money. The approval path is unchanged: a
-- row still has to be included by a person, and a row the classifier read as a
-- repayment still cannot be approved until the lender is named.

-- 1. The suggestion beside the row -------------------------------------------
-- `to_jsonb(p)` in load_household_document picks new columns up on its own, so
-- the read path needs no change for this one.
alter table public.import_proposals
  add column if not exists classification jsonb;

comment on column public.import_proposals.classification is
  'The classifier''s suggestion for this row: class, category, counterparty, '
  'confidence, the rule that produced it and a Hebrew explanation. A suggestion '
  'only — it never alters the raw row or any balance.';

-- 2. What this household decided ---------------------------------------------
create table if not exists public.learned_rules (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,

  -- What the family called this rule, for the list they manage.
  label         text not null check (length(btrim(label)) between 1 and 120),

  -- The matcher. `contains` on the folded description is the whole of it: a
  -- regular expression typed by a family is a way to match rows nobody intended,
  -- and the normaliser has already folded the spelling variants a looser matcher
  -- would have been needed for.
  description_contains text not null
    check (length(btrim(description_contains)) between 2 and 120),
  -- Null means the rule applies in both directions.
  direction     text check (direction is null or direction in ('inflow', 'outflow')),
  -- Null means the rule applies on every account.
  account_id    uuid references public.financial_accounts (id) on delete cascade,

  -- What to classify a matching row as.
  class         text not null check (length(btrim(class)) between 2 and 40),
  budget_category_key text,
  counterparty  text check (length(btrim(counterparty)) <= 160),
  -- A repayment rule may name the debt. Even then the row is only a suggestion:
  -- the balance moves when a person approves the batch, never because of a rule.
  debt_id       uuid references public.debts (id) on delete set null,

  -- A disabled rule is kept and ignored, so a family can test turning it off
  -- instead of destroying what it said.
  enabled       boolean not null default true,
  times_applied integer not null default 0 check (times_applied >= 0),

  created_by    uuid not null references public.profiles (id) on delete restrict,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  version       integer not null default 1,

  -- The same matcher twice within a household is the family saying the same
  -- thing again, not a second rule.
  constraint learned_rules_unique_matcher
    unique (household_id, description_contains, direction, account_id)
);

create index if not exists learned_rules_household_enabled_idx
  on public.learned_rules (household_id, enabled);

-- The table says what a family spends money on. It is private by definition.
revoke all on table public.learned_rules from public, anon, authenticated;
grant select, insert, update, delete on table public.learned_rules to authenticated;

alter table public.learned_rules enable row level security;
alter table public.learned_rules force row level security;

drop policy if exists learned_rules_select_member on public.learned_rules;
create policy learned_rules_select_member
  on public.learned_rules for select to authenticated
  using (app.is_household_member(household_id));

drop policy if exists learned_rules_insert_member on public.learned_rules;
create policy learned_rules_insert_member
  on public.learned_rules for insert to authenticated
  with check (app.is_household_member(household_id));

drop policy if exists learned_rules_update_member on public.learned_rules;
create policy learned_rules_update_member
  on public.learned_rules for update to authenticated
  using (app.is_household_member(household_id))
  with check (app.is_household_member(household_id));

drop policy if exists learned_rules_delete_member on public.learned_rules;
create policy learned_rules_delete_member
  on public.learned_rules for delete to authenticated
  using (app.is_household_member(household_id));

-- 3. Carry the rules into the document the application reads -----------------
-- The whole function is restated because that is how the earlier migrations
-- define it; the only change is the `learnedRules` key.
create or replace function public.load_household_document(p_household_id uuid)
returns jsonb
language sql
security invoker
stable
set search_path = ''
as $$
  select case when h.id is null then null else jsonb_build_object(
    'household', to_jsonb(h),
    'settings', (select to_jsonb(s) from public.household_settings s where s.household_id = h.id),
    'setup', (select to_jsonb(sp) from public.setup_progress sp where sp.household_id = h.id),
    'members', (select coalesce(jsonb_agg(to_jsonb(m) order by m.joined_at, m.id), '[]'::jsonb)
                from public.household_members m where m.household_id = h.id),
    'profiles', (select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at, p.id), '[]'::jsonb)
                 from public.profiles p
                 where p.id in (select hm.profile_id from public.household_members hm
                                where hm.household_id = h.id)),
    'invitations', (select coalesce(jsonb_agg(to_jsonb(i) - 'token_hash' order by i.created_at, i.id), '[]'::jsonb)
                    from public.household_invitations i where i.household_id = h.id),
    'businesses', (select coalesce(jsonb_agg(to_jsonb(b) order by b.created_at, b.id), '[]'::jsonb)
                   from public.businesses b where b.household_id = h.id),
    'accounts', (select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at, a.id), '[]'::jsonb)
                 from public.financial_accounts a where a.household_id = h.id),
    'categories', (select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at, c.id), '[]'::jsonb)
                   from public.categories c where c.household_id = h.id),
    'balanceSnapshots', (select coalesce(jsonb_agg(to_jsonb(s) order by s.verified_at, s.created_at, s.id), '[]'::jsonb)
                         from public.account_balance_snapshots s where s.household_id = h.id),
    'transactions', (select coalesce(jsonb_agg(to_jsonb(t) order by t.transaction_date, t.created_at, t.id), '[]'::jsonb)
                     from public.transactions t where t.household_id = h.id),
    'cashflowItems', (select coalesce(jsonb_agg(to_jsonb(ci) order by ci.created_at, ci.id), '[]'::jsonb)
                      from public.cashflow_items ci where ci.household_id = h.id),
    'debts', (select coalesce(jsonb_agg(to_jsonb(d) order by d.created_at, d.id), '[]'::jsonb)
              from public.debts d where d.household_id = h.id),
    'debtEvents', (select coalesce(jsonb_agg(to_jsonb(de) order by de.occurred_on, de.created_at, de.id), '[]'::jsonb)
                   from public.debt_events de where de.household_id = h.id),
    'rollovers', (select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at, r.id), '[]'::jsonb)
                  from public.debt_rollovers r where r.household_id = h.id),
    'checks', (select coalesce(jsonb_agg(to_jsonb(pc) order by pc.due_date, pc.created_at, pc.id), '[]'::jsonb)
               from public.post_dated_checks pc where pc.household_id = h.id),
    'repaymentPlans', (select coalesce(jsonb_agg(to_jsonb(rp) order by rp.created_at, rp.id), '[]'::jsonb)
                       from public.repayment_plans rp where rp.household_id = h.id),
    'budgets', (select coalesce(jsonb_agg(to_jsonb(bu) order by bu.created_at, bu.id), '[]'::jsonb)
                from public.budgets bu where bu.household_id = h.id),
    'budgetLines', (select coalesce(jsonb_agg(to_jsonb(bl) order by bl.created_at, bl.id), '[]'::jsonb)
                    from public.budget_lines bl where bl.household_id = h.id),
    'tasks', (select coalesce(jsonb_agg(to_jsonb(ft) order by ft.created_at, ft.id), '[]'::jsonb)
              from public.family_tasks ft where ft.household_id = h.id),
    'importSourceFiles', '[]'::jsonb,
    'importBatches', (select coalesce(jsonb_agg(to_jsonb(ib) order by ib.created_at, ib.id), '[]'::jsonb)
                      from public.import_batches ib where ib.household_id = h.id),
    'importProposals', (select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at, p.id), '[]'::jsonb)
                        from public.import_proposals p where p.household_id = h.id),
    -- What this household decided its own statement lines mean.
    'learnedRules', (select coalesce(jsonb_agg(to_jsonb(lr) order by lr.created_at, lr.id), '[]'::jsonb)
                     from public.learned_rules lr where lr.household_id = h.id),
    -- Command-level entries only (dotted actions): the row-level trail the
    -- triggers write stays in the table for forensics and is not the family's
    -- history.
    'audit', (select coalesce(jsonb_agg(to_jsonb(a) order by a.occurred_at, a.id), '[]'::jsonb)
              from public.audit_events a where a.household_id = h.id and a.action like '%.%')
  ) end
  from (select * from public.households where id = p_household_id) h;
$$;

revoke all on function public.load_household_document(uuid) from public, anon;
grant execute on function public.load_household_document(uuid) to authenticated;

-- 4. Write them back ---------------------------------------------------------
-- Appended to the existing apply function through a separate helper, so the
-- large function itself is not restated and cannot drift from the copy that has
-- been exercised against the database.
create or replace function app.apply_learned_rule_changes(
  p_household_id uuid,
  p_changes jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_changes ? 'learnedRules' then
    insert into public.learned_rules
      (id, household_id, label, description_contains, direction, account_id, class,
       budget_category_key, counterparty, debt_id, enabled, times_applied,
       created_by, created_at, updated_at, version)
    select r.id, p_household_id, r.label, r.description_contains, r.direction, r.account_id,
           r.class, r.budget_category_key, r.counterparty, r.debt_id,
           coalesce(r.enabled, true), coalesce(r.times_applied, 0),
           r.created_by, coalesce(r.created_at, now()), coalesce(r.updated_at, now()),
           coalesce(r.version, 1)
    from jsonb_to_recordset(p_changes -> 'learnedRules' -> 'upsert') as r(
      id uuid, label text, description_contains text, direction text, account_id uuid,
      class text, budget_category_key text, counterparty text, debt_id uuid,
      enabled boolean, times_applied integer, created_by uuid,
      created_at timestamptz, updated_at timestamptz, version integer)
    on conflict (id) do update set
      label = excluded.label,
      class = excluded.class,
      budget_category_key = excluded.budget_category_key,
      counterparty = excluded.counterparty,
      debt_id = excluded.debt_id,
      enabled = excluded.enabled,
      times_applied = excluded.times_applied,
      updated_at = excluded.updated_at,
      version = excluded.version;

    -- A rule the family deleted. Unlike a financial record, a rule carries no
    -- history worth keeping: it described how to read the future, and they have
    -- said to stop reading it that way. Nothing already imported changes.
    delete from public.learned_rules
    where household_id = p_household_id
      and id in (
        select (value #>> '{}')::uuid
        from jsonb_array_elements(coalesce(p_changes -> 'learnedRules' -> 'gone', '[]'::jsonb))
      );
  end if;
end
$$;

revoke all on function app.apply_learned_rule_changes(uuid, jsonb) from public, anon;
grant execute on function app.apply_learned_rule_changes(uuid, jsonb) to authenticated;

/*
 * The entry point the application calls, composing the two.
 *
 * Why a composing function rather than a longer `apply_household_changes`: that
 * function is five hundred lines that have been exercised against a real
 * database, and restating it to add one call would duplicate all of it into a
 * second place that can drift from the first. Composition keeps one definition
 * of each.
 *
 * Atomicity is preserved because a function call is one statement: the version
 * check inside `apply_household_changes` runs first and raises on a conflict, and
 * a raise rolls back the rule changes with it. Either both happen or neither
 * does — which is what an import approving rows and saving a rule needs.
 */
create or replace function public.apply_household_document(
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
  -- Membership and the expected version are checked in here, before anything of
  -- the household's is touched.
  v_result := public.apply_household_changes(p_household_id, p_expected_version, p_changes);
  perform app.apply_learned_rule_changes(p_household_id, p_changes);
  return v_result;
end
$$;

comment on function public.apply_household_document(uuid, integer, jsonb) is
  'Applies a document change set, including household classification rules. '
  'Wraps apply_household_changes so both run in one transaction.';

revoke all on function public.apply_household_document(uuid, integer, jsonb) from public, anon;
grant execute on function public.apply_household_document(uuid, integer, jsonb) to authenticated;
