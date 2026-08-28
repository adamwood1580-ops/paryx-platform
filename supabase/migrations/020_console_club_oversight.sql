-- =========================================================
-- PARYX MIGRATION 020
-- CONSOLE CLUB OVERSIGHT
--
-- Adds:
--   - full tenant detail/operational overview
--   - safe edit of club name + timezone
--
-- Slug intentionally stays immutable after creation.
-- =========================================================

begin;


-- =========================================================
-- CLUB DETAIL / OPERATIONAL OVERVIEW
-- =========================================================

create or replace function public.platform_get_club_detail(
    p_club_id uuid
)
returns table (
    club_id uuid,
    club_name text,
    club_slug text,
    club_timezone text,
    is_active boolean,
    created_at timestamptz,
    member_count bigint,
    staff_count bigint,
    course_count bigint,
    upcoming_event_count bigint,
    today_tee_time_count bigint,
    today_booking_count bigint,
    today_player_count bigint,
    next_30_day_booking_count bigint,
    renewals_due_90_count bigint,
    pending_access_request_count bigint,
    primary_admin_name text,
    primary_admin_email text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null
       or p_club_id is null
       or not public.is_platform_user(null) then
        raise exception
            'Paryx Console access required.';
    end if;

    return query
    select
        c.id,
        c.name::text,
        c.slug::text,
        c.timezone::text,
        c.is_active,
        c.created_at,

        (
            select count(*)
            from public.club_memberships as cm
            where cm.club_id = c.id
              and cm.status = 'active'
              and cm.membership_type not in (
                  'visitor',
                  'guest',
                  'staff'
              )
        )::bigint,

        (
            select count(*)
            from public.club_memberships as cm
            where cm.club_id = c.id
              and cm.status = 'active'
              and cm.role in (
                  'starter',
                  'reception',
                  'professional',
                  'greenkeeper',
                  'manager',
                  'club_admin'
              )
        )::bigint,

        (
            select count(*)
            from public.courses as course
            where course.club_id = c.id
        )::bigint,

        (
            select count(*)
            from public.club_events as ce
            where ce.club_id = c.id
              and ce.event_date >= current_date
              and ce.status <> 'cancelled'
        )::bigint,

        (
            select count(*)
            from public.tee_times as tt
            join public.courses as course
                on course.id = tt.course_id
            where course.club_id = c.id
              and tt.play_date = current_date
        )::bigint,

        (
            select count(*)
            from public.bookings as b
            join public.tee_times as tt
                on tt.id = b.tee_time_id
            join public.courses as course
                on course.id = tt.course_id
            where course.club_id = c.id
              and tt.play_date = current_date
              and b.booking_status = 'active'
        )::bigint,

        coalesce(
            (
                select sum(
                    b.player_count
                )::bigint
                from public.bookings as b
                join public.tee_times as tt
                    on tt.id = b.tee_time_id
                join public.courses as course
                    on course.id = tt.course_id
                where course.club_id = c.id
                  and tt.play_date = current_date
                  and b.booking_status = 'active'
            ),
            0
        )::bigint,

        (
            select count(*)
            from public.bookings as b
            join public.tee_times as tt
                on tt.id = b.tee_time_id
            join public.courses as course
                on course.id = tt.course_id
            where course.club_id = c.id
              and tt.play_date between
                    current_date
                    and current_date + 30
              and b.booking_status = 'active'
        )::bigint,

        (
            select count(*)
            from public.club_memberships as cm
            where cm.club_id = c.id
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
        )::bigint,

        (
            select count(*)
            from public.club_membership_access_requests as req
            where req.club_id = c.id
              and req.status = 'pending'
        )::bigint,

        (
            select
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
                    'Club Admin'
                )::text
            from public.club_memberships as cm
            join public.profiles as p
                on p.id = cm.profile_id
            left join auth.users as au
                on au.id = cm.profile_id
            where cm.club_id = c.id
              and cm.status = 'active'
              and cm.role = 'club_admin'
            order by cm.created_at asc
            limit 1
        )::text,

        (
            select
                au.email::text
            from public.club_memberships as cm
            join auth.users as au
                on au.id = cm.profile_id
            where cm.club_id = c.id
              and cm.status = 'active'
              and cm.role = 'club_admin'
            order by cm.created_at asc
            limit 1
        )::text

    from public.clubs as c
    where c.id = p_club_id
    limit 1;
end;
$$;

revoke all
on function public.platform_get_club_detail(
    uuid
)
from public, anon;

grant execute
on function public.platform_get_club_detail(
    uuid
)
to authenticated;


-- =========================================================
-- UPDATE BASIC CLUB DETAILS
-- =========================================================

create or replace function public.platform_update_club_details(
    p_club_id uuid,
    p_name text,
    p_timezone text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor_role text;
    v_name text;
    v_timezone text;
    v_old_name text;
    v_old_timezone text;
begin
    if auth.uid() is null
       or p_club_id is null
       or not public.is_platform_user(
            array[
                'platform_owner',
                'platform_admin'
            ]
       ) then
        raise exception
            'Platform Admin or Owner access required.';
    end if;

    v_name :=
        nullif(
            trim(
                coalesce(
                    p_name,
                    ''
                )
            ),
            ''
        );

    v_timezone :=
        nullif(
            trim(
                coalesce(
                    p_timezone,
                    ''
                )
            ),
            ''
        );

    if v_name is null then
        raise exception
            'Club name is required.';
    end if;

    if v_timezone is null
       or not exists (
            select 1
            from pg_catalog.pg_timezone_names as tz
            where tz.name = v_timezone
       ) then
        raise exception
            'Invalid timezone.';
    end if;

    select
        c.name,
        c.timezone
    into
        v_old_name,
        v_old_timezone
    from public.clubs as c
    where c.id = p_club_id
    for update;

    if not found then
        raise exception
            'Club not found.';
    end if;

    select
        pu.role
    into
        v_actor_role
    from public.platform_users as pu
    where pu.user_id = auth.uid()
      and pu.is_active = true
    limit 1;

    update public.clubs
    set
        name = v_name,
        timezone = v_timezone
    where id = p_club_id;

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
        'club_details_updated',
        p_club_id,
        jsonb_build_object(
            'previous',
                jsonb_build_object(
                    'name',
                        v_old_name,
                    'timezone',
                        v_old_timezone
                ),
            'new',
                jsonb_build_object(
                    'name',
                        v_name,
                    'timezone',
                        v_timezone
                )
        )
    );

    return true;
end;
$$;

revoke all
on function public.platform_update_club_details(
    uuid,
    text,
    text
)
from public, anon;

grant execute
on function public.platform_update_club_details(
    uuid,
    text,
    text
)
to authenticated;


commit;

notify pgrst, 'reload schema';
