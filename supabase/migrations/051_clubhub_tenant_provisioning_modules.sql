-- =========================================================
-- PARYX v0.30.0
-- Migration 051: tenant-safe ClubHub access, module catalogue,
--                 and complete Console club provisioning
--
-- Run after 050_single_course_mode_course_setup_refinement.sql.
-- =========================================================

begin;

-- =========================================================
-- PLATFORM MODULE CATALOGUE
-- One catalogue drives Console configuration and ClubHub navigation.
-- =========================================================

create table if not exists public.club_module_catalog (
    module_key text primary key,
    label text not null,
    description text not null,
    route text,
    display_order smallint not null,
    default_enabled boolean not null default false,
    required boolean not null default false,
    allowed_roles text[] not null default array[]::text[],
    depends_on text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint club_module_catalog_key_format
        check (module_key ~ '^[a-z][a-z0-9_]*$'),
    constraint club_module_catalog_roles_present
        check (cardinality(allowed_roles) > 0)
);

alter table public.club_module_catalog enable row level security;
revoke all on table public.club_module_catalog from public, anon, authenticated;

insert into public.club_module_catalog (
    module_key,
    label,
    description,
    route,
    display_order,
    default_enabled,
    required,
    allowed_roles,
    depends_on
)
values
    ('dashboard', 'Dashboard', 'Club overview and operational summary.', 'dashboard.html', 10, true, true,
        array['starter','reception','professional','greenkeeper','manager','club_admin'], null),
    ('tee_sheet', 'Tee Sheet', 'Tee-time inventory, daily operations and check-in.', 'tee-sheet.html', 20, true, false,
        array['starter','reception','professional','manager','club_admin'], null),
    ('bookings', 'Bookings', 'Create, update, move and cancel club bookings.', null, 30, true, false,
        array['starter','reception','professional','manager','club_admin'], 'tee_sheet'),
    ('members', 'Members', 'Member directory, imports, access requests and staff administration.', 'members.html', 40, true, false,
        array['reception','professional','manager','club_admin'], null),
    ('courses', 'Courses', 'Course, tee, rating and scorecard configuration.', 'courses.html', 50, true, false,
        array['manager','club_admin'], null),
    ('calendar', 'Calendar', 'Events, fixtures and recurring club calendar entries.', 'calendar.html', 60, true, false,
        array['reception','professional','greenkeeper','manager','club_admin'], null),
    ('competitions', 'Competitions', 'Competition setup, entries, results and prizes.', 'competitions.html', 70, true, false,
        array['reception','professional','manager','club_admin'], 'calendar'),
    ('member_credit', 'Club Credit', 'Member balances, prizes, credits and debits.', 'club-credit.html', 80, false, false,
        array['reception','professional','manager','club_admin'], null),
    ('stock_inventory', 'Stock', 'Products, stock levels, valuation and movement audit.', 'stock.html', 90, false, false,
        array['reception','professional','manager','club_admin'], null),
    ('epos_integration', 'EPOS', 'Provider-neutral product mapping and sales/refund integration.', 'epos.html', 100, false, false,
        array['professional','manager','club_admin'], 'stock_inventory'),
    ('website_booking', 'Website Booking', 'Public availability and guest booking widget.', null, 110, false, false,
        array['manager','club_admin'], 'tee_sheet'),
    ('reports', 'Reports', 'Club reporting and exports.', null, 120, false, false,
        array['manager','club_admin'], null),
    ('settings', 'Settings', 'Club identity, branding and operational defaults.', 'settings.html', 130, true, false,
        array['manager','club_admin'], null)
on conflict (module_key) do update set
    label = excluded.label,
    description = excluded.description,
    route = excluded.route,
    display_order = excluded.display_order,
    default_enabled = excluded.default_enabled,
    required = excluded.required,
    allowed_roles = excluded.allowed_roles,
    depends_on = excluded.depends_on,
    updated_at = now();

-- Expand the original three-key constraint to the complete v0.30 catalogue.
alter table public.club_modules
    drop constraint if exists club_modules_key_valid;

alter table public.club_modules
    add constraint club_modules_key_valid
    check (
        module_key in (
            'dashboard','tee_sheet','bookings','members','courses','calendar',
            'competitions','member_credit','stock_inventory','epos_integration',
            'website_booking','reports','settings'
        )
    );

-- Existing tenants retain their three optional-module choices. All existing
-- working ClubHub areas remain enabled so this migration cannot hide a live
-- feature merely because the old schema had no row for it.
insert into public.club_modules (
    club_id,
    module_key,
    is_enabled,
    enabled_at,
    enabled_by,
    updated_at
)
select
    club.id,
    catalog.module_key,
    case
        when catalog.module_key = 'website_booking'
            then coalesce(settings.public_booking_enabled, false)
        else catalog.default_enabled
    end,
    case
        when catalog.default_enabled
          or (
                catalog.module_key = 'website_booking'
                and coalesce(settings.public_booking_enabled, false)
          )
            then now()
        else null
    end,
    null,
    now()
from public.clubs as club
cross join public.club_module_catalog as catalog
left join public.club_settings as settings
    on settings.club_id = club.id
on conflict (club_id, module_key) do nothing;

-- Future clubs receive one row for every catalogue item. Console provisioning
-- immediately applies the selected states in the same database transaction.
create or replace function public.handle_new_club_modules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.club_modules (
        club_id,
        module_key,
        is_enabled,
        enabled_at,
        updated_at
    )
    select
        new.id,
        catalog.module_key,
        catalog.default_enabled,
        case when catalog.default_enabled then now() else null end,
        now()
    from public.club_module_catalog as catalog
    on conflict (club_id, module_key) do nothing;

    return new;
end;
$$;

-- =========================================================
-- TENANT-SAFE CLUBHUB ACCESS
-- 0 rows = deny; 1 row = auto-open; 2+ rows = authorised selector.
-- Platform access never grants ClubHub tenant access by itself.
-- =========================================================

create or replace function public.clubhub_user_can_access(
    p_club_id uuid,
    p_module_key text,
    p_allowed_roles text[] default array[
        'starter','reception','professional','greenkeeper','manager','club_admin'
    ]::text[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select
        auth.uid() is not null
        and p_club_id is not null
        and exists (
            select 1
            from public.club_memberships as membership
            join public.clubs as club
                on club.id = membership.club_id
               and club.is_active = true
            join public.club_modules as module
                on module.club_id = membership.club_id
               and module.module_key = lower(trim(coalesce(p_module_key, '')))
               and module.is_enabled = true
            where membership.profile_id = auth.uid()
              and membership.club_id = p_club_id
              and membership.status = 'active'
              and membership.role = any(coalesce(p_allowed_roles, array[]::text[]))
        );
$$;

revoke all on function public.clubhub_user_can_access(uuid,text,text[]) from public, anon;
grant execute on function public.clubhub_user_can_access(uuid,text,text[]) to authenticated;

create or replace function public.clubhub_require_access(
    p_club_id uuid,
    p_module_key text,
    p_allowed_roles text[] default array[
        'starter','reception','professional','greenkeeper','manager','club_admin'
    ]::text[]
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if not public.clubhub_user_can_access(
        p_club_id,
        p_module_key,
        p_allowed_roles
    ) then
        raise exception 'ClubHub module access required.';
    end if;
end;
$$;

revoke all on function public.clubhub_require_access(uuid,text,text[]) from public, anon;
grant execute on function public.clubhub_require_access(uuid,text,text[]) to authenticated;

-- Existing ClubHub RPCs already centralise their role checks through these two
-- helpers. Resolve the requested service from PostgREST's request path so the
-- same checks also enforce the selected tenant's enabled module.
create or replace function public._clubhub_module_for_request(
    p_default text
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_path text := lower(coalesce(current_setting('request.path', true), ''));
begin
    if v_path like '%public_booking_widget%' then
        return 'website_booking';
    end if;

    if v_path like '%calendar%'
       or v_path like '%calendar_series%'
       or v_path like '%_event%'
       or v_path like '%event_%' then
        return 'calendar';
    end if;

    if v_path like '%booking_schedule%' then
        return 'tee_sheet';
    end if;

    if v_path like '%course%'
       or v_path like '%tee_distances%'
       or v_path like '%save_tee%' then
        return 'courses';
    end if;

    if v_path like '%member%'
       or v_path like '%staff%' then
        return 'members';
    end if;

    if v_path like '%club_configuration%'
       or v_path like '%settings%' then
        return 'settings';
    end if;

    return coalesce(nullif(trim(p_default), ''), 'settings');
end;
$$;

revoke all on function public._clubhub_module_for_request(text)
from public, anon, authenticated;

create or replace function public.user_can_manage_club(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select public.clubhub_user_can_access(
        p_club_id,
        public._clubhub_module_for_request('settings'),
        array['manager','club_admin']
    );
$$;

revoke all on function public.user_can_manage_club(uuid) from public, anon;
grant execute on function public.user_can_manage_club(uuid) to authenticated;

create or replace function public.user_can_operate_tee_sheet(p_club_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_path text := lower(coalesce(current_setting('request.path', true), ''));
    v_module text := 'tee_sheet';
begin
    if v_path like '%staff_create_booking%'
       or v_path like '%staff_update_booking%'
       or v_path like '%staff_move_booking%'
       or v_path like '%staff_cancel_booking%'
       or v_path like '%staff_replace_booking_players%'
       or v_path like '%staff_set_booking_check_in%'
       or v_path like '%staff_search_booking_members%'
       or v_path like '%staff_get_booking_detail%' then
        v_module := 'bookings';
    end if;

    return public.clubhub_user_can_access(
        p_club_id,
        v_module,
        array['starter','reception','professional','manager','club_admin']
    );
end;
$$;

revoke all on function public.user_can_operate_tee_sheet(uuid) from public, anon;
grant execute on function public.user_can_operate_tee_sheet(uuid) to authenticated;

create or replace function public.get_my_clubhub_access()
returns table (
    club_id uuid,
    club_name text,
    club_slug text,
    club_timezone text,
    membership_id uuid,
    staff_role text,
    is_primary boolean,
    enabled_modules jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
    select
        club.id,
        club.name,
        club.slug,
        club.timezone,
        membership.id,
        membership.role,
        membership.is_primary,
        coalesce(
            (
                select jsonb_agg(module.module_key order by catalog.display_order)
                from public.club_modules as module
                join public.club_module_catalog as catalog
                    on catalog.module_key = module.module_key
                where module.club_id = club.id
                  and module.is_enabled = true
                  and membership.role = any(catalog.allowed_roles)
            ),
            '[]'::jsonb
        )
    from public.club_memberships as membership
    join public.clubs as club
        on club.id = membership.club_id
       and club.is_active = true
    where auth.uid() is not null
      and membership.profile_id = auth.uid()
      and membership.status = 'active'
      and membership.role in (
          'starter','reception','professional','greenkeeper','manager','club_admin'
      )
      and exists (
          select 1
          from public.club_modules as dashboard
          where dashboard.club_id = club.id
            and dashboard.module_key = 'dashboard'
            and dashboard.is_enabled = true
      )
    order by membership.is_primary desc, lower(club.name), club.id;
$$;

revoke all on function public.get_my_clubhub_access() from public, anon;
grant execute on function public.get_my_clubhub_access() to authenticated;

drop function if exists public.get_my_club_modules(uuid);

create function public.get_my_club_modules(p_club_id uuid)
returns table (
    module_key text,
    label text,
    description text,
    route text,
    display_order smallint,
    is_enabled boolean,
    settings jsonb,
    allowed_roles text[],
    required boolean,
    depends_on text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null
       or p_club_id is null
       or not exists (
            select 1
            from public.club_memberships as membership
            join public.clubs as club on club.id = membership.club_id
            where membership.profile_id = auth.uid()
              and membership.club_id = p_club_id
              and membership.status = 'active'
              and membership.role in (
                  'starter','reception','professional','greenkeeper','manager','club_admin'
              )
              and club.is_active = true
       ) then
        raise exception 'Club staff access required.';
    end if;

    return query
    select
        catalog.module_key,
        catalog.label,
        catalog.description,
        catalog.route,
        catalog.display_order,
        coalesce(module.is_enabled, false),
        coalesce(module.settings, '{}'::jsonb),
        catalog.allowed_roles,
        catalog.required,
        catalog.depends_on
    from public.club_module_catalog as catalog
    left join public.club_modules as module
        on module.club_id = p_club_id
       and module.module_key = catalog.module_key
    order by catalog.display_order;
end;
$$;

revoke all on function public.get_my_club_modules(uuid) from public, anon;
grant execute on function public.get_my_club_modules(uuid) to authenticated;

-- Preserve Player's global multi-club booking model while ensuring that a
-- ClubHub staff relationship respects the selected tenant's Courses module.
create or replace function public.get_club_course_mode(p_club_id uuid)
returns table (
    single_course_mode boolean,
    default_course_id uuid,
    active_course_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null or p_club_id is null then
        raise exception 'Club access required.';
    end if;

    if not exists (
        select 1
        from public.clubs as club
        where club.id = p_club_id
          and club.is_active = true
    ) then
        raise exception 'Club not found.';
    end if;

    -- Player is intentionally global and may book at any active Paryx club.
    -- If this account is using a staff relationship, however, respect that
    -- tenant's Courses entitlement.
    if exists (
        select 1
        from public.club_memberships as membership
        where membership.profile_id = auth.uid()
          and membership.club_id = p_club_id
          and membership.status = 'active'
          and membership.role in (
              'starter','reception','professional','greenkeeper','manager','club_admin'
          )
    ) and not public.club_module_enabled(p_club_id, 'courses') then
        raise exception 'Courses module access required.';
    end if;

    return query
    select
        coalesce(settings.single_course_mode, false),
        settings.default_course_id,
        count(course.id)::bigint
    from public.club_settings as settings
    left join public.courses as course
        on course.club_id = settings.club_id
       and course.is_active = true
    where settings.club_id = p_club_id
    group by settings.single_course_mode, settings.default_course_id;
end;
$$;

-- =========================================================
-- CONSOLE CATALOGUE + MODULE CONFIGURATION
-- =========================================================

create or replace function public.platform_get_module_catalog()
returns table (
    module_key text,
    label text,
    description text,
    route text,
    display_order smallint,
    default_enabled boolean,
    required boolean,
    allowed_roles text[],
    depends_on text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null
       or not public.is_platform_user(
            array['platform_owner','platform_admin','platform_support']
       ) then
        raise exception 'Paryx Console access required.';
    end if;

    return query
    select
        catalog.module_key,
        catalog.label,
        catalog.description,
        catalog.route,
        catalog.display_order,
        catalog.default_enabled,
        catalog.required,
        catalog.allowed_roles,
        catalog.depends_on
    from public.club_module_catalog as catalog
    order by catalog.display_order;
end;
$$;

revoke all on function public.platform_get_module_catalog() from public, anon;
grant execute on function public.platform_get_module_catalog() to authenticated;

drop function if exists public.platform_get_club_modules(uuid);

create function public.platform_get_club_modules(p_club_id uuid)
returns table (
    module_key text,
    label text,
    description text,
    route text,
    display_order smallint,
    default_enabled boolean,
    required boolean,
    allowed_roles text[],
    depends_on text,
    is_enabled boolean,
    settings jsonb,
    enabled_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null
       or not public.is_platform_user(
            array['platform_owner','platform_admin','platform_support']
       ) then
        raise exception 'Paryx Console access required.';
    end if;

    if not exists (select 1 from public.clubs where id = p_club_id) then
        raise exception 'Club not found.';
    end if;

    return query
    select
        catalog.module_key,
        catalog.label,
        catalog.description,
        catalog.route,
        catalog.display_order,
        catalog.default_enabled,
        catalog.required,
        catalog.allowed_roles,
        catalog.depends_on,
        coalesce(module.is_enabled, false),
        coalesce(module.settings, '{}'::jsonb),
        module.enabled_at
    from public.club_module_catalog as catalog
    left join public.club_modules as module
        on module.club_id = p_club_id
       and module.module_key = catalog.module_key
    order by catalog.display_order;
end;
$$;

revoke all on function public.platform_get_club_modules(uuid) from public, anon;
grant execute on function public.platform_get_club_modules(uuid) to authenticated;

create or replace function public._platform_apply_club_modules(
    p_club_id uuid,
    p_modules jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_modules jsonb := coalesce(p_modules, '{}'::jsonb);
    v_unknown text;
    v_epos boolean;
    v_stock boolean;
    v_bookings boolean;
    v_tee_sheet boolean;
    v_competitions boolean;
    v_calendar boolean;
    v_website_booking boolean;
begin
    if jsonb_typeof(v_modules) <> 'object' then
        raise exception 'Module configuration must be a JSON object.';
    end if;

    select key
    into v_unknown
    from jsonb_object_keys(v_modules) as supplied(key)
    where not exists (
        select 1
        from public.club_module_catalog as catalog
        where catalog.module_key = supplied.key
    )
    limit 1;

    if v_unknown is not null then
        raise exception 'Unsupported club module: %.', v_unknown;
    end if;

    if exists (
        select 1
        from jsonb_each(v_modules) as supplied(key, value)
        where jsonb_typeof(supplied.value) <> 'boolean'
    ) then
        raise exception 'Every module value must be true or false.';
    end if;

    if coalesce((v_modules ->> 'dashboard')::boolean, true) = false then
        raise exception 'Dashboard is required for every ClubHub tenant.';
    end if;

    v_epos := coalesce((v_modules ->> 'epos_integration')::boolean, false);
    v_stock := coalesce((v_modules ->> 'stock_inventory')::boolean, false);
    v_bookings := coalesce((v_modules ->> 'bookings')::boolean, true);
    v_tee_sheet := coalesce((v_modules ->> 'tee_sheet')::boolean, true);
    v_competitions := coalesce((v_modules ->> 'competitions')::boolean, true);
    v_calendar := coalesce((v_modules ->> 'calendar')::boolean, true);
    v_website_booking := coalesce((v_modules ->> 'website_booking')::boolean, false);

    if v_epos and not v_stock then
        raise exception 'EPOS Integration requires Stock Inventory.';
    end if;

    if v_bookings and not v_tee_sheet then
        raise exception 'Bookings requires Tee Sheet.';
    end if;

    if v_competitions and not v_calendar then
        raise exception 'Competitions requires Calendar.';
    end if;

    if v_website_booking and not v_tee_sheet then
        raise exception 'Website Booking requires Tee Sheet.';
    end if;

    insert into public.club_modules (
        club_id,
        module_key,
        is_enabled,
        enabled_at,
        enabled_by,
        updated_at
    )
    select
        p_club_id,
        catalog.module_key,
        case
            when catalog.required then true
            when v_modules ? catalog.module_key
                then (v_modules ->> catalog.module_key)::boolean
            else catalog.default_enabled
        end,
        case
            when catalog.required
              or (
                    v_modules ? catalog.module_key
                    and (v_modules ->> catalog.module_key)::boolean
              )
              or (
                    not (v_modules ? catalog.module_key)
                    and catalog.default_enabled
              )
                then now()
            else null
        end,
        case
            when catalog.required
              or (
                    v_modules ? catalog.module_key
                    and (v_modules ->> catalog.module_key)::boolean
              )
              or (
                    not (v_modules ? catalog.module_key)
                    and catalog.default_enabled
              )
                then auth.uid()
            else null
        end,
        now()
    from public.club_module_catalog as catalog
    on conflict (club_id, module_key) do update set
        is_enabled = excluded.is_enabled,
        enabled_at = case
            when excluded.is_enabled and not public.club_modules.is_enabled then now()
            when excluded.is_enabled then public.club_modules.enabled_at
            else null
        end,
        enabled_by = case when excluded.is_enabled then auth.uid() else null end,
        updated_at = now();
end;
$$;

revoke all on function public._platform_apply_club_modules(uuid,jsonb) from public, anon, authenticated;

create or replace function public.platform_provision_club(
    p_name text,
    p_slug text,
    p_timezone text default 'Europe/London',
    p_course_name text default null,
    p_course_holes smallint default 18,
    p_single_course_mode boolean default true,
    p_modules jsonb default '{}'::jsonb
)
returns table (
    club_id uuid,
    club_name text,
    club_slug text,
    club_timezone text,
    course_id uuid,
    course_name text,
    single_course_mode boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_name text := nullif(trim(coalesce(p_name, '')), '');
    v_slug text := lower(nullif(trim(coalesce(p_slug, '')), ''));
    v_timezone text := coalesce(nullif(trim(coalesce(p_timezone, '')), ''), 'Europe/London');
    v_course_name text;
    v_club_id uuid;
    v_course_id uuid;
    v_actor_role text;
begin
    if auth.uid() is null
       or not public.is_platform_user(array['platform_owner','platform_admin']) then
        raise exception 'Paryx platform admin access required.';
    end if;

    if v_name is null then
        raise exception 'Club name is required.';
    end if;

    if v_slug is null or v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
        raise exception 'Slug must use lowercase letters, numbers and single hyphens.';
    end if;

    if not exists (
        select 1 from pg_catalog.pg_timezone_names where name = v_timezone
    ) then
        raise exception 'Invalid timezone.';
    end if;

    if p_course_holes not in (9, 18) then
        raise exception 'Course must contain 9 or 18 holes.';
    end if;

    v_course_name := coalesce(
        nullif(trim(coalesce(p_course_name, '')), ''),
        v_name
    );

    insert into public.clubs (name, slug, timezone, is_active)
    values (v_name, v_slug, v_timezone, true)
    returning id into v_club_id;

    perform public._platform_apply_club_modules(v_club_id, p_modules);

    insert into public.courses (club_id, name, holes, is_active)
    values (v_club_id, v_course_name, p_course_holes, true)
    returning id into v_course_id;

    insert into public.course_holes (course_id, hole_number)
    select v_course_id, generated.number::smallint
    from generate_series(1, p_course_holes::integer) as generated(number)
    on conflict on constraint course_holes_pkey do nothing;

    insert into public.club_settings (
        club_id,
        default_course_id,
        single_course_mode,
        updated_at
    )
    values (
        v_club_id,
        v_course_id,
        coalesce(p_single_course_mode, true),
        now()
    )
    on conflict (club_id) do update set
        default_course_id = excluded.default_course_id,
        single_course_mode = excluded.single_course_mode,
        updated_at = now();

    select platform_user.role
    into v_actor_role
    from public.platform_users as platform_user
    where platform_user.user_id = auth.uid()
      and platform_user.is_active
    limit 1;

    insert into public.platform_audit_log (
        actor_user_id,
        actor_role,
        action,
        club_id,
        details
    )
    values (
        auth.uid(),
        v_actor_role,
        'club_provisioned_v0_30',
        v_club_id,
        jsonb_build_object(
            'name', v_name,
            'slug', v_slug,
            'timezone', v_timezone,
            'course_id', v_course_id,
            'course_name', v_course_name,
            'course_holes', p_course_holes,
            'single_course_mode', coalesce(p_single_course_mode, true),
            'modules', coalesce(p_modules, '{}'::jsonb)
        )
    );

    return query
    select
        v_club_id,
        v_name,
        v_slug,
        v_timezone,
        v_course_id,
        v_course_name,
        coalesce(p_single_course_mode, true);
end;
$$;

revoke all on function public.platform_provision_club(
    text,text,text,text,smallint,boolean,jsonb
) from public, anon;
grant execute on function public.platform_provision_club(
    text,text,text,text,smallint,boolean,jsonb
) to authenticated;

-- Retire the two incomplete creation entry points. Existing definitions remain
-- for migration history, but Console callers must use the complete provisioner.
revoke execute on function public.platform_create_club(text,text,text)
from authenticated;

revoke execute on function public.platform_create_club_configured(
    text,text,text,boolean,boolean,boolean
) from authenticated;

create or replace function public.platform_update_club_configuration_v2(
    p_club_id uuid,
    p_name text,
    p_timezone text,
    p_modules jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_name text := nullif(trim(coalesce(p_name, '')), '');
    v_timezone text := nullif(trim(coalesce(p_timezone, '')), '');
    v_actor_role text;
    v_previous jsonb;
begin
    if auth.uid() is null
       or p_club_id is null
       or not public.is_platform_user(array['platform_owner','platform_admin']) then
        raise exception 'Platform Admin or Owner access required.';
    end if;

    if v_name is null then
        raise exception 'Club name is required.';
    end if;

    if v_timezone is null
       or not exists (
            select 1 from pg_catalog.pg_timezone_names where name = v_timezone
       ) then
        raise exception 'Invalid timezone.';
    end if;

    select jsonb_build_object(
        'name', club.name,
        'timezone', club.timezone,
        'modules', coalesce((
            select jsonb_object_agg(module.module_key, module.is_enabled)
            from public.club_modules as module
            where module.club_id = club.id
        ), '{}'::jsonb)
    )
    into v_previous
    from public.clubs as club
    where club.id = p_club_id
    for update;

    if v_previous is null then
        raise exception 'Club not found.';
    end if;

    update public.clubs
    set name = v_name,
        timezone = v_timezone,
        updated_at = now()
    where id = p_club_id;

    perform public._platform_apply_club_modules(p_club_id, p_modules);

    select platform_user.role
    into v_actor_role
    from public.platform_users as platform_user
    where platform_user.user_id = auth.uid()
      and platform_user.is_active
    limit 1;

    insert into public.platform_audit_log (
        actor_user_id,
        actor_role,
        action,
        club_id,
        details
    )
    values (
        auth.uid(),
        v_actor_role,
        'club_configuration_v0_30_updated',
        p_club_id,
        jsonb_build_object(
            'previous', v_previous,
            'new', jsonb_build_object(
                'name', v_name,
                'timezone', v_timezone,
                'modules', coalesce(p_modules, '{}'::jsonb)
            )
        )
    );

    return true;
end;
$$;

revoke all on function public.platform_update_club_configuration_v2(uuid,text,text,jsonb)
from public, anon;
grant execute on function public.platform_update_club_configuration_v2(uuid,text,text,jsonb)
to authenticated;

-- Optional-feature helpers now participate in the same module contract.
create or replace function public.user_can_view_competitions(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select public.clubhub_user_can_access(
        p_club_id,
        'competitions',
        array['reception','professional','manager','club_admin']
    );
$$;

create or replace function public.user_can_manage_competitions(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select public.clubhub_user_can_access(
        p_club_id,
        'competitions',
        array['professional','manager','club_admin']
    );
$$;

create or replace function public.user_can_confirm_competition_results(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select public.clubhub_user_can_access(
        p_club_id,
        'competitions',
        array['manager','club_admin']
    );
$$;

commit;

notify pgrst, 'reload schema';
