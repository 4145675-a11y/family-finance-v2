-- Milestone 2 — household invitations.
--
-- 07-SECURITY-PRIVACY.md requires the invitation token to be hashed, one-time,
-- revocable and expiring. The plaintext token exists only in the invite link the
-- inviter sends; the database stores nothing that can be replayed if it leaks.

create table if not exists public.household_invitations (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  invited_email extensions.citext not null check (position('@' in invited_email) > 1),

  -- SHA-256 of the plaintext token. The token itself is never stored, never
  -- logged and never returned by a query. A stolen database dump yields no
  -- usable invitation.
  token_hash    bytea not null,

  created_by    uuid not null references public.profiles (id) on delete restrict,
  expires_at    timestamptz not null,
  accepted_at   timestamptz,
  accepted_by   uuid references public.profiles (id) on delete set null,
  revoked_at    timestamptz,
  revoked_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  version       integer not null default 1,

  constraint household_invitations_token_hash_unique unique (token_hash),
  constraint household_invitations_expires_after_creation check (expires_at > created_at),
  constraint household_invitations_accepted_fields_together check (
    (accepted_at is null and accepted_by is null)
    or (accepted_at is not null and accepted_by is not null)
  ),
  -- An invitation cannot be both accepted and revoked. Without this, a race
  -- between accept and revoke could leave a row that reads as either.
  constraint household_invitations_not_both_accepted_and_revoked check (
    accepted_at is null or revoked_at is null
  )
);

comment on table public.household_invitations is
  'Pending invitations. Stores only the SHA-256 of the token; plaintext lives solely in the invite link.';
comment on column public.household_invitations.token_hash is
  'SHA-256 digest. Never store, log or return the plaintext token.';

create trigger household_invitations_touch_updated_at
  before update on public.household_invitations
  for each row execute function app.touch_updated_at();

create index if not exists household_invitations_household_idx
  on public.household_invitations (household_id);

-- Lookup path for acceptance: only rows that are still usable.
create index if not exists household_invitations_pending_idx
  on public.household_invitations (token_hash)
  where accepted_at is null and revoked_at is null;

-- ---------------------------------------------------------------------------
-- Acceptance
-- ---------------------------------------------------------------------------

-- Acceptance cannot be a plain INSERT by the invitee: the invitee is not yet a
-- member, so no sane policy on household_members would let them add themselves.
-- This SECURITY DEFINER function is the only path in, and it validates every
-- condition before granting membership.
create or replace function public.accept_household_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id   uuid := (select auth.uid());
  v_token_hash   bytea;
  v_invitation   public.household_invitations%rowtype;
begin
  if v_profile_id is null then
    raise exception 'authentication required'
      using errcode = '28000';
  end if;

  if p_token is null or length(btrim(p_token)) < 32 then
    raise exception 'invalid invitation token'
      using errcode = '22023';
  end if;

  v_token_hash := extensions.digest(p_token, 'sha256');

  -- FOR UPDATE serialises concurrent acceptances of the same token, so the
  -- one-time guarantee holds even under a double click or a replayed request.
  select * into v_invitation
  from public.household_invitations
  where token_hash = v_token_hash
  for update;

  if not found then
    raise exception 'invitation not found'
      using errcode = 'P0002';
  end if;

  if v_invitation.revoked_at is not null then
    raise exception 'invitation revoked'
      using errcode = 'P0001';
  end if;

  if v_invitation.expires_at <= now() then
    raise exception 'invitation expired'
      using errcode = 'P0001';
  end if;

  if v_invitation.accepted_at is not null then
    -- Already accepted. Accepting twice from the same profile is idempotent;
    -- from a different profile it is a replay attempt and must fail.
    if v_invitation.accepted_by = v_profile_id then
      return v_invitation.household_id;
    end if;
    raise exception 'invitation already accepted'
      using errcode = 'P0001';
  end if;

  insert into public.household_members (household_id, profile_id, invited_by, status)
  values (v_invitation.household_id, v_profile_id, v_invitation.created_by, 'active')
  on conflict (household_id, profile_id) do update
    set status     = 'active',
        revoked_at = null;

  update public.household_invitations
  set accepted_at = now(),
      accepted_by = v_profile_id
  where id = v_invitation.id;

  return v_invitation.household_id;
end;
$$;

comment on function public.accept_household_invitation(text) is
  'Redeems an invitation token. Validates revocation, expiry and single use, then grants membership. The only path by which a non-member joins a household.';

revoke all on function public.accept_household_invitation(text) from public, anon;
grant execute on function public.accept_household_invitation(text) to authenticated;
