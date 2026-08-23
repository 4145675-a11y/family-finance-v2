-- Milestone 6b — the monthly budget.
--
-- 01-PRODUCT-SPEC.md § Must: "תקציב קטגוריאלי מוצע, לא מופעל ללא אישור".
-- Two shapes carry that rule:
--
--   * A budget is a plan. Nothing in these tables is a balance, and no column can
--     be mistaken for one. Changing a plan never moves money.
--   * Moving money between categories is a proposal until a person approves it.
--     `budget_changes` exists precisely so that enlarging food at the expense of
--     something else is a visible, audited decision rather than a silent edit —
--     a budget that can grow on its own has stopped being a budget.
--
-- Every object here is re-runnable (ADR-0015).

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'budget_status' and n.nspname = 'public'
  ) then
    create type public.budget_status as enum ('draft', 'active', 'archived');
  end if;

  -- A fixed set, not free text: the copy layer names each one in plain Hebrew and
  -- the weekly food guidance attaches to a stable key. 01-PRODUCT-SPEC.md
  -- § מחוץ לתכולה forbids recommending cuts to religious or educational spending,
  -- so those are ordinary categories here and never candidates for elimination.
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'budget_category_key' and n.nspname = 'public'
  ) then
    create type public.budget_category_key as enum (
      'food', 'housing_and_bills', 'transport_and_fuel', 'health', 'education',
      'clothing', 'celebrations_and_gifts', 'cash_and_small', 'holidays', 'other'
    );
  end if;

  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'budget_change_status' and n.nspname = 'public'
  ) then
    create type public.budget_change_status as enum ('proposed', 'approved', 'rejected');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- budgets
-- ---------------------------------------------------------------------------

create table if not exists public.budgets (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  -- The month this budget plans, as YYYY-MM in the household's time zone.
  period        text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  status        public.budget_status not null default 'draft',
  currency      text not null default 'ILS' check (currency ~ '^[A-Z]{3}$'),
  -- 03-UX-SPEC.md: a first month is a low-confidence draft. The flag travels with
  -- the row so no screen has to infer it from dates.
  is_first_month_draft boolean not null default false,
  created_by    uuid not null references public.profiles (id) on delete restrict,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  version       integer not null default 1,

  constraint budgets_one_per_period unique (household_id, period)
);

comment on table public.budgets is
  'A monthly plan. Holds no money and changes no balance.';

drop trigger if exists budgets_touch_updated_at on public.budgets;
create trigger budgets_touch_updated_at
  before update on public.budgets
  for each row execute function app.touch_updated_at();

create index if not exists budgets_household_period_idx
  on public.budgets (household_id, period desc);

drop trigger if exists budgets_audit on public.budgets;
create trigger budgets_audit
  after insert or update on public.budgets
  for each row execute function app.audit_row_change(
    'budgets', 'id', 'period', 'status', 'currency', 'is_first_month_draft'
  );

-- ---------------------------------------------------------------------------
-- budget_lines
-- ---------------------------------------------------------------------------

create table if not exists public.budget_lines (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  budget_id     uuid not null references public.budgets (id) on delete cascade,
  category_id   uuid not null references public.categories (id) on delete restrict,
  category_key  public.budget_category_key not null,
  planned_minor bigint not null check (app.is_valid_amount_minor(planned_minor)),
  -- Food is the category a family steers weekly, so it is the one that also
  -- produces guidance on the home screen. The flag is data, not a hard-coded name.
  weekly_guidance boolean not null default false,
  note          text check (length(btrim(note)) <= 280),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  version       integer not null default 1,

  constraint budget_lines_one_per_category unique (budget_id, category_id)
);

comment on column public.budget_lines.planned_minor is
  'Planned spending for the period. A plan, never a balance.';

drop trigger if exists budget_lines_touch_updated_at on public.budget_lines;
create trigger budget_lines_touch_updated_at
  before update on public.budget_lines
  for each row execute function app.touch_updated_at();

create index if not exists budget_lines_budget_idx
  on public.budget_lines (budget_id);

create index if not exists budget_lines_weekly_idx
  on public.budget_lines (household_id)
  where weekly_guidance;

drop trigger if exists budget_lines_audit on public.budget_lines;
create trigger budget_lines_audit
  after insert or update on public.budget_lines
  for each row execute function app.audit_row_change(
    'budget_lines', 'id', 'budget_id', 'category_id', 'category_key',
    'planned_minor', 'weekly_guidance'
  );

-- ---------------------------------------------------------------------------
-- budget_changes
-- ---------------------------------------------------------------------------

-- A transfer between categories, and never an increase. If the family wants more
-- for food, something else gives, and this row records which — with who proposed
-- it and who approved it.
create table if not exists public.budget_changes (
  id               uuid primary key default gen_random_uuid(),
  household_id     uuid not null references public.households (id) on delete cascade,
  budget_id        uuid not null references public.budgets (id) on delete cascade,
  from_category_id uuid not null references public.categories (id) on delete restrict,
  to_category_id   uuid not null references public.categories (id) on delete restrict,
  amount_minor     bigint not null check (app.is_valid_amount_minor(amount_minor) and amount_minor > 0),
  reason           text check (length(btrim(reason)) <= 280),
  status           public.budget_change_status not null default 'proposed',
  proposed_by      uuid not null references public.profiles (id) on delete restrict,
  approved_by      uuid references public.profiles (id) on delete set null,
  approved_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  version          integer not null default 1,

  constraint budget_changes_distinct_categories check (from_category_id <> to_category_id),
  constraint budget_changes_approval_is_recorded check (
    (status = 'approved') = (approved_at is not null)
  )
);

comment on table public.budget_changes is
  'Proposed movements of planned money between categories. Proposed until approved, and audited either way.';

drop trigger if exists budget_changes_touch_updated_at on public.budget_changes;
create trigger budget_changes_touch_updated_at
  before update on public.budget_changes
  for each row execute function app.touch_updated_at();

create index if not exists budget_changes_budget_idx
  on public.budget_changes (budget_id, created_at desc);

create index if not exists budget_changes_pending_idx
  on public.budget_changes (household_id)
  where status = 'proposed';

drop trigger if exists budget_changes_audit on public.budget_changes;
create trigger budget_changes_audit
  after insert or update on public.budget_changes
  for each row execute function app.audit_row_change(
    'budget_changes', 'id', 'budget_id', 'from_category_id', 'to_category_id',
    'amount_minor', 'status', 'approved_at'
  );
