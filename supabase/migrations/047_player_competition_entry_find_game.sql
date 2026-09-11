-- =========================================================
-- PARYX MIGRATION 047
-- PLAYER COMPETITION ENTRY + FIND A GAME
-- =========================================================
--
-- Adds two Player-facing capabilities:
--   1) self-entry / withdrawal for open club competitions;
--   2) privacy-safe discovery of joinable tee-time bookings across Paryx.
--
-- Competition entry is restricted to an active genuine club membership.
-- Find a Game is available to any authenticated Player; joining a game uses
-- the existing member_join_booking() flow, which creates visitor club access
-- when required.
-- =========================================================

begin;

-- =========================================================
-- PLAYER CALENDAR V2
-- Includes competition entry state without exposing private Player linkage.
-- =========================================================

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
        coalesce((
            select count(*)
            from public.club_competition_entries as entry_count_row
            where entry_count_row.competition_id = competition.id
              and entry_count_row.entry_status <> 'withdrawn'
        ), 0)::bigint,
        (
            event.event_type = 'competition'
            and competition.id is not null
            and competition.status = 'open'
            and event.event_date >= v_today
            and (
                my_entry.id is null
                or my_entry.entry_status = 'withdrawn'
            )
        )::boolean,
        (
            competition.id is not null
            and competition.status = 'open'
            and event.event_date >= v_today
            and my_entry.entry_status = 'entered'
        )::boolean
    from public.club_events as event
    left join public.courses as course
        on course.id = event.course_id
    left join public.club_competitions as competition
        on competition.club_event_id = event.id
       and competition.club_id = event.club_id
    left join public.club_competition_entries as my_entry
        on my_entry.competition_id = competition.id
       and my_entry.membership_id = v_membership_id
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


-- =========================================================
-- PLAYER: ENTER AN OPEN COMPETITION
-- =========================================================

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
    v_status text;
    v_timezone text;
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

    select
        competition.club_id,
        coalesce(event.title, competition.name)::text,
        coalesce(event.event_date, competition.competition_date)::date,
        competition.status::text,
        coalesce(nullif(trim(club.timezone), ''), 'Europe/London')
    into
        v_club_id,
        v_competition_name,
        v_competition_date,
        v_status,
        v_timezone
    from public.club_competitions as competition
    join public.clubs as club
        on club.id = competition.club_id
       and club.is_active = true
    left join public.club_events as event
        on event.id = competition.club_event_id
    where competition.id = p_competition_id
    limit 1;

    if v_club_id is null then
        raise exception 'Competition not found.';
    end if;

    if v_status <> 'open' then
        raise exception 'Entries are not open for this competition.';
    end if;

    if v_competition_date < (now() at time zone v_timezone)::date then
        raise exception 'This competition has already passed.';
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

    if v_entry_id is not null then
        if v_entry_status = 'entered' then
            return v_entry_id;
        end if;

        if v_entry_status <> 'withdrawn' then
            raise exception 'This competition entry can no longer be changed by the Player.';
        end if;

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


-- =========================================================
-- PLAYER: WITHDRAW FROM AN OPEN COMPETITION
-- =========================================================

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
    v_status text;
    v_timezone text;
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
        competition.status::text,
        coalesce(nullif(trim(club.timezone), ''), 'Europe/London')
    into
        v_club_id,
        v_competition_name,
        v_competition_date,
        v_status,
        v_timezone
    from public.club_competitions as competition
    join public.clubs as club
        on club.id = competition.club_id
       and club.is_active = true
    left join public.club_events as event
        on event.id = competition.club_event_id
    where competition.id = p_competition_id
    limit 1;

    if v_club_id is null then
        raise exception 'Competition not found.';
    end if;

    if v_status <> 'open' then
        raise exception 'This competition entry can no longer be withdrawn online.';
    end if;

    if v_competition_date < (now() at time zone v_timezone)::date then
        raise exception 'This competition has already passed.';
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


-- =========================================================
-- FIND A GAME
-- Privacy-safe discovery of open joinable bookings.
-- No Player/member names, contact details or membership identifiers leave RPC.
-- =========================================================

create or replace function public.player_find_games(
    p_from_date date default current_date,
    p_to_date date default (current_date + 14),
    p_club_id uuid default null,
    p_min_spaces smallint default 1,
    p_limit integer default 40,
    p_offset integer default 0
)
returns table (
    booking_id uuid,
    tee_time_id uuid,
    club_id uuid,
    club_name text,
    course_id uuid,
    course_name text,
    play_date date,
    start_time time,
    player_count smallint,
    max_players smallint,
    spaces_remaining smallint,
    is_member_club boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_from date;
    v_to date;
    v_min_spaces smallint;
    v_limit integer;
    v_offset integer;
begin
    if auth.uid() is null then
        raise exception 'You must be signed in.';
    end if;

    v_from := coalesce(p_from_date, current_date);
    v_to := coalesce(p_to_date, v_from + 14);
    v_min_spaces := greatest(1, least(coalesce(p_min_spaces, 1), 8));
    v_limit := greatest(1, least(coalesce(p_limit, 40), 100));
    v_offset := greatest(0, coalesce(p_offset, 0));

    if v_to < v_from or v_to > v_from + 31 then
        raise exception 'Find a Game date range must be between 1 and 32 days.';
    end if;

    return query
    select
        booking.id,
        tee_time.id,
        club.id,
        club.name::text,
        course.id,
        course.name::text,
        tee_time.play_date,
        tee_time.start_time,
        coalesce(booking.player_count, 0)::smallint,
        tee_time.max_players,
        greatest(tee_time.max_players - coalesce(booking.player_count, 0), 0)::smallint,
        (public._player_membership_id_for_club(club.id, false) is not null)::boolean
    from public.bookings as booking
    join public.tee_times as tee_time
        on tee_time.id = booking.tee_time_id
    join public.courses as course
        on course.id = tee_time.course_id
       and course.is_active = true
    join public.clubs as club
        on club.id = course.club_id
       and club.is_active = true
    where booking.booking_status = 'active'
      and booking.booking_type = 'joinable'
      and tee_time.operational_status = 'open'
      and tee_time.play_date between v_from and v_to
      and (p_club_id is null or club.id = p_club_id)
      and greatest(tee_time.max_players - coalesce(booking.player_count, 0), 0) >= v_min_spaces
      and (
          tee_time.play_date > (now() at time zone coalesce(nullif(trim(club.timezone), ''), 'Europe/London'))::date
          or (
              tee_time.play_date = (now() at time zone coalesce(nullif(trim(club.timezone), ''), 'Europe/London'))::date
              and tee_time.start_time > (now() at time zone coalesce(nullif(trim(club.timezone), ''), 'Europe/London'))::time
          )
      )
      and not exists (
          select 1
          from public.club_memberships as creator_membership
          where creator_membership.id = booking.created_by_membership_id
            and (
                creator_membership.profile_id = auth.uid()
                or exists (
                    select 1
                    from public.club_membership_player_links as creator_link
                    where creator_link.membership_id = creator_membership.id
                      and creator_link.profile_id = auth.uid()
                )
            )
      )
      and not exists (
          select 1
          from public.booking_members as booking_member
          join public.club_memberships as member_membership
            on member_membership.id = booking_member.membership_id
          where booking_member.booking_id = booking.id
            and booking_member.member_status in ('invited','confirmed','checked_in')
            and (
                member_membership.profile_id = auth.uid()
                or exists (
                    select 1
                    from public.club_membership_player_links as member_link
                    where member_link.membership_id = member_membership.id
                      and member_link.profile_id = auth.uid()
                )
            )
      )
    order by
        tee_time.play_date,
        tee_time.start_time,
        lower(club.name),
        lower(course.name)
    limit v_limit
    offset v_offset;
end;
$$;

revoke all
on function public.player_find_games(date,date,uuid,smallint,integer,integer)
from public, anon;

grant execute
on function public.player_find_games(date,date,uuid,smallint,integer,integer)
to authenticated;

commit;

notify pgrst, 'reload schema';
