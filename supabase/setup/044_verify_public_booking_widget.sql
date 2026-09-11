-- Paryx v0.27.0 — read-only website booking widget verification.
-- Run after migration 044. This does not change any data.

select
    club.name as club_name,
    club.slug as club_slug,
    coalesce(settings.public_booking_enabled, false) as public_booking_enabled,
    coalesce(settings.public_booking_advance_days, 14) as public_booking_advance_days,
    count(course.id) filter (where course.is_active) as active_courses
from public.clubs as club
left join public.club_settings as settings
    on settings.club_id = club.id
left join public.courses as course
    on course.club_id = club.id
where club.is_active = true
group by
    club.id,
    club.name,
    club.slug,
    settings.public_booking_enabled,
    settings.public_booking_advance_days
order by lower(club.name);
