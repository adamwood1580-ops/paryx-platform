-- Paryx Hotel Mode - Phase 2: central booking policy and automatic release.
-- REQUIRES migration 055 (Console configuration) to be installed first.
-- Safe to run only in staging until tested with the live club's tee sheet.
-- Uses virtual allocations across each course/day's generated tee-time schedule.
-- A confirmed booking is NEVER automatically removed or moved.
-- Role access and mode toggles remain EXCLUSIVELY managed in Paryx Console.
-- Do not enable Hotel Mode on a production club until regression tests pass.
begin;

-- A deterministic spread of protected slots, ordered by tee start time.
-- E.g. 30% hotel + 20% member: approximately every 3rd hotel, every 5th member.
-- The calculation is based on *all generated tee times* (including closed ones)
-- to avoid shifting position when an individual slot is marked closed.
-- New/deleted tee times and configuration edits can change the virtual allocation
-- of UNBOOKED slots. Existing confirmed bookings are not changed.
create or replace function public.hotel_mode_slot_class(p_tee_time_id uuid)
returns text
language plpgsql stable security definer set search_path = ''
as $$
declare
    v_course_id uuid;
    v_play_date date;
    v_start_time time;
    v_enabled boolean;
    v_h integer;
    v_m integer;
    v_rank bigint;
    v_nonhotel_rank bigint;
begin
    select t.course_id, t.play_date, t.start_time,
           coalesce(s.enabled,false),
           coalesce(s.hotel_allocation_percent,0),
           coalesce(s.member_allocation_percent,0)
    into v_course_id, v_play_date, v_start_time, v_enabled, v_h, v_m
    from public.tee_times t
    join public.courses c on c.id = t.course_id
    left join public.hotel_mode_settings s on s.club_id = c.club_id
    where t.id = p_tee_time_id;

    if not found or not v_enabled then return 'general'; end if;

    select count(*) into v_rank
    from public.tee_times tt
    where tt.course_id = v_course_id and tt.play_date = v_play_date
      and tt.start_time <= v_start_time;

    if floor(v_rank * v_h::numeric / 100) >
       floor((v_rank-1) * v_h::numeric / 100) then
        return 'hotel';
    end if;

    -- Choose member slots from the slots NOT already classified as hotel,
    -- avoiding overlap and preserving the intended split (e.g. 30/20/50).
    v_nonhotel_rank := v_rank - floor(v_rank * v_h::numeric / 100)::bigint;
    if v_m > 0 and
       floor(v_nonhotel_rank * v_m::numeric / (100-v_h)) >
       floor((v_nonhotel_rank-1) * v_m::numeric / (100-v_h)) then
        return 'member';
    end if;
    return 'general';
end;
$$;
revoke all on function public.hotel_mode_slot_class(uuid) from public, anon;
grant execute on function public.hotel_mode_slot_class(uuid) to authenticated;

-- Query-time release: no cron job or time-based database updates are needed.
-- Existing platform/club validation and operational-status checks still apply.
create or replace function public.hotel_mode_can_book(
    p_tee_time_id uuid, p_audience text default 'auto'
)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
    v_club_id uuid;
    v_play_date date;
    v_start_time time;
    v_timezone text;
    v_local_now timestamp;
    v_days integer;
    v_slot text;
    v_audience text := p_audience;
    v_window integer;
    v_cfg public.hotel_mode_settings%rowtype;
    v_public_max integer;
    v_request_path text := lower(coalesce(current_setting('request.path',true),''));
begin
    -- An unknown tee time must not be considered bookable.
    select c.club_id, tt.play_date, tt.start_time,
           coalesce(nullif(trim(club.timezone),''),'Europe/London'),
           coalesce(cs.public_booking_advance_days,14)
    into v_club_id,v_play_date,v_start_time,v_timezone,v_public_max
    from public.tee_times tt
    join public.courses c on c.id = tt.course_id
    join public.clubs club on club.id = c.club_id and club.is_active
    left join public.club_settings cs on cs.club_id = club.id
    where tt.id = p_tee_time_id and c.is_active;

    if not found then return false; end if;

    select * into v_cfg from public.hotel_mode_settings
    where club_id = v_club_id;
    if not found or not v_cfg.enabled then return true; end if;

    v_local_now := now() at time zone v_timezone;
    v_days := v_play_date - v_local_now::date;
    if v_days < 0 or
       (v_days = 0 and v_start_time <= v_local_now::time) then
        return false;
    end if;

    -- 'auto' is the only option intended for untrusted booking clients.
    -- Supplying 'staff' cannot create staff permissions: those are checked
    -- against real active club staff membership and Console-owned role rules.
    if v_audience not in ('auto','staff','member','visitor') then
        return false;
    end if;

    if v_audience = 'auto' then
        -- A signed-in staff member is NOT automatically a hotel-booking agent
        -- when they book from the Player app or public visitor widget.
        -- Only the protected ClubHub staff booking RPCs can use staff access.
        if v_request_path like '%public_booking_widget_create_guest%' then
            v_audience := 'visitor';
        elsif (v_request_path like '%staff_create_booking%' or
               v_request_path like '%staff_update_booking%' or
               v_request_path like '%staff_move_booking%' or
               v_request_path like '%staff_replace_booking_players%')
              and auth.uid() is not null
              and public.user_can_operate_tee_sheet(v_club_id) then
            v_audience := 'staff';
        elsif auth.uid() is not null and public.member_is_linked_club_member(v_club_id) then
            v_audience := 'member';
        else
            v_audience := 'visitor';
        end if;
    elsif v_audience = 'staff' and
          (auth.uid() is null or not public.user_can_operate_tee_sheet(v_club_id)) then
        return false;
    elsif v_audience = 'member' and
          (auth.uid() is null or not public.member_is_linked_club_member(v_club_id)) then
        return false;
    end if;

    case v_audience
        when 'staff' then
            -- Staff may handle advance reservations on available general inventory.
            -- Future society-specific inventory is reserved for Phase 3.
            v_window := greatest(v_cfg.hotel_booking_days,v_cfg.society_booking_days);
        when 'member' then v_window := v_cfg.member_booking_days;
        else v_window := least(v_cfg.visitor_booking_days,v_public_max);
    end case;
    if v_days > v_window then return false; end if;

    v_slot := public.hotel_mode_slot_class(p_tee_time_id);
    if v_slot = 'hotel' and v_days > v_cfg.hotel_release_days then
        return v_audience = 'staff' and public.hotel_mode_staff_can(v_club_id,'hotel');
    end if;
    if v_slot = 'member' and v_days > v_cfg.member_release_days then
        return v_audience in ('member','staff');
    end if;
    return true;
end;
$$;
revoke all on function public.hotel_mode_can_book(uuid,text) from public;
grant execute on function public.hotel_mode_can_book(uuid,text) to authenticated, anon;

-- Make the Player date selector reflect the Console-owned club booking window.
-- Returns a number of calendar dates INCLUDING today (max 366).
create or replace function public.hotel_mode_player_visible_days(p_club_id uuid)
returns integer
language plpgsql stable security definer set search_path = ''
as $$
declare
    v_enabled boolean;
    v_member_days integer;
    v_visitor_days integer;
begin
    if auth.uid() is null then
        raise exception 'You must be signed in.';
    end if;
    select coalesce(h.enabled,false),
           coalesce(h.member_booking_days,14),
           least(coalesce(h.visitor_booking_days,7),
                 coalesce(cs.public_booking_advance_days,14))
    into v_enabled,v_member_days,v_visitor_days
    from public.clubs c
    left join public.hotel_mode_settings h on h.club_id = c.id
    left join public.club_settings cs on cs.club_id = c.id
    where c.id = p_club_id and c.is_active;
    if not found or not v_enabled then return 14; end if;
    if public.member_is_linked_club_member(p_club_id) then
        return least(v_member_days+1,366);
    end if;
    return least(v_visitor_days+1,366);
end;
$$;
revoke all on function public.hotel_mode_player_visible_days(uuid) from public, anon;
grant execute on function public.hotel_mode_player_visible_days(uuid) to authenticated;

-- ASSERT for all write pathways. This runs inside the booking transaction.
-- Protects direct create_booking(), staff_create_booking(), member_create_booking(),
-- public_booking_widget_create_guest(), joins, and future booking clients.
create or replace function public.hotel_mode_assert_booking_allowed(p_tee_time_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
    if not public.hotel_mode_can_book(p_tee_time_id, 'auto') then
        raise exception using
            errcode = 'P0001',
            message = 'This tee time is not available within your booking window or priority allocation.';
    end if;
end;
$$;
revoke all on function public.hotel_mode_assert_booking_allowed(uuid) from public, anon, authenticated;

-- Booking creation/movement guard. Normal edits of a pre-existing confirmed
-- booking do not re-evaluate the slot's current protection (grandfathering).
create or replace function public.hotel_mode_guard_booking_write()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
    if new.booking_status <> 'active' then return new; end if;
    if tg_op = 'INSERT' then
        perform public.hotel_mode_assert_booking_allowed(new.tee_time_id);
    elsif old.booking_status <> 'active' or
          old.tee_time_id is distinct from new.tee_time_id then
        perform public.hotel_mode_assert_booking_allowed(new.tee_time_id);
    end if;
    return new;
end;
$$;
revoke all on function public.hotel_mode_guard_booking_write() from public, anon, authenticated;
drop trigger if exists hotel_mode_guard_booking_write on public.bookings;
create trigger hotel_mode_guard_booking_write
before insert or update on public.bookings
for each row execute function public.hotel_mode_guard_booking_write();

-- A join adds capacity to an existing booking. Check separately so adding a
-- guest to an old joinable booking can't evade hotel/member priority rules.
create or replace function public.hotel_mode_guard_member_join()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
    v_tee_time_id uuid;
begin
    if tg_op = 'INSERT' or (
        tg_op = 'UPDATE' and
        (old.booking_id is distinct from new.booking_id or
         old.membership_id is distinct from new.membership_id or
         old.party_size is distinct from new.party_size)
    ) then
        select b.tee_time_id into v_tee_time_id
        from public.bookings b where b.id = new.booking_id
          and b.booking_status = 'active';
        if v_tee_time_id is not null then
            perform public.hotel_mode_assert_booking_allowed(v_tee_time_id);
        end if;
    end if;
    return new;
end;
$$;
revoke all on function public.hotel_mode_guard_member_join() from public, anon, authenticated;
drop trigger if exists hotel_mode_guard_member_join on public.booking_members;
create trigger hotel_mode_guard_member_join
before insert or update on public.booking_members
for each row execute function public.hotel_mode_guard_member_join();

create or replace function public.hotel_mode_guard_guest_join()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
    v_tee_time_id uuid;
begin
    if tg_op = 'INSERT' or (
        tg_op = 'UPDATE' and
        (old.booking_id is distinct from new.booking_id or
         old.public_guest_party_id is distinct from new.public_guest_party_id)
    ) then
        select b.tee_time_id into v_tee_time_id
        from public.bookings b where b.id = new.booking_id
          and b.booking_status = 'active';
        if v_tee_time_id is not null then
            perform public.hotel_mode_assert_booking_allowed(v_tee_time_id);
        end if;
    end if;
    return new;
end;
$$;
revoke all on function public.hotel_mode_guard_guest_join() from public, anon, authenticated;
drop trigger if exists hotel_mode_guard_guest_join on public.booking_guests;
create trigger hotel_mode_guard_guest_join
before insert or update on public.booking_guests
for each row execute function public.hotel_mode_guard_guest_join();


-- Reuse the existing Member RPC return structure. Unavailable priority slots
-- are visible only as disabled slots, never as bookable ones.
create or replace function public.member_get_tee_sheet(p_course_id uuid, p_play_date date)
returns table (
    tee_time_id uuid,
    club_id uuid,
    club_name text,
    course_name text,
    play_date date,
    start_time time,
    max_players smallint,
    operational_status text,
    event_title text,
    booking_id uuid,
    booking_type text,
    player_count smallint,
    spaces_remaining smallint,
    player_names text[],
    current_user_role text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null then raise exception 'You must be signed in.'; end if;

    return query
    select
        tt.id,
        club.id,
        club.name,
        course.name,
        tt.play_date,
        tt.start_time,
        tt.max_players,
        case
            when tt.operational_status = 'open'
                 and (b.id is null or b.booking_type = 'joinable')
                 and not public.hotel_mode_can_book(tt.id, 'auto')
            then case public.hotel_mode_slot_class(tt.id)
                when 'hotel' then 'hotel_priority'
                when 'member' then 'member_priority'
                else 'booking_window'
            end
            else tt.operational_status
        end::text,
        ce.title,
        b.id,
        b.booking_type,
        coalesce(b.player_count,0)::smallint,
        greatest(tt.max_players - coalesce(b.player_count,0),0)::smallint,
        case
            when b.id is null then array[]::text[]
            when b.booking_type = 'private'
                 and not exists (
                    select 1
                    from public.booking_members mine
                    join public.club_memberships mycm on mycm.id = mine.membership_id
                    where mine.booking_id = b.id
                      and mine.member_status in ('invited','confirmed','checked_in')
                      and mycm.profile_id = auth.uid()
                 )
            then array[]::text[]
            else coalesce((
                select array_agg(x.name order by x.position)
                from (
                    select bm.position,
                           coalesce(nullif(trim(p.display_name),''), nullif(trim(concat_ws(' ',p.first_name,p.last_name)),''), 'Member')::text as name
                    from public.booking_members bm
                    join public.club_memberships cm on cm.id = bm.membership_id
                    join public.profiles p on p.id = cm.profile_id
                    where bm.booking_id = b.id and bm.member_status in ('invited','confirmed','checked_in')
                    union all
                    select bg.position, 'Guest'::text
                    from public.booking_guests bg
                    where bg.booking_id = b.id
                ) x
            ), array[]::text[])
        end,
        case
            when b.id is null then null
            when exists (
                select 1 from public.club_memberships leadcm
                where leadcm.id = b.created_by_membership_id and leadcm.profile_id = auth.uid()
            ) then 'lead'
            when exists (
                select 1
                from public.booking_members bm
                join public.club_memberships cm on cm.id = bm.membership_id
                where bm.booking_id = b.id
                  and cm.profile_id = auth.uid()
                  and bm.member_status in ('invited','confirmed','checked_in')
            ) then 'joined'
            else null
        end
    from public.tee_times tt
    join public.courses course on course.id = tt.course_id and course.is_active = true
    join public.clubs club on club.id = course.club_id and club.is_active = true
    left join public.club_events ce on ce.id = tt.club_event_id
    left join public.bookings b on b.tee_time_id = tt.id and b.booking_status = 'active'
    where tt.course_id = p_course_id and tt.play_date = p_play_date
    order by tt.start_time;
end;
$$;


revoke all on function public.member_get_tee_sheet(uuid,date) from public, anon;
grant execute on function public.member_get_tee_sheet(uuid,date) to authenticated;

-- Preserve the existing public widget API and its booking window validation.
create or replace function public.public_booking_widget_tee_times(
    p_club_slug text,
    p_course_id uuid,
    p_play_date date
)
returns table (
    tee_time_id uuid,
    course_id uuid,
    play_date date,
    start_time time without time zone,
    max_players smallint,
    spaces_remaining smallint,
    availability text,
    bookable boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_club_id uuid;
    v_timezone text;
    v_today date;
    v_local_now timestamp;
    v_advance_days integer;
begin
    select
        club.id,
        coalesce(nullif(trim(club.timezone), ''), 'Europe/London'),
        coalesce(settings.public_booking_advance_days, 14)
    into
        v_club_id,
        v_timezone,
        v_advance_days
    from public.clubs as club
    join public.club_settings as settings
        on settings.club_id = club.id
    where lower(club.slug) = lower(trim(coalesce(p_club_slug, '')))
      and club.is_active = true
      and settings.public_booking_enabled = true
    limit 1;

    if v_club_id is null
       or p_course_id is null
       or p_play_date is null then
        return;
    end if;

    if not exists (
        select 1
        from public.courses as course
        where course.id = p_course_id
          and course.club_id = v_club_id
          and course.is_active = true
    ) then
        return;
    end if;

    v_local_now := now() at time zone v_timezone;
    v_today := v_local_now::date;

    if p_play_date < v_today
       or p_play_date > (v_today + v_advance_days) then
        return;
    end if;

    return query
    select
        tee_time.id,
        tee_time.course_id,
        tee_time.play_date,
        tee_time.start_time,
        tee_time.max_players,
        greatest(
            tee_time.max_players - coalesce(booking.player_count, 0),
            0
        )::smallint,
        case
            when tee_time.operational_status <> 'open' then 'closed'
            when not public.hotel_mode_can_book(tee_time.id, 'visitor') then 'priority'
            when booking.id is null then 'open'
            when booking.booking_type = 'private' then 'unavailable'
            when coalesce(booking.player_count, 0) >= tee_time.max_players then 'full'
            when booking.booking_type = 'joinable' then 'joinable'
            else 'unavailable'
        end::text,
        (
            tee_time.operational_status = 'open'
            and public.hotel_mode_can_book(tee_time.id, 'visitor')
            and (
                booking.id is null
                or (
                    booking.booking_type = 'joinable'
                    and coalesce(booking.player_count, 0) < tee_time.max_players
                )
            )
        )::boolean
    from public.tee_times as tee_time
    left join public.bookings as booking
        on booking.tee_time_id = tee_time.id
       and booking.booking_status = 'active'
    where tee_time.course_id = p_course_id
      and tee_time.play_date = p_play_date
      and (
          p_play_date > v_today
          or tee_time.start_time > v_local_now::time
      )
    order by tee_time.start_time;
end;
$$;


revoke all on function public.public_booking_widget_tee_times(text,uuid,date) from public;
grant execute on function public.public_booking_widget_tee_times(text,uuid,date) to anon, authenticated;

commit;
