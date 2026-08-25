-- =========================================================
-- PARYX INTERACTIVE CALENDAR + RECURRING SERIES
-- Run after 007_calendar_foundation.sql.
-- =========================================================

begin;

-- =========================================================
-- RECURRING SERIES METADATA
-- Each generated occurrence remains a normal club_events row,
-- so booking/calendar consumers do not need recurrence logic.
-- =========================================================

alter table public.club_events
    add column if not exists series_id uuid;

alter table public.club_events
    add column if not exists series_sequence integer;

alter table public.club_events
    add column if not exists series_rule jsonb;

create index if not exists
    club_events_club_series_date_idx
on public.club_events (
    club_id,
    series_id,
    event_date
)
where series_id is not null;

-- =========================================================
-- CALENDAR DIRECTORY V2
-- Adds recurring-series metadata without changing the v1 RPC.
-- =========================================================

create or replace function public.admin_get_calendar_events_v2(
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
    series_id uuid,
    series_sequence integer,
    series_rule jsonb,
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
        ce.series_id,
        ce.series_sequence,
        ce.series_rule,
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
on function public.admin_get_calendar_events_v2(uuid, date, date)
from public, anon;

grant execute
on function public.admin_get_calendar_events_v2(uuid, date, date)
to authenticated;

-- =========================================================
-- EVENT TITLE SUGGESTIONS
-- Turns previously-used named events into future dropdown choices.
-- =========================================================

create or replace function public.admin_get_calendar_event_suggestions(
    p_club_id uuid
)
returns table (
    title text,
    section text,
    event_type text,
    use_count bigint
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

    return query
    select
        ce.title,
        ce.section,
        ce.event_type,
        count(*)::bigint
    from public.club_events as ce
    where ce.club_id = p_club_id
      and ce.title is not null
      and trim(ce.title) <> ''
    group by
        ce.title,
        ce.section,
        ce.event_type
    order by
        count(*) desc,
        lower(ce.title)
    limit 250;
end;
$$;

revoke all
on function public.admin_get_calendar_event_suggestions(uuid)
from public, anon;

grant execute
on function public.admin_get_calendar_event_suggestions(uuid)
to authenticated;

-- =========================================================
-- CREATE RECURRING SERIES
-- The browser calculates the occurrence dates. This RPC inserts
-- them transactionally and groups them with one series_id.
-- =========================================================

create or replace function public.admin_create_calendar_series(
    p_club_id uuid,
    p_event jsonb,
    p_dates jsonb,
    p_rule jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_series_id uuid := gen_random_uuid();
    v_date_item jsonb;
    v_date date;
    v_payload jsonb;
    v_event_id uuid;
    v_sequence integer := 0;
    v_source_key text;
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

    if p_dates is null
       or jsonb_typeof(p_dates) <> 'array'
       or jsonb_array_length(p_dates) = 0 then
        raise exception
            'At least one recurring event date is required.';
    end if;

    if jsonb_array_length(p_dates) > 150 then
        raise exception
            'A recurring series is limited to 150 occurrences.';
    end if;

    for v_date_item in
        select value
        from jsonb_array_elements(p_dates)
    loop
        begin
            v_date := nullif(
                trim(both '"' from v_date_item::text),
                ''
            )::date;
        exception
            when others then
                raise exception
                    'One or more recurring event dates are invalid.';
        end;

        if v_date is null then
            raise exception
                'One or more recurring event dates are invalid.';
        end if;

        v_sequence := v_sequence + 1;
        v_source_key :=
            'series:' || v_series_id::text || ':' ||
            lpad(v_sequence::text, 4, '0');

        v_payload := p_event
            || jsonb_build_object(
                'id', null,
                'event_date', v_date::text,
                'source_key', v_source_key,
                'source_text', null,
                'source_page', null
            );

        v_event_id := public.admin_save_calendar_event(
            p_club_id,
            v_payload
        );

        update public.club_events
        set
            series_id = v_series_id,
            series_sequence = v_sequence,
            series_rule = coalesce(p_rule, '{}'::jsonb)
        where id = v_event_id
          and club_id = p_club_id;
    end loop;

    return jsonb_build_object(
        'series_id', v_series_id,
        'created', v_sequence
    );
end;
$$;

revoke all
on function public.admin_create_calendar_series(uuid, jsonb, jsonb, jsonb)
from public, anon;

grant execute
on function public.admin_create_calendar_series(uuid, jsonb, jsonb, jsonb)
to authenticated;

-- =========================================================
-- UPDATE EVENT / SERIES
-- Multi-event edits keep each occurrence on its existing date.
-- This is ideal for changing the time or details from a point
-- in the season onward without rebuilding the recurring series.
-- =========================================================

create or replace function public.admin_update_calendar_series(
    p_club_id uuid,
    p_event_id uuid,
    p_event jsonb,
    p_scope text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_current public.club_events%rowtype;
    v_target record;
    v_payload jsonb;
    v_scope text := lower(coalesce(nullif(trim(p_scope), ''), 'this'));
    v_count integer := 0;
begin
    if auth.uid() is null
       or p_club_id is null
       or not public.user_can_manage_club(p_club_id) then
        raise exception
            'Club management access required.';
    end if;

    if p_event_id is null
       or p_event is null
       or jsonb_typeof(p_event) <> 'object' then
        raise exception
            'Event details are required.';
    end if;

    if v_scope not in ('this', 'following', 'all') then
        raise exception
            'Unsupported recurring event edit scope.';
    end if;

    select ce.*
    into v_current
    from public.club_events as ce
    where ce.id = p_event_id
      and ce.club_id = p_club_id;

    if not found then
        raise exception
            'Calendar event not found for the selected club.';
    end if;

    if v_current.series_id is null
       or v_scope = 'this' then
        v_payload := p_event
            || jsonb_build_object(
                'id', p_event_id::text
            );

        perform public.admin_save_calendar_event(
            p_club_id,
            v_payload
        );

        return 1;
    end if;

    for v_target in
        select
            ce.id,
            ce.event_date
        from public.club_events as ce
        where ce.club_id = p_club_id
          and ce.series_id = v_current.series_id
          and (
              v_scope = 'all'
              or ce.event_date >= v_current.event_date
          )
        order by
            ce.event_date,
            ce.series_sequence nulls last,
            ce.id
    loop
        -- Keep each series occurrence on its current date and
        -- preserve its original source metadata.
        v_payload := p_event
            || jsonb_build_object(
                'id', v_target.id::text,
                'event_date', v_target.event_date::text,
                'source_key', null,
                'source_text', null,
                'source_page', null
            );

        perform public.admin_save_calendar_event(
            p_club_id,
            v_payload
        );

        v_count := v_count + 1;
    end loop;

    return v_count;
end;
$$;

revoke all
on function public.admin_update_calendar_series(uuid, uuid, jsonb, text)
from public, anon;

grant execute
on function public.admin_update_calendar_series(uuid, uuid, jsonb, text)
to authenticated;

-- =========================================================
-- DELETE EVENT / SERIES
-- =========================================================

create or replace function public.admin_delete_calendar_series(
    p_club_id uuid,
    p_event_id uuid,
    p_scope text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_current public.club_events%rowtype;
    v_scope text := lower(coalesce(nullif(trim(p_scope), ''), 'this'));
    v_count integer := 0;
begin
    if auth.uid() is null
       or p_club_id is null
       or not public.user_can_manage_club(p_club_id) then
        raise exception
            'Club management access required.';
    end if;

    if p_event_id is null then
        raise exception
            'Calendar event is required.';
    end if;

    if v_scope not in ('this', 'following', 'all') then
        raise exception
            'Unsupported recurring event delete scope.';
    end if;

    select ce.*
    into v_current
    from public.club_events as ce
    where ce.id = p_event_id
      and ce.club_id = p_club_id;

    if not found then
        return 0;
    end if;

    if v_current.series_id is null
       or v_scope = 'this' then
        delete from public.club_events
        where id = p_event_id
          and club_id = p_club_id;

        return case when found then 1 else 0 end;
    end if;

    delete from public.club_events as ce
    where ce.club_id = p_club_id
      and ce.series_id = v_current.series_id
      and (
          v_scope = 'all'
          or ce.event_date >= v_current.event_date
      );

    get diagnostics v_count = row_count;
    return v_count;
end;
$$;

revoke all
on function public.admin_delete_calendar_series(uuid, uuid, text)
from public, anon;

grant execute
on function public.admin_delete_calendar_series(uuid, uuid, text)
to authenticated;

commit;
