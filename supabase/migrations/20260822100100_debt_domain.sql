-- Milestone 4 — the debt domain.
--
-- 02-FINANCIAL-RULES.md § גלגול חוב והחלפת נושה is the authority. Three rules are
-- built into the shape of these tables rather than left to application code:
--
--   1. Debt events are the truth. A balance is derived by replaying what happened,
--      never stored as a number that someone typed over the previous one. There is
--      deliberately no `current_balance_minor` column to drift out of date.
--   2. Repaying one creditor with another creditor's money is three facts: the old
--      debt was repaid, a new debt was created, and a link explains what funded the
--      repayment. The link changes no balance.
--   3. A link that was inferred from amount and timing is a proposal until a person
--      confirms it.
--
-- The balance is computed in packages/finance-engine, and only there. A second
-- implementation in SQL would be a second definition of "how much do we owe", and
-- the two would eventually disagree.

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'debt_kind' and n.nspname = 'public'
  ) then
    create type public.debt_kind as enum (
      'mortgage', 'bank_loan', 'revolving_credit', 'overdraft',
      'private_person', 'institution', 'other'
    );
  end if;

  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'debt_status' and n.nspname = 'public'
  ) then
    create type public.debt_status as enum ('active', 'settled', 'written_off');
  end if;

  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'debt_urgency' and n.nspname = 'public'
  ) then
    create type public.debt_urgency as enum ('none', 'watch', 'demanded', 'legal');
  end if;

  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'relationship_sensitivity' and n.nspname = 'public'
  ) then
    create type public.relationship_sensitivity as enum ('low', 'medium', 'high');
  end if;

  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'debt_event_kind' and n.nspname = 'public'
  ) then
    create type public.debt_event_kind as enum (
      'opening_balance', 'new_principal', 'principal_payment',
      'interest_charge', 'fee_charge', 'interest_paid', 'fee_paid',
      'balance_correction', 'write_off'
    );
  end if;

  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'correction_effect' and n.nspname = 'public'
  ) then
    create type public.correction_effect as enum ('increase', 'decrease');
  end if;

  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'rollover_source' and n.nspname = 'public'
  ) then
    create type public.rollover_source as enum ('user_confirmed', 'system_suggested');
  end if;

  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'rollover_status' and n.nspname = 'public'
  ) then
    create type public.rollover_status as enum ('proposed', 'confirmed', 'rejected');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- debts
-- ---------------------------------------------------------------------------

create table if not exists public.debts (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  kind          public.debt_kind not null,
  creditor_name text not null check (length(btrim(creditor_name)) between 1 and 160),
  currency      text not null default 'ILS' check (currency ~ '^[A-Z]{3}$'),
  status        public.debt_status not null default 'active',

  -- Basis points. NULL means the rate is unknown, and unknown is not zero:
  -- § קדימות חובות forbids claiming a precise saving when the rate is missing.
  effective_annual_rate_bp integer
    check (effective_annual_rate_bp is null or effective_annual_rate_bp between 0 and 1000000),

  minimum_payment_minor bigint
    check (minimum_payment_minor is null or app.is_valid_amount_minor(minimum_payment_minor)),
  payment_due_day integer check (payment_due_day is null or payment_due_day between 1 and 31),

  urgency       public.debt_urgency not null default 'none',

  -- Private-debt fields. 02-FINANCIAL-RULES.md § חובות לאנשים lists them, and
  -- states that a personal relationship is never silently converted into interest.
  promise_summary          text check (length(btrim(promise_summary)) <= 500),
  relationship_sensitivity public.relationship_sensitivity,
  partial_payment_allowed  boolean,
  last_demand_at           timestamptz,
  last_conversation_at     timestamptz,
  expected_call_date       date,

  notes         text check (length(btrim(notes)) <= 1000),
  opened_on     date not null,
  closed_at     timestamptz,
  created_by    uuid not null references public.profiles (id) on delete restrict,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  version       integer not null default 1,

  -- The relationship fields exist for a debt owed to a person and for no other
  -- kind. Enforced in both directions so an institutional debt cannot acquire a
  -- "sensitivity" that would then influence a ranking.
  constraint debts_relationship_fields_match_kind check (
    (kind = 'private_person'
      and relationship_sensitivity is not null
      and partial_payment_allowed is not null)
    or (kind <> 'private_person'
      and relationship_sensitivity is null
      and partial_payment_allowed is null)
  )
);

comment on table public.debts is
  'One row per creditor relationship. Balances are not stored here: they are replayed from debt_events.';
comment on column public.debts.effective_annual_rate_bp is
  'Effective annual cost in basis points. NULL means unknown, which is never treated as zero.';

drop trigger if exists debts_touch_updated_at on public.debts;
create trigger debts_touch_updated_at
  before update on public.debts
  for each row execute function app.touch_updated_at();

create index if not exists debts_household_idx
  on public.debts (household_id, kind)
  where status = 'active';

create index if not exists debts_urgency_idx
  on public.debts (household_id, urgency)
  where status = 'active';

drop trigger if exists debts_audit on public.debts;
create trigger debts_audit
  after insert or update on public.debts
  for each row execute function app.audit_row_change(
    'debts', 'id', 'kind', 'status', 'currency', 'effective_annual_rate_bp',
    'minimum_payment_minor', 'urgency', 'closed_at'
  );

-- ---------------------------------------------------------------------------
-- debt_events
-- ---------------------------------------------------------------------------

create table if not exists public.debt_events (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  debt_id       uuid not null references public.debts (id) on delete cascade,
  kind          public.debt_event_kind not null,
  amount_minor  bigint not null check (app.is_valid_amount_minor(amount_minor)),
  currency      text not null default 'ILS' check (currency ~ '^[A-Z]{3}$'),
  occurred_on   date not null,

  -- Only a correction carries an explicit direction. Every other kind takes its
  -- effect from the table in packages/contracts/src/debt.ts, so a row cannot
  -- claim an effect that contradicts its kind.
  correction_effect public.correction_effect,

  transaction_id uuid references public.transactions (id) on delete set null,
  note          text check (length(btrim(note)) <= 500),
  created_by    uuid not null references public.profiles (id) on delete restrict,
  created_at    timestamptz not null default now(),

  constraint debt_events_correction_direction check (
    (kind = 'balance_correction') = (correction_effect is not null)
  )
);

comment on table public.debt_events is
  'What happened to a debt. Append-only in intent: a mistake is corrected with a balance_correction event, which stays visibly separate from a repayment.';
comment on column public.debt_events.kind is
  'interest_paid and fee_paid do not reduce the balance: paying interest is not progress on principal.';

create index if not exists debt_events_debt_time_idx
  on public.debt_events (debt_id, occurred_on, created_at);

create index if not exists debt_events_household_time_idx
  on public.debt_events (household_id, occurred_on desc);

drop trigger if exists debt_events_audit on public.debt_events;
create trigger debt_events_audit
  after insert on public.debt_events
  for each row execute function app.audit_row_change(
    'debt_events', 'id', 'debt_id', 'kind', 'amount_minor', 'occurred_on', 'correction_effect'
  );

-- ---------------------------------------------------------------------------
-- debt_rollovers
-- ---------------------------------------------------------------------------

create table if not exists public.debt_rollovers (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  from_debt_id  uuid not null references public.debts (id) on delete cascade,
  to_debt_id    uuid not null references public.debts (id) on delete cascade,
  repayment_event_id   uuid not null references public.debt_events (id) on delete cascade,
  origination_event_id uuid not null references public.debt_events (id) on delete cascade,
  amount_minor  bigint not null check (app.is_valid_amount_minor(amount_minor)),
  occurred_on   date not null,
  source        public.rollover_source not null,
  status        public.rollover_status not null default 'proposed',
  confidence_bp integer check (confidence_bp is null or confidence_bp between 0 and 10000),
  notes         text check (length(btrim(notes)) <= 500),
  confirmed_by  uuid references public.profiles (id) on delete set null,
  confirmed_at  timestamptz,
  created_by    uuid not null references public.profiles (id) on delete restrict,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  version       integer not null default 1,

  constraint debt_rollovers_distinct_debts check (from_debt_id <> to_debt_id),
  constraint debt_rollovers_confirmation_is_recorded check (
    (status = 'confirmed') = (confirmed_at is not null)
  ),
  constraint debt_rollovers_inference_states_confidence check (
    source <> 'system_suggested' or confidence_bp is not null
  ),
  -- One link per pair of events. This is what makes confirming twice idempotent
  -- rather than producing a second link that would double-count the rollover
  -- (08-TEST-PLAN.md § גלגולי חוב).
  constraint debt_rollovers_one_per_event_pair
    unique (repayment_event_id, origination_event_id)
);

comment on table public.debt_rollovers is
  'Explains what funded a repayment. Changes no balance: the debt events are the truth and this row is the explanation.';

drop trigger if exists debt_rollovers_touch_updated_at on public.debt_rollovers;
create trigger debt_rollovers_touch_updated_at
  before update on public.debt_rollovers
  for each row execute function app.touch_updated_at();

create index if not exists debt_rollovers_household_idx
  on public.debt_rollovers (household_id, occurred_on desc);

create index if not exists debt_rollovers_from_debt_idx
  on public.debt_rollovers (from_debt_id);

create index if not exists debt_rollovers_to_debt_idx
  on public.debt_rollovers (to_debt_id);

-- A link must describe events that actually exist, on the debts it names, of the
-- kinds it claims, in the same household. Without this a row could assert a
-- funding relationship between unrelated events and quietly change what the debt
-- meter reports as progress.
create or replace function app.assert_rollover_references()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_repayment public.debt_events%rowtype;
  v_origination public.debt_events%rowtype;
begin
  select * into v_repayment
  from public.debt_events e where e.id = new.repayment_event_id;

  if not found then
    raise exception 'repayment event % does not exist', new.repayment_event_id
      using errcode = '23503';
  end if;

  select * into v_origination
  from public.debt_events e where e.id = new.origination_event_id;

  if not found then
    raise exception 'origination event % does not exist', new.origination_event_id
      using errcode = '23503';
  end if;

  if v_repayment.debt_id <> new.from_debt_id then
    raise exception 'repayment event belongs to debt %, not %',
      v_repayment.debt_id, new.from_debt_id using errcode = '23514';
  end if;

  if v_origination.debt_id <> new.to_debt_id then
    raise exception 'origination event belongs to debt %, not %',
      v_origination.debt_id, new.to_debt_id using errcode = '23514';
  end if;

  if v_repayment.kind <> 'principal_payment' then
    raise exception 'a rollover is funded by a principal_payment, not a %', v_repayment.kind
      using errcode = '23514';
  end if;

  if v_origination.kind <> 'new_principal' then
    raise exception 'a rollover creates new_principal, not a %', v_origination.kind
      using errcode = '23514';
  end if;

  if v_repayment.household_id <> new.household_id
     or v_origination.household_id <> new.household_id then
    raise exception 'a rollover cannot span households' using errcode = '42501';
  end if;

  -- The link cannot claim to have funded more than either event moved.
  if new.amount_minor > v_repayment.amount_minor
     or new.amount_minor > v_origination.amount_minor then
    raise exception 'rollover amount % exceeds the events it links', new.amount_minor
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function app.assert_rollover_references() is
  'Validates that a rollover link points at a real principal_payment and new_principal in the same household, for no more than either event moved.';

drop trigger if exists debt_rollovers_validate_references on public.debt_rollovers;
create trigger debt_rollovers_validate_references
  before insert or update on public.debt_rollovers
  for each row execute function app.assert_rollover_references();

drop trigger if exists debt_rollovers_audit on public.debt_rollovers;
create trigger debt_rollovers_audit
  after insert or update on public.debt_rollovers
  for each row execute function app.audit_row_change(
    'debt_rollovers', 'id', 'from_debt_id', 'to_debt_id', 'amount_minor',
    'occurred_on', 'source', 'status', 'confidence_bp'
  );
