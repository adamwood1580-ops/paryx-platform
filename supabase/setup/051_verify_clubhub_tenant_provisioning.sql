-- PARYX v0.30.0 — READ-ONLY VERIFICATION

-- The catalogue must contain the complete 13-module release contract.
select
    module_key,
    label,
    route,
    display_order,
    default_enabled,
    required,
    depends_on
from public.club_module_catalog
order by display_order;

-- Every club must have exactly one state row for every catalogue module.
select
    club.id as club_id,
    club.name as club_name,
    count(module.module_key) as configured_modules,
    count(*) filter (where module.is_enabled) as enabled_modules
from public.clubs as club
left join public.club_modules as module
    on module.club_id = club.id
group by club.id, club.name
order by lower(club.name);

-- No enabled module may have a disabled prerequisite.
select
    club.name as club_name,
    module.module_key,
    catalog.depends_on
from public.club_modules as module
join public.club_module_catalog as catalog
    on catalog.module_key = module.module_key
join public.clubs as club
    on club.id = module.club_id
left join public.club_modules as dependency
    on dependency.club_id = module.club_id
   and dependency.module_key = catalog.depends_on
where module.is_enabled
  and catalog.depends_on is not null
  and coalesce(dependency.is_enabled, false) = false;

-- Provisioned clubs must have one persisted default course. Single-course
-- clubs must point to their only active course.
select
    club.name as club_name,
    settings.single_course_mode,
    settings.default_course_id,
    default_course.name as default_course_name,
    count(course.id) filter (where course.is_active) as active_courses
from public.clubs as club
left join public.club_settings as settings
    on settings.club_id = club.id
left join public.courses as default_course
    on default_course.id = settings.default_course_id
left join public.courses as course
    on course.club_id = club.id
group by
    club.id,
    club.name,
    settings.single_course_mode,
    settings.default_course_id,
    default_course.name
order by lower(club.name);

select proname
from pg_proc
where proname in (
    'clubhub_user_can_access',
    'clubhub_require_access',
    'get_my_clubhub_access',
    'get_my_club_modules',
    'platform_get_module_catalog',
    'platform_get_club_modules',
    'platform_provision_club',
    'platform_update_club_configuration_v2'
)
order by proname;
