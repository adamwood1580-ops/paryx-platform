-- =========================================================
-- PARYX MIGRATION 049
-- COMPETITION ENTRY BACKEND FIX
-- =========================================================
--
-- v0.29.0 added ClubHub controls and Player UI for competition self-entry,
-- but four RPCs used by those frontends were omitted from Migration 047:
--   competition_get_player_entry_settings()
--   competition_save_player_entry_settings()
--   player_list_competitions()
--   player_join_game()
--
-- This migration adds the missing backend contract and also makes the
-- existing Player calendar/enter/withdraw RPCs enforce the ClubHub entry
-- settings (open/close dates, maximum entries, individual formats only).
-- =========================================================

begin;

-- ---------------------------------------------------------
-- PER-COMPETITION PLAYER ENTRY SETTINGS
-- ---------------------------------------------------------

create table if not exists public.club_competition_player_entry_settings (
    competition_id uuid primary key
        references public.club_competitions(id) on delete cascade,
    self_entry_enabled boolean not null default false,
    entry_open_date date,
    entry_close_date date,
    max_entries integer,
    updated_by uuid references public.profiles(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint club_competition_player_entry_max_valid
        check (max_entries is null or max_entries between 1 and 500),
    constraint club_competition_player_entry_dates_valid
        check (
            entry_open_date is null
            or entry_close_date is null
            or entry_open_date <= entry_close_date
        )
);

alter table public.club_competition_player_entry_settings enable row level security;

-- Settings are exposed only through permission-checked RPCs.
revoke all on table public.club_competition_player_entry_settings from public, anon, authenticated;


-- ---------------------------------------------------------
-- CLUBHUB: READ PLAYER ENTRY SETTINGS
-- ---------------------------------------------------------

create or replace function public.competition_get_player_entry_settings(
    p_competition_id uuid
)
returns table (
    self_entry_enabled boolean,
    entry_open_date date,
    entry_close_date date,
    max_entries integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_club_id uuid;
begin
    if auth.uid() is null or p_competition_id is null then
        raise exception 'Competition access required.';
    end if;

    select competition.club_id
    into v_club_id
    from public.club_competitions as competition
    where competition.id = p_competition_id
    limit 1;

    if v_club_id is null
       or not public.user_can_view_competitions(v_club_id) then
        raise exception 'Competition access required.';
    end if;

    return query
    select
        coalesce(settings.self_entry_enabled, false)::boolean,
        settings.entry_open_date,
        settings.entry_close_date,
        settings.max_entries
    from (select 1) as anchor
    left join public.club_competition_player_entry_settings as settings
        on settings.competition_id = p_competition_id;
end;
$$;

revoke all
on function public.competition_get_player_entry_settings(uuid)
from public, anon;

grant execute
on function public.competition_get_player_entry_settings(uuid)
to authenticated;


-- ---------------------------------------------------------
-- CLUBHUB: SAVE PLAYER ENTRY SETTINGS
-- ---------------------------------------------------------

create or replace function public.competition_save_player_entry_settings(
    p_competition_id uuid,
    p_self_entry_enabled boolean,
    p_entry_open_date date default null,
    p_entry_close_date date default null,
    p_max_entries integer default null
)
returns table (
    self_entry_enabled boolean,
    entry_open_date date,
    entry_close_date date,
    max_entries integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_club_id uuid;
    v_competition_date date;
    v_competition_format text;
    v_results_confirmed_at timestamptz;
    v_enabled boolean;
begin
    if auth.uid() is null or p_competition_id is null then
        raise exception 'Competition management access required.';
    end if;

    select
        competition.club_id,
        coalesce(event.event_date, competition.competition_date)::date,
        competition.competition_format::text,
        competition.results_confirmed_at
    into
        v_club_id,
        v_competition_date,
        v_competition_format,
        v_results_confirmed_at
    from public.club_competitions as competition
    left join public.club_events as event
        on event.id = competition.club_event_id
    where competition.id = p_competition_id
    limit 1;

    if v_club_id is null
       or not public.user_can_manage_competitions(v_club_id) then
        raise exception 'Competition management access required.';
    end if;

    if v_results_confirmed_at is not null then
        raise exception 'Confirmed competition results cannot be changed.';
    end if;

    if p_max_entries is not null
       and (p_max_entries < 1 or p_max_entries > 500) then
        raise exception 'Maximum entries must be between 1 and 500.';
    end if;

    if p_entry_open_date is not null
       and p_entry_close_date is not null
       and p_entry_open_date > p_entry_close_date then
        raise exception 'Entry open date cannot be after the entry close date.';
    end if;

    if p_entry_open_date is not null
       and p_entry_open_date > v_competition_date then
        raise exception 'Entry open date cannot be after the competition date.';
    end if;

    if p_entry_close_date is not null
       and p_entry_close_date > v_competition_date then
        raise exception 'Entry close date cannot be after the competition date.';
    end if;

    v_enabled := coalesce(p_self_entry_enabled, false);

    if v_competition_format in ('fourball','greensomes','texas_scramble') then
        v_enabled := false;
    end if;

    insert into public.club_competition_player_entry_settings (
        competition_id,
        self_entry_enabled,
        entry_open_date,
        entry_close_date,
        max_entries,
        updated_by,
        updated_at
    )
    values (
        p_competition_id,
        v_enabled,
        p_entry_open_date,
        p_entry_close_date,
        p_max_entries,
        auth.uid(),
        now()
    )
    on conflict (competition_id)
    do update set
        self_entry_enabled = excluded.self_entry_enabled,
        entry_open_date = excluded.entry_open_date,
        entry_close_date = excluded.entry_close_date,
        max_entries = excluded.max_entries,
        updated_by = auth.uid(),
        updated_at = now();

    return query
    select
        settings.self_entry_enabled,
        settings.entry_open_date,
        settings.entry_close_date,
        settings.max_entries
    from public.club_competition_player_entry_settings as settings
    where settings.competition_id = p_competition_id;
end;
$$;

revoke all
on function public.competition_save_player_entry_settings(uuid,boolean,date,date,integer)
from public, anon;

grant execute
on function public.competition_save_player_entry_settings(uuid,boolean,date,date,integer)
to authenticated;


-- ---------------------------------------------------------
-- PLAYER CALENDAR V2
-- Enforces the ClubHub self-entry configuration.
-- ---------------------------------------------------------

create or replace function public.player_get_calendar_events_v2(
    p_club_id uuid,
    p_from_date date,
    p_to_date date
)
returns table (
    event_id uuid,
    event_date date,
    start_time time,
    time_text text,
    title text,
    section text,
    event_type text,
    location_type text,
    venue text,
    course_name text,
    competition_id uuid,
    competition_status text,
    competition_format text,
    is_qualifier boolean,
    entry_id uuid,
    entry_status text,
    entry_count bigint,
    can_enter boolean,
    can_withdraw boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_membership_id uuid;
    v_timezone text;
    v_today date;
begin
    if auth.uid() is null then
        raise exception 'You must be signed in.';
    end if;

    if p_club_id is null
       or p_from_date is null
       or p_to_date is null
       or p_to_date < p_from_date
       or p_to_date > p_from_date + 92 then
        raise exception 'A valid calendar range of up to 93 days is required.';
    end if;

    v_membership_id := public._player_membership_id_for_club(p_club_id, false);

    if v_membership_id is null then
        raise exception 'Club member access is required.';
    end if;

    select coalesce(nullif(trim(club.timezone), ''), 'Europe/London')
    into v_timezone
    from public.clubs as club
    where club.id = p_club_id
      and club.is_active = true
    limit 1;

    if v_timezone is null then
        raise exception 'Club not found.';
    end if;

    v_today := (now() at time zone v_timezone)::date;

    return query
    select
        event.id,
        event.event_date,
        event.start_time,
        event.time_text,
        event.title::text,
        event.section::text,
        event.event_type::text,
        event.location_type::text,
        event.venue::text,
        course.name::text,
        competition.id,
        competition.status::text,
        competition.competition_format::text,
        coalesce(competition.is_qualifier, event.is_qualifier, false)::boolean,
        my_entry.id,
        my_entry.entry_status::text,
        counts.entry_count,
        (
            event.event_type = 'competition'
            and competition.id is not null
            and competition.status = 'open'
            and competition.competition_format not in ('fourball','greensomes','texas_scramble')
            and coalesce(settings.self_entry_enabled, false) = true
            and event.event_date >= v_today
            and (settings.entry_open_date is null or settings.entry_open_date <= v_today)
            and (settings.entry_close_date is null or settings.entry_close_date >= v_today)
            and (settings.max_entries is null or counts.entry_count < settings.max_entries)
            and (my_entry.id is null or my_entry.entry_status = 'withdrawn')
        )::boolean,
        (
            competition.id is not null
            and competition.status = 'open'
            and competition.competition_format not in ('fourball','greensomes','texas_scramble')
            and coalesce(settings.self_entry_enabled, false) = true
            and event.event_date >= v_today
            and (settings.entry_open_date is null or settings.entry_open_date <= v_today)
            and (settings.entry_close_date is null or settings.entry_close_date >= v_today)
            and my_entry.entry_status = 'entered'
        )::boolean
    from public.club_events as event
    left join public.courses as course
        on course.id = event.course_id
    left join public.club_competitions as competition
        on competition.club_event_id = event.id
       and competition.club_id = event.club_id
    left join public.club_competition_player_entry_settings as settings
        on settings.competition_id = competition.id
    left join public.club_competition_entries as my_entry
        on my_entry.competition_id = competition.id
       and my_entry.membership_id = v_membership_id
    left join lateral (
        select count(*)::bigint as entry_count
        from public.club_competition_entries as entry_count_row
        where entry_count_row.competition_id = competition.id
          and entry_count_row.entry_status <> 'withdrawn'
    ) as counts on true
    where event.club_id = p_club_id
      and event.is_published = true
      and event.status <> 'cancelled'
      and event.event_date between p_from_date and p_to_date
    order by
        event.event_date,
        event.start_time nulls last,
        event.display_order,
        lower(event.title);
end;
$$;

revoke all
on function public.player_get_calendar_events_v2(uuid,date,date)
from public, anon;

grant execute
on function public.player_get_calendar_events_v2(uuid,date,date)
to authenticated;


-- ---------------------------------------------------------
-- PLAYER COMPETITION DIRECTORY
-- This is the RPC already referenced by competitions-page.js.
-- ---------------------------------------------------------

create or replace function public.player_list_competitions(
    p_club_id uuid,
    p_from_date date,
    p_to_date date,
    p_filter text default null
)
returns table (
    competition_id uuid,
    club_name text,
    competition_name text,
    competition_date date,
    competition_format text,
    section text,
    competition_status text,
    is_qualifier boolean,
    entry_count bigint,
    max_entries integer,
    my_entry_status text,
    entry_state text,
    entry_message text,
    can_enter boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_membership_id uuid;
    v_timezone text;
    v_today date;
    v_filter text;
begin
    if auth.uid() is null then
        raise exception 'You must be signed in.';
    end if;

    if p_club_id is null
       or p_from_date is null
       or p_to_date is null
       or p_to_date < p_from_date
       or p_to_date > p_from_date + 366 then
        raise exception 'A valid competition date range is required.';
    end if;

    v_membership_id := public._player_membership_id_for_club(p_club_id, false);

    if v_membership_id is null then
        raise exception 'Club member access is required.';
    end if;

    select coalesce(nullif(trim(club.timezone), ''), 'Europe/London')
    into v_timezone
    from public.clubs as club
    where club.id = p_club_id
      and club.is_active = true
    limit 1;

    if v_timezone is null then
        raise exception 'Club not found.';
    end if;

    v_today := (now() at time zone v_timezone)::date;
    v_filter := nullif(lower(trim(coalesce(p_filter, ''))), '');

    return query
    with rows as (
        select
            competition.id as competition_id,
            club.name::text as club_name,
            coalesce(event.title, competition.name)::text as competition_name,
            coalesce(event.event_date, competition.competition_date)::date as competition_date,
            competition.competition_format::text as competition_format,
            coalesce(event.section, competition.section)::text as section,
            competition.status::text as competition_status,
            coalesce(competition.is_qualifier, event.is_qualifier, false)::boolean as is_qualifier,
            counts.entry_count,
            settings.max_entries,
            my_entry.entry_status::text as my_entry_status,
            coalesce(settings.self_entry_enabled, false) as self_entry_enabled,
            settings.entry_open_date,
            settings.entry_close_date
        from public.club_competitions as competition
        join public.clubs as club
            on club.id = competition.club_id
           and club.is_active = true
        left join public.club_events as event
            on event.id = competition.club_event_id
        left join public.club_competition_player_entry_settings as settings
            on settings.competition_id = competition.id
        left join public.club_competition_entries as my_entry
            on my_entry.competition_id = competition.id
           and my_entry.membership_id = v_membership_id
        left join lateral (
            select count(*)::bigint as entry_count
            from public.club_competition_entries as active_entry
            where active_entry.competition_id = competition.id
              and active_entry.entry_status <> 'withdrawn'
        ) as counts on true
        where competition.club_id = p_club_id
          and coalesce(event.event_date, competition.competition_date) between p_from_date and p_to_date
          and competition.status <> 'cancelled'
    ), states as (
        select
            rows.*,
            case
                when rows.my_entry_status = 'completed' then 'completed'
                when rows.my_entry_status = 'entered' then 'entered'
                when rows.competition_format in ('fourball','greensomes','texas_scramble') then 'club_managed_team'
                when rows.self_entry_enabled = false then 'club_managed'
                when rows.competition_status <> 'open' then 'closed'
                when rows.competition_date < v_today then 'closed'
                when rows.entry_open_date is not null and rows.entry_open_date > v_today then 'not_open'
                when rows.entry_close_date is not null and rows.entry_close_date < v_today then 'closed'
                when rows.max_entries is not null and rows.entry_count >= rows.max_entries then 'full'
                when rows.my_entry_status = 'withdrawn' then 'withdrawn'
                else 'open'
            end::text as entry_state
        from rows
    )
    select
        states.competition_id,
        states.club_name,
        states.competition_name,
        states.competition_date,
        states.competition_format,
        states.section,
        states.competition_status,
        states.is_qualifier,
        states.entry_count,
        states.max_entries,
        states.my_entry_status,
        states.entry_state,
        case states.entry_state
            when 'entered' then 'Your entry is confirmed.'
            when 'completed' then 'Results have been recorded for your entry.'
            when 'withdrawn' then 'You withdrew earlier. Entry is still open if you want to re-enter.'
            when 'open' then 'Online entry is open.'
            when 'full' then 'This competition has reached its entry limit.'
            when 'not_open' then 'Online entry has not opened yet.'
            when 'club_managed_team' then 'Team-format entries are managed by the club.'
            when 'club_managed' then 'Entry is managed by the club.'
            else 'Online entry is closed.'
        end::text,
        (states.entry_state in ('open','withdrawn'))::boolean
    from states
    where
        v_filter is null
        or (v_filter = 'open' and states.entry_state in ('open','withdrawn'))
        or (v_filter = 'entered' and states.my_entry_status = 'entered')
        or v_filter = 'all'
    order by states.competition_date, lower(states.competition_name);
end;
$$;

revoke all
on function public.player_list_competitions(uuid,date,date,text)
from public, anon;

grant execute
on function public.player_list_competitions(uuid,date,date,text)
to authenticated;


-- ---------------------------------------------------------
-- PLAYER: ENTER AN OPEN COMPETITION
-- Now enforces ClubHub Player-entry settings and capacity atomically.
-- ---------------------------------------------------------

create or replace function public.player_enter_competition(
    p_competition_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_club_id uuid;
    v_competition_name text;
    v_competition_date date;
    v_competition_format text;
    v_status text;
    v_timezone text;
    v_today date;
    v_self_entry_enabled boolean;
    v_entry_open_date date;
    v_entry_close_date date;
    v_max_entries integer;
    v_active_entries bigint;
    v_membership_id uuid;
    v_name text;
    v_email text;
    v_membership_number text;
    v_entry_id uuid;
    v_entry_status text;
    v_action_url text;
begin
    if auth.uid() is null then
        raise exception 'You must be signed in.';
    end if;

    -- Serialise entry/capacity checks for this competition.
    perform 1
    from public.club_competitions as competition_lock
    where competition_lock.id = p_competition_id
    for update;

    select
        competition.club_id,
        coalesce(event.title, competition.name)::text,
        coalesce(event.event_date, competition.competition_date)::date,
        competition.competition_format::text,
        competition.status::text,
        coalesce(nullif(trim(club.timezone), ''), 'Europe/London'),
        coalesce(settings.self_entry_enabled, false),
        settings.entry_open_date,
        settings.entry_close_date,
        settings.max_entries
    into
        v_club_id,
        v_competition_name,
        v_competition_date,
        v_competition_format,
        v_status,
        v_timezone,
        v_self_entry_enabled,
        v_entry_open_date,
        v_entry_close_date,
        v_max_entries
    from public.club_competitions as competition
    join public.clubs as club
        on club.id = competition.club_id
       and club.is_active = true
    left join public.club_events as event
        on event.id = competition.club_event_id
    left join public.club_competition_player_entry_settings as settings
        on settings.competition_id = competition.id
    where competition.id = p_competition_id
    limit 1;

    if v_club_id is null then
        raise exception 'Competition not found.';
    end if;

    v_today := (now() at time zone v_timezone)::date;

    if v_competition_format in ('fourball','greensomes','texas_scramble') then
        raise exception 'Team-format entry is managed by the club.';
    end if;

    if not v_self_entry_enabled then
        raise exception 'Online entry is not enabled for this competition.';
    end if;

    if v_status <> 'open' then
        raise exception 'Entries are not open for this competition.';
    end if;

    if v_competition_date < v_today then
        raise exception 'This competition has already passed.';
    end if;

    if v_entry_open_date is not null and v_entry_open_date > v_today then
        raise exception 'Online entry has not opened yet.';
    end if;

    if v_entry_close_date is not null and v_entry_close_date < v_today then
        raise exception 'Online entry has closed.';
    end if;

    v_membership_id := public._player_membership_id_for_club(v_club_id, false);

    if v_membership_id is null then
        raise exception 'An active club membership is required to enter.';
    end if;

    select
        coalesce(
            nullif(trim(membership.club_display_name), ''),
            nullif(trim(concat_ws(' ', membership.club_first_name, membership.club_last_name)), ''),
            nullif(trim(membership.club_email), ''),
            'Member'
        )::text,
        membership.club_email::text,
        membership.membership_number::text
    into
        v_name,
        v_email,
        v_membership_number
    from public.club_memberships as membership
    where membership.id = v_membership_id
      and membership.club_id = v_club_id
      and membership.status = 'active'
      and coalesce(membership.membership_type, 'member') not in ('visitor','guest','staff')
    limit 1;

    if v_name is null then
        raise exception 'An active genuine club membership is required.';
    end if;

    select entry.id, entry.entry_status
    into v_entry_id, v_entry_status
    from public.club_competition_entries as entry
    where entry.competition_id = p_competition_id
      and entry.membership_id = v_membership_id
    limit 1;

    if v_entry_id is not null and v_entry_status = 'entered' then
        return v_entry_id;
    end if;

    if v_entry_id is not null and v_entry_status <> 'withdrawn' then
        raise exception 'This competition entry can no longer be changed by the Player.';
    end if;

    select count(*)
    into v_active_entries
    from public.club_competition_entries as entry
    where entry.competition_id = p_competition_id
      and entry.entry_status <> 'withdrawn';

    if v_max_entries is not null and v_active_entries >= v_max_entries then
        raise exception 'This competition is full.';
    end if;

    if v_entry_id is not null then
        update public.club_competition_entries as entry
        set
            entry_status = 'entered',
            entrant_name = v_name,
            entrant_email = v_email,
            membership_number = v_membership_number,
            gross_score = null,
            nett_score = null,
            points = null,
            finishing_position = null,
            result_text = null,
            updated_at = now()
        where entry.id = v_entry_id;
    else
        insert into public.club_competition_entries (
            competition_id,
            membership_id,
            entry_type,
            entrant_name,
            entrant_email,
            membership_number,
            entry_status,
            created_by
        )
        values (
            p_competition_id,
            v_membership_id,
            'member',
            v_name,
            v_email,
            v_membership_number,
            'entered',
            auth.uid()
        )
        returning id into v_entry_id;
    end if;

    v_action_url :=
        'calendar.html?club=' || v_club_id::text ||
        '&competition=' || p_competition_id::text ||
        '&date=' || v_competition_date::text;

    perform public._player_create_notification(
        auth.uid(),
        v_club_id,
        'competition_entry',
        'Competition entered',
        v_competition_name || ' · ' || to_char(v_competition_date, 'Dy DD Mon'),
        v_action_url,
        jsonb_build_object(
            'competition_id', p_competition_id,
            'entry_id', v_entry_id,
            'competition_date', v_competition_date
        ),
        null
    );

    return v_entry_id;
end;
$$;

revoke all
on function public.player_enter_competition(uuid)
from public, anon;

grant execute
on function public.player_enter_competition(uuid)
to authenticated;


-- ---------------------------------------------------------
-- PLAYER: WITHDRAW FROM AN OPEN COMPETITION
-- ---------------------------------------------------------

create or replace function public.player_withdraw_competition(
    p_competition_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_club_id uuid;
    v_competition_name text;
    v_competition_date date;
    v_competition_format text;
    v_status text;
    v_timezone text;
    v_today date;
    v_self_entry_enabled boolean;
    v_entry_open_date date;
    v_entry_close_date date;
    v_membership_id uuid;
    v_entry_id uuid;
    v_action_url text;
begin
    if auth.uid() is null then
        raise exception 'You must be signed in.';
    end if;

    select
        competition.club_id,
        coalesce(event.title, competition.name)::text,
        coalesce(event.event_date, competition.competition_date)::date,
        competition.competition_format::text,
        competition.status::text,
        coalesce(nullif(trim(club.timezone), ''), 'Europe/London'),
        coalesce(settings.self_entry_enabled, false),
        settings.entry_open_date,
        settings.entry_close_date
    into
        v_club_id,
        v_competition_name,
        v_competition_date,
        v_competition_format,
        v_status,
        v_timezone,
        v_self_entry_enabled,
        v_entry_open_date,
        v_entry_close_date
    from public.club_competitions as competition
    join public.clubs as club
        on club.id = competition.club_id
       and club.is_active = true
    left join public.club_events as event
        on event.id = competition.club_event_id
    left join public.club_competition_player_entry_settings as settings
        on settings.competition_id = competition.id
    where competition.id = p_competition_id
    limit 1;

    if v_club_id is null then
        raise exception 'Competition not found.';
    end if;

    v_today := (now() at time zone v_timezone)::date;

    if v_competition_format in ('fourball','greensomes','texas_scramble')
       or not v_self_entry_enabled then
        raise exception 'This competition entry is managed by the club.';
    end if;

    if v_status <> 'open' then
        raise exception 'This competition entry can no longer be withdrawn online.';
    end if;

    if v_competition_date < v_today then
        raise exception 'This competition has already passed.';
    end if;

    if v_entry_open_date is not null and v_entry_open_date > v_today then
        raise exception 'Online entry has not opened yet.';
    end if;

    if v_entry_close_date is not null and v_entry_close_date < v_today then
        raise exception 'Online entry has closed.';
    end if;

    v_membership_id := public._player_membership_id_for_club(v_club_id, false);

    if v_membership_id is null then
        raise exception 'An active club membership is required.';
    end if;

    select entry.id
    into v_entry_id
    from public.club_competition_entries as entry
    where entry.competition_id = p_competition_id
      and entry.membership_id = v_membership_id
      and entry.entry_status = 'entered'
    limit 1;

    if v_entry_id is null then
        raise exception 'You do not have an active entry in this competition.';
    end if;

    update public.club_competition_entries as entry
    set
        entry_status = 'withdrawn',
        updated_at = now()
    where entry.id = v_entry_id;

    v_action_url :=
        'calendar.html?club=' || v_club_id::text ||
        '&competition=' || p_competition_id::text ||
        '&date=' || v_competition_date::text;

    perform public._player_create_notification(
        auth.uid(),
        v_club_id,
        'competition_withdrawn',
        'Competition entry withdrawn',
        v_competition_name || ' · ' || to_char(v_competition_date, 'Dy DD Mon'),
        v_action_url,
        jsonb_build_object(
            'competition_id', p_competition_id,
            'entry_id', v_entry_id,
            'competition_date', v_competition_date
        ),
        null
    );

    return true;
end;
$$;

revoke all
on function public.player_withdraw_competition(uuid)
from public, anon;

grant execute
on function public.player_withdraw_competition(uuid)
to authenticated;


-- ---------------------------------------------------------
-- COMPATIBILITY RPC FOR THE UNUSED EARLY GAMES PAGE
-- The live Find-a-Game page calls member_join_booking() directly, but this
-- keeps games-page.js from failing if it is opened directly.
-- ---------------------------------------------------------

create or replace function public.player_join_game(
    p_booking_id uuid,
    p_player_count smallint default 1
)
returns uuid
language sql
security definer
set search_path = ''
as $$
    select public.member_join_booking(p_booking_id, p_player_count);
$$;

revoke all
on function public.player_join_game(uuid,smallint)
from public, anon;

grant execute
on function public.player_join_game(uuid,smallint)
to authenticated;

commit;

notify pgrst, 'reload schema';
