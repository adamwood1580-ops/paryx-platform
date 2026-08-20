-- PARYX PLATFORM
-- Migration 005: Console cleanup controls + club member removal
--
-- Adds:
--   1. Owner-only hard delete for a tenant club.
--   2. Owner-only removal of Paryx platform access.
--   3. Club-admin member removal from a selected club.
--
-- IMPORTANT:
-- Removing a club is destructive and cascades through club-owned tables.
-- The caller must type the exact club name as confirmation.

begin;

-- =========================================================
-- PLATFORM OWNER: DELETE CLUB
-- =========================================================

create or replace function public.platform_delete_club(
    p_club_id uuid,
    p_confirmation text
)
returns table (
    deleted_club_id uuid,
    deleted_club_name text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_club_name text;
    v_actor_role text;
begin
    if auth.uid() is null
       or not public.is_platform_user(
            array['platform_owner']
       ) then
        raise exception
            'Paryx platform owner access required.';
    end if;

    select
        c.name
    into
        v_club_name
    from public.clubs as c
    where c.id = p_club_id
    limit 1;

    if v_club_name is null then
        raise exception
            'Club not found.';
    end if;

    if coalesce(trim(p_confirmation), '') <> v_club_name then
        raise exception
            'Confirmation must exactly match the club name.';
    end if;

    select
        pu.role
    into
        v_actor_role
    from public.platform_users as pu
    where pu.user_id = auth.uid()
      and pu.is_active = true
    limit 1;

    insert into public.platform_audit_log (
        actor_user_id,
        actor_role,
        action,
        club_id,
        details
    )
    values (
        auth.uid(),
        v_actor_role,
        'club_deleted',
        p_club_id,
        jsonb_build_object(
            'club_id', p_club_id,
            'club_name', v_club_name
        )
    );

    delete from public.clubs as c
    where c.id = p_club_id;

    return query
    select
        p_club_id,
        v_club_name;
end;
$$;

revoke all
on function public.platform_delete_club(uuid, text)
from public, anon;

grant execute
on function public.platform_delete_club(uuid, text)
to authenticated;


-- =========================================================
-- PLATFORM OWNER: REMOVE PLATFORM ACCESS
-- =========================================================

create or replace function public.platform_remove_user_access(
    p_user_id uuid
)
returns table (
    removed_user_id uuid,
    removed_email text,
    removed_role text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_email text;
    v_role text;
    v_active boolean;
    v_active_owner_count bigint;
begin
    if auth.uid() is null
       or not public.is_platform_user(
            array['platform_owner']
       ) then
        raise exception
            'Paryx platform owner access required.';
    end if;

    if p_user_id = auth.uid() then
        raise exception
            'You cannot remove your own Paryx Console access here.';
    end if;

    select
        au.email::text,
        pu.role,
        pu.is_active
    into
        v_email,
        v_role,
        v_active
    from public.platform_users as pu
    join auth.users as au
        on au.id = pu.user_id
    where pu.user_id = p_user_id
    limit 1;

    if v_role is null then
        raise exception
            'Platform user not found.';
    end if;

    if v_role = 'platform_owner'
       and v_active = true then

        select count(*)
        into v_active_owner_count
        from public.platform_users as pu
        where pu.role = 'platform_owner'
          and pu.is_active = true;

        if v_active_owner_count <= 1 then
            raise exception
                'Paryx must retain at least one active platform owner.';
        end if;
    end if;

    insert into public.platform_audit_log (
        actor_user_id,
        actor_role,
        action,
        target_user_id,
        details
    )
    values (
        auth.uid(),
        'platform_owner',
        'platform_user_access_removed',
        p_user_id,
        jsonb_build_object(
            'email', v_email,
            'role', v_role,
            'was_active', v_active
        )
    );

    delete from public.platform_users as pu
    where pu.user_id = p_user_id;

    return query
    select
        p_user_id,
        v_email,
        v_role;
end;
$$;

revoke all
on function public.platform_remove_user_access(uuid)
from public, anon;

grant execute
on function public.platform_remove_user_access(uuid)
to authenticated;


-- =========================================================
-- CLUB ADMIN: REMOVE MEMBER FROM CLUB
-- =========================================================

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
    v_active_admin_count bigint;
begin
    if auth.uid() is null
       or p_club_id is null
       or not public.user_can_manage_club(p_club_id) then
        raise exception
            'Club management access required.';
    end if;

    select
        cm.role
    into
        v_actor_role
    from public.club_memberships as cm
    where cm.profile_id = auth.uid()
      and cm.club_id = p_club_id
      and cm.status = 'active'
      and cm.role in ('manager', 'club_admin')
    limit 1;

    select
        cm.profile_id,
        cm.role,
        au.email::text
    into
        v_target_profile_id,
        v_target_role,
        v_target_email
    from public.club_memberships as cm
    join auth.users as au
        on au.id = cm.profile_id
    where cm.id = p_membership_id
      and cm.club_id = p_club_id
    limit 1;

    if v_target_profile_id is null then
        raise exception
            'Club member not found.';
    end if;

    if v_target_profile_id = auth.uid() then
        raise exception
            'You cannot remove your own club membership.';
    end if;

    if v_target_role = 'club_admin'
       and v_actor_role <> 'club_admin' then
        raise exception
            'Only a Club Admin can remove another Club Admin.';
    end if;

    if v_target_role = 'club_admin' then
        select count(*)
        into v_active_admin_count
        from public.club_memberships as cm
        where cm.club_id = p_club_id
          and cm.status = 'active'
          and cm.role = 'club_admin';

        if v_active_admin_count <= 1 then
            raise exception
                'The club must retain at least one active Club Admin.';
        end if;
    end if;

    delete from public.club_memberships as cm
    where cm.id = p_membership_id
      and cm.club_id = p_club_id;

    return query
    select
        p_membership_id,
        v_target_profile_id,
        v_target_email;
end;
$$;

revoke all
on function public.admin_remove_member(uuid, uuid)
from public, anon;

grant execute
on function public.admin_remove_member(uuid, uuid)
to authenticated;

commit;
