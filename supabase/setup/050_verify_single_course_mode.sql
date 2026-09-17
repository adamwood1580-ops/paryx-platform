-- Read-only verification for Migration 050
select
    cs.club_id,
    c.name as club_name,
    cs.single_course_mode,
    cs.default_course_id,
    dc.name as default_course_name,
    count(ac.id) filter (where ac.is_active = true) as active_course_count
from public.club_settings cs
join public.clubs c on c.id = cs.club_id
left join public.courses dc on dc.id = cs.default_course_id
left join public.courses ac on ac.club_id = cs.club_id
group by cs.club_id, c.name, cs.single_course_mode, cs.default_course_id, dc.name
order by lower(c.name);

select proname
from pg_proc
where proname in ('get_club_course_mode','admin_set_single_course_mode','enforce_single_course_mode')
order by proname;
