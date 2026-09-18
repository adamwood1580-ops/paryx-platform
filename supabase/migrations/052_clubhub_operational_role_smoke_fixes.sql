-- =========================================================
-- PARYX v0.30.4
-- Migration 052: ClubHub operational-role access alignment
--
-- Aligns the module catalogue with the role boundaries exercised by the
-- v0.30.3 live smoke test and grants Greenkeeper only the requested
-- ClubHub areas: Tee Sheet, Courses and Settings.
-- =========================================================

begin;

-- Keep the server-side module list aligned with the ClubHub navigation.
update public.club_module_catalog
set
    allowed_roles = case module_key
        when 'dashboard' then array['manager','club_admin']::text[]
        when 'tee_sheet' then array['starter','reception','professional','greenkeeper','manager','club_admin']::text[]
        when 'bookings' then array['starter','reception','professional','manager','club_admin']::text[]
        when 'members' then array['manager','club_admin']::text[]
        when 'courses' then array['greenkeeper','manager','club_admin']::text[]
        when 'calendar' then array['manager','club_admin']::text[]
        when 'competitions' then array['reception','professional','manager','club_admin']::text[]
        when 'member_credit' then array['reception','professional','manager','club_admin']::text[]
        when 'stock_inventory' then array['reception','professional','manager','club_admin']::text[]
        when 'epos_integration' then array['professional','manager','club_admin']::text[]
        when 'website_booking' then array['greenkeeper','manager','club_admin']::text[]
        when 'reports' then array['manager','club_admin']::text[]
        when 'settings' then array['greenkeeper','manager','club_admin']::text[]
        else allowed_roles
    end,
    updated_at = now()
where module_key in (
    'dashboard',
    'tee_sheet',
    'bookings',
    'members',
    'courses',
    'calendar',
    'competitions',
    'member_credit',
    'stock_inventory',
    'epos_integration',
    'website_booking',
    'reports',
    'settings'
);

-- Existing course/settings RPCs already centralise their write checks through
-- user_can_manage_club(). Keep Manager/Admin behaviour unchanged, but allow a
-- Greenkeeper only when the current RPC resolves to Courses, Settings or the
-- Website Booking settings embedded within the Settings page.
create or replace function public.user_can_manage_club(
    p_club_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_module text;
    v_roles text[];
begin
    v_module := public._clubhub_module_for_request('settings');

    if v_module in ('courses', 'settings', 'website_booking') then
        v_roles := array['greenkeeper','manager','club_admin']::text[];
    else
        v_roles := array['manager','club_admin']::text[];
    end if;

    return public.clubhub_user_can_access(
        p_club_id,
        v_module,
        v_roles
    );
end;
$$;

revoke all
on function public.user_can_manage_club(uuid)
from public, anon;

grant execute
on function public.user_can_manage_club(uuid)
to authenticated;

-- Greenkeepers may operate the Tee Sheet itself (including availability and
-- maintenance status) but do not gain booking-member search/create/edit
-- privileges. Those booking RPCs continue to resolve to the Bookings module.
create or replace function public.user_can_operate_tee_sheet(
    p_club_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_path text := lower(coalesce(current_setting('request.path', true), ''));
    v_module text := 'tee_sheet';
    v_roles text[];
begin
    if v_path like '%staff_create_booking%'
       or v_path like '%staff_update_booking%'
       or v_path like '%staff_move_booking%'
       or v_path like '%staff_cancel_booking%'
       or v_path like '%staff_replace_booking_players%'
       or v_path like '%staff_set_booking_check_in%'
       or v_path like '%staff_search_booking_members%'
       or v_path like '%staff_get_booking_detail%' then
        v_module := 'bookings';
        v_roles := array['starter','reception','professional','manager','club_admin']::text[];
    else
        v_roles := array['starter','reception','professional','greenkeeper','manager','club_admin']::text[];
    end if;

    return public.clubhub_user_can_access(
        p_club_id,
        v_module,
        v_roles
    );
end;
$$;

revoke all
on function public.user_can_operate_tee_sheet(uuid)
from public, anon;

grant execute
on function public.user_can_operate_tee_sheet(uuid)
to authenticated;

commit;

notify pgrst, 'reload schema';
