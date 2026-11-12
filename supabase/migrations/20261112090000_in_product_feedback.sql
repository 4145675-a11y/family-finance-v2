-- Feedback from inside the product (ADR-0047).
--
-- A member marks something on a screen, writes what should change, and sends
-- it. The platform owner reads it and decides. Three things shape this file:
--
--   * **Nothing that was on the screen is stored.** The server builds the row
--     from a white list (packages/contracts/src/feedback.ts), and the columns
--     here hold only that list: a note the person wrote, a chain of `data-fb`
--     names, a route template with every identifier taken out, the size of the
--     screen and which build was serving. The checks below repeat the shape, so
--     a server that forgot the white list still could not store a page title.
--
--   * **Writing goes through one function.** There is no INSERT policy, exactly
--     like `household_requests` (ADR-0045). `submit_feedback` decides the author
--     and the household itself, from the session, and limits how many notes one
--     person sends in an hour. Nothing the browser says names either.
--
--   * **Reading is the platform owner's, and nobody else's** — not the author's,
--     and not their partner's. The author was never going to need the list, and
--     a table nobody but the reviewer can read has nothing to leak between
--     families. The platform owner sees the note and the family's name, never a
--     figure of money: no financial table is touched here.
--
-- Additive throughout: new types, one new table, new functions. Nothing that
-- exists changes.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'feedback_kind' and n.nspname = 'public'
  ) then
    create type public.feedback_kind as enum ('design', 'content', 'bug', 'other');
  end if;
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'feedback_urgency' and n.nspname = 'public'
  ) then
    create type public.feedback_urgency as enum ('low', 'normal', 'high');
  end if;
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'feedback_status' and n.nspname = 'public'
  ) then
    create type public.feedback_status as enum ('new', 'approved', 'done', 'declined');
  end if;
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'feedback_device' and n.nspname = 'public'
  ) then
    create type public.feedback_device as enum ('phone', 'tablet', 'desktop');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- The table
-- ---------------------------------------------------------------------------

create table if not exists public.feedback (
  id             uuid primary key default gen_random_uuid(),
  -- What a person reads back and approves by: fb-YYYYMMDD-HHMMSS-xxxxxx, UTC.
  reference      text not null unique
                 check (reference ~ '^fb-[0-9]{8}-[0-9]{6}-[0-9a-f]{6}$'),
  -- Set by submit_feedback from the session. Never by the browser.
  household_id   uuid not null references public.households (id) on delete cascade,
  author_id      uuid not null references public.profiles (id) on delete cascade,
  kind           public.feedback_kind not null,
  urgency        public.feedback_urgency not null,
  status         public.feedback_status not null default 'new',
  body           text not null check (length(btrim(body)) between 1 and 2000),
  -- {"type":"page"} or {"type":"element"|"region","chain":[…],"rect":{…}}.
  mark           jsonb not null check (
                   jsonb_typeof(mark) = 'object'
                   and mark ->> 'type' in ('element', 'region', 'page')
                   and length(mark::text) <= 2000
                 ),
  -- A template: lowercase words and [id], nothing a person could be identified by.
  route          text not null check (
                   length(route) <= 512 and route ~ '^/([a-z][a-z0-9-]*|\[id\])?(/([a-z][a-z0-9-]*|\[id\]))*$'
                 ),
  viewport_width  integer not null check (viewport_width between 1 and 100000),
  viewport_height integer not null check (viewport_height between 1 and 100000),
  scroll_y        integer not null check (scroll_y between 0 and 100000),
  device          public.feedback_device not null,
  build_commit    text check (build_commit ~ '^[0-9a-f]{7,40}$'),
  build_branch    text check (length(build_branch) <= 200),
  schema_version  integer not null check (schema_version >= 1),
  status_changed_by uuid references public.profiles (id) on delete set null,
  status_changed_at timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- The optimistic-concurrency counter app.touch_updated_at() bumps.
  version        integer not null default 1
);

comment on table public.feedback is
  'Notes members send about the product. Written only through submit_feedback, read only by the platform owner. Holds nothing that was on the screen.';

-- The hourly limit counts one person's recent notes.
create index if not exists feedback_author_recent on public.feedback (author_id, created_at);
create index if not exists feedback_status_created on public.feedback (status, created_at);

drop trigger if exists feedback_touch_updated_at on public.feedback;
create trigger feedback_touch_updated_at
  before update on public.feedback
  for each row execute function app.touch_updated_at();

alter table public.feedback enable row level security;
alter table public.feedback force row level security;

-- Only the platform owner reads. The author does not, and neither does anybody
-- else in their household.
drop policy if exists feedback_select_platform_owner on public.feedback;
create policy feedback_select_platform_owner
  on public.feedback
  for select
  to authenticated
  using (app.is_platform_admin());

comment on policy feedback_select_platform_owner on public.feedback is
  'Reviewing notes is the platform owner''s job. No member, author included, can list them.';

-- Deliberately no INSERT, UPDATE or DELETE policy, and no write privilege.
-- Sending goes through submit_feedback; deciding and deleting through the
-- admin_* functions, which check app.is_platform_admin() themselves.
revoke all on public.feedback from anon, authenticated;
grant select on public.feedback to authenticated;

-- ---------------------------------------------------------------------------
-- Sending one
-- ---------------------------------------------------------------------------

create or replace function public.submit_feedback(
  p_kind          public.feedback_kind,
  p_urgency       public.feedback_urgency,
  p_body          text,
  p_mark          jsonb,
  p_route         text,
  p_viewport_width  integer,
  p_viewport_height integer,
  p_scroll_y      integer,
  p_device        public.feedback_device,
  p_build_commit  text,
  p_build_branch  text,
  p_schema_version integer
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile   uuid := (select auth.uid());
  v_household uuid;
  v_reference text;
begin
  if v_profile is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  -- The household is the caller's own — the one the product opens for them, the
  -- earliest active membership in a household that is switched on. A person in
  -- no household, or only in a disabled one, has nowhere to send from.
  select hm.household_id into v_household
  from public.household_members hm
  join public.households h on h.id = hm.household_id
  where hm.profile_id = v_profile
    and hm.status = 'active'
    and h.disabled_at is null
  order by hm.joined_at
  limit 1;

  if v_household is null then
    raise exception 'feedback is sent from inside a household' using errcode = '42501';
  end if;

  -- Ten in an hour, per person. Counted under a lock on the person's own rows
  -- would be stricter; this is a courtesy limit, and a race that lets an
  -- eleventh through is not worth a lock on every send.
  if (
    select count(*) from public.feedback f
    where f.author_id = v_profile and f.created_at > now() - interval '1 hour'
  ) >= 10 then
    raise exception 'feedback limit reached' using errcode = 'P0001';
  end if;

  v_reference := 'fb-'
    || to_char(now() at time zone 'UTC', 'YYYYMMDD-HH24MISS')
    || '-'
    || encode(extensions.gen_random_bytes(3), 'hex');

  insert into public.feedback (
    reference, household_id, author_id, kind, urgency, body, mark, route,
    viewport_width, viewport_height, scroll_y, device, build_commit, build_branch,
    schema_version
  ) values (
    v_reference, v_household, v_profile, p_kind, p_urgency, btrim(p_body), p_mark, p_route,
    p_viewport_width, p_viewport_height, p_scroll_y, p_device,
    nullif(btrim(coalesce(p_build_commit, '')), ''),
    nullif(btrim(coalesce(p_build_branch, '')), ''),
    p_schema_version
  );

  return v_reference;
end;
$$;

comment on function public.submit_feedback(
  public.feedback_kind, public.feedback_urgency, text, jsonb, text, integer, integer, integer,
  public.feedback_device, text, text, integer
) is
  'Stores one note from the signed-in member. Author and household come from the session; the status is always new; ten per person per hour.';

revoke all on function public.submit_feedback(
  public.feedback_kind, public.feedback_urgency, text, jsonb, text, integer, integer, integer,
  public.feedback_device, text, text, integer
) from public, anon;
grant execute on function public.submit_feedback(
  public.feedback_kind, public.feedback_urgency, text, jsonb, text, integer, integer, integer,
  public.feedback_device, text, text, integer
) to authenticated;

-- ---------------------------------------------------------------------------
-- Reviewing them
-- ---------------------------------------------------------------------------

-- Every note, newest first, with the name of the family that sent it. Not the
-- author, not the household's identifier: the reviewer needs to know which
-- family to ask, not who in it pressed the button.
create or replace function public.admin_feedback_list()
returns table (
  reference       text,
  created_at      timestamptz,
  status          public.feedback_status,
  kind            public.feedback_kind,
  urgency         public.feedback_urgency,
  body            text,
  mark            jsonb,
  route           text,
  viewport_width  integer,
  viewport_height integer,
  scroll_y        integer,
  device          public.feedback_device,
  build_commit    text,
  build_branch    text,
  schema_version  integer,
  household_name  text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    f.reference, f.created_at, f.status, f.kind, f.urgency, f.body, f.mark, f.route,
    f.viewport_width, f.viewport_height, f.scroll_y, f.device, f.build_commit,
    f.build_branch, f.schema_version, h.name
  from public.feedback f
  left join public.households h on h.id = f.household_id
  where app.is_platform_admin()
  order by f.created_at desc;
$$;

comment on function public.admin_feedback_list() is
  'Every feedback note for the platform owner. Returns nothing at all to anybody else.';

revoke all on function public.admin_feedback_list() from public, anon;
grant execute on function public.admin_feedback_list() to authenticated;

create or replace function public.admin_set_feedback_status(
  p_reference text,
  p_status    public.feedback_status
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_platform_admin() then
    raise exception 'only the platform owner decides on feedback' using errcode = '42501';
  end if;
  update public.feedback
  set status = p_status,
      status_changed_by = (select auth.uid()),
      status_changed_at = now()
  where reference = p_reference;
  if not found then
    raise exception 'no such feedback' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.admin_set_feedback_status(text, public.feedback_status)
  from public, anon;
grant execute on function public.admin_set_feedback_status(text, public.feedback_status)
  to authenticated;

create or replace function public.admin_delete_feedback(p_reference text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_platform_admin() then
    raise exception 'only the platform owner deletes feedback' using errcode = '42501';
  end if;
  delete from public.feedback where reference = p_reference;
  if not found then
    raise exception 'no such feedback' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.admin_delete_feedback(text) from public, anon;
grant execute on function public.admin_delete_feedback(text) to authenticated;
