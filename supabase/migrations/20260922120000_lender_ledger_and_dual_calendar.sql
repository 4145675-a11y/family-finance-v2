-- Lender ledger and dual-calendar due dates (ADR-0035).
--
-- Three additions, all of them additive. No column is dropped, no type is
-- narrowed, no existing row is rewritten, and every statement is safe to run
-- twice.
--
--  1. `note` joins the debt-event kinds. A lender ledger needs a line that
--     records something the family wants remembered — a conversation, a promise,
--     a change of address — without moving the balance. Its balance effect is
--     `none`, declared once in packages/contracts/src/debt.ts.
--
--  2. A due date becomes structured data instead of free text. The Gregorian
--     date is canonical and is what sorts, filters and drives reminders; the
--     Hebrew day/month/year sit beside it so "ז׳ טבת תשפ״ז" can be displayed as
--     the family wrote it. The original cell text is kept for the audit trail,
--     and a date that could not be read safely is recorded as a review reason
--     rather than as a date.
--
--  3. `lender_aliases` lets one lender be recognised under the several names a
--     spreadsheet calls them. A lender here is the creditor name a debt already
--     carries; the alias table maps other spellings onto it, per household, and
--     is consulted on import so a repeat upload matches instead of duplicating.

-- 1. The `note` ledger action ------------------------------------------------
-- ADD VALUE is additive and idempotent. The new value is not used by any DDL in
-- this migration, which is what makes it safe inside a transaction.
alter type public.debt_event_kind add value if not exists 'note';

-- 2. Structured dual-calendar due date ---------------------------------------
alter table public.debts
  -- The canonical date. Always Gregorian, always a real day, always what the
  -- application sorts and compares by.
  add column if not exists due_date date,
  -- The same day in the Hebrew calendar, when one applies.
  add column if not exists due_date_hebrew_year integer,
  add column if not exists due_date_hebrew_month integer,
  add column if not exists due_date_hebrew_day integer,
  -- True when the family expressed this date in the Hebrew calendar. It decides
  -- which calendar leads in the UI and whether an annual rule is Hebrew-based.
  add column if not exists due_date_is_hebrew boolean not null default false,
  -- The cell exactly as it was imported. Never parsed again, never shown as a
  -- date; kept so a person can always see what the file actually said.
  add column if not exists due_date_source_text text
    check (length(btrim(due_date_source_text)) <= 500),
  -- Why a date that looked like one was not accepted. NULL when there is a date
  -- or when there was never anything to read.
  add column if not exists due_date_review_reason text
    check (due_date_review_reason is null or due_date_review_reason in (
      'uncertainty_marker', 'ambiguous_adar', 'adar_in_non_leap_year',
      'day_not_in_month', 'unreadable_date'
    )),
  -- An obligation that returns every Hebrew year on the same day and month.
  add column if not exists due_date_recurs_annually boolean not null default false,
  -- The answers the household gave once, so the same question is not asked every
  -- year. NULL means it has not been asked yet.
  add column if not exists due_date_adar_choice text
    check (due_date_adar_choice is null or due_date_adar_choice in ('adar_i', 'adar_ii')),
  add column if not exists due_date_missing_day_choice text
    check (due_date_missing_day_choice is null or due_date_missing_day_choice in (
      'last_day_of_month', 'first_day_of_next_month'
    ));

do $$
begin
  -- The three Hebrew parts are one value: all present or all absent. A half
  -- Hebrew date is the kind of record that later reads as a real one.
  if not exists (
    select 1 from pg_constraint where conname = 'debts_hebrew_due_date_complete'
  ) then
    alter table public.debts add constraint debts_hebrew_due_date_complete check (
      (due_date_hebrew_year is null
        and due_date_hebrew_month is null
        and due_date_hebrew_day is null)
      or (due_date_hebrew_year between 1 and 9999
        and due_date_hebrew_month between 1 and 13
        and due_date_hebrew_day between 1 and 30)
    );
  end if;

  -- A date and a reason it could not be read are mutually exclusive answers.
  if not exists (
    select 1 from pg_constraint where conname = 'debts_due_date_or_review_reason'
  ) then
    alter table public.debts add constraint debts_due_date_or_review_reason check (
      due_date is null or due_date_review_reason is null
    );
  end if;

  -- Recurrence is a rule about a date, so it needs one.
  if not exists (
    select 1 from pg_constraint where conname = 'debts_recurrence_needs_a_date'
  ) then
    alter table public.debts add constraint debts_recurrence_needs_a_date check (
      due_date_recurs_annually = false or due_date is not null
    );
  end if;
end
$$;

-- Due dates are read in date order, for the next-payment view and reminders.
create index if not exists debts_due_date_idx
  on public.debts (household_id, due_date)
  where due_date is not null;

-- 3. Lender aliases -----------------------------------------------------------
create table if not exists public.lender_aliases (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  -- The name the debts are recorded under.
  canonical_name text not null check (length(btrim(canonical_name)) between 1 and 160),
  -- A spelling that means the same lender. Stored normalised so a match is a
  -- lookup rather than a comparison: folded case, collapsed whitespace, no
  -- geresh or quotation marks.
  alias_normalised text not null check (length(btrim(alias_normalised)) between 1 and 160),
  -- The alias exactly as it was written, for the person reading the list.
  alias_display text not null check (length(btrim(alias_display)) between 1 and 160),
  -- An alias is only ever created by a person confirming a match on the review
  -- screen. Nothing infers one.
  created_by    uuid not null references public.profiles (id) on delete restrict,
  created_at    timestamptz not null default now(),

  -- One alias means one lender within a household. This is what stops a repeat
  -- import from quietly attaching the same spelling to a second lender.
  constraint lender_aliases_unique_per_household
    unique (household_id, alias_normalised)
);

create index if not exists lender_aliases_canonical_idx
  on public.lender_aliases (household_id, canonical_name);

-- The table holds who a household owes money to. It is private by definition.
revoke all on table public.lender_aliases from public, anon, authenticated;
grant select, insert, update, delete on table public.lender_aliases to authenticated;

alter table public.lender_aliases enable row level security;
alter table public.lender_aliases force row level security;

drop policy if exists lender_aliases_select_member on public.lender_aliases;
create policy lender_aliases_select_member
  on public.lender_aliases for select to authenticated
  using (app.is_household_member(household_id));

drop policy if exists lender_aliases_insert_member on public.lender_aliases;
create policy lender_aliases_insert_member
  on public.lender_aliases for insert to authenticated
  with check (app.is_household_member(household_id));

drop policy if exists lender_aliases_update_member on public.lender_aliases;
create policy lender_aliases_update_member
  on public.lender_aliases for update to authenticated
  using (app.is_household_member(household_id))
  with check (app.is_household_member(household_id));

drop policy if exists lender_aliases_delete_member on public.lender_aliases;
create policy lender_aliases_delete_member
  on public.lender_aliases for delete to authenticated
  using (app.is_household_member(household_id));

-- 4. Import provenance --------------------------------------------------------
-- The file's own row identifier, carried so a re-import can recognise a row it
-- has already seen and so a ledger entry can be traced back to a line in a
-- spreadsheet. Never interpreted as a number or a key.
alter table public.import_proposals
  add column if not exists source_row_id text
    check (length(btrim(source_row_id)) <= 120);
