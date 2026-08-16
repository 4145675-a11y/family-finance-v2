-- Milestone 2 — append-only audit.
--
-- 07-SECURITY-PRIVACY.md: "append-only DB enforcement", metadata only, no
-- secrets and no full documents. Enforcement lives in the database, because an
-- audit trail that the application layer can rewrite is not an audit trail.

create table if not exists public.audit_events (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid references public.households (id) on delete cascade,
  actor_profile_id uuid references public.profiles (id) on delete set null,

  action        text not null check (length(btrim(action)) between 1 and 80),
  entity_type   text not null check (length(btrim(entity_type)) between 1 and 80),
  entity_id     uuid,

  -- Reduced before/after images. 07-SECURITY-PRIVACY.md forbids secrets, full
  -- documents and card data here; callers pass only the changed fields.
  before_state  jsonb,
  after_state   jsonb,

  request_id    uuid,
  device_id     uuid,
  occurred_at   timestamptz not null default now()
);

comment on table public.audit_events is
  'Append-only audit trail. UPDATE and DELETE are rejected by trigger for every role, including table owners.';
comment on column public.audit_events.before_state is
  'Reduced field-level image. Never secrets, full documents or card data.';

create index if not exists audit_events_household_time_idx
  on public.audit_events (household_id, occurred_at desc);

create index if not exists audit_events_entity_idx
  on public.audit_events (entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- Append-only enforcement
-- ---------------------------------------------------------------------------

create or replace function app.reject_audit_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'audit_events is append-only; % is not permitted', tg_op
    using errcode = '42501';
end;
$$;

comment on function app.reject_audit_mutation() is
  'Raises on any UPDATE or DELETE against audit_events.';

-- A statement-level trigger fires even when the statement matches no rows, so
-- an attempted `delete from audit_events` fails loudly instead of silently
-- succeeding against zero visible rows.
create trigger audit_events_block_update
  before update on public.audit_events
  execute function app.reject_audit_mutation();

create trigger audit_events_block_delete
  before delete on public.audit_events
  execute function app.reject_audit_mutation();

-- ---------------------------------------------------------------------------
-- Recording
-- ---------------------------------------------------------------------------

-- Writing audit rows goes through this function so the actor is taken from the
-- session rather than from client input. A client cannot forge another actor.
create or replace function public.record_audit_event(
  p_household_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid default null,
  p_before jsonb default null,
  p_after jsonb default null,
  p_request_id uuid default null,
  p_device_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_id    uuid;
begin
  if v_actor is null then
    raise exception 'authentication required'
      using errcode = '28000';
  end if;

  -- A caller may only write audit rows for a household they belong to.
  if p_household_id is not null and not app.is_household_member(p_household_id) then
    raise exception 'not a member of household %', p_household_id
      using errcode = '42501';
  end if;

  insert into public.audit_events (
    household_id, actor_profile_id, action, entity_type, entity_id,
    before_state, after_state, request_id, device_id
  )
  values (
    p_household_id, v_actor, p_action, p_entity_type, p_entity_id,
    p_before, p_after, p_request_id, p_device_id
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.record_audit_event(uuid, text, text, uuid, jsonb, jsonb, uuid, uuid) is
  'Appends an audit row with the actor taken from the session. Rejects writes for households the caller does not belong to.';

revoke all on function public.record_audit_event(uuid, text, text, uuid, jsonb, jsonb, uuid, uuid) from public, anon;
grant execute on function public.record_audit_event(uuid, text, text, uuid, jsonb, jsonb, uuid, uuid) to authenticated;
