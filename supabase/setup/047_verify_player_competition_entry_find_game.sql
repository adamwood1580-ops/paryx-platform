-- =========================================================
-- PARYX v0.29.0 — READ-ONLY VERIFICATION
-- Competition Entry + Find a Game
-- =========================================================

-- 1) Confirm the Player RPCs exist.
select
    routine_name,
    routine_type
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
      'player_get_calendar_events_v2',
      'player_enter_competition',
      'player_withdraw_competition',
      'player_find_games'
  )
order by routine_name;

-- 2) Current open competitions and active entry counts.
select
    competition.id as competition_id,
    competition.club_id,
    club.name as club_name,
    coalesce(event.title, competition.name) as competition_name,
    coalesce(event.event_date, competition.competition_date) as competition_date,
    competition.status,
    count(entry.id) filter (where entry.entry_status <> 'withdrawn') as active_entries,
    count(entry.id) filter (where entry.entry_status = 'withdrawn') as withdrawn_entries
from public.club_competitions as competition
join public.clubs as club
    on club.id = competition.club_id
left join public.club_events as event
    on event.id = competition.club_event_id
left join public.club_competition_entries as entry
    on entry.competition_id = competition.id
where competition.status = 'open'
group by
    competition.id,
    competition.club_id,
    club.name,
    event.title,
    event.event_date,
    competition.name,
    competition.competition_date,
    competition.status
order by competition_date, club_name, competition_name;

-- 3) Privacy-safe Find a Game candidates at database level.
-- This intentionally shows only operational booking data, never Player contact data.
select
    booking.id as booking_id,
    club.name as club_name,
    course.name as course_name,
    tee_time.play_date,
    tee_time.start_time,
    booking.player_count,
    tee_time.max_players,
    greatest(tee_time.max_players - coalesce(booking.player_count, 0), 0) as spaces_remaining
from public.bookings as booking
join public.tee_times as tee_time
    on tee_time.id = booking.tee_time_id
join public.courses as course
    on course.id = tee_time.course_id
join public.clubs as club
    on club.id = course.club_id
where booking.booking_status = 'active'
  and booking.booking_type = 'joinable'
  and tee_time.operational_status = 'open'
  and tee_time.play_date between current_date and current_date + 14
  and greatest(tee_time.max_players - coalesce(booking.player_count, 0), 0) > 0
order by tee_time.play_date, tee_time.start_time;
