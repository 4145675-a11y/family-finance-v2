-- Milestone 9 — uploaded documents, staged proposals, and the approval boundary.
--
-- 05-ARCHITECTURE-DATA.md § Imports and `IMP-DRAFT-001` are the authority, and
-- one sentence from CLAUDE.md is what these tables are shaped around:
--
--   draft לא truth
--
-- A spreadsheet a bank produced is a claim about a family's money, not the money
-- itself. Until a person has looked at a proposed row and said yes, it may not
-- move a single balance, budget, debt or forecast.
--
-- The schema enforces that structurally rather than by convention:
--
--   * proposals live in their own table and are referenced by nothing that
--     computes a balance. No view, no trigger and no foreign key leads from a
--     financial table back to `import_proposals`;
--   * the link runs the other way. `committed_record_id` is written when a
--     proposal became a record, so a batch can be reversed and every record it
--     created can be found;
--   * a batch cannot be approved while any row is still `pending`. Silence is
--     never consent, and that is a CHECK rather than a code path;
--   * `raw`, `proposed` and `correction` are three separate columns. What the
--     document said, what the parser read, and what the reviewer decided are
--     never merged — a reviewer must always be able to see all three.
--
-- The uploaded bytes themselves are NOT stored here. They live in a private
-- Supabase Storage bucket under an unguessable household-scoped path; this table
-- holds the metadata and the hash. A financial database is the wrong place for
-- a multi-megabyte PDF, and a row that could hold one is a row that eventually
-- does.

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'import_file_kind' and n.nspname = 'public'
  ) then
    create type public.import_file_kind as enum ('xlsx', 'csv', 'pdf');
  end if;

  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'import_batch_status' and n.nspname = 'public'
  ) then
    -- `failed` is separated from `rejected`: one is the software not managing to
    -- read the file, the other is a person deciding it should not be used. They
    -- mean different things to a reader of the import history.
    create type public.import_batch_status as enum (
      'extracting', 'needs_review', 'approved', 'rejected', 'failed', 'reversed'
    );
  end if;

  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'import_document_type' and n.nspname = 'public'
  ) then
    create type public.import_document_type as enum (
      'bank_statement', 'credit_card_statement', 'loan_schedule',
      'mortgage_schedule', 'private_debt_list', 'household_income_expense',
      'business_income_expense', 'balance_summary', 'budget_file',
      'general_table', 'unrecognised'
    );
  end if;

  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'proposal_kind' and n.nspname = 'public'
  ) then
    create type public.proposal_kind as enum (
      'account', 'transaction', 'balance', 'debt',
      'debt_payment', 'planned_item', 'budget_line'
    );
  end if;

  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'review_state' and n.nspname = 'public'
  ) then
    -- `pending` is the only state a row can be created in.
    create type public.review_state as enum ('pending', 'included', 'excluded');
  end if;

  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'duplicate_verdict' and n.nspname = 'public'
  ) then
    create type public.duplicate_verdict as enum (
      'new', 'possible_duplicate', 'likely_duplicate'
    );
  end if;

  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'document_retention_state' and n.nspname = 'public'
  ) then
    -- Where the bytes are in their life. `quarantined` is the state on arrival:
    -- stored, hashed, and not yet read by anything.
    create type public.document_retention_state as enum (
      'quarantined', 'parsed', 'retained', 'purged'
    );
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- import_source_files — the metadata of what was uploaded
-- ---------------------------------------------------------------------------

create table if not exists public.import_source_files (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,

  -- Kept only so a reviewer can see which file they picked. It never becomes a
  -- path: 07-SECURITY-PRIVACY.md's traversal rule is kept structurally, by
  -- addressing objects with a generated id instead of a supplied name.
  display_name text not null check (length(btrim(display_name)) between 1 and 300),

  -- The object key inside the private bucket. Household-scoped and unguessable.
  storage_path text not null check (length(btrim(storage_path)) between 1 and 500),

  kind       public.import_file_kind not null,
  byte_size  bigint not null check (byte_size > 0 and byte_size <= 20971520),
  sha256     text not null check (sha256 ~ '^[0-9a-f]{64}$'),

  -- What the browser claimed. Recorded, never trusted: the format is decided
  -- from the bytes.
  declared_mime_type text check (length(btrim(declared_mime_type)) <= 200),

  retention_state public.document_retention_state not null default 'quarantined',
  purged_at       timestamptz,

  uploaded_by uuid not null references public.profiles (id) on delete restrict,
  uploaded_at timestamptz not null default now(),

  constraint import_source_files_purged_state check (
    (retention_state = 'purged') = (purged_at is not null)
  ),

  -- One object per household path. Two rows pointing at the same bytes would
  -- make deletion ambiguous.
  constraint import_source_files_path_unique unique (household_id, storage_path)
);

comment on table public.import_source_files is
  'Metadata for an uploaded document. The bytes live in a private Storage bucket; this row holds the hash, the size and where to find them.';
comment on column public.import_source_files.sha256 is
  'Hash of the uploaded bytes. Used to recognise the same file arriving twice, which is shown to a reviewer and never acted on automatically.';
comment on column public.import_source_files.storage_path is
  'Object key in the private bucket. Generated, never derived from the supplied filename.';

create index if not exists import_source_files_household_idx
  on public.import_source_files (household_id, uploaded_at desc);

-- The same file uploaded twice is recognised, not refused: a family may
-- legitimately re-upload after a mistake, and the duplicate is surfaced to the
-- reviewer instead.
create index if not exists import_source_files_hash_idx
  on public.import_source_files (household_id, sha256);

-- ---------------------------------------------------------------------------
-- import_batches — one upload, and where its review stands
-- ---------------------------------------------------------------------------

create table if not exists public.import_batches (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references public.households (id) on delete cascade,
  source_file_id uuid not null references public.import_source_files (id) on delete restrict,

  status        public.import_batch_status not null default 'extracting',
  document_type public.import_document_type not null default 'unrecognised',

  -- Detection is a hint that steers the review, never a fact that skips it.
  document_confidence_bp integer not null default 0
    check (document_confidence_bp between 0 and 10000),

  rows_proposed integer not null default 0 check (rows_proposed >= 0),
  rows_scanned  integer not null default 0 check (rows_scanned >= 0),
  truncated     boolean not null default false,

  -- Why extraction failed, when it did. A code, not a sentence: the Hebrew
  -- belongs in the copy layer where it can be reviewed as product language.
  failure_code text check (length(btrim(failure_code)) <= 80),

  -- Which account the file appears to be about, when the user picked one.
  target_account_id uuid references public.financial_accounts (id) on delete restrict,

  approved_at timestamptz,
  approved_by uuid references public.profiles (id) on delete restrict,
  reversed_at timestamptz,
  reversed_by uuid references public.profiles (id) on delete restrict,

  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version    integer not null default 1,

  -- An approval records who and when, together.
  constraint import_batches_approval_complete check (
    (approved_at is null) = (approved_by is null)
  ),
  constraint import_batches_reversal_complete check (
    (reversed_at is null) = (reversed_by is null)
  ),
  -- Only an approved batch can have been approved, and only an approved batch
  -- can be reversed. Neither is reachable from `failed`.
  constraint import_batches_approved_status check (
    approved_at is null or status in ('approved', 'reversed')
  ),
  constraint import_batches_reversed_status check (
    reversed_at is null or status = 'reversed'
  ),
  constraint import_batches_failure_code_when_failed check (
    failure_code is null or status = 'failed'
  )
);

comment on table public.import_batches is
  'One uploaded document being reviewed. Nothing here affects a balance: approval is what crosses that boundary, and it is recorded with who and when.';

drop trigger if exists import_batches_touch_updated_at on public.import_batches;
create trigger import_batches_touch_updated_at
  before update on public.import_batches
  for each row execute function app.touch_updated_at();

create index if not exists import_batches_household_idx
  on public.import_batches (household_id, created_at desc);

create index if not exists import_batches_open_idx
  on public.import_batches (household_id)
  where status = 'needs_review';

drop trigger if exists import_batches_audit on public.import_batches;
create trigger import_batches_audit
  after insert or update on public.import_batches
  for each row execute function app.audit_row_change(
    'import_batches', 'id', 'status', 'document_type', 'rows_proposed'
  );

-- ---------------------------------------------------------------------------
-- import_proposals — what the document said, and what it would become
-- ---------------------------------------------------------------------------

create table if not exists public.import_proposals (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  batch_id     uuid not null references public.import_batches (id) on delete cascade,

  kind public.proposal_kind not null,

  -- Exactly where in the document this came from, so any number can be traced
  -- back to the row a person can look at.
  location_sheet_name text check (length(location_sheet_name) <= 200),
  location_page       integer check (location_page is null or location_page between 1 and 10000),
  location_row        integer check (location_row is null or location_row between 1 and 1000000),
  location_snippet    text check (length(location_snippet) <= 1000),

  -- Three separate columns, never merged. What the file said, what the parser
  -- read it as, and what the reviewer changed it to.
  raw        jsonb not null,
  proposed   jsonb not null,
  correction jsonb,

  confidence_bp integer not null default 0 check (confidence_bp between 0 and 10000),
  warnings      text[] not null default '{}',

  duplicate_verdict public.duplicate_verdict not null default 'new',
  duplicate_of_id   uuid,

  review_state public.review_state not null default 'pending',

  -- Which account, debt or check the row attaches to once approved.
  target_account_id uuid references public.financial_accounts (id) on delete restrict,
  target_debt_id    uuid references public.debts (id) on delete restrict,
  target_check_id   uuid references public.post_dated_checks (id) on delete restrict,

  -- The record created when the batch was approved. NULL until then. This is
  -- the only link between a proposal and financial truth, and it points from
  -- the proposal outward — nothing that computes a balance reads this table.
  committed_record_id uuid,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version    integer not null default 1,

  -- A duplicate verdict must name the record it matched.
  constraint import_proposals_duplicate_names_record check (
    duplicate_verdict = 'new' or duplicate_of_id is not null
  ),
  -- A row that was never included cannot have created a record.
  constraint import_proposals_committed_only_when_included check (
    committed_record_id is null or review_state = 'included'
  )
);

comment on table public.import_proposals is
  'A staged row. Never read by anything that computes a balance: approval copies it into a financial table, and `committed_record_id` records where it went.';
comment on column public.import_proposals.raw is
  'What the document said, verbatim. Never rewritten by a correction.';
comment on column public.import_proposals.correction is
  'What the reviewer changed it to. Stored beside the parsed value, never over it.';
comment on column public.import_proposals.target_check_id is
  'The post-dated check this row is the clearing of, once a person says so. Never filled in automatically, however confident the match.';

drop trigger if exists import_proposals_touch_updated_at on public.import_proposals;
create trigger import_proposals_touch_updated_at
  before update on public.import_proposals
  for each row execute function app.touch_updated_at();

create index if not exists import_proposals_batch_idx
  on public.import_proposals (batch_id, created_at);

create index if not exists import_proposals_pending_idx
  on public.import_proposals (household_id)
  where review_state = 'pending';

-- ---------------------------------------------------------------------------
-- Approval is all-or-nothing, and silence is not consent
-- ---------------------------------------------------------------------------
--
-- The application refuses to approve a batch with an undecided row. This is the
-- same rule in the database, so it holds for any caller — including a
-- service-role worker, which RLS does not constrain.

create or replace function app.assert_batch_ready_for_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pending integer;
  v_included integer;
begin
  if new.status <> 'approved' or old.status = 'approved' then
    return new;
  end if;

  select
    count(*) filter (where review_state = 'pending'),
    count(*) filter (where review_state = 'included')
  into v_pending, v_included
  from public.import_proposals
  where batch_id = new.id;

  if v_pending > 0 then
    raise exception 'this import still has % undecided row(s); silence is not consent', v_pending;
  end if;

  if v_included = 0 then
    raise exception 'no row was included, so there is nothing to approve';
  end if;

  return new;
end;
$$;

comment on function app.assert_batch_ready_for_approval() is
  'A batch cannot become approved while a row is still pending. Enforced in the database so it holds for callers RLS does not constrain.';

drop trigger if exists import_batches_assert_ready on public.import_batches;
create trigger import_batches_assert_ready
  before update on public.import_batches
  for each row execute function app.assert_batch_ready_for_approval();

-- ---------------------------------------------------------------------------
-- Cross-household references
-- ---------------------------------------------------------------------------

create or replace function app.assert_import_references()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household uuid;
begin
  if tg_table_name = 'import_batches' then
    select household_id into v_household
    from public.import_source_files where id = new.source_file_id;
    if v_household is null or v_household <> new.household_id then
      raise exception 'an import batch must reference a file belonging to the same household';
    end if;

    if new.target_account_id is not null then
      select household_id into v_household
      from public.financial_accounts where id = new.target_account_id;
      if v_household is null or v_household <> new.household_id then
        raise exception 'an import batch must target an account belonging to the same household';
      end if;
    end if;

    return new;
  end if;

  -- import_proposals
  select household_id into v_household
  from public.import_batches where id = new.batch_id;
  if v_household is null or v_household <> new.household_id then
    raise exception 'a proposal must belong to the same household as its batch';
  end if;

  if new.target_account_id is not null then
    select household_id into v_household
    from public.financial_accounts where id = new.target_account_id;
    if v_household is null or v_household <> new.household_id then
      raise exception 'a proposal must target an account belonging to the same household';
    end if;
  end if;

  if new.target_debt_id is not null then
    select household_id into v_household
    from public.debts where id = new.target_debt_id;
    if v_household is null or v_household <> new.household_id then
      raise exception 'a proposal must target a debt belonging to the same household';
    end if;
  end if;

  if new.target_check_id is not null then
    select household_id into v_household
    from public.post_dated_checks where id = new.target_check_id;
    if v_household is null or v_household <> new.household_id then
      raise exception 'a proposal must target a check belonging to the same household';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists import_batches_assert_references on public.import_batches;
create trigger import_batches_assert_references
  before insert or update on public.import_batches
  for each row execute function app.assert_import_references();

drop trigger if exists import_proposals_assert_references on public.import_proposals;
create trigger import_proposals_assert_references
  before insert or update on public.import_proposals
  for each row execute function app.assert_import_references();

-- The check table's import link, now that batches exist.
alter table public.post_dated_checks
  drop constraint if exists post_dated_checks_import_batch_fkey;
alter table public.post_dated_checks
  add constraint post_dated_checks_import_batch_fkey
  foreign key (import_batch_id) references public.import_batches (id) on delete set null;
