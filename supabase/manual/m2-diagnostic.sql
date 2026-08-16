-- Milestone 2 — diagnostic. READ ONLY.
--
-- Reports which schema objects exist. It changes nothing: no INSERT, UPDATE,
-- DELETE, CREATE, ALTER, DROP, TRUNCATE, GRANT or REVOKE, and no call to a
-- function that writes. tools/manual-sql.test.mjs proves this on every run.
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
  union all select 'type: membership_status',
         exists (select 1 from pg_type t
                 join pg_namespace n on n.oid = t.typnamespace
                 where t.typname = 'membership_status' and n.nspname = 'public')
  union all select 'function: app.is_household_member',
         exists (select 1 from pg_proc p
                 join pg_namespace n on n.oid = p.pronamespace
                 where p.proname = 'is_household_member' and n.nspname = 'app')
  union all select 'function: app.current_household_ids',
         exists (select 1 from pg_proc p
                 join pg_namespace n on n.oid = p.pronamespace
                 where p.proname = 'current_household_ids' and n.nspname = 'app')
  union all select 'function: public.accept_household_invitation',
         exists (select 1 from pg_proc p
                 join pg_namespace n on n.oid = p.pronamespace
                 where p.proname = 'accept_household_invitation' and n.nspname = 'public')
  union all select 'function: public.record_audit_event',
         exists (select 1 from pg_proc p
                 join pg_namespace n on n.oid = p.pronamespace
                 where p.proname = 'record_audit_event' and n.nspname = 'public')
  union all select 'trigger: profiles_touch_updated_at',
         exists (select 1 from pg_trigger
                 where tgname = 'profiles_touch_updated_at' and not tgisinternal)
  union all select 'trigger: audit_events_block_delete',
         exists (select 1 from pg_trigger
                 where tgname = 'audit_events_block_delete' and not tgisinternal)
  union all select 'rls forced on all five tables',
         (select count(*) from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public'
            and c.relname in ('profiles', 'households', 'household_members',
                              'household_invitations', 'audit_events')
            and c.relrowsecurity and c.relforcerowsecurity) = 5
  union all select 'policies present (expect 12)',
         (select count(*) from pg_policies where schemaname = 'public') = 12
) checks
order by object;
