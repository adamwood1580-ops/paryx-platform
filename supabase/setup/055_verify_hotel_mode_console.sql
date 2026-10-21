-- Paryx Hotel Mode Phase 1 - read-only setup verification.
-- Run as a SQL Editor admin after migration 055; expected: all clubs have config rows;
-- hotel_mode_settings.enabled remains FALSE unless explicitly enabled in Console.
select c.name, c.slug, h.enabled, h.hotel_booking_days,
       h.society_booking_days, h.hotel_allocation_percent,
       h.member_allocation_percent, h.hotel_release_days
from public.clubs c left join public.hotel_mode_settings h on h.club_id = c.id
order by c.name;

select c.name, r.staff_role, r.can_manage_hotel, r.can_manage_societies, r.can_override
from public.clubs c join public.hotel_mode_role_permissions r on r.club_id = c.id
order by c.name, r.staff_role;

-- Expect zero rows: missing club configs or incomplete role rows.
select c.name, count(r.staff_role) as role_count
from public.clubs c
left join public.hotel_mode_settings h on h.club_id = c.id
left join public.hotel_mode_role_permissions r on r.club_id = c.id
where h.club_id is null or r.staff_role is null
   or h.hotel_allocation_percent + h.member_allocation_percent > 100
   or h.hotel_release_days >= h.hotel_booking_days
   or h.member_release_days >= h.member_booking_days
group by c.name;
