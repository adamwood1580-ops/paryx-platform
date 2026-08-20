-- =========================================================
-- PARYX CALENDAR FOUNDATION
-- Adds course-aware club events and admin calendar RPCs.
-- Run after 006_courses_and_tee_data.sql.
-- =========================================================

begin;

-- =========================================================
-- CLUB EVENT EXTENSIONS
-- =========================================================

alter table public.club_events
    add column if not exists course_id uuid
        references public.courses(id)
        on delete set null;

alter table public.club_events
    add column if not exists course_closed_start_time time;

alter table public.club_events
    add column if not exists course_closed_end_time time;

create index if not exists
    club_events_course_date_idx
on public.club_events (
    course_id,
    event_date
);

-- Tighten the member read policy so published events cannot leak
-- between clubs in a multi-club environment.
drop policy if exists
    "Authenticated users can read published club events"
on public.club_events;

drop policy if exists
    "Members can read published events for their clubs"
on public.club_events;

create policy
    "Members can read published events for their clubs"
on public.club_events
for select
to authenticated
using (
    is_published = true
    and exists (
        select 1
        from public.club_memberships as cm
        where cm.club_id = club_events.club_id
          and cm.profile_id = auth.uid()
          and cm.status = 'active'
    )
);

-- =========================================================
-- ADMIN CALENDAR DIRECTORY
-- =========================================================

create or replace function public.admin_get_calendar_events(
    p_club_id uuid,
    p_from_date date,
    p_to_date date
)
returns table (
    event_id uuid,
    club_id uuid,
    course_id uuid,
    course_name text,
    event_date date,
    display_order smallint,
    start_time time,
    end_time time,
    time_text text,
    title text,
    section text,
    event_type text,
    location_type text,
    venue text,
    notes text,
    is_qualifier boolean,
    course_closed boolean,
    course_closed_start_time time,
    course_closed_end_time time,
    status text,
    is_published boolean,
    source_key text,
    source_text text,
    source_page smallint,
    updated_at timestamptz
)
language plpgsql
stable
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

    if p_from_date is null
       or p_to_date is null
       or p_to_date < p_from_date then
        raise exception
            'A valid calendar date range is required.';
    end if;

    return query
    select
        ce.id,
        ce.club_id,
        ce.course_id,
        c.name,
        ce.event_date,
        ce.display_order,
        ce.start_time,
        ce.end_time,
        ce.time_text,
        ce.title,
        ce.section,
        ce.event_type,
        ce.location_type,
        ce.venue,
        ce.notes,
        ce.is_qualifier,
        ce.course_closed,
        ce.course_closed_start_time,
        ce.course_closed_end_time,
        ce.status,
        ce.is_published,
        ce.source_key,
        ce.source_text,
        ce.source_page,
        ce.updated_at
    from public.club_events as ce
    left join public.courses as c
        on c.id = ce.course_id
    where ce.club_id = p_club_id
      and ce.event_date between p_from_date and p_to_date
    order by
        ce.event_date,
        ce.start_time nulls last,
        ce.display_order,
        lower(ce.title),
        ce.id;
end;
$$;

revoke all
on function public.admin_get_calendar_events(uuid, date, date)
from public, anon;

grant execute
on function public.admin_get_calendar_events(uuid, date, date)
to authenticated;

-- =========================================================
-- ADMIN SAVE CALENDAR EVENT
-- One function handles create and edit so the browser has a
-- stable contract as the event model grows.
-- =========================================================

create or replace function public.admin_save_calendar_event(
    p_club_id uuid,
    p_event jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_id uuid;
    v_event_date date;
    v_display_order smallint;
    v_start_time time;
    v_end_time time;
    v_time_text text;
    v_title text;
    v_section text;
    v_event_type text;
    v_location_type text;
    v_venue text;
    v_notes text;
    v_is_qualifier boolean;
    v_course_closed boolean;
    v_course_closed_start_time time;
    v_course_closed_end_time time;
    v_status text;
    v_is_published boolean;
    v_course_id uuid;
    v_source_key text;
    v_source_text text;
    v_source_page smallint;
begin
    if auth.uid() is null
       or p_club_id is null
       or not public.user_can_manage_club(p_club_id) then
        raise exception
            'Club management access required.';
    end if;

    if p_event is null
       or jsonb_typeof(p_event) <> 'object' then
        raise exception
            'Event details are required.';
    end if;

    begin
        v_id := nullif(trim(p_event ->> 'id'), '')::uuid;
        v_event_date := nullif(trim(p_event ->> 'event_date'), '')::date;
        v_display_order := coalesce(
            nullif(trim(p_event ->> 'display_order'), '')::smallint,
            1
        );
        v_start_time := nullif(trim(p_event ->> 'start_time'), '')::time;
        v_end_time := nullif(trim(p_event ->> 'end_time'), '')::time;
        v_course_closed_start_time :=
            nullif(trim(p_event ->> 'course_closed_start_time'), '')::time;
        v_course_closed_end_time :=
            nullif(trim(p_event ->> 'course_closed_end_time'), '')::time;
        v_course_id := nullif(trim(p_event ->> 'course_id'), '')::uuid;
        v_source_page := nullif(trim(p_event ->> 'source_page'), '')::smallint;
    exception
        when others then
            raise exception
                'One or more event date/time values are invalid.';
    end;

    v_time_text := nullif(trim(p_event ->> 'time_text'), '');
    v_title := nullif(trim(p_event ->> 'title'), '');
    v_section := lower(coalesce(nullif(trim(p_event ->> 'section'), ''), 'club'));
    v_event_type := lower(coalesce(nullif(trim(p_event ->> 'event_type'), ''), 'other'));
    v_location_type := lower(nullif(trim(p_event ->> 'location_type'), ''));
    v_venue := nullif(trim(p_event ->> 'venue'), '');
    v_notes := nullif(trim(p_event ->> 'notes'), '');
    v_status := lower(coalesce(nullif(trim(p_event ->> 'status'), ''), 'scheduled'));
    v_is_qualifier := coalesce((p_event ->> 'is_qualifier')::boolean, false);
    v_course_closed := coalesce((p_event ->> 'course_closed')::boolean, false);
    v_is_published := coalesce((p_event ->> 'is_published')::boolean, true);
    v_source_key := nullif(trim(p_event ->> 'source_key'), '');
    v_source_text := nullif(trim(p_event ->> 'source_text'), '');

    if v_event_date is null then
        raise exception 'Event date is required.';
    end if;

    if v_title is null then
        raise exception 'Event title is required.';
    end if;

    if v_section not in ('club', 'mens', 'seniors', 'ladies') then
        raise exception 'Unsupported event section.';
    end if;

    if v_event_type not in (
        'competition',
        'roll_up',
        'fixture',
        'social',
        'course_event',
        'other'
    ) then
        raise exception 'Unsupported event type.';
    end if;

    if v_location_type is not null
       and v_location_type not in ('home', 'away') then
        raise exception 'Unsupported event location type.';
    end if;

    if v_status not in (
        'scheduled',
        'cancelled',
        'postponed',
        'completed'
    ) then
        raise exception 'Unsupported event status.';
    end if;

    if v_start_time is not null
       and v_end_time is not null
       and v_end_time < v_start_time then
        raise exception 'Event end time cannot be before the start time.';
    end if;

    if v_course_closed_start_time is not null
       and v_course_closed_end_time is not null
       and v_course_closed_end_time < v_course_closed_start_time then
        raise exception 'Course closure end time cannot be before the start time.';
    end if;

    if v_course_id is not null
       and not exists (
            select 1
            from public.courses as c
            where c.id = v_course_id
              and c.club_id = p_club_id
       ) then
        raise exception
            'The selected course does not belong to this club.';
    end if;

    if v_id is null then
        v_id := gen_random_uuid();

        if v_source_key is null then
            v_source_key := 'manual:' || v_id::text;
        end if;

        insert into public.club_events (
            id,
            club_id,
            course_id,
            event_date,
            display_order,
            start_time,
            end_time,
            time_text,
            title,
            section,
            event_type,
            location_type,
            venue,
            notes,
            is_qualifier,
            course_closed,
            course_closed_start_time,
            course_closed_end_time,
            status,
            is_published,
            source_key,
            source_text,
            source_page
        ) values (
            v_id,
            p_club_id,
            v_course_id,
            v_event_date,
            greatest(v_display_order, 1),
            v_start_time,
            v_end_time,
            v_time_text,
            v_title,
            v_section,
            v_event_type,
            v_location_type,
            v_venue,
            v_notes,
            v_is_qualifier,
            v_course_closed,
            v_course_closed_start_time,
            v_course_closed_end_time,
            v_status,
            v_is_published,
            v_source_key,
            v_source_text,
            v_source_page
        );

        return v_id;
    end if;

    if not exists (
        select 1
        from public.club_events as ce
        where ce.id = v_id
          and ce.club_id = p_club_id
    ) then
        raise exception
            'Calendar event not found for the selected club.';
    end if;

    update public.club_events
    set
        course_id = v_course_id,
        event_date = v_event_date,
        display_order = greatest(v_display_order, 1),
        start_time = v_start_time,
        end_time = v_end_time,
        time_text = v_time_text,
        title = v_title,
        section = v_section,
        event_type = v_event_type,
        location_type = v_location_type,
        venue = v_venue,
        notes = v_notes,
        is_qualifier = v_is_qualifier,
        course_closed = v_course_closed,
        course_closed_start_time = v_course_closed_start_time,
        course_closed_end_time = v_course_closed_end_time,
        status = v_status,
        is_published = v_is_published,
        source_key = coalesce(v_source_key, source_key),
        source_text = coalesce(v_source_text, source_text),
        source_page = coalesce(v_source_page, source_page)
    where id = v_id
      and club_id = p_club_id;

    return v_id;
end;
$$;

revoke all
on function public.admin_save_calendar_event(uuid, jsonb)
from public, anon;

grant execute
on function public.admin_save_calendar_event(uuid, jsonb)
to authenticated;

-- =========================================================
-- ADMIN IMPORT CALENDAR EVENTS
-- One RPC call = one database transaction. If one row fails,
-- the entire reviewed import is rolled back.
-- =========================================================

create or replace function public.admin_import_calendar_events(
    p_club_id uuid,
    p_events jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_item jsonb;
    v_existing_id uuid;
    v_source_key text;
    v_event_id uuid;
    v_inserted integer := 0;
    v_updated integer := 0;
begin
    if auth.uid() is null
       or p_club_id is null
       or not public.user_can_manage_club(p_club_id) then
        raise exception
            'Club management access required.';
    end if;

    if p_events is null
       or jsonb_typeof(p_events) <> 'array' then
        raise exception
            'Calendar import rows are required.';
    end if;

    if jsonb_array_length(p_events) > 1000 then
        raise exception
            'Calendar imports are limited to 1000 events at a time.';
    end if;

    for v_item in
        select value
        from jsonb_array_elements(p_events)
    loop
        v_source_key :=
            nullif(trim(v_item ->> 'source_key'), '');

        if v_source_key is null then
            raise exception
                'Every imported event requires a source key.';
        end if;

        select ce.id
        into v_existing_id
        from public.club_events as ce
        where ce.club_id = p_club_id
          and ce.source_key = v_source_key
        limit 1;

        if v_existing_id is not null then
            v_item := jsonb_set(
                v_item,
                '{id}',
                to_jsonb(v_existing_id::text),
                true
            );
        end if;

        v_event_id := public.admin_save_calendar_event(
            p_club_id,
            v_item
        );

        if v_existing_id is null then
            v_inserted := v_inserted + 1;
        else
            v_updated := v_updated + 1;
        end if;

        v_existing_id := null;
    end loop;

    return jsonb_build_object(
        'inserted', v_inserted,
        'updated', v_updated,
        'total', v_inserted + v_updated
    );
end;
$$;

revoke all
on function public.admin_import_calendar_events(uuid, jsonb)
from public, anon;

grant execute
on function public.admin_import_calendar_events(uuid, jsonb)
to authenticated;

-- =========================================================
-- ADMIN DELETE CALENDAR EVENT
-- =========================================================

create or replace function public.admin_delete_calendar_event(
    p_club_id uuid,
    p_event_id uuid
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

    delete from public.club_events
    where id = p_event_id
      and club_id = p_club_id;

    return found;
end;
$$;

revoke all
on function public.admin_delete_calendar_event(uuid, uuid)
from public, anon;

grant execute
on function public.admin_delete_calendar_event(uuid, uuid)
to authenticated;

commit;
