-- Schema diagnostic. READ ONLY.
--
-- Reports which schema objects exist. It changes nothing: no INSERT, UPDATE,
-- DELETE, CREATE, ALTER, DROP, TRUNCATE, GRANT or REVOKE, and no call to a
-- function that writes. tools/manual-sql.test.mjs proves this on every run.
--
-- Run it before applying anything, to see what is already there, and again
-- afterwards to confirm what arrived. Everything should read EXISTS after a
-- successful run of supabase/manual/apply-all.sql.
--
-- Paste into an EMPTY SQL Editor window and run once.

select object, case when present then 'EXISTS' else 'missing' end as status
from (
  select 'schema: app' as object,
         exists (select 1 from pg_namespace where nspname = 'app') as present
  union all select 'table: profiles',
         to_regclass('public.profiles') is not null
  union all select 'table: households',
         to_regclass('public.households') is not null
  union all select 'table: household_members',
         to_regclass('public.household_members') is not null
  union all select 'table: household_invitations',
         to_regclass('public.household_invitations') is not null
  union all select 'table: audit_events',
         to_regclass('public.audit_events') is not null
  union all select 'table: businesses',
         to_regclass('public.businesses') is not null
  union all select 'table: financial_accounts',
         to_regclass('public.financial_accounts') is not null
  union all select 'table: account_balance_snapshots',
         to_regclass('public.account_balance_snapshots') is not null
  union all select 'table: categories',
         to_regclass('public.categories') is not null
  union all select 'table: transactions',
         to_regclass('public.transactions') is not null
  union all select 'table: transaction_splits',
         to_regclass('public.transaction_splits') is not null
  union all select 'table: cashflow_items',
         to_regclass('public.cashflow_items') is not null
  union all select 'table: debts',
         to_regclass('public.debts') is not null
  union all select 'table: debt_events',
         to_regclass('public.debt_events') is not null
  union all select 'table: debt_rollovers',
         to_regclass('public.debt_rollovers') is not null
  union all select 'type: membership_status',
         exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where t.typname = 'membership_status' and n.nspname = 'public')
  union all select 'type: record_scope',
         exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where t.typname = 'record_scope' and n.nspname = 'public')
  union all select 'type: transaction_kind',
         exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where t.typname = 'transaction_kind' and n.nspname = 'public')
  union all select 'type: debt_event_kind',
         exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where t.typname = 'debt_event_kind' and n.nspname = 'public')
  union all select 'function: accept_household_invitation',
         exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where p.proname = 'accept_household_invitation' and n.nspname = 'public')
  union all select 'function: record_audit_event',
         exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where p.proname = 'record_audit_event' and n.nspname = 'public')
  union all select 'function: is_household_member',
         exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where p.proname = 'is_household_member' and n.nspname = 'app')
  union all select 'function: audit_row_change',
         exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where p.proname = 'audit_row_change' and n.nspname = 'app')
  union all select 'function: assert_rollover_references',
         exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where p.proname = 'assert_rollover_references' and n.nspname = 'app')
  union all select 'function: household_owns_account',
         exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where p.proname = 'household_owns_account' and n.nspname = 'app')
  union all select 'trigger: profiles_touch_updated_at',
         exists (select 1 from pg_trigger where tgname = 'profiles_touch_updated_at'
                 and not tgisinternal)
  union all select 'trigger: transaction_splits_sum_matches',
         exists (select 1 from pg_trigger where tgname = 'transaction_splits_sum_matches'
                 and not tgisinternal)
  union all select 'trigger: debt_rollovers_validate_references',
         exists (select 1 from pg_trigger where tgname = 'debt_rollovers_validate_references'
                 and not tgisinternal)
  union all select 'policies on public (15 or more)',
         (select count(*) from pg_policies where schemaname = 'public') >= 15
  union all select 'row level security forced on every public table we own',
         not exists (
           select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public'
             and c.relkind = 'r'
             and c.relname in (
               'profiles', 'households', 'household_members', 'household_invitations',
               'audit_events', 'businesses', 'financial_accounts',
               'account_balance_snapshots', 'categories', 'transactions',
               'transaction_splits', 'cashflow_items', 'debts', 'debt_events',
               'debt_rollovers'
             )
             and not (c.relrowsecurity and c.relforcerowsecurity)
         )
) checks
order by object;
