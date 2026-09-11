-- =========================================================
-- PARYX MIGRATION 041
-- CLUB MEMBER REMOVAL — IDENTITY V2 SAFE REMOVAL
-- =========================================================
--
-- Purpose
-- - "Remove from club" must not hard-delete club_memberships because
--   historical bookings, competition data and Club Credit deliberately retain
--   references to the club-owned membership record.
-- - Cancel the membership instead, detach any global Player identity link and
--   remove staff privileges while preserving the club's historical record.
-- =========================================================

begin;

create or replace function public.admin_remove_member(
    p_club_id uuid,
    p_membership_id uuid
)
returns table (
    removed_membership_id uuid,
    removed_profile_id uuid,
    removed_email text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor_role text;
    v_target_profile_id uuid;
    v_target_role text;
    v_target_email text;
    v_member_exists boolean;
    v_active_admin_count bigint;
begin
    if auth.uid() is null
       or p_club_id is null
       or not public.user_has_admin_access(p_club_id) then
        raise exception 'Club management access required.';
    end if;

    select membership.role
    into v_actor_role
    from public.club_memberships as membership
    where membership.profile_id = auth.uid()
      and membership.club_id = p_club_id
      and membership.status = 'active'
      and membership.role in ('manager','club_admin')
    limit 1;

    select
        true,
        membership.profile_id,
        membership.role,
        membership.club_email
    into
        v_member_exists,
        v_target_profile_id,
        v_target_role,
        v_target_email
    from public.club_memberships as membership
    where membership.id = p_membership_id
      and membership.club_id = p_club_id
    limit 1;

    if not coalesce(v_member_exists, false) then
        raise exception 'Club member not found.';
    end if;

    if v_target_profile_id is not null
       and v_target_profile_id = auth.uid() then
        raise exception 'You cannot remove your own club membership.';
    end if;

    if v_target_role = 'club_admin'
       and v_actor_role <> 'club_admin' then
        raise exception 'Only a Club Admin can remove another Club Admin.';
    end if;

    if v_target_role = 'club_admin' then
        select count(*)
        into v_active_admin_count
        from public.club_memberships as membership
        where membership.club_id = p_club_id
          and membership.status = 'active'
          and membership.role = 'club_admin';

        if v_active_admin_count <= 1 then
            raise exception 'The club must retain at least one active Club Admin.';
        end if;
    end if;

    -- Remove any private Player -> membership claim first. This is harmless for
    -- an account already deleted from Console because the link is already gone.
    delete from public.club_membership_player_links as link
    where link.membership_id = p_membership_id
      and link.club_id = p_club_id;

    -- Do not DELETE the club-owned member record. Bookings and Club Credit use
    -- restrictive foreign keys precisely so their audit/history cannot vanish.
    -- Cancellation removes current access while retaining those references.
    update public.club_memberships as membership
    set
        status = 'cancelled',
        profile_id = null,
        is_primary = false,
        role = case
            when membership.role in (
                'starter',
                'reception',
                'professional',
                'greenkeeper',
                'manager',
                'club_admin'
            ) then 'member'
            else membership.role
        end,
        updated_at = now()
    where membership.id = p_membership_id
      and membership.club_id = p_club_id;

    -- Keep the legacy RPC return contract, but never disclose the private
    -- Paryx profile id to ClubHub.
    return query
    select
        p_membership_id,
        null::uuid,
        v_target_email;
end;
$$;

revoke all on function public.admin_remove_member(uuid,uuid)
from public, anon;

grant execute on function public.admin_remove_member(uuid,uuid)
to authenticated;

commit;

notify pgrst, 'reload schema';
