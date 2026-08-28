-- =========================================================
-- PARYX MIGRATION 017
-- MEMBERSHIP RENEWALS + IN-APP REMINDERS
--
-- ClubHub:
--   - stores membership renewal date
--   - shows renewals from 90 days before expiry
--
-- Player:
--   - 60-day reminder stage
--   - 30-day reminder stage
--   - expired/not-renewed stage
--
-- Reminders are calculated from the current renewal date.
-- When a club updates the renewal date after renewal, the old
-- reminder disappears automatically.
-- =========================================================

begin;


-- =========================================================
-- RENEWAL DATE
-- =========================================================

alter table public.club_memberships
    add column if not exists renewal_date date;

create index if not exists
    club_memberships_club_renewal_date_idx
on public.club_memberships (
    club_id,
    renewal_date
)
where renewal_date is not null;


-- =========================================================
-- MEMBER DIRECTORY
-- Adds renewal_date to the existing ClubHub directory.
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
    renewal_date date,
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
            cm.renewal_date,
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
        f.renewal_date,
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
-- UPDATE MEMBER DETAILS
-- Adds renewal date to the controlled ClubHub edit.
-- =========================================================

drop function if exists public.admin_update_member_details(
    uuid,
    uuid,
    text,
    text,
    text,
    date
);

create function public.admin_update_member_details(
    p_club_id uuid,
    p_membership_id uuid,
    p_membership_number text,
    p_membership_type text,
    p_status text,
    p_joined_at date,
    p_renewal_date date
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
        renewal_date =
            p_renewal_date,
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
    date,
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
    date,
    date
)
to authenticated;


-- =========================================================
-- CLUBHUB 90-DAY RENEWAL REMINDERS
-- =========================================================

create or replace function public.admin_get_membership_renewals(
    p_club_id uuid
)
returns table (
    membership_id uuid,
    profile_id uuid,
    display_name text,
    email text,
    membership_number text,
    membership_type text,
    membership_status text,
    renewal_date date,
    days_remaining integer,
    notice_level text
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
            'Admin access required.';
    end if;

    return query
    select
        cm.id,
        cm.profile_id,
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
            au.email::text,
            'Member'
        )::text,
        au.email::text,
        cm.membership_number,
        cm.membership_type,
        cm.status,
        cm.renewal_date,
        (
            cm.renewal_date -
            current_date
        )::integer,
        case
            when cm.renewal_date < current_date
                then 'overdue'
            when cm.renewal_date <= current_date + 30
                then '30_day'
            when cm.renewal_date <= current_date + 60
                then '60_day'
            else '90_day'
        end::text
    from public.club_memberships as cm
    join public.profiles as p
        on p.id = cm.profile_id
    left join auth.users as au
        on au.id = cm.profile_id
    where cm.club_id = p_club_id
      and cm.membership_type not in (
          'visitor',
          'guest',
          'staff'
      )
      and cm.status in (
          'active',
          'suspended',
          'expired'
      )
      and cm.renewal_date is not null
      and cm.renewal_date <=
          current_date + 90
    order by
        cm.renewal_date asc,
        lower(
            coalesce(
                p.display_name,
                p.last_name,
                p.first_name,
                au.email::text,
                ''
            )
        );
end;
$$;

revoke all
on function public.admin_get_membership_renewals(
    uuid
)
from public, anon;

grant execute
on function public.admin_get_membership_renewals(
    uuid
)
to authenticated;


-- =========================================================
-- PLAYER RENEWAL NOTICES
--
-- A player sees:
--   31-60 days -> 60-day reminder stage
--    0-30 days -> 30-day reminder stage
--       overdue -> expired/not-renewed notice
--
-- Updating the renewal date after payment immediately clears
-- the old reminder and starts the next annual cycle.
-- =========================================================

create or replace function public.member_get_membership_renewal_notices()
returns table (
    club_id uuid,
    club_name text,
    membership_id uuid,
    membership_number text,
    renewal_date date,
    days_remaining integer,
    notice_level text
)
language sql
stable
security definer
set search_path = ''
as $$
    select
        c.id as club_id,
        c.name::text as club_name,
        cm.id as membership_id,
        cm.membership_number,
        cm.renewal_date,
        (
            cm.renewal_date -
            current_date
        )::integer as days_remaining,
        case
            when cm.renewal_date < current_date
                then 'expired'
            when cm.renewal_date <= current_date + 30
                then '30_day'
            else '60_day'
        end::text as notice_level
    from public.club_memberships as cm
    join public.clubs as c
        on c.id = cm.club_id
    where auth.uid() is not null
      and cm.profile_id = auth.uid()
      and cm.membership_type not in (
          'visitor',
          'guest',
          'staff'
      )
      and cm.status in (
          'active',
          'suspended',
          'expired'
      )
      and cm.renewal_date is not null
      and cm.renewal_date <=
          current_date + 60
    order by
        cm.renewal_date asc,
        c.name asc;
$$;

revoke all
on function public.member_get_membership_renewal_notices()
from public, anon;

grant execute
on function public.member_get_membership_renewal_notices()
to authenticated;


commit;

notify pgrst, 'reload schema';
