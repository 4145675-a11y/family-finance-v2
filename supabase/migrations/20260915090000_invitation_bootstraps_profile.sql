-- Production Data Layer — an invitee who has never had a household has no
-- profile row yet.
--
-- Found by the live validation (ADR-0032, Phase 8): a person signs up through
-- Supabase Auth, receives an invitation code, and redeems it. The membership
-- insert inside accept_household_invitation() references public.profiles, and
-- that row did not exist — every earlier test had seeded one. The function is
-- the only path by which a non-member joins, so it is the right place to make
-- sure the person exists on this side of the door.
--
-- The display name comes from the session the auth server signed: the
-- `display_name` the person chose at sign-up when there is one, otherwise the
-- local part of their email, otherwise a neutral placeholder. Either partner
-- can change it later. Nothing else about the function changes.

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
  v_claims       jsonb;
  v_display_name text;
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

  -- A person who has never created a household has no profile yet.
  if not exists (select 1 from public.profiles where id = v_profile_id) then
    v_claims := coalesce(auth.jwt(), '{}'::jsonb);
    v_display_name := coalesce(
      nullif(btrim(v_claims -> 'user_metadata' ->> 'display_name'), ''),
      nullif(split_part(v_claims ->> 'email', '@', 1), ''),
      'חבר/ה במשק הבית'
    );
    insert into public.profiles (id, display_name)
    values (v_profile_id, left(v_display_name, 80));
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
  'Redeems an invitation token. Validates revocation, expiry and single use, creates the profile of a first-time person, then grants membership. The only path by which a non-member joins a household.';

revoke all on function public.accept_household_invitation(text) from public, anon;
grant execute on function public.accept_household_invitation(text) to authenticated;
