-- Milestone 9 — gemach loans and the post-dated checks that repay them.
--
-- ADR-0030 is the authority, and the one sentence it turns on is the reason this
-- migration exists as its own set of tables rather than columns on `debts`:
--
--   Handing a check to the gemach changes no number.
--   The bank honouring it changes exactly two, exactly once.
--
-- Three separate facts, three separate records, and the schema is shaped so they
-- cannot be merged:
--
--   1. The debt exists          -> public.debts + an opening_balance event
--   2. A check was handed over  -> a row here, and nothing else moves
--   3. The bank honoured it     -> a transaction AND a principal_payment, both
--                                  linked from the check row
--
-- The links in (3) are what make double counting structurally impossible rather
-- than merely unlikely. A check carries at most one `cleared_transaction_id` and
-- at most one `debt_event_id`, and both are permitted only in the `cleared`
-- state — so a statement imported twice cannot produce two repayments for one
-- piece of paper.
--
-- `due` is deliberately not a stored status. It is what today's date makes of a
-- check nobody has cashed; storing it would mean a value that is correct when
-- written and quietly wrong the next morning, with a family depending on a
-- background job to tell them a check is late. Urgency is derived on read, in
-- packages/finance-engine, and only there.

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------

-- A gemach is its own kind of creditor. Not `institution` and not
-- `private_person`: it charges no interest, which changes what progress means,
-- and it is repaid through paper handed over in advance, which no other kind is.
--
-- ADD VALUE is separated from any use of the value. PostgreSQL will not let a
-- new enum label be used in the same transaction that created it, so the tables
-- below reference `debt_kind` only through foreign keys, never as a literal.
alter type public.debt_kind add value if not exists 'gemach';

do $$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'check_status' and n.nspname = 'public'
  ) then
    -- What has actually happened to the paper. `cleared` is the only state in
    -- which money moved.
    create type public.check_status as enum (
      'prepared',   -- written, still in the chequebook, nobody else can cash it
      'delivered',  -- handed over; can be presented at any moment
      'deposited',  -- known to be at the bank, not yet honoured
      'cleared',    -- the bank paid it
      'returned',   -- presented and not honoured; not a payment
      'cancelled',  -- withdrawn by agreement, with a reason
      'replaced'    -- swapped for another check, which is linked
    );
  end if;

  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'check_source' and n.nspname = 'public'
  ) then
    create type public.check_source as enum ('manual', 'import', 'reconciliation');
  end if;

  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'repayment_cadence' and n.nspname = 'public'
  ) then
    -- Monthly is the only cadence a gemach uses in practice. Kept as an enum so
    -- adding another is a migration rather than a free-text field nobody parses.
    create type public.repayment_cadence as enum ('monthly');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- repayment_plans — what was agreed, which is not what has been written
-- ---------------------------------------------------------------------------
--
-- Separate from the checks because either can exist without the other: a plan
-- may be agreed before a single check is written, and checks can be handed over
-- for an arrangement nobody wrote down. Keeping them apart is what lets the
-- product answer "do the checks actually cover what we owe?" — a question with
-- no meaning if the plan is defined as the sum of the checks.

create table if not exists public.repayment_plans (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  debt_id       uuid not null references public.debts (id) on delete cascade,

  -- The arrangement in the family's own words. Never parsed, only shown.
  agreement_summary text check (length(btrim(agreement_summary)) <= 1000),

  installment_count        integer not null check (installment_count between 1 and 600),
  installment_amount_minor bigint  not null
    check (app.is_valid_amount_minor(installment_amount_minor) and installment_amount_minor > 0),

  -- A different last payment, when the total does not divide evenly. NULL when
  -- every installment is the same.
  final_installment_amount_minor bigint
    check (final_installment_amount_minor is null
      or (app.is_valid_amount_minor(final_installment_amount_minor)
          and final_installment_amount_minor > 0)),

  first_due_date date not null,
  cadence        public.repayment_cadence not null default 'monthly',

  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version    integer not null default 1,

  -- One agreement per debt. A second row would be a second answer to "what did
  -- we agree", and the screens would have to choose between them.
  constraint repayment_plans_one_per_debt unique (debt_id)
);

comment on table public.repayment_plans is
  'What was agreed with the lender. The checks are the paper; this is the arrangement, and the two are compared rather than merged.';
comment on column public.repayment_plans.final_installment_amount_minor is
  'A different last payment when the total does not divide evenly. NULL when every installment is equal.';

drop trigger if exists repayment_plans_touch_updated_at on public.repayment_plans;
create trigger repayment_plans_touch_updated_at
  before update on public.repayment_plans
  for each row execute function app.touch_updated_at();

create index if not exists repayment_plans_household_idx
  on public.repayment_plans (household_id, debt_id);

-- ---------------------------------------------------------------------------
-- post_dated_checks — the paper, and what has happened to it
-- ---------------------------------------------------------------------------

create table if not exists public.post_dated_checks (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,

  -- Every check repays exactly one debt, and is drawn on exactly one account.
  debt_id    uuid not null references public.debts (id) on delete cascade,
  account_id uuid not null references public.financial_accounts (id) on delete restrict,

  -- Optional, because a borrower does not always write them down and a model
  -- that demands one produces invented data. Digits only: anything else is
  -- somebody typing a note into the wrong field.
  check_number text check (check_number is null or check_number ~ '^[0-9]{1,12}$'),

  amount_minor bigint not null
    check (app.is_valid_amount_minor(amount_minor) and amount_minor > 0),
  currency text not null default 'ILS' check (currency ~ '^[A-Z]{3}$'),

  -- The date printed on the paper: the earliest it should be presented.
  due_date date not null,
  -- When it was physically handed over. NULL until it is.
  delivered_on date,

  payee_name text not null check (length(btrim(payee_name)) between 1 and 160),
  installment_number integer check (installment_number is null or installment_number between 1 and 600),
  note text check (length(btrim(note)) <= 500),

  source public.check_source not null default 'manual',
  status public.check_status not null default 'prepared',

  -- Set only in `cleared`. The two links below are the whole defence against
  -- one piece of paper becoming two repayments.
  cleared_on            date,
  cleared_transaction_id uuid references public.transactions (id) on delete restrict,
  debt_event_id          uuid references public.debt_events (id) on delete restrict,

  returned_on date,
  -- Required for `cancelled` and `returned`. Blame-free wording is a product
  -- rule; that it exists at all is a schema rule.
  resolution_reason text check (length(btrim(resolution_reason)) <= 300),

  replaced_by_check_id uuid references public.post_dated_checks (id) on delete restrict,
  replaces_check_id    uuid references public.post_dated_checks (id) on delete restrict,

  -- The import batch that proposed the clearing, when one did.
  import_batch_id uuid,

  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version    integer not null default 1,

  -- --- the invariants that keep "delivered" and "paid" apart ---------------

  -- A clearing date exists exactly when the check cleared.
  constraint checks_cleared_date_matches_status check (
    (status = 'cleared') = (cleared_on is not null)
  ),

  -- Only a cleared check may point at money. Without this a check could carry a
  -- transaction while sitting in somebody's drawer, and the household would have
  -- paid for paper the bank has never seen.
  constraint checks_transaction_only_when_cleared check (
    cleared_transaction_id is null or status = 'cleared'
  ),
  constraint checks_debt_event_only_when_cleared check (
    debt_event_id is null or status = 'cleared'
  ),

  -- A returned check records when it came back.
  constraint checks_returned_date_when_returned check (
    status <> 'returned' or returned_on is not null
  ),

  -- The returned date outlives the returned status, in one direction only. A
  -- check that bounced and was then cancelled or replaced still bounced, and
  -- erasing the date would delete the fact a family most needs later. What must
  -- not happen is a date surviving onto a check that is back in play, so
  -- re-presenting one clears it.
  constraint checks_returned_date_allowed_states check (
    returned_on is null or status in ('returned', 'cancelled', 'replaced')
  ),

  -- A replaced check names its replacement.
  constraint checks_replacement_link_matches_status check (
    (status = 'replaced') = (replaced_by_check_id is not null)
  ),

  -- Cancelling or recording a return needs a reason on the record.
  constraint checks_resolution_reason_required check (
    status not in ('cancelled', 'returned') or resolution_reason is not null
  ),

  -- Never handed over, so it cannot have reached the bank. `cancelled` and
  -- `replaced` are permitted alongside `prepared` because both are things that
  -- happen to a check still in the chequebook — torn up, or rewritten.
  constraint checks_undelivered_states check (
    delivered_on is not null or status in ('prepared', 'cancelled', 'replaced')
  ),

  constraint checks_no_self_replacement check (
    replaces_check_id is null or replaces_check_id <> id
  ),
  constraint checks_no_self_replacement_forward check (
    replaced_by_check_id is null or replaced_by_check_id <> id
  )
);

comment on table public.post_dated_checks is
  'One row per piece of paper. Handing one over moves no money; only `cleared` does, and then exactly once through the two links recorded here.';
comment on column public.post_dated_checks.cleared_transaction_id is
  'The cash movement the clearing created. Permitted only in the cleared state: this link is what stops one check becoming two repayments.';
comment on column public.post_dated_checks.debt_event_id is
  'The principal_payment the clearing created. Permitted only in the cleared state.';
comment on column public.post_dated_checks.due_date is
  'The date printed on the check. "Due" and "overdue" are derived from this on read and are never stored.';

drop trigger if exists post_dated_checks_touch_updated_at on public.post_dated_checks;
create trigger post_dated_checks_touch_updated_at
  before update on public.post_dated_checks
  for each row execute function app.touch_updated_at();

-- A check number is unique within the account it is drawn on, and only when one
-- was supplied. Two different chequebooks legitimately share numbers, and most
-- families do not record them at all — so this is a partial index rather than a
-- column constraint. Cancelled and replaced checks still occupy their number:
-- the paper exists, and the bank will honour it if it turns up.
create unique index if not exists post_dated_checks_number_per_account_idx
  on public.post_dated_checks (account_id, check_number)
  where check_number is not null;

-- One cash movement belongs to at most one check. The application refuses to
-- clear a check twice; this refuses two checks to claim the same debit.
create unique index if not exists post_dated_checks_transaction_idx
  on public.post_dated_checks (cleared_transaction_id)
  where cleared_transaction_id is not null;

create unique index if not exists post_dated_checks_debt_event_idx
  on public.post_dated_checks (debt_event_id)
  where debt_event_id is not null;

-- The question every screen asks: what is still out there, and when.
create index if not exists post_dated_checks_outstanding_idx
  on public.post_dated_checks (household_id, due_date)
  where status in ('prepared', 'delivered', 'deposited');

create index if not exists post_dated_checks_debt_idx
  on public.post_dated_checks (debt_id, due_date);

-- Matching an imported bank debit looks for account + exact amount.
create index if not exists post_dated_checks_match_idx
  on public.post_dated_checks (account_id, amount_minor)
  where status in ('prepared', 'delivered', 'deposited');

drop trigger if exists post_dated_checks_audit on public.post_dated_checks;
create trigger post_dated_checks_audit
  after insert or update on public.post_dated_checks
  for each row execute function app.audit_row_change(
    'post_dated_checks', 'id', 'status', 'amount_minor', 'currency',
    'due_date', 'delivered_on', 'cleared_on', 'returned_on', 'debt_id'
  );

-- ---------------------------------------------------------------------------
-- Cross-household references
-- ---------------------------------------------------------------------------
--
-- Foreign keys are checked with the table owner's privileges and are not
-- filtered by Row Level Security, so a member of household A could otherwise
-- name household B's debt or account in one of these columns and the constraint
-- would accept it. The RLS policies prove visibility of every referenced row;
-- this trigger proves they belong to the same household, which is the stronger
-- statement and holds even for a service-role caller.

create or replace function app.assert_check_references()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_debt_household uuid;
  v_account_household uuid;
  v_replaced_household uuid;
begin
  select household_id into v_debt_household
  from public.debts where id = new.debt_id;

  if v_debt_household is null or v_debt_household <> new.household_id then
    raise exception 'a check must repay a debt belonging to the same household';
  end if;

  select household_id into v_account_household
  from public.financial_accounts where id = new.account_id;

  if v_account_household is null or v_account_household <> new.household_id then
    raise exception 'a check must be drawn on an account belonging to the same household';
  end if;

  if new.replaced_by_check_id is not null then
    select household_id into v_replaced_household
    from public.post_dated_checks where id = new.replaced_by_check_id;

    if v_replaced_household is null or v_replaced_household <> new.household_id then
      raise exception 'a check may only be replaced by a check in the same household';
    end if;
  end if;

  if new.replaces_check_id is not null then
    select household_id into v_replaced_household
    from public.post_dated_checks where id = new.replaces_check_id;

    if v_replaced_household is null or v_replaced_household <> new.household_id then
      raise exception 'a check may only replace a check in the same household';
    end if;
  end if;

  return new;
end;
$$;

comment on function app.assert_check_references() is
  'Foreign keys ignore RLS. This proves a check''s debt, account and replacement links all belong to the same household.';

drop trigger if exists post_dated_checks_assert_references on public.post_dated_checks;
create trigger post_dated_checks_assert_references
  before insert or update on public.post_dated_checks
  for each row execute function app.assert_check_references();

-- The same hazard for a repayment plan naming another household's debt.
create or replace function app.assert_repayment_plan_references()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_debt_household uuid;
begin
  select household_id into v_debt_household
  from public.debts where id = new.debt_id;

  if v_debt_household is null or v_debt_household <> new.household_id then
    raise exception 'a repayment plan must belong to the same household as its debt';
  end if;

  return new;
end;
$$;

drop trigger if exists repayment_plans_assert_references on public.repayment_plans;
create trigger repayment_plans_assert_references
  before insert or update on public.repayment_plans
  for each row execute function app.assert_repayment_plan_references();
