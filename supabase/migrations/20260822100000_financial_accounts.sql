-- Milestone 3 — financial accounts and the opening picture.
--
-- 01-PRODUCT-SPEC.md § Must: accounts, cards, cash, business, opening balances,
-- future items and manual transactions, all separated by scope so the household
-- and the business can be read apart and together without double counting.
--
-- Two structural decisions carried through this file:
--
--   * `scope` on a stored row is household or business, never consolidated.
--     Consolidated is a reading of the two, and a row that claimed it would be
--     counted twice (02-FINANCIAL-RULES.md § Scopes ותנועות).
--   * Amounts are non-negative integers in minor units, with a direction column
--     carrying the meaning (FIN-MONEY-001). No column holds a signed amount.
--
-- Every object here is re-runnable per ADR-0015.

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------

-- CREATE TYPE has no IF NOT EXISTS, and dropping a type that a column depends on
-- is not an option, so each one is created under an existence check.
do $$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'record_scope' and n.nspname = 'public'
  ) then
    create type public.record_scope as enum ('household', 'business');
  end if;

  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'flow_direction' and n.nspname = 'public'
  ) then
    create type public.flow_direction as enum ('inflow', 'outflow');
  end if;

  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'account_kind' and n.nspname = 'public'
  ) then
    create type public.account_kind as enum
      ('bank_account', 'credit_card', 'cash_wallet', 'other');
  end if;

  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'balance_source' and n.nspname = 'public'
  ) then
    create type public.balance_source as enum ('manual_entry', 'statement', 'import');
  end if;

  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'transaction_kind' and n.nspname = 'public'
  ) then
    create type public.transaction_kind as enum
      ('expense', 'income', 'transfer', 'settlement', 'refund', 'correction');
  end if;

  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'transaction_status' and n.nspname = 'public'
  ) then
    create type public.transaction_status as enum
      ('draft', 'confirmed', 'reconciled', 'void');
  end if;

  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'certainty_level' and n.nspname = 'public'
  ) then
    create type public.certainty_level as enum ('possible', 'probable', 'certain');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Shared money constraint
-- ---------------------------------------------------------------------------

-- The ceiling matches MAX_AMOUNT_MINOR in packages/contracts/src/money.ts: high
-- enough that no real household reaches it, low enough that summing a household's
-- rows stays inside exact integer arithmetic.
create or replace function app.is_valid_amount_minor(p_amount bigint)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select p_amount >= 0 and p_amount <= 1000000000000000;
$$;

comment on function app.is_valid_amount_minor(bigint) is
  'FIN-MONEY-001: a stored amount is a non-negative integer of minor units within the aggregation-safe range.';

-- ---------------------------------------------------------------------------
-- businesses
-- ---------------------------------------------------------------------------

create table if not exists public.businesses (
  id                  uuid primary key default gen_random_uuid(),
  household_id        uuid not null references public.households (id) on delete cascade,
  name                text not null check (length(btrim(name)) between 1 and 120),
  -- Basis points, so a 25% reserve is 2500 and no floating point is stored.
  tax_reserve_rate_bp integer not null default 0 check (tax_reserve_rate_bp between 0 and 10000),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  version             integer not null default 1
);

comment on table public.businesses is
  'A business belonging to the household. Its money is tracked apart from household money and only a safe transfer moves between them.';

drop trigger if exists businesses_touch_updated_at on public.businesses;
create trigger businesses_touch_updated_at
  before update on public.businesses
  for each row execute function app.touch_updated_at();

create index if not exists businesses_household_idx
  on public.businesses (household_id);

-- ---------------------------------------------------------------------------
-- financial_accounts
-- ---------------------------------------------------------------------------

create table if not exists public.financial_accounts (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  business_id  uuid references public.businesses (id) on delete restrict,
  scope        public.record_scope not null,
  kind         public.account_kind not null,
  name         text not null check (length(btrim(name)) between 1 and 120),
  institution  text check (length(btrim(institution)) <= 120),
  currency     text not null default 'ILS' check (currency ~ '^[A-Z]{3}$'),

  -- 07-SECURITY-PRIVACY.md forbids storing a full card number anywhere. Four
  -- digits are enough to recognise the card and useless to an attacker.
  display_suffix text check (display_suffix ~ '^[0-9]{4}$'),

  opening_balance_minor     bigint not null
    check (app.is_valid_amount_minor(opening_balance_minor)),
  opening_balance_direction public.flow_direction not null,
  opening_balance_date      date not null,

  closed_at    timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  version      integer not null default 1,

  -- A business-scoped account names its business; a household account has none.
  -- Without this a business account could drift out of every business report.
  constraint financial_accounts_business_matches_scope check (
    (scope = 'business' and business_id is not null)
    or (scope = 'household' and business_id is null)
  )
);

comment on table public.financial_accounts is
  'Bank accounts, credit cards and cash wallets. A credit card balance is money owed, which is why direction is stored rather than a sign.';
comment on column public.financial_accounts.display_suffix is
  'Last four digits only. A full card number is never stored, logged or audited.';

drop trigger if exists financial_accounts_touch_updated_at on public.financial_accounts;
create trigger financial_accounts_touch_updated_at
  before update on public.financial_accounts
  for each row execute function app.touch_updated_at();

create index if not exists financial_accounts_household_idx
  on public.financial_accounts (household_id, scope)
  where closed_at is null;

create index if not exists financial_accounts_business_idx
  on public.financial_accounts (business_id)
  where business_id is not null;

-- ---------------------------------------------------------------------------
-- account_balance_snapshots
-- ---------------------------------------------------------------------------

-- 05-ARCHITECTURE-DATA.md § Reconciliation: a computed balance is compared to a
-- balance the user verified against the institution. Freshness on the dashboard
-- is measured from verified_at, so an old snapshot lowers confidence rather than
-- silently passing as current.
create table if not exists public.account_balance_snapshots (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  account_id   uuid not null references public.financial_accounts (id) on delete cascade,
  balance_minor bigint not null check (app.is_valid_amount_minor(balance_minor)),
  balance_direction public.flow_direction not null,
  verified_at  timestamptz not null,
  source       public.balance_source not null,
  note         text check (length(btrim(note)) <= 280),
  created_by   uuid not null references public.profiles (id) on delete restrict,
  created_at   timestamptz not null default now()
);

comment on table public.account_balance_snapshots is
  'A balance confirmed against the real institution at a point in time. Append-only in practice: a newer snapshot supersedes an older one rather than editing it.';

create index if not exists account_balance_snapshots_account_time_idx
  on public.account_balance_snapshots (account_id, verified_at desc);

-- ---------------------------------------------------------------------------
-- categories
-- ---------------------------------------------------------------------------

create table if not exists public.categories (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name         text not null check (length(btrim(name)) between 1 and 80),
  scope        public.record_scope not null,
  -- Essential needs are the first claim in the allocation waterfall
  -- (02-FINANCIAL-RULES.md § מפל הקצאת כסף), so the flag is data, not a guess.
  essential    boolean not null default false,
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  version      integer not null default 1,

  constraint categories_unique_name_per_scope unique (household_id, scope, name)
);

comment on column public.categories.essential is
  'Marks a need that the allocation waterfall funds before anything else.';

drop trigger if exists categories_touch_updated_at on public.categories;
create trigger categories_touch_updated_at
  before update on public.categories
  for each row execute function app.touch_updated_at();

create index if not exists categories_household_idx
  on public.categories (household_id, scope)
  where archived_at is null;

-- ---------------------------------------------------------------------------
-- transactions
-- ---------------------------------------------------------------------------

create table if not exists public.transactions (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  account_id   uuid not null references public.financial_accounts (id) on delete restrict,
  -- Present for transfers and settlements, forbidden otherwise.
  counterpart_account_id uuid references public.financial_accounts (id) on delete restrict,
  scope        public.record_scope not null,
  kind         public.transaction_kind not null,
  direction    public.flow_direction not null,
  amount_minor bigint not null check (app.is_valid_amount_minor(amount_minor)),
  currency     text not null default 'ILS' check (currency ~ '^[A-Z]{3}$'),
  status       public.transaction_status not null default 'draft',
  category_id  uuid references public.categories (id) on delete set null,
  merchant     text check (length(btrim(merchant)) <= 160),

  -- The date roles are kept apart (02-FINANCIAL-RULES.md § מוסכמות). Collapsing
  -- them is what makes a card charge appear in the wrong month.
  transaction_date date not null,
  posting_date     date,
  value_date       date,

  refunds_transaction_id  uuid references public.transactions (id) on delete restrict,
  corrects_transaction_id uuid references public.transactions (id) on delete restrict,

  note         text check (length(btrim(note)) <= 500),
  created_by   uuid not null references public.profiles (id) on delete restrict,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  version      integer not null default 1,

  -- A transfer moves money between two accounts we own; anything else has one
  -- side. Both halves of the rule are enforced so neither shape can drift.
  constraint transactions_counterpart_matches_kind check (
    (kind in ('transfer', 'settlement') and counterpart_account_id is not null)
    or (kind not in ('transfer', 'settlement') and counterpart_account_id is null)
  ),
  constraint transactions_counterpart_is_other_account check (
    counterpart_account_id is null or counterpart_account_id <> account_id
  ),
  -- A refund points at what it reverses, and only a refund may.
  constraint transactions_refund_links_source check (
    (kind = 'refund') = (refunds_transaction_id is not null)
  ),
  constraint transactions_correction_links_source check (
    corrects_transaction_id is null or kind = 'correction'
  )
);

comment on table public.transactions is
  'Money movements. Nothing is deleted: a mistake becomes a void status or a correction row, so history survives.';
comment on column public.transactions.status is
  'draft is never truth and void is never counted (CLAUDE.md).';

drop trigger if exists transactions_touch_updated_at on public.transactions;
create trigger transactions_touch_updated_at
  before update on public.transactions
  for each row execute function app.touch_updated_at();

create index if not exists transactions_household_date_idx
  on public.transactions (household_id, transaction_date desc);

create index if not exists transactions_account_date_idx
  on public.transactions (account_id, transaction_date desc);

create index if not exists transactions_status_idx
  on public.transactions (household_id, status);

-- ---------------------------------------------------------------------------
-- transaction_splits
-- ---------------------------------------------------------------------------

create table if not exists public.transaction_splits (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references public.households (id) on delete cascade,
  transaction_id uuid not null references public.transactions (id) on delete cascade,
  category_id    uuid references public.categories (id) on delete set null,
  scope          public.record_scope not null,
  amount_minor   bigint not null check (app.is_valid_amount_minor(amount_minor)),
  note           text check (length(btrim(note)) <= 280),
  created_at     timestamptz not null default now()
);

comment on table public.transaction_splits is
  'Parts of one transaction, typically splitting a mixed household/business charge. Splits sum exactly to the transaction amount.';

create index if not exists transaction_splits_transaction_idx
  on public.transaction_splits (transaction_id);

-- The invariant "splits שווים למקור" (02-FINANCIAL-RULES.md § אינווריאנטים) cannot
-- be a row check, because it is a property of the set. It is enforced by a
-- DEFERRABLE constraint trigger so that a multi-row edit is judged once, at
-- commit, on the final state — not midway through, when it is legitimately
-- inconsistent.
create or replace function app.assert_splits_match_transaction()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_transaction_id uuid := coalesce(new.transaction_id, old.transaction_id);
  v_amount bigint;
  v_split_total bigint;
  v_split_count integer;
begin
  select t.amount_minor into v_amount
  from public.transactions t
  where t.id = v_transaction_id;

  -- The parent is gone (household cascade). There is nothing left to reconcile.
  if not found then
    return null;
  end if;

  select coalesce(sum(s.amount_minor), 0), count(*)
    into v_split_total, v_split_count
  from public.transaction_splits s
  where s.transaction_id = v_transaction_id;

  -- Zero splits means the transaction is simply not split, which is valid.
  if v_split_count > 0 and v_split_total <> v_amount then
    raise exception
      'splits for transaction % total % but the transaction is %',
      v_transaction_id, v_split_total, v_amount
      using errcode = '23514';
  end if;

  return null;
end;
$$;

comment on function app.assert_splits_match_transaction() is
  'Deferred constraint: when a transaction has splits, they sum exactly to its amount.';

drop trigger if exists transaction_splits_sum_matches on public.transaction_splits;
create constraint trigger transaction_splits_sum_matches
  after insert or update or delete on public.transaction_splits
  deferrable initially deferred
  for each row execute function app.assert_splits_match_transaction();

-- ---------------------------------------------------------------------------
-- cashflow_items
-- ---------------------------------------------------------------------------

-- Future inflows and outflows. This is the table the forecast reads, and the one
-- place certainty is most easily confused with liquidity: `certainty` says how
-- sure we are the event happens, never whether the money is available today
-- (02-FINANCIAL-RULES.md § נזילות מול ודאות).
create table if not exists public.cashflow_items (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  scope        public.record_scope not null,
  account_id   uuid references public.financial_accounts (id) on delete set null,
  direction    public.flow_direction not null,
  amount_minor bigint not null check (app.is_valid_amount_minor(amount_minor)),
  currency     text not null default 'ILS' check (currency ~ '^[A-Z]{3}$'),
  label        text not null check (length(btrim(label)) between 1 and 160),
  category_id  uuid references public.categories (id) on delete set null,
  certainty    public.certainty_level not null,
  expected_date date not null,
  due_date      date,
  essential     boolean not null default false,
  settled_transaction_id uuid references public.transactions (id) on delete set null,
  created_by   uuid not null references public.profiles (id) on delete restrict,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  version      integer not null default 1
);

comment on column public.cashflow_items.certainty is
  'Confidence that the event happens. Not a liquidity statement: certain money that has not arrived is still not cash.';

drop trigger if exists cashflow_items_touch_updated_at on public.cashflow_items;
create trigger cashflow_items_touch_updated_at
  before update on public.cashflow_items
  for each row execute function app.touch_updated_at();

create index if not exists cashflow_items_household_expected_idx
  on public.cashflow_items (household_id, expected_date)
  where settled_transaction_id is null;

create index if not exists cashflow_items_due_idx
  on public.cashflow_items (household_id, due_date)
  where due_date is not null and settled_transaction_id is null;

-- ---------------------------------------------------------------------------
-- Automatic audit
-- ---------------------------------------------------------------------------

-- 07-SECURITY-PRIVACY.md requires every change to a household, business, debt,
-- opening balance or permission to be audited with actor and time. Doing it in
-- the application would leave the trail dependent on the caller remembering; a
-- trigger cannot be forgotten.
--
-- SECURITY DEFINER because audit_events has no INSERT policy for `authenticated`
-- by design — rows arrive only through code that stamps the actor from the
-- session, never from client input.
--
-- The recorded image is reduced to the column names passed as trigger arguments.
-- Free-text columns (notes, promises, merchant) are deliberately never passed:
-- 07-SECURITY-PRIVACY.md keeps the audit to metadata.
create or replace function app.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entity   text := tg_argv[0];
  v_keys     text[] := tg_argv[1:array_length(tg_argv, 1) - 1];
  v_before   jsonb;
  v_after    jsonb;
  v_row      jsonb;
  v_household uuid;
  v_entity_id uuid;
begin
  if tg_op <> 'INSERT' then
    select jsonb_object_agg(entry.key, entry.value) into v_before
    from jsonb_each(to_jsonb(old)) as entry
    where entry.key = any(v_keys);
  end if;

  if tg_op <> 'DELETE' then
    select jsonb_object_agg(entry.key, entry.value) into v_after
    from jsonb_each(to_jsonb(new)) as entry
    where entry.key = any(v_keys);
  end if;

  v_row := to_jsonb(coalesce(new, old));
  v_household := (v_row ->> 'household_id')::uuid;
  v_entity_id := (v_row ->> 'id')::uuid;

  insert into public.audit_events (
    household_id, actor_profile_id, action, entity_type, entity_id,
    before_state, after_state
  )
  values (
    v_household,
    (select auth.uid()),
    lower(tg_op),
    v_entity,
    v_entity_id,
    v_before,
    v_after
  );

  return null;
end;
$$;

comment on function app.audit_row_change() is
  'AFTER trigger: appends a reduced audit image. Arguments are the entity name followed by the column names allowed into the trail.';

revoke all on function app.audit_row_change() from public, anon, authenticated;

drop trigger if exists financial_accounts_audit on public.financial_accounts;
create trigger financial_accounts_audit
  after insert or update on public.financial_accounts
  for each row execute function app.audit_row_change(
    'financial_accounts', 'id', 'scope', 'kind', 'currency',
    'opening_balance_minor', 'opening_balance_direction', 'opening_balance_date', 'closed_at'
  );

drop trigger if exists account_balance_snapshots_audit on public.account_balance_snapshots;
create trigger account_balance_snapshots_audit
  after insert on public.account_balance_snapshots
  for each row execute function app.audit_row_change(
    'account_balance_snapshots', 'id', 'account_id', 'balance_minor',
    'balance_direction', 'verified_at', 'source'
  );

drop trigger if exists businesses_audit on public.businesses;
create trigger businesses_audit
  after insert or update on public.businesses
  for each row execute function app.audit_row_change(
    'businesses', 'id', 'tax_reserve_rate_bp'
  );
