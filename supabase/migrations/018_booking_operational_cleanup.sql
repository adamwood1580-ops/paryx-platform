-- =========================================================
-- PARYX MIGRATION 018
-- BOOKING V3 — TEE SHEET OPERATIONAL CLEANUP
--
-- Adds:
--   - staff check-in audit for a booking
--   - booking source/contact/check-in on staff tee sheet
--   - genuine-member-only staff booking search
--
-- Frontend also prevents selecting visibly past empty tee times
-- and filters past destinations from the Move Booking list.
-- =========================================================

begin;


-- =========================================================
-- BOOKING CHECK-IN AUDIT
-- =========================================================

alter table public.bookings
    add column if not exists staff_checked_in_at timestamptz;

alter table public.bookings
    add column if not exists staff_checked_in_by_membership_id uuid
        references public.club_memberships(id)
        on delete set null;

create index if not exists
    bookings_staff_checked_in_at_idx
on public.bookings (
    staff_checked_in_at
)
where staff_checked_in_at is not null;


-- =========================================================
-- STAFF CHECK-IN / UNDO CHECK-IN
-- =========================================================

create or replace function public.staff_set_booking_check_in(
    p_club_id uuid,
    p_booking_id uuid,
    p_checked_in boolean
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_operator_membership_id uuid;
    v_booking public.bookings%rowtype;
    v_play_date date;
    v_checked_in_at timestamptz;
begin
    if auth.uid() is null
       or p_club_id is null
       or p_booking_id is null
       or p_checked_in is null
       or not public.user_can_operate_tee_sheet(
            p_club_id
       ) then
        raise exception
            'Tee sheet access required.';
    end if;

    v_operator_membership_id :=
        public.tee_sheet_operator_membership_id(
            p_club_id
        );

    if v_operator_membership_id is null then
        raise exception
            'Tee sheet access required.';
    end if;

    select
        b.*
    into
        v_booking
    from public.bookings as b
    join public.tee_times as tt
        on tt.id = b.tee_time_id
    join public.courses as c
        on c.id = tt.course_id
    where b.id = p_booking_id
      and c.club_id = p_club_id
    for update of b;

    if not found then
        raise exception
            'The selected booking was not found.';
    end if;

    select
        tt.play_date
    into
        v_play_date
    from public.tee_times as tt
    where tt.id = v_booking.tee_time_id;

    if v_booking.booking_status <> 'active' then
        raise exception
            'Only active bookings can be checked in.';
    end if;

    if v_play_date > current_date then
        raise exception
            'Future bookings cannot be checked in.';
    end if;

    if p_checked_in then
        v_checked_in_at := now();

        update public.bookings
        set
            staff_checked_in_at =
                v_checked_in_at,
            staff_checked_in_by_membership_id =
                v_operator_membership_id
        where id = p_booking_id;
    else
        v_checked_in_at := null;

        update public.bookings
        set
            staff_checked_in_at =
                null,
            staff_checked_in_by_membership_id =
                null
        where id = p_booking_id;
    end if;

    return v_checked_in_at;
end;
$$;

revoke all
on function public.staff_set_booking_check_in(
    uuid,
    uuid,
    boolean
)
from public, anon;

grant execute
on function public.staff_set_booking_check_in(
    uuid,
    uuid,
    boolean
)
to authenticated;


-- =========================================================
-- GENUINE MEMBER SEARCH
--
-- Visitor/guest/staff-only relationships must not appear under
-- "Find member". A genuine member who is also staff still does,
-- because their membership_type remains a real member type.
-- =========================================================

create or replace function public.staff_search_booking_members(
    p_club_id uuid,
    p_search text default null,
    p_limit integer default 20
)
returns table (
    membership_id uuid,
    profile_id uuid,
    display_name text,
    email text,
    membership_number text,
    membership_type text,
    membership_role text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_search text :=
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

    v_limit integer :=
        greatest(
            1,
            least(
                coalesce(
                    p_limit,
                    20
                ),
                50
            )
        );
begin
    if auth.uid() is null
       or p_club_id is null
       or not public.user_can_operate_tee_sheet(
            p_club_id
       ) then
        raise exception
            'Tee sheet access required.';
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
            nullif(
                trim(
                    au.email::text
                ),
                ''
            ),
            'Member'
        )::text,
        au.email::text,
        cm.membership_number,
        cm.membership_type,
        cm.role
    from public.club_memberships as cm
    join public.profiles as p
        on p.id = cm.profile_id
    left join auth.users as au
        on au.id = cm.profile_id
    where cm.club_id = p_club_id
      and cm.status = 'active'
      and cm.membership_type not in (
          'visitor',
          'guest',
          'staff'
      )
      and (
          v_search is null
          or lower(
                coalesce(
                    p.display_name,
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
                    au.email::text,
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
    order by
        lower(
            coalesce(
                nullif(
                    trim(
                        p.display_name
                    ),
                    ''
                ),
                nullif(
                    trim(
                        p.last_name
                    ),
                    ''
                ),
                nullif(
                    trim(
                        p.first_name
                    ),
                    ''
                ),
                au.email::text,
                'member'
            )
        ),
        cm.id
    limit v_limit;
end;
$$;

revoke all
on function public.staff_search_booking_members(
    uuid,
    text,
    integer
)
from public, anon;

grant execute
on function public.staff_search_booking_members(
    uuid,
    text,
    integer
)
to authenticated;


-- =========================================================
-- STAFF TEE SHEET
-- Adds operational fields used by ClubHub:
--   contact_number
--   staff_checked_in_at
--   booking_source
-- =========================================================

drop function if exists public.staff_get_tee_sheet(
    uuid,
    uuid,
    date
);

create function public.staff_get_tee_sheet(
    p_club_id uuid,
    p_course_id uuid,
    p_play_date date
)
returns table (
    tee_time_id uuid,
    start_time time,
    max_players smallint,
    operational_status text,
    tee_time_notes text,
    club_event_id uuid,
    event_title text,
    event_section text,
    event_type text,
    booking_id uuid,
    booking_type text,
    booking_status text,
    player_count smallint,
    lead_name text,
    booking_notes text,
    player_names text[],
    contact_number text,
    staff_checked_in_at timestamptz,
    booking_source text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null
       or p_club_id is null
       or p_course_id is null
       or p_play_date is null
       or not public.user_can_operate_tee_sheet(
            p_club_id
       ) then
        raise exception
            'Tee sheet access required.';
    end if;

    if not exists (
        select 1
        from public.courses as c
        where c.id = p_course_id
          and c.club_id = p_club_id
    ) then
        raise exception
            'The selected course is not available at this club.';
    end if;

    return query
    select
        tt.id,
        tt.start_time,
        tt.max_players,
        tt.operational_status,
        tt.notes,
        ce.id,
        ce.title,
        ce.section,
        ce.event_type,
        b.id,
        b.booking_type,
        b.booking_status,
        b.player_count,
        b.lead_name,
        b.notes,
        coalesce(
            (
                select array_agg(
                    players.name
                    order by players.position
                )
                from (
                    select
                        bm.position,
                        (
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
                                'Member'
                            )
                        )::text as name
                    from public.booking_members as bm
                    join public.club_memberships as cm
                        on cm.id = bm.membership_id
                    join public.profiles as p
                        on p.id = cm.profile_id
                    where bm.booking_id = b.id
                      and bm.member_status in (
                          'invited',
                          'confirmed',
                          'checked_in'
                      )

                    union all

                    select
                        bg.position,
                        (
                            bg.guest_name
                            || ' (Guest)'
                        )::text
                    from public.booking_guests as bg
                    where bg.booking_id = b.id
                ) as players
            ),
            array[]::text[]
        ),
        b.contact_number,
        b.staff_checked_in_at,
        case
            when b.staff_created_by_membership_id is not null
                then 'staff'
            when b.id is not null
                then 'player'
            else null
        end::text
    from public.tee_times as tt
    left join public.club_events as ce
        on ce.id = tt.club_event_id
    left join public.bookings as b
        on b.tee_time_id = tt.id
       and b.booking_status = 'active'
    where tt.course_id = p_course_id
      and tt.play_date = p_play_date
    order by
        tt.start_time;
end;
$$;

revoke all
on function public.staff_get_tee_sheet(
    uuid,
    uuid,
    date
)
from public, anon;

grant execute
on function public.staff_get_tee_sheet(
    uuid,
    uuid,
    date
)
to authenticated;


commit;

notify pgrst, 'reload schema';
