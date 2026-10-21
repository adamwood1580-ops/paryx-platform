-- Run in Supabase SQL Editor (read-only). Follow with role-authenticated UI tests.
select p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in (
  'platform_hotel_mode_get','platform_hotel_mode_save',
  'platform_update_club_configuration_hotel','club_hotel_mode_get',
  'club_hotel_mode_save_policy','club_hotel_mode_save_permissions',
  'hotel_mode_slot_class'
) order by p.proname;

select c.name as club,hs.enabled,hs.allocation_mode,
       hs.hotel_allocation_percent,hs.member_allocation_percent,
       count(r.id) as timed_rules
from public.hotel_mode_settings hs
join public.clubs c on c.id=hs.club_id
left join public.hotel_mode_time_allocations r on r.club_id=hs.club_id
group by c.name,hs.enabled,hs.allocation_mode,
         hs.hotel_allocation_percent,hs.member_allocation_percent
order by c.name;
