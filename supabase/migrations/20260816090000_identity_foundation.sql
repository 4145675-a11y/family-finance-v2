-- Milestone 2 — Identity foundation.
--
-- Creates the private schema that holds security helpers, the shared column
-- conventions from 05-ARCHITECTURE-DATA.md (UUID, timestamps, actor, version),
-- and the updated_at trigger used by every mutable table.
--
-- Nothing in this file grants access. Every table's access is defined by the
-- policies in 20260816090400_rls_policies.sql, and every private table is
-- denied by default until a policy allows a specific operation.

create extension if not exists "pgcrypto" with schema extensions;
create extension if not exists "citext" with schema extensions;

-- Helpers live outside `public` so they are not exposed through PostgREST.
create schema if not exists app;

revoke all on schema app from public, anon, authenticated;
grant usage on schema app to authenticated;

comment on schema app is
  'Security helpers and internal functions. Not exposed through the API.';

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function app.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  -- `version` is the optimistic-concurrency counter required by
  -- 05-ARCHITECTURE-DATA.md. It is owned by the database, never by the client:
  -- a client that sends its own value cannot skip or replay a version.
  new.version := old.version + 1;
  return new;
end;
$$;

comment on function app.touch_updated_at() is
  'BEFORE UPDATE trigger: sets updated_at and increments version server-side.';

-- ---------------------------------------------------------------------------
-- Current actor
-- ---------------------------------------------------------------------------

-- auth.uid() wrapped so that policies read the same way everywhere and so the
-- call is stable within a statement (PostgreSQL can then cache it per query).
create or replace function app.current_profile_id()
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select auth.uid();
$$;

comment on function app.current_profile_id() is
  'The authenticated profile making the request, or NULL when unauthenticated.';
