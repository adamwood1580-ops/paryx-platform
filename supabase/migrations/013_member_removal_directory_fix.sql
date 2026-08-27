-- =========================================================
-- PARYX MIGRATION 013
-- MEMBER REMOVAL / DIRECTORY FIX V2
--
-- Corrects the ClubHub member-directory overload actually used
-- by the current frontend:
--
-- get_admin_members(
--   p_club_id,
--   p_search,
--   p_status,
--   p_limit,
--   p_offset
-- )
--
-- Migration 012 updated the older 4-argument overload, so an
-- internal visitor relationship could still remain visible in
-- ClubHub after "Remove from club".
-- =========================================================

begin;


-- =========================================================
-- REMOVE FROM CLUB
--
-- Idempotent: if the relationship has already been downgraded
-- to visitor, return success rather than "Club member not found".
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
    v_target_is_primary boolean;
    v_target_type text;
    v_active_admin_count bigint;
begin
    if auth.uid() is null
       or p_club_id is null
       or p_membership_id is null
       or not public.user_can_manage_club(
            p_club_id
       ) then
        raise exception
            'Club management access required.';
    end if;

    select cm.role
    into v_actor_role
    from public.club_memberships as cm
    where cm.profile_id = auth.uid()
      and cm.club_id = p_club_id
      and cm.status = 'active'
      and cm.role in (
          'manager',
          'club_admin'
      )
    order by
        cm.is_primary desc,
        cm.created_at asc
    limit 1;

    if v_actor_role is null then
        raise exception
            'Club management access required.';
    end if;

    select
        cm.profile_id,
        cm.role,
        cm.is_primary,
        cm.membership_type,
        au.email::text
    into
        v_target_profile_id,
        v_target_role,
        v_target_is_primary,
        v_target_type,
        v_target_email
    from public.club_memberships as cm
    left join auth.users as au
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

    /*
     * If migration 012 already performed the downgrade,
     * treat a repeat call as success.
     */
    if v_target_type in (
        'visitor',
        'guest'
    ) then
        return query
        select
            p_membership_id,
            v_target_profile_id,
            v_target_email;

        return;
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
          and cm.role = 'club_admin'
          and cm.membership_type not in (
              'visitor',
              'guest'
          );

        if v_active_admin_count <= 1 then
            raise exception
                'The club must retain at least one active Club Admin.';
        end if;
    end if;

    /*
     * Preserve historical booking references. The global Paryx
     * account stays intact; only this club's member entitlement
     * is removed.
     */
    update public.club_memberships
    set
        membership_number = null,
        membership_type = 'visitor',
        status = 'active',
        role = 'member',
        joined_at = null,
        is_primary = false,
        updated_at = now()
    where id = p_membership_id
      and club_id = p_club_id;

    if v_target_is_primary then
        update public.club_memberships
        set
            is_primary = true,
            updated_at = now()
        where id = (
            select candidate.id
            from public.club_memberships as candidate
            where candidate.profile_id =
                    v_target_profile_id
              and candidate.id <>
                    p_membership_id
              and candidate.status =
                    'active'
              and candidate.membership_type
                    not in (
                        'visitor',
                        'guest'
                    )
            order by
                candidate.created_at asc
            limit 1
        );
    end if;

    return query
    select
        p_membership_id,
        v_target_profile_id,
        v_target_email;
end;
$$;

revoke all
on function public.admin_remove_member(
    uuid,
    uuid
)
from public, anon;

grant execute
on function public.admin_remove_member(
    uuid,
    uuid
)
to authenticated;


-- =========================================================
-- CURRENT CLUBHUB MEMBER DIRECTORY OVERLOAD
--
-- The live ClubHub frontend sends p_club_id. This is the
-- overload that must exclude visitor/guest relationships.
-- =========================================================

drop function if exists public.get_admin_members(
    uuid,
    text,
    text,
    integer,
    integer
);

create function public.get_admin_members(
    p_club_id uuid,
    p_search text default null,
    p_status text default null,
    p_limit integer default 50,
    p_offset integer default 0
)
returns table (
    membership_id uuid,
    profile_id uuid,
    email text,
    first_name text,
    last_name text,
    display_name text,
    membership_number text,
    membership_type text,
    membership_status text,
    membership_role text,
    joined_at date,
    is_primary boolean,
    handicap_index numeric,
    handicap_status text,
    member_created_at timestamptz,
    total_count bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_limit integer;
    v_offset integer;
    v_search text;
    v_status text;
begin
    if auth.uid() is null
       or p_club_id is null
       or not public.user_can_manage_club(
            p_club_id
       ) then
        raise exception
            'Admin access required.';
    end if;

    v_limit :=
        greatest(
            1,
            least(
                coalesce(
                    p_limit,
                    50
                ),
                100
            )
        );

    v_offset :=
        greatest(
            0,
            coalesce(
                p_offset,
                0
            )
        );

    v_search :=
        nullif(
            lower(
                trim(
                    coalesce(
                        p_search,
                        ''
                    )
                )
            ),
            ''
        );

    v_status :=
        nullif(
            lower(
                trim(
                    coalesce(
                        p_status,
                        ''
                    )
                )
            ),
            ''
        );

    if v_status = 'all' then
        v_status := null;
    end if;

    return query
    with filtered as (
        select
            cm.id
                as membership_id,
            cm.profile_id,
            au.email::text
                as email,
            p.first_name,
            p.last_name,
            p.display_name,
            cm.membership_number,
            cm.membership_type,
            cm.status
                as membership_status,
            cm.role
                as membership_role,
            cm.joined_at,
            cm.is_primary,
            ph.handicap_index,
            ph.verification_status
                as handicap_status,
            cm.created_at
                as member_created_at
        from public.club_memberships
            as cm
        join public.profiles as p
            on p.id =
                cm.profile_id
        left join auth.users as au
            on au.id =
                cm.profile_id
        left join public.player_handicaps
            as ph
            on ph.profile_id =
                cm.profile_id
        where cm.club_id =
                p_club_id

          /*
           * These are internal Paryx access relationships,
           * not ClubHub member-directory entries.
           */
          and cm.membership_type
                not in (
                    'visitor',
                    'guest'
                )

          and (
              v_status is null
              or cm.status =
                    v_status
          )

          and (
              v_search is null

              or lower(
                    coalesce(
                        au.email::text,
                        ''
                    )
                 ) like
                    '%' ||
                    v_search ||
                    '%'

              or lower(
                    coalesce(
                        p.first_name,
                        ''
                    )
                 ) like
                    '%' ||
                    v_search ||
                    '%'

              or lower(
                    coalesce(
                        p.last_name,
                        ''
                    )
                 ) like
                    '%' ||
                    v_search ||
                    '%'

              or lower(
                    coalesce(
                        p.display_name,
                        ''
                    )
                 ) like
                    '%' ||
                    v_search ||
                    '%'

              or lower(
                    coalesce(
                        cm.membership_number,
                        ''
                    )
                 ) like
                    '%' ||
                    v_search ||
                    '%'
          )
    ),
    counted as (
        select
            count(*)::bigint
                as total_count
        from filtered
    )
    select
        f.membership_id,
        f.profile_id,
        f.email,
        f.first_name,
        f.last_name,
        f.display_name,
        f.membership_number,
        f.membership_type,
        f.membership_status,
        f.membership_role,
        f.joined_at,
        f.is_primary,
        f.handicap_index,
        f.handicap_status,
        f.member_created_at,
        c.total_count
    from filtered as f
    cross join counted as c
    order by
        lower(
            coalesce(
                nullif(
                    trim(
                        f.display_name
                    ),
                    ''
                ),
                nullif(
                    trim(
                        f.last_name
                    ),
                    ''
                ),
                nullif(
                    trim(
                        f.first_name
                    ),
                    ''
                ),
                f.email,
                ''
            )
        ),
        f.membership_id
    limit v_limit
    offset v_offset;
end;
$$;

revoke all
on function public.get_admin_members(
    uuid,
    text,
    text,
    integer,
    integer
)
from public, anon;

grant execute
on function public.get_admin_members(
    uuid,
    text,
    text,
    integer,
    integer
)
to authenticated;


/*
 * Remove the obsolete 4-argument overload introduced by
 * migration 012 so PostgREST only exposes the intended
 * tenant-safe ClubHub function.
 */
drop function if exists public.get_admin_members(
    text,
    text,
    integer,
    integer
);


commit;

notify pgrst, 'reload schema';
