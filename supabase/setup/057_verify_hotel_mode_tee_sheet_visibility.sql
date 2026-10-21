-- Read-only installation check for 057, run in Supabase SQL Editor.
-- Does not require a club ID or modify any bookings.
select to_regprocedure('public.staff_get_hotel_mode_tee_sheet(uuid,uuid,date)')
       is not null as visibility_rpc_installed,
       to_regprocedure('public.hotel_mode_slot_class(uuid)')
       is not null as allocation_engine_installed,
       to_regprocedure('public.hotel_mode_can_book(uuid,text)')
       is not null as booking_guard_installed;

select c.name, h.enabled, h.hotel_allocation_percent,
       h.member_allocation_percent, h.hotel_release_days, h.member_release_days
from public.hotel_mode_settings h join public.clubs c on c.id = h.club_id
order by c.name;

-- To verify an actual generated day, replace <COURSE_UUID> and date:
-- select t.start_time, public.hotel_mode_slot_class(t.id) as allocation
-- from public.tee_times t
-- where t.course_id = '<COURSE_UUID>'::uuid and t.play_date = '2026-11-03'
-- order by t.start_time;
