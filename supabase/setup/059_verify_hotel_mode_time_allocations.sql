-- Read-only checks after installing 059. Safe to run from Supabase SQL Editor.
-- Inspect every result; no settings or tee-time rows are modified.

-- (1) One mode per club; existing Hotel Mode configuration must be retained.
select c.name as club_name, h.enabled, h.allocation_mode,
       h.hotel_allocation_percent, h.member_allocation_percent,
       (select count(*) from public.hotel_mode_time_allocations r where r.club_id = c.id) as time_rules
from public.clubs c
join public.hotel_mode_settings h on h.club_id = c.id
order by c.name;

-- (2) See exactly which bands Console saved, including course/date precedence.
select c.name as club_name, coalesce(cr.name,'All courses') as course,
       case when r.specific_date is not null then r.specific_date::text
            else (array['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'])[r.weekday+1]
       end as applies_to,
       to_char(r.start_time,'HH24:MI') as from_time,
       to_char(r.end_time,'HH24:MI') as until_time,
       r.allocation
from public.hotel_mode_time_allocations r
join public.clubs c on c.id = r.club_id
left join public.courses cr on cr.id = r.course_id
order by c.name, r.specific_date nulls last,r.weekday nulls last,r.start_time;

-- (3) Verify SQL objects exist and the schedule column's default is 'percentage'.
select
  to_regclass('public.hotel_mode_time_allocations') is not null as rules_table_present,
  to_regprocedure('public.hotel_mode_validate_time_allocation()') is not null as overlap_validator_present,
  to_regprocedure('public.hotel_mode_slot_class(uuid)') is not null as booking_classifier_present,
  to_regprocedure('public.platform_hotel_mode_save(uuid,jsonb,jsonb)') is not null as console_save_present;

-- (4) Inspect classifications on the next generated days; empty result means
-- no generated tee times for the future, not a migration failure.
select c.name as club_name, cr.name as course, t.play_date,
       to_char(t.start_time,'HH24:MI') as tee_time,
       public.hotel_mode_slot_class(t.id) as priority
from public.tee_times t
join public.courses cr on cr.id = t.course_id
join public.clubs c on c.id = cr.club_id
join public.hotel_mode_settings h on h.club_id = c.id and h.enabled
where t.play_date between current_date and current_date+14
order by c.name,t.play_date,t.start_time
limit 100;
