-- Milestone 9 — household settings, setup progress, and the family task list.
--
-- These are the collections the local store has carried since M7 that had no
-- table yet. None of them is money, and that is exactly why they are worth
-- getting right: settings decide how money is *interpreted* (which day a month
-- starts, what reserve floor applies), and a wrong value here moves every figure
-- on every screen without any of them looking wrong.

-- ---------------------------------------------------------------------------
-- household_settings — one row per household
-- ---------------------------------------------------------------------------

create table if not exists public.household_settings (
  household_id uuid primary key references public.households (id) on delete cascade,

  currency  text not null default 'ILS' check (currency ~ '^[A-Z]{3}$'),
  -- Israel. Stored rather than assumed, because every date boundary in the
  -- product — a month start, a check falling due, a weekly food window —
  -- depends on it, and a server in another region must not shift them.
  time_zone text not null default 'Asia/Jerusalem'
    check (length(btrim(time_zone)) between 1 and 60),

  -- The day a household's month begins. Salary rarely arrives on the 1st, and a
  -- budget measured against the wrong window is a budget nobody trusts.
  month_start_day integer not null default 1 check (month_start_day between 1 and 28),

  -- 02-FINANCIAL-RULES.md § רזרבה מינימלית: the floor is the highest of these,
  -- and NULL means "not set", never zero.
  manual_reserve_floor_minor  bigint check (manual_reserve_floor_minor is null
    or app.is_valid_amount_minor(manual_reserve_floor_minor)),
  incident_buffer_minor       bigint check (incident_buffer_minor is null
    or app.is_valid_amount_minor(incident_buffer_minor)),
  revolving_avoidance_minor   bigint check (revolving_avoidance_minor is null
    or app.is_valid_amount_minor(revolving_avoidance_minor)),

  -- Money already earmarked for something else. Not part of the floor; simply
  -- not available to spend.
  protected_reserves_minor bigint not null default 0
    check (app.is_valid_amount_minor(protected_reserves_minor)),

  -- Notification preferences that belong to the household rather than a device.
  weekly_food_guidance        boolean not null default true,
  balance_freshness_reminder  boolean not null default true,
  balance_freshness_days      integer not null default 7
    check (balance_freshness_days between 1 and 90),

  updated_at timestamptz not null default now(),
  version    integer not null default 1
);

comment on table public.household_settings is
  'How this household reads its own money: currency, calendar, month boundary and reserve components. One row per household, created with it.';
comment on column public.household_settings.month_start_day is
  'Capped at 28 so every month has the day. A budget window that silently moves in February is a budget window nobody can reconcile.';
comment on column public.household_settings.manual_reserve_floor_minor is
  'NULL means not set. Never treated as zero: an unset floor and a floor of nothing are different claims.';

drop trigger if exists household_settings_touch_updated_at on public.household_settings;
create trigger household_settings_touch_updated_at
  before update on public.household_settings
  for each row execute function app.touch_updated_at();

drop trigger if exists household_settings_audit on public.household_settings;
create trigger household_settings_audit
  after insert or update on public.household_settings
  for each row execute function app.audit_row_change(
    'household_settings', 'household_id', 'currency', 'month_start_day'
  );

-- ---------------------------------------------------------------------------
-- setup_progress — what the household has told us so far
-- ---------------------------------------------------------------------------
--
-- Deliberately booleans rather than a percentage. "You are 60% set up" is a
-- number nobody can act on; "you have not confirmed a balance yet" is.

create table if not exists public.setup_progress (
  household_id uuid primary key references public.households (id) on delete cascade,

  household_named               boolean not null default false,
  members_added                 boolean not null default false,
  accounts_added                boolean not null default false,
  balances_confirmed            boolean not null default false,
  business_decided              boolean not null default false,
  debts_recorded                boolean not null default false,
  recurring_income_recorded     boolean not null default false,
  recurring_obligations_recorded boolean not null default false,
  budget_started                boolean not null default false,
  privacy_explained             boolean not null default false,

  updated_at timestamptz not null default now()
);

comment on table public.setup_progress is
  'Which parts of the opening picture the household has completed. Booleans, not a score: a percentage is not something a person can act on.';

drop trigger if exists setup_progress_touch_updated_at on public.setup_progress;
create trigger setup_progress_touch_updated_at
  before update on public.setup_progress
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- family_tasks — the recommendation, with a name against it
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'task_status' and n.nspname = 'public'
  ) then
    create type public.task_status as enum ('open', 'done', 'dropped');
  end if;
end
$$;

create table if not exists public.family_tasks (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,

  title  text not null check (length(btrim(title)) between 1 and 200),
  -- Why this is worth doing, in the words the home screen used when it
  -- suggested it. Carried so a task still makes sense a week later.
  reason text check (length(btrim(reason)) <= 500),

  -- Which recommendation produced it, when one did. A code, not a sentence.
  recommendation_key text check (length(btrim(recommendation_key)) <= 60),

  status public.task_status not null default 'open',

  -- Whose it is. NULL is a real answer: a task the couple has not assigned.
  assigned_member_id uuid references public.household_members (id) on delete set null,

  due_on      date,
  completed_at timestamptz,

  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version    integer not null default 1,

  constraint family_tasks_completed_matches_status check (
    (status = 'done') = (completed_at is not null)
  )
);

comment on table public.family_tasks is
  'A recommendation that became something with a name against it. Creating one changes no figure — that separation is the point.';

drop trigger if exists family_tasks_touch_updated_at on public.family_tasks;
create trigger family_tasks_touch_updated_at
  before update on public.family_tasks
  for each row execute function app.touch_updated_at();

create index if not exists family_tasks_open_idx
  on public.family_tasks (household_id, due_on)
  where status = 'open';

-- ---------------------------------------------------------------------------
-- Cross-household reference
-- ---------------------------------------------------------------------------

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

  return new;
end;
$$;

drop trigger if exists family_tasks_assert_references on public.family_tasks;
create trigger family_tasks_assert_references
  before insert or update on public.family_tasks
  for each row execute function app.assert_task_references();

-- ---------------------------------------------------------------------------
-- idempotency_keys — the same request twice is one effect
-- ---------------------------------------------------------------------------
--
-- A phone on a poor connection retries. A user double-taps. A worker restarts
-- mid-job. None of those may approve an import twice or clear a check twice.
--
-- The check state machine already refuses a second clearing by name, which is
-- the stronger defence. This is the general one, for operations that have no
-- such state to lean on.

create table if not exists public.idempotency_keys (
  household_id uuid not null references public.households (id) on delete cascade,
  -- Supplied by the caller: stable for one logical operation, unguessable.
  key          text not null check (length(btrim(key)) between 8 and 200),
  operation    text not null check (length(btrim(operation)) between 1 and 80),

  -- What the first attempt produced, so a retry can be answered identically
  -- rather than re-executed.
  result_record_id uuid,
  created_at       timestamptz not null default now(),
  -- Retention: long enough to cover any plausible retry, short enough that the
  -- table does not grow without bound.
  expires_at       timestamptz not null default (now() + interval '7 days'),

  primary key (household_id, key)
);

comment on table public.idempotency_keys is
  'One logical operation, one effect. A retry finds its key and is answered with the original result instead of running again.';

create index if not exists idempotency_keys_expiry_idx
  on public.idempotency_keys (expires_at);
