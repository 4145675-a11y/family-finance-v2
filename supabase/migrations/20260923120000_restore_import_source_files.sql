-- Restore the source files the document carries.
--
-- ADR-0036's migration restated `load_household_document` in order to add one
-- key, and in restating it replaced the `importSourceFiles` query with an empty
-- array. Every household that had ever imported a file then failed to load at
-- all: `documentFromLoaded` refuses a batch whose source file it cannot see, so
-- the application could not read the household — reads and writes alike.
--
-- This migration rebuilds the function from the original text with the one key
-- added, rather than from a retyped copy. The fault was transcription, and the
-- fix is to stop transcribing.
--
-- Nothing but the function definition changes. No table, no column, no row.

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

revoke all on function public.load_household_document(uuid) from public, anon;
grant execute on function public.load_household_document(uuid) to authenticated;
