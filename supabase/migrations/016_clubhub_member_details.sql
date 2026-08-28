-- =========================================================
-- PARYX MIGRATION 016
-- CLUBHUB MEMBER DETAILS
--
-- Adds controlled editing of club-specific member data and
-- cleans pure staff relationships out of the Members directory.
--
-- Global player identity fields are intentionally NOT editable
-- here because one Paryx account can belong to multiple clubs.
-- =========================================================

begin;


-- =========================================================
-- MEMBER DIRECTORY
-- Pure staff / visitor / guest relationships are not members.
-- Genuine members who also have a staff ROLE still remain here
-- because their membership_type is member/junior/etc.
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
            ph.verification_status as handicap_status,
            cm.created_at as member_created_at
        from public.club_memberships as cm
        join public.profiles as p
            on p.id = cm.profile_id
        left join auth.users as au
            on au.id = cm.profile_id
        left join public.player_handicaps as ph
            on ph.profile_id = cm.profile_id
        where cm.club_id = p_club_id
          and cm.membership_type not in (
              'visitor',
              'guest',
              'staff'
          )
          and (
              v_status is null
              or cm.status = v_status
          )
          and (
              v_search is null
              or lower(
                    coalesce(
                        au.email::text,
                        ''
                    )
                 ) like
                    '%' || v_search || '%'
              or lower(
                    coalesce(
                        p.first_name,
                        ''
                    )
                 ) like
                    '%' || v_search || '%'
              or lower(
                    coalesce(
                        p.last_name,
                        ''
                    )
                 ) like
                    '%' || v_search || '%'
              or lower(
                    coalesce(
                        p.display_name,
                        ''
                    )
                 ) like
                    '%' || v_search || '%'
              or lower(
                    coalesce(
                        cm.membership_number,
                        ''
                    )
                 ) like
                    '%' || v_search || '%'
          )
    ),
    counted as (
        select count(*)::bigint
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


-- =========================================================
-- UPDATE CLUB-SPECIFIC MEMBER DETAILS
-- =========================================================

create or replace function public.admin_update_member_details(
    p_club_id uuid,
    p_membership_id uuid,
    p_membership_number text,
    p_membership_type text,
    p_status text,
    p_joined_at date
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor_role text;
    v_target
        public.club_memberships%rowtype;
    v_type text;
    v_status text;
begin
    if auth.uid() is null
       or p_club_id is null
       or p_membership_id is null then
        raise exception
            'Admin access required.';
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

    if v_actor_role is null then
        raise exception
            'Admin access required.';
    end if;

    select cm.*
    into v_target
    from public.club_memberships as cm
    where cm.id = p_membership_id
      and cm.club_id = p_club_id
    for update;

    if not found then
        raise exception
            'Member not found.';
    end if;

    if v_target.membership_type in (
        'visitor',
        'guest',
        'staff'
    ) then
        raise exception
            'This relationship is not a club member record.';
    end if;

    if (
        v_target.role = 'club_admin'
        and v_actor_role <> 'club_admin'
    ) then
        raise exception
            'Only a Club Admin can edit another Club Admin membership.';
    end if;

    v_type :=
        lower(
            trim(
                coalesce(
                    p_membership_type,
                    ''
                )
            )
        );

    if v_type not in (
        'member',
        'junior',
        'student',
        'social',
        'corporate'
    ) then
        raise exception
            'Invalid membership type.';
    end if;

    v_status :=
        lower(
            trim(
                coalesce(
                    p_status,
                    ''
                )
            )
        );

    if v_status not in (
        'invited',
        'pending',
        'active',
        'suspended',
        'expired',
        'cancelled'
    ) then
        raise exception
            'Invalid membership status.';
    end if;

    if (
        v_target.profile_id = auth.uid()
        and v_status <> v_target.status
        and v_status <> 'active'
    ) then
        raise exception
            'You cannot deactivate your own ClubHub membership.';
    end if;

    update public.club_memberships
    set
        membership_number =
            nullif(
                trim(
                    coalesce(
                        p_membership_number,
                        ''
                    )
                ),
                ''
            ),
        membership_type =
            v_type,
        status =
            v_status,
        joined_at =
            case
                when v_status = 'active'
                then coalesce(
                    p_joined_at,
                    joined_at,
                    current_date
                )
                else p_joined_at
            end,
        updated_at =
            now()
    where id =
        p_membership_id;

    return true;
end;
$$;

revoke all
on function public.admin_update_member_details(
    uuid,
    uuid,
    text,
    text,
    text,
    date
)
from public, anon;

grant execute
on function public.admin_update_member_details(
    uuid,
    uuid,
    text,
    text,
    text,
    date
)
to authenticated;


commit;

notify pgrst, 'reload schema';
