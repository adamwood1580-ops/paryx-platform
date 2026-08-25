-- =========================================================
-- PARYX STAFF TEE SHEET + CALENDAR EVENT ALLOCATIONS
-- Run after 008_interactive_calendar_series.sql.
-- =========================================================

begin;

-- =========================================================
-- OPERATIONAL ACCESS
-- Tee-sheet users are deliberately broader than full ClubHub
-- administrators, while schedule editing remains manager/admin.
-- =========================================================

create or replace function public.user_can_operate_tee_sheet(
    p_club_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.club_memberships as cm
        join public.clubs as c
            on c.id = cm.club_id
        where cm.profile_id = auth.uid()
          and cm.club_id = p_club_id
          and cm.status = 'active'
          and cm.role in (
              'starter',
              'reception',
              'professional',
              'manager',
              'club_admin'
          )
          and c.is_active = true
    );
$$;

revoke all
on function public.user_can_operate_tee_sheet(uuid)
from public, anon;

grant execute
on function public.user_can_operate_tee_sheet(uuid)
to authenticated;

-- =========================================================
-- TEE-TIME EVENT LINK + RESERVED STATUS
-- =========================================================

alter table public.tee_times
    add column if not exists club_event_id uuid
        references public.club_events(id)
        on delete set null;

create index if not exists
    tee_times_club_event_id_idx
on public.tee_times (club_event_id)
where club_event_id is not null;

alter table public.tee_times
    drop constraint if exists tee_times_status_valid;

alter table public.tee_times
    add constraint tee_times_status_valid
        check (
            operational_status in (
                'open',
                'reserved',
                'blocked',
                'maintenance',
                'competition',
                'closed'
            )
        );

-- =========================================================
-- EVENT -> TEE SHEET SETTINGS
-- These are configured from the Tee Sheet rather than forcing
-- booking concepts into the normal calendar creation flow.
-- =========================================================

alter table public.club_events
    add column if not exists tee_sheet_action text
        not null default 'none';

alter table public.club_events
    add column if not exists tee_times_required smallint;

alter table public.club_events
    add column if not exists tee_sheet_applied_at timestamptz;

alter table public.club_events
    drop constraint if exists club_events_tee_sheet_action_valid;

alter table public.club_events
    add constraint club_events_tee_sheet_action_valid
        check (
            tee_sheet_action in (
                'none',
                'reserve',
                'competition',
                'blocked',
                'closed'
            )
        );

alter table public.club_events
    drop constraint if exists club_events_tee_times_required_valid;

alter table public.club_events
    add constraint club_events_tee_times_required_valid
        check (
            tee_times_required is null
            or tee_times_required between 1 and 48
        );

-- =========================================================
-- COURSE DIRECTORY FOR TEE SHEET
-- =========================================================

create or replace function public.staff_get_booking_courses(
    p_club_id uuid
)
returns table (
    course_id uuid,
    course_name text,
    holes smallint,
    is_default boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null
       or p_club_id is null
       or not public.user_can_operate_tee_sheet(p_club_id) then
        raise exception
            'Tee sheet access required.';
    end if;

    return query
    select
        c.id,
        c.name,
        c.holes,
        (cfg.default_course_id = c.id)
    from public.courses as c
    left join public.club_settings as cfg
        on cfg.club_id = c.club_id
    where c.club_id = p_club_id
      and c.is_active = true
    order by
        (cfg.default_course_id = c.id) desc,
        lower(c.name),
        c.id;
end;
$$;

revoke all
on function public.staff_get_booking_courses(uuid)
from public, anon;

grant execute
on function public.staff_get_booking_courses(uuid)
to authenticated;

-- =========================================================
-- BOOKING SCHEDULE DIRECTORY
-- =========================================================

create or replace function public.staff_get_booking_schedules(
    p_club_id uuid,
    p_course_id uuid
)
returns table (
    schedule_id uuid,
    name text,
    first_tee_time time,
    last_tee_time time,
    interval_minutes smallint,
    max_players smallint,
    monday boolean,
    tuesday boolean,
    wednesday boolean,
    thursday boolean,
    friday boolean,
    saturday boolean,
    sunday boolean,
    effective_from date,
    effective_to date,
    is_active boolean
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
       or not public.user_can_operate_tee_sheet(p_club_id) then
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
        bs.id,
        bs.name,
        bs.first_tee_time,
        bs.last_tee_time,
        bs.interval_minutes,
        bs.max_players,
        bs.monday,
        bs.tuesday,
        bs.wednesday,
        bs.thursday,
        bs.friday,
        bs.saturday,
        bs.sunday,
        bs.effective_from,
        bs.effective_to,
        bs.is_active
    from public.booking_schedules as bs
    where bs.course_id = p_course_id
    order by
        bs.is_active desc,
        bs.effective_from desc,
        lower(bs.name),
        bs.id;
end;
$$;

revoke all
on function public.staff_get_booking_schedules(uuid, uuid)
from public, anon;

grant execute
on function public.staff_get_booking_schedules(uuid, uuid)
to authenticated;

-- Manager/admin only schedule write.
create or replace function public.admin_save_booking_schedule(
    p_club_id uuid,
    p_schedule jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_id uuid;
    v_course_id uuid;
    v_name text;
    v_first time;
    v_last time;
    v_interval smallint;
    v_max_players smallint;
    v_effective_from date;
    v_effective_to date;
    v_is_active boolean;
    v_mon boolean;
    v_tue boolean;
    v_wed boolean;
    v_thu boolean;
    v_fri boolean;
    v_sat boolean;
    v_sun boolean;
begin
    if auth.uid() is null
       or p_club_id is null
       or not public.user_can_manage_club(p_club_id) then
        raise exception
            'Club management access required.';
    end if;

    if p_schedule is null
       or jsonb_typeof(p_schedule) <> 'object' then
        raise exception
            'Booking schedule details are required.';
    end if;

    begin
        v_id := nullif(trim(p_schedule ->> 'id'), '')::uuid;
        v_course_id := nullif(trim(p_schedule ->> 'course_id'), '')::uuid;
        v_first := nullif(trim(p_schedule ->> 'first_tee_time'), '')::time;
        v_last := nullif(trim(p_schedule ->> 'last_tee_time'), '')::time;
        v_interval := nullif(trim(p_schedule ->> 'interval_minutes'), '')::smallint;
        v_max_players := coalesce(
            nullif(trim(p_schedule ->> 'max_players'), '')::smallint,
            4
        );
        v_effective_from := nullif(trim(p_schedule ->> 'effective_from'), '')::date;
        v_effective_to := nullif(trim(p_schedule ->> 'effective_to'), '')::date;
    exception
        when others then
            raise exception
                'One or more booking schedule values are invalid.';
    end;

    v_name := nullif(trim(p_schedule ->> 'name'), '');
    v_is_active := coalesce((p_schedule ->> 'is_active')::boolean, true);
    v_mon := coalesce((p_schedule ->> 'monday')::boolean, false);
    v_tue := coalesce((p_schedule ->> 'tuesday')::boolean, false);
    v_wed := coalesce((p_schedule ->> 'wednesday')::boolean, false);
    v_thu := coalesce((p_schedule ->> 'thursday')::boolean, false);
    v_fri := coalesce((p_schedule ->> 'friday')::boolean, false);
    v_sat := coalesce((p_schedule ->> 'saturday')::boolean, false);
    v_sun := coalesce((p_schedule ->> 'sunday')::boolean, false);

    if v_course_id is null
       or not exists (
            select 1
            from public.courses as c
            where c.id = v_course_id
              and c.club_id = p_club_id
              and c.is_active = true
       ) then
        raise exception
            'Select an active course for this booking schedule.';
    end if;

    if v_name is null then
        raise exception
            'A schedule name is required.';
    end if;

    if v_first is null
       or v_last is null
       or v_last < v_first then
        raise exception
            'Choose a valid first and last tee time.';
    end if;

    if v_interval is null
       or v_interval < 1
       or v_interval > 60 then
        raise exception
            'The tee-time interval must be between 1 and 60 minutes.';
    end if;

    if v_max_players < 1
       or v_max_players > 8 then
        raise exception
            'Maximum players must be between 1 and 8.';
    end if;

    if v_effective_from is null
       or (
            v_effective_to is not null
            and v_effective_to < v_effective_from
       ) then
        raise exception
            'Choose a valid schedule date range.';
    end if;

    if not (
        v_mon or v_tue or v_wed or v_thu or
        v_fri or v_sat or v_sun
    ) then
        raise exception
            'Select at least one day of the week.';
    end if;

    if v_id is null then
        insert into public.booking_schedules (
            course_id,
            name,
            first_tee_time,
            last_tee_time,
            interval_minutes,
            max_players,
            monday,
            tuesday,
            wednesday,
            thursday,
            friday,
            saturday,
            sunday,
            effective_from,
            effective_to,
            is_active
        )
        values (
            v_course_id,
            v_name,
            v_first,
            v_last,
            v_interval,
            v_max_players,
            v_mon,
            v_tue,
            v_wed,
            v_thu,
            v_fri,
            v_sat,
            v_sun,
            v_effective_from,
            v_effective_to,
            v_is_active
        )
        returning id into v_id;
    else
        if not exists (
            select 1
            from public.booking_schedules as bs
            join public.courses as c
                on c.id = bs.course_id
            where bs.id = v_id
              and c.club_id = p_club_id
        ) then
            raise exception
                'The selected booking schedule was not found.';
        end if;

        update public.booking_schedules
        set
            course_id = v_course_id,
            name = v_name,
            first_tee_time = v_first,
            last_tee_time = v_last,
            interval_minutes = v_interval,
            max_players = v_max_players,
            monday = v_mon,
            tuesday = v_tue,
            wednesday = v_wed,
            thursday = v_thu,
            friday = v_fri,
            saturday = v_sat,
            sunday = v_sun,
            effective_from = v_effective_from,
            effective_to = v_effective_to,
            is_active = v_is_active,
            updated_at = now()
        where id = v_id;
    end if;

    return v_id;
end;
$$;

revoke all
on function public.admin_save_booking_schedule(uuid, jsonb)
from public, anon;

grant execute
on function public.admin_save_booking_schedule(uuid, jsonb)
to authenticated;

create or replace function public.admin_delete_booking_schedule(
    p_club_id uuid,
    p_schedule_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null
       or p_club_id is null
       or not public.user_can_manage_club(p_club_id) then
        raise exception
            'Club management access required.';
    end if;

    if p_schedule_id is null
       or not exists (
            select 1
            from public.booking_schedules as bs
            join public.courses as c
                on c.id = bs.course_id
            where bs.id = p_schedule_id
              and c.club_id = p_club_id
       ) then
        raise exception
            'The selected booking schedule was not found.';
    end if;

    -- Existing tee times remain usable; their schedule link becomes null.
    delete from public.booking_schedules
    where id = p_schedule_id;

    return true;
end;
$$;

revoke all
on function public.admin_delete_booking_schedule(uuid, uuid)
from public, anon;

grant execute
on function public.admin_delete_booking_schedule(uuid, uuid)
to authenticated;

-- =========================================================
-- ENSURE ONE DAY'S TEE SHEET EXISTS
-- Uses every active schedule that applies to the selected date.
-- Overlaps are safe because the tee-time unique constraint skips
-- duplicate times.
-- =========================================================

create or replace function public.staff_generate_course_tee_sheet(
    p_club_id uuid,
    p_course_id uuid,
    p_play_date date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_schedule public.booking_schedules%rowtype;
    v_created integer;
    v_total integer := 0;
    v_day_enabled boolean;
begin
    if auth.uid() is null
       or p_club_id is null
       or p_course_id is null
       or p_play_date is null
       or not public.user_can_operate_tee_sheet(p_club_id) then
        raise exception
            'Tee sheet access required.';
    end if;

    if not exists (
        select 1
        from public.courses as c
        where c.id = p_course_id
          and c.club_id = p_club_id
          and c.is_active = true
    ) then
        raise exception
            'The selected course is not available at this club.';
    end if;

    for v_schedule in
        select bs.*
        from public.booking_schedules as bs
        where bs.course_id = p_course_id
          and bs.is_active = true
          and bs.effective_from <= p_play_date
          and (
              bs.effective_to is null
              or bs.effective_to >= p_play_date
          )
    loop
        v_day_enabled :=
            case extract(isodow from p_play_date)::integer
                when 1 then v_schedule.monday
                when 2 then v_schedule.tuesday
                when 3 then v_schedule.wednesday
                when 4 then v_schedule.thursday
                when 5 then v_schedule.friday
                when 6 then v_schedule.saturday
                when 7 then v_schedule.sunday
                else false
            end;

        if not v_day_enabled then
            continue;
        end if;

        v_created := public.generate_tee_sheet(
            v_schedule.id,
            p_play_date
        );

        v_total := v_total + v_created;
    end loop;

    return v_total;
end;
$$;

revoke all
on function public.staff_generate_course_tee_sheet(uuid, uuid, date)
from public, anon;

grant execute
on function public.staff_generate_course_tee_sheet(uuid, uuid, date)
to authenticated;

-- =========================================================
-- DAY TEE SHEET
-- Returns one row per tee time with active booking occupancy and
-- any linked calendar event.
-- =========================================================

create or replace function public.staff_get_tee_sheet(
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
    player_names text[]
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
       or not public.user_can_operate_tee_sheet(p_club_id) then
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
                    coalesce(
                        nullif(trim(p.display_name), ''),
                        nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''),
                        'Member'
                    )
                    order by bm.position
                )
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
            ),
            array[]::text[]
        )
    from public.tee_times as tt
    left join public.club_events as ce
        on ce.id = tt.club_event_id
    left join public.bookings as b
        on b.tee_time_id = tt.id
       and b.booking_status = 'active'
    where tt.course_id = p_course_id
      and tt.play_date = p_play_date
    order by tt.start_time;
end;
$$;

revoke all
on function public.staff_get_tee_sheet(uuid, uuid, date)
from public, anon;

grant execute
on function public.staff_get_tee_sheet(uuid, uuid, date)
to authenticated;

-- =========================================================
-- MANUAL TEE-TIME STATUS
-- =========================================================

create or replace function public.staff_set_tee_time_status(
    p_club_id uuid,
    p_tee_time_id uuid,
    p_status text,
    p_notes text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_status text := lower(coalesce(nullif(trim(p_status), ''), 'open'));
    v_course_club_id uuid;
begin
    if auth.uid() is null
       or p_club_id is null
       or p_tee_time_id is null
       or not public.user_can_operate_tee_sheet(p_club_id) then
        raise exception
            'Tee sheet access required.';
    end if;

    select c.club_id
    into v_course_club_id
    from public.tee_times as tt
    join public.courses as c
        on c.id = tt.course_id
    where tt.id = p_tee_time_id;

    if v_course_club_id is null
       or v_course_club_id <> p_club_id then
        raise exception
            'The selected tee time was not found.';
    end if;

    if v_status not in (
        'open',
        'reserved',
        'blocked',
        'maintenance',
        'competition',
        'closed'
    ) then
        raise exception
            'Unsupported tee-time status.';
    end if;

    if v_status <> 'open'
       and exists (
            select 1
            from public.bookings as b
            where b.tee_time_id = p_tee_time_id
              and b.booking_status = 'active'
       ) then
        raise exception
            'This tee time already has an active booking.';
    end if;

    update public.tee_times
    set
        operational_status = v_status,
        notes = nullif(trim(p_notes), ''),
        club_event_id = null,
        updated_at = now()
    where id = p_tee_time_id;

    return true;
end;
$$;

revoke all
on function public.staff_set_tee_time_status(uuid, uuid, text, text)
from public, anon;

grant execute
on function public.staff_set_tee_time_status(uuid, uuid, text, text)
to authenticated;

-- =========================================================
-- CALENDAR EVENTS FOR THE BOOKING DAY
-- =========================================================

create or replace function public.staff_get_booking_events(
    p_club_id uuid,
    p_play_date date
)
returns table (
    event_id uuid,
    course_id uuid,
    course_name text,
    event_date date,
    start_time time,
    end_time time,
    time_text text,
    title text,
    section text,
    event_type text,
    course_closed boolean,
    course_closed_start_time time,
    course_closed_end_time time,
    tee_sheet_action text,
    tee_times_required smallint,
    tee_sheet_applied_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null
       or p_club_id is null
       or p_play_date is null
       or not public.user_can_operate_tee_sheet(p_club_id) then
        raise exception
            'Tee sheet access required.';
    end if;

    return query
    select
        ce.id,
        ce.course_id,
        c.name,
        ce.event_date,
        ce.start_time,
        ce.end_time,
        ce.time_text,
        ce.title,
        ce.section,
        ce.event_type,
        ce.course_closed,
        ce.course_closed_start_time,
        ce.course_closed_end_time,
        ce.tee_sheet_action,
        ce.tee_times_required,
        ce.tee_sheet_applied_at
    from public.club_events as ce
    left join public.courses as c
        on c.id = ce.course_id
    where ce.club_id = p_club_id
      and ce.event_date = p_play_date
      and ce.status <> 'cancelled'
    order by
        ce.start_time nulls last,
        ce.display_order,
        lower(ce.title),
        ce.id;
end;
$$;

revoke all
on function public.staff_get_booking_events(uuid, date)
from public, anon;

grant execute
on function public.staff_get_booking_events(uuid, date)
to authenticated;

-- =========================================================
-- EVENT ALLOCATION
-- reserve/competition/blocked use N consecutive tee times from
-- the event start. closed uses the explicit closure range (or
-- event start/end when closure fields are not populated).
-- =========================================================

create or replace function public.staff_apply_event_tee_times(
    p_club_id uuid,
    p_event_id uuid,
    p_course_id uuid,
    p_action text,
    p_tee_times_required smallint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_event public.club_events%rowtype;
    v_action text := lower(coalesce(nullif(trim(p_action), ''), 'none'));
    v_status text;
    v_count smallint;
    v_start time;
    v_end time;
    v_available integer;
    v_allocated integer := 0;
    v_first time;
    v_last time;
begin
    if auth.uid() is null
       or p_club_id is null
       or p_event_id is null
       or p_course_id is null
       or not public.user_can_operate_tee_sheet(p_club_id) then
        raise exception
            'Tee sheet access required.';
    end if;

    select ce.*
    into v_event
    from public.club_events as ce
    where ce.id = p_event_id
      and ce.club_id = p_club_id
    for update;

    if not found then
        raise exception
            'The selected calendar event was not found.';
    end if;

    if not exists (
        select 1
        from public.courses as c
        where c.id = p_course_id
          and c.club_id = p_club_id
          and c.is_active = true
    ) then
        raise exception
            'Select an active course for this event.';
    end if;

    if v_action not in (
        'none',
        'reserve',
        'competition',
        'blocked',
        'closed'
    ) then
        raise exception
            'Unsupported event tee-sheet action.';
    end if;

    -- Do not strand previous event allocations when the setting changes.
    if exists (
        select 1
        from public.bookings as b
        join public.tee_times as tt
            on tt.id = b.tee_time_id
        where tt.club_event_id = v_event.id
          and b.booking_status = 'active'
    ) then
        raise exception
            'This event has a tee time with an active booking and cannot be reallocated yet.';
    end if;

    update public.tee_times
    set
        operational_status = 'open',
        club_event_id = null,
        notes = null,
        updated_at = now()
    where club_event_id = v_event.id;

    if v_action = 'none' then
        update public.club_events
        set
            course_id = p_course_id,
            tee_sheet_action = 'none',
            tee_times_required = null,
            tee_sheet_applied_at = null,
            updated_at = now()
        where id = v_event.id;

        return jsonb_build_object(
            'action', 'none',
            'allocated', 0
        );
    end if;

    perform public.staff_generate_course_tee_sheet(
        p_club_id,
        p_course_id,
        v_event.event_date
    );

    if v_action = 'closed' then
        v_status := 'closed';
        v_start := coalesce(
            v_event.course_closed_start_time,
            v_event.start_time
        );
        v_end := coalesce(
            v_event.course_closed_end_time,
            v_event.end_time
        );

        if v_start is null or v_end is null or v_end < v_start then
            raise exception
                'A course closure needs a valid start and end time.';
        end if;

        if exists (
            select 1
            from public.bookings as b
            join public.tee_times as tt
                on tt.id = b.tee_time_id
            where tt.course_id = p_course_id
              and tt.play_date = v_event.event_date
              and tt.start_time between v_start and v_end
              and b.booking_status = 'active'
        ) then
            raise exception
                'One or more tee times in this closure already have active bookings.';
        end if;

        update public.tee_times
        set
            operational_status = 'closed',
            club_event_id = v_event.id,
            notes = v_event.title,
            updated_at = now()
        where course_id = p_course_id
          and play_date = v_event.event_date
          and start_time between v_start and v_end;

        get diagnostics v_allocated = row_count;

        select min(tt.start_time), max(tt.start_time)
        into v_first, v_last
        from public.tee_times as tt
        where tt.club_event_id = v_event.id;
    else
        v_status := case v_action
            when 'reserve' then 'reserved'
            when 'competition' then 'competition'
            when 'blocked' then 'blocked'
            else 'reserved'
        end;

        v_start := v_event.start_time;
        v_count := p_tee_times_required;

        if v_start is null then
            raise exception
                'This event needs a start time before tee times can be allocated.';
        end if;

        if v_count is null or v_count < 1 or v_count > 48 then
            raise exception
                'Choose between 1 and 48 tee times for this event.';
        end if;

        -- Take the first N chronological tee times so an event
        -- allocation is always a consecutive block. Do not skip over
        -- an occupied/unavailable slot and silently extend later.
        select count(*)::integer
        into v_available
        from (
            select tt.id
            from public.tee_times as tt
            where tt.course_id = p_course_id
              and tt.play_date = v_event.event_date
              and tt.start_time >= v_start
            order by tt.start_time
            limit v_count
        ) as candidate;

        if v_available < v_count then
            raise exception
                'Only % tee times exist from % onward.',
                v_available,
                to_char(v_start, 'HH24:MI');
        end if;

        if exists (
            select 1
            from (
                select tt.id, tt.operational_status
                from public.tee_times as tt
                where tt.course_id = p_course_id
                  and tt.play_date = v_event.event_date
                  and tt.start_time >= v_start
                order by tt.start_time
                limit v_count
            ) as candidate
            where candidate.operational_status <> 'open'
               or exists (
                    select 1
                    from public.bookings as b
                    where b.tee_time_id = candidate.id
                      and b.booking_status = 'active'
               )
        ) then
            raise exception
                'One of the first % tee times from % is already booked or unavailable.',
                v_count,
                to_char(v_start, 'HH24:MI');
        end if;

        with selected as (
            select tt.id
            from public.tee_times as tt
            where tt.course_id = p_course_id
              and tt.play_date = v_event.event_date
              and tt.start_time >= v_start
            order by tt.start_time
            limit v_count
        )
        update public.tee_times as tt
        set
            operational_status = v_status,
            club_event_id = v_event.id,
            notes = v_event.title,
            updated_at = now()
        from selected
        where tt.id = selected.id;

        get diagnostics v_allocated = row_count;

        select min(tt.start_time), max(tt.start_time)
        into v_first, v_last
        from public.tee_times as tt
        where tt.club_event_id = v_event.id;
    end if;

    update public.club_events
    set
        course_id = p_course_id,
        tee_sheet_action = v_action,
        tee_times_required = case
            when v_action = 'closed' then null
            else v_allocated::smallint
        end,
        tee_sheet_applied_at = now(),
        updated_at = now()
    where id = v_event.id;

    return jsonb_build_object(
        'action', v_action,
        'allocated', v_allocated,
        'first_tee_time', case when v_first is null then null else to_char(v_first, 'HH24:MI') end,
        'last_tee_time', case when v_last is null then null else to_char(v_last, 'HH24:MI') end
    );
end;
$$;

revoke all
on function public.staff_apply_event_tee_times(uuid, uuid, uuid, text, smallint)
from public, anon;

grant execute
on function public.staff_apply_event_tee_times(uuid, uuid, uuid, text, smallint)
to authenticated;

-- Restore linked tee times when an event is deleted through Calendar.
create or replace function public.release_tee_times_for_deleted_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    update public.tee_times as tt
    set
        operational_status = 'open',
        club_event_id = null,
        notes = null,
        updated_at = now()
    where tt.club_event_id = old.id
      and not exists (
          select 1
          from public.bookings as b
          where b.tee_time_id = tt.id
            and b.booking_status = 'active'
      );

    return old;
end;
$$;

drop trigger if exists
    release_tee_times_before_club_event_delete
on public.club_events;

create trigger release_tee_times_before_club_event_delete
before delete on public.club_events
for each row
execute function public.release_tee_times_for_deleted_event();

commit;

notify pgrst, 'reload schema';
