-- Phase 2 read-only diagnostic. Run after migration 056.
-- Replace this with a real club ID from your Paryx Console (no write operations).
-- To preview distribution at a course/day, supply actual UUID and date:
-- SELECT t.start_time, public.hotel_mode_slot_class(t.id) as priority,
--        public.hotel_mode_can_book(t.id, 'auto') as can_current_user_book
-- FROM public.tee_times t WHERE t.course_id = 'REPLACE-UUID'::uuid
--   AND t.play_date = '2026-11-18'::date ORDER BY t.start_time;

select c.name as club, s.enabled, s.hotel_allocation_percent,
       s.member_allocation_percent, s.hotel_release_days,
       s.member_release_days, s.hotel_booking_days,
       s.member_booking_days, s.visitor_booking_days
from public.hotel_mode_settings s
join public.clubs c on c.id = s.club_id
order by c.name;

select routine_name from information_schema.routines
where routine_schema = 'public'
  and routine_name in ('hotel_mode_slot_class','hotel_mode_can_book',
                       'hotel_mode_assert_booking_allowed','hotel_mode_player_visible_days')
order by routine_name;

select tgname, tgrelid::regclass as target
from pg_trigger
where not tgisinternal and tgname in (
    'hotel_mode_guard_booking_write',
    'hotel_mode_guard_member_join',
    'hotel_mode_guard_guest_join'
) order by tgname;
