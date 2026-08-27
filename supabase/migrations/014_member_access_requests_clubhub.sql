-- =========================================================
-- PARYX MIGRATION 014
-- MEMBER ACCESS REQUESTS — CLUBHUB APPROVAL WORKFLOW
--
-- Run after:
--   011_member_app_foundation.sql
--
-- Player-side requests already exist in migration 011.
-- This migration adds the ClubHub management RPCs that review
-- and resolve those requests.
-- =========================================================

begin;


-- =========================================================
-- LIST REQUESTS FOR THE SELECTED CLUB
-- =========================================================

create or replace function public.admin_get_member_access_requests(
    p_club_id uuid
)
returns table (
    request_id uuid,
    profile_id uuid,
    display_name text,
    email text,
    requested_membership_number text,
    message text,
    request_status text,
    created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null
       or p_club_id is null
       or not public.user_can_manage_club(
            p_club_id
       ) then
        raise exception
            'Club management access required.';
    end if;

    return query
    select
        req.id,
        req.profile_id,

        coalesce(
            nullif(
                trim(
                    p.display_name
                ),
                ''
            ),
            nullif(
                trim(
                    concat_ws(
                        ' ',
                        p.first_name,
                        p.last_name
                    )
                ),
                ''
            ),
            nullif(
                trim(
                    au.email::text
                ),
                ''
            ),
            'Paryx player'
        )::text,

        au.email::text,

        req.requested_membership_number,
        req.message,
        req.status,
        req.created_at

    from public.club_membership_access_requests
        as req

    join public.profiles as p
        on p.id =
            req.profile_id

    left join auth.users as au
        on au.id =
            req.profile_id

    where req.club_id =
            p_club_id

    order by
        case
            when req.status =
                'pending'
            then 0
            else 1
        end,

        req.created_at desc;
end;
$$;

revoke all
on function public.admin_get_member_access_requests(
    uuid
)
from public, anon;

grant execute
on function public.admin_get_member_access_requests(
    uuid
)
to authenticated;


-- =========================================================
-- APPROVE / REJECT REQUEST
--
-- Approval reuses the player's existing global Paryx identity.
-- If the player already has an internal visitor relationship
-- at the club, that exact relationship is upgraded to Member.
-- =========================================================

create or replace function public.admin_resolve_member_access_request(
    p_club_id uuid,
    p_request_id uuid,
    p_approve boolean,
    p_membership_number text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_operator_membership_id uuid;
    v_request
        public.club_membership_access_requests%rowtype;

    v_existing_membership
        public.club_memberships%rowtype;

    v_membership_number text;

    v_should_be_primary boolean :=
        false;
begin
    if auth.uid() is null
       or p_club_id is null
       or p_request_id is null
       or p_approve is null
       or not public.user_can_manage_club(
            p_club_id
       ) then
        raise exception
            'Club management access required.';
    end if;

    select cm.id
    into v_operator_membership_id
    from public.club_memberships as cm
    where cm.profile_id =
            auth.uid()
      and cm.club_id =
            p_club_id
      and cm.status =
            'active'
      and cm.role in (
            'manager',
            'club_admin'
      )
    order by
        cm.is_primary desc,
        cm.created_at asc
    limit 1;

    if v_operator_membership_id is null then
        raise exception
            'Club management access required.';
    end if;

    select req.*
    into v_request
    from public.club_membership_access_requests
        as req
    where req.id =
            p_request_id
      and req.club_id =
            p_club_id
      and req.status =
            'pending'
    for update;

    if not found then
        raise exception
            'The pending member access request was not found.';
    end if;

    if not p_approve then
        update public.club_membership_access_requests
        set
            status =
                'rejected',
            resolved_by_membership_id =
                v_operator_membership_id,
            resolved_at =
                now(),
            updated_at =
                now()
        where id =
            v_request.id;

        return true;
    end if;

    v_membership_number :=
        coalesce(
            nullif(
                trim(
                    p_membership_number
                ),
                ''
            ),
            nullif(
                trim(
                    v_request
                        .requested_membership_number
                ),
                ''
            )
        );

    select cm.*
    into v_existing_membership
    from public.club_memberships as cm
    where cm.profile_id =
            v_request.profile_id
      and cm.club_id =
            p_club_id
    for update;

    v_should_be_primary :=
        not exists (
            select 1
            from public.club_memberships
                as other
            where other.profile_id =
                    v_request.profile_id
              and other.status =
                    'active'
              and other.membership_type
                    not in (
                        'visitor',
                        'guest'
                    )
              and (
                    v_existing_membership.id
                        is null
                    or other.id <>
                        v_existing_membership.id
              )
        );

    if v_existing_membership.id is null then
        insert into public.club_memberships (
            profile_id,
            club_id,
            membership_number,
            membership_type,
            status,
            role,
            joined_at,
            is_primary
        )
        values (
            v_request.profile_id,
            p_club_id,
            v_membership_number,
            'member',
            'active',
            'member',
            current_date,
            v_should_be_primary
        );

    elsif v_existing_membership.membership_type
          in (
              'visitor',
              'guest'
          ) then

        update public.club_memberships
        set
            membership_number =
                v_membership_number,
            membership_type =
                'member',
            status =
                'active',
            role =
                'member',
            joined_at =
                coalesce(
                    joined_at,
                    current_date
                ),
            is_primary =
                case
                    when v_should_be_primary
                    then true
                    else is_primary
                end,
            updated_at =
                now()
        where id =
            v_existing_membership.id;

    else
        /*
         * The relationship may already have been converted by a
         * CSV import or another admin action while this request
         * was pending. Preserve its genuine membership type/role
         * and simply ensure it is active.
         */
        update public.club_memberships
        set
            membership_number =
                coalesce(
                    v_membership_number,
                    membership_number
                ),
            status =
                'active',
            joined_at =
                coalesce(
                    joined_at,
                    current_date
                ),
            updated_at =
                now()
        where id =
            v_existing_membership.id;
    end if;

    update public.club_membership_access_requests
    set
        status =
            'approved',
        resolved_by_membership_id =
            v_operator_membership_id,
        resolved_at =
            now(),
        updated_at =
            now()
    where id =
        v_request.id;

    return true;
end;
$$;

revoke all
on function public.admin_resolve_member_access_request(
    uuid,
    uuid,
    boolean,
    text
)
from public, anon;

grant execute
on function public.admin_resolve_member_access_request(
    uuid,
    uuid,
    boolean,
    text
)
to authenticated;


commit;

notify pgrst, 'reload schema';
