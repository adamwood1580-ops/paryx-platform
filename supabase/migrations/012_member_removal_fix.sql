-- =========================================================
-- PARYX MIGRATION 012
-- CLUB MEMBER REMOVAL FIX
--
-- Paryx player identities are global. Removing somebody from
-- one club must therefore NOT delete the Auth user or profile.
--
-- The old admin_remove_member() physically deleted the
-- club_memberships row. Historical bookings deliberately hold
-- RESTRICT foreign keys to that membership, so a member who had
-- booked or joined a tee time could not be removed.
--
-- New behaviour:
--   - remove club-member privileges
--   - keep the global Paryx player account
--   - retain the club relationship as an internal visitor record
--     so historical bookings remain valid
--   - hide visitor/guest relationships from ClubHub Members
--   - allow the player to continue using Paryx as a visitor
-- =========================================================

begin;


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
    v_target_is_primary boolean;
    v_active_admin_count bigint;
begin
    if auth.uid() is null
       or p_club_id is null
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
    limit 1;

    select
        cm.profile_id,
        cm.role,
        cm.is_primary,
        au.email::text
    into
        v_target_profile_id,
        v_target_role,
        v_target_is_primary,
        v_target_email
    from public.club_memberships as cm
    join auth.users as au
        on au.id = cm.profile_id
    where cm.id = p_membership_id
      and cm.club_id = p_club_id
      and cm.membership_type not in (
          'visitor',
          'guest'
      )
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

    /*
     * Do not delete this row.
     *
     * Existing booking history may reference the membership using
     * ON DELETE RESTRICT. Downgrading to visitor preserves that
     * history and removes all member/staff privileges at this club.
     */
    update public.club_memberships as cm
    set
        membership_number = null,
        membership_type = 'visitor',
        status = 'active',
        role = 'member',
        joined_at = null,
        is_primary = false,
        updated_at = now()
    where cm.id = p_membership_id
      and cm.club_id = p_club_id;

    /*
     * If the removed club was the player's primary club, promote
     * another genuine active membership where one exists.
     */
    if v_target_is_primary then
        update public.club_memberships as cm
        set
            is_primary = true,
            updated_at = now()
        where cm.id = (
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
-- MEMBER DIRECTORY
--
-- Internal visitor/guest relationships are intentionally not
-- club members and should not appear on ClubHub > Members.
-- =========================================================

create or replace function public.get_admin_members(
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
    v_user_id uuid;
    v_club_id uuid;
    v_limit integer;
    v_offset integer;
    v_search text;
    v_status text;
begin
    v_user_id := auth.uid();

    if v_user_id is null then
        raise exception
            'Admin access required.';
    end if;

    select cm.club_id
    into v_club_id
    from public.club_memberships as cm
    where cm.profile_id = v_user_id
      and cm.status = 'active'
      and cm.role in (
          'manager',
          'club_admin'
      )
    order by
        cm.is_primary desc,
        cm.created_at asc
    limit 1;

    if v_club_id is null then
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
            cm.id as membership_id,
            cm.profile_id,
            au.email::text as email,
            p.first_name,
            p.last_name,
            p.display_name,
            cm.membership_number,
            cm.membership_type,
            cm.status as membership_status,
            cm.role as membership_role,
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
        join auth.users as au
            on au.id =
                cm.profile_id
        left join public.player_handicaps
            as ph
            on ph.profile_id =
                cm.profile_id
        where cm.club_id =
                v_club_id

          /*
           * Visitors are global Paryx players who have interacted
           * with this club, not members of the club.
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
                        au.email,
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
                f.email
            )
        ),
        lower(
            f.email
        )
    limit v_limit
    offset v_offset;
end;
$$;

revoke all
on function public.get_admin_members(
    text,
    text,
    integer,
    integer
)
from public, anon;

grant execute
on function public.get_admin_members(
    text,
    text,
    integer,
    integer
)
to authenticated;

commit;

notify pgrst, 'reload schema';
