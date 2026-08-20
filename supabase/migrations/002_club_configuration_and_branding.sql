-- PARYX PLATFORM
-- Migration 002: Club configuration and branding
--
-- PURPOSE
-- 1. Give every club its own configurable identity and operational defaults.
-- 2. Keep customer-specific values in data, not in Paryx source code.
-- 3. Provide secure selected-club RPCs for the staff Settings page.
-- 4. Provide a public club-branding storage bucket with staff-managed uploads.
--
-- Run this AFTER 001_multi_club_tenant_foundation.sql in the existing
-- Paryx development Supabase project.

begin;

-- =========================================================
-- CLUB SETTINGS
-- =========================================================

create table if not exists public.club_settings (
    club_id uuid primary key
        references public.clubs(id)
        on delete cascade,

    short_name text,
    website_url text,
    contact_email text,
    phone text,

    address_line_1 text,
    address_line_2 text,
    town_city text,
    county_region text,
    postcode text,

    country_code text not null default 'GB',
    currency_code text not null default 'GBP',

    default_course_id uuid
        references public.courses(id)
        on delete set null,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint club_settings_short_name_not_blank
        check (
            short_name is null
            or length(trim(short_name)) > 0
        ),

    constraint club_settings_country_code_format
        check (country_code ~ '^[A-Z]{2}$'),

    constraint club_settings_currency_code_format
        check (currency_code ~ '^[A-Z]{3}$')
);

alter table public.club_settings
    enable row level security;


-- =========================================================
-- CLUB BRANDING
-- =========================================================

create table if not exists public.club_branding (
    club_id uuid primary key
        references public.clubs(id)
        on delete cascade,

    logo_path text,

    primary_color text not null default '#064831',
    secondary_color text not null default '#022D1D',
    accent_color text not null default '#E5C45F',

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint club_branding_primary_color_format
        check (primary_color ~ '^#[0-9A-Fa-f]{6}$'),

    constraint club_branding_secondary_color_format
        check (secondary_color ~ '^#[0-9A-Fa-f]{6}$'),

    constraint club_branding_accent_color_format
        check (accent_color ~ '^#[0-9A-Fa-f]{6}$')
);

alter table public.club_branding
    enable row level security;


-- =========================================================
-- DEFAULT ROWS FOR EXISTING AND FUTURE CLUBS
-- =========================================================

insert into public.club_settings (club_id)
select c.id
from public.clubs as c
on conflict (club_id) do nothing;

insert into public.club_branding (club_id)
select c.id
from public.clubs as c
on conflict (club_id) do nothing;

create or replace function public.handle_new_club_configuration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.club_settings (club_id)
    values (new.id)
    on conflict (club_id) do nothing;

    insert into public.club_branding (club_id)
    values (new.id)
    on conflict (club_id) do nothing;

    return new;
end;
$$;

drop trigger if exists on_club_created_configuration
on public.clubs;

create trigger on_club_created_configuration
after insert on public.clubs
for each row
execute function public.handle_new_club_configuration();


-- =========================================================
-- MANAGEMENT ACCESS HELPER
-- =========================================================

create or replace function public.user_can_manage_club(
    p_club_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.club_memberships as cm
        join public.clubs as c
            on c.id = cm.club_id
        where cm.profile_id = auth.uid()
          and cm.club_id = p_club_id
          and cm.status = 'active'
          and cm.role in (
              'manager',
              'club_admin'
          )
          and c.is_active = true
    );
$$;

revoke all
on function public.user_can_manage_club(uuid)
from public, anon;

grant execute
on function public.user_can_manage_club(uuid)
to authenticated;


-- =========================================================
-- SELECTED CLUB CONFIGURATION
-- =========================================================

create or replace function public.get_club_configuration(
    p_club_id uuid
)
returns table (
    club_id uuid,
    club_name text,
    club_slug text,
    club_timezone text,

    short_name text,
    website_url text,
    contact_email text,
    phone text,

    address_line_1 text,
    address_line_2 text,
    town_city text,
    county_region text,
    postcode text,
    country_code text,
    currency_code text,

    default_course_id uuid,
    default_course_name text,

    logo_path text,
    primary_color text,
    secondary_color text,
    accent_color text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null
       or p_club_id is null
       or not public.user_has_active_club_access(p_club_id) then
        raise exception
            'Club access required.';
    end if;

    return query
    select
        c.id,
        c.name,
        c.slug,
        c.timezone,

        cs.short_name,
        cs.website_url,
        cs.contact_email,
        cs.phone,

        cs.address_line_1,
        cs.address_line_2,
        cs.town_city,
        cs.county_region,
        cs.postcode,
        cs.country_code,
        cs.currency_code,

        cs.default_course_id,
        course.name,

        cb.logo_path,
        cb.primary_color,
        cb.secondary_color,
        cb.accent_color
    from public.clubs as c
    left join public.club_settings as cs
        on cs.club_id = c.id
    left join public.club_branding as cb
        on cb.club_id = c.id
    left join public.courses as course
        on course.id = cs.default_course_id
    where c.id = p_club_id
      and c.is_active = true
    limit 1;
end;
$$;

revoke all
on function public.get_club_configuration(uuid)
from public, anon;

grant execute
on function public.get_club_configuration(uuid)
to authenticated;


-- =========================================================
-- COURSES AVAILABLE TO CLUB SETTINGS
-- =========================================================

create or replace function public.get_club_courses_for_settings(
    p_club_id uuid
)
returns table (
    course_id uuid,
    course_name text,
    holes smallint,
    is_active boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null
       or p_club_id is null
       or not public.user_can_manage_club(p_club_id) then
        raise exception
            'Club management access required.';
    end if;

    return query
    select
        c.id,
        c.name,
        c.holes,
        c.is_active
    from public.courses as c
    where c.club_id = p_club_id
      and c.is_active = true
    order by lower(c.name), c.created_at;
end;
$$;

revoke all
on function public.get_club_courses_for_settings(uuid)
from public, anon;

grant execute
on function public.get_club_courses_for_settings(uuid)
to authenticated;


-- =========================================================
-- UPDATE CLUB CONFIGURATION
-- =========================================================

create or replace function public.admin_update_club_configuration(
    p_club_id uuid,
    p_club_name text,
    p_short_name text,
    p_timezone text,
    p_website_url text,
    p_contact_email text,
    p_phone text,
    p_address_line_1 text,
    p_address_line_2 text,
    p_town_city text,
    p_county_region text,
    p_postcode text,
    p_country_code text,
    p_currency_code text,
    p_default_course_id uuid,
    p_logo_path text,
    p_primary_color text,
    p_secondary_color text,
    p_accent_color text
)
returns table (
    club_id uuid,
    club_name text,
    club_slug text,
    club_timezone text,

    short_name text,
    website_url text,
    contact_email text,
    phone text,

    address_line_1 text,
    address_line_2 text,
    town_city text,
    county_region text,
    postcode text,
    country_code text,
    currency_code text,

    default_course_id uuid,
    default_course_name text,

    logo_path text,
    primary_color text,
    secondary_color text,
    accent_color text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_name text;
    v_short_name text;
    v_timezone text;
    v_country_code text;
    v_currency_code text;
    v_primary text;
    v_secondary text;
    v_accent text;
begin
    if auth.uid() is null
       or p_club_id is null
       or not public.user_can_manage_club(p_club_id) then
        raise exception
            'Club management access required.';
    end if;

    v_name := nullif(trim(p_club_name), '');

    if v_name is null then
        raise exception
            'Club name is required.';
    end if;

    v_short_name := nullif(trim(p_short_name), '');

    v_timezone := coalesce(
        nullif(trim(p_timezone), ''),
        'Europe/London'
    );

    if not exists (
        select 1
        from pg_catalog.pg_timezone_names as tz
        where tz.name = v_timezone
    ) then
        raise exception
            'Invalid timezone.';
    end if;

    v_country_code := upper(
        coalesce(
            nullif(trim(p_country_code), ''),
            'GB'
        )
    );

    if v_country_code !~ '^[A-Z]{2}$' then
        raise exception
            'Country code must contain two letters.';
    end if;

    v_currency_code := upper(
        coalesce(
            nullif(trim(p_currency_code), ''),
            'GBP'
        )
    );

    if v_currency_code !~ '^[A-Z]{3}$' then
        raise exception
            'Currency code must contain three letters.';
    end if;

    v_primary := upper(
        coalesce(
            nullif(trim(p_primary_color), ''),
            '#064831'
        )
    );

    v_secondary := upper(
        coalesce(
            nullif(trim(p_secondary_color), ''),
            '#022D1D'
        )
    );

    v_accent := upper(
        coalesce(
            nullif(trim(p_accent_color), ''),
            '#E5C45F'
        )
    );

    if v_primary !~ '^#[0-9A-F]{6}$'
       or v_secondary !~ '^#[0-9A-F]{6}$'
       or v_accent !~ '^#[0-9A-F]{6}$' then
        raise exception
            'Brand colours must use six-digit hex values.';
    end if;

    if p_default_course_id is not null
       and not exists (
            select 1
            from public.courses as course
            where course.id = p_default_course_id
              and course.club_id = p_club_id
              and course.is_active = true
       ) then
        raise exception
            'Default course must belong to the selected club.';
    end if;

    update public.clubs
    set
        name = v_name,
        timezone = v_timezone,
        updated_at = now()
    where id = p_club_id;

    insert into public.club_settings (
        club_id,
        short_name,
        website_url,
        contact_email,
        phone,
        address_line_1,
        address_line_2,
        town_city,
        county_region,
        postcode,
        country_code,
        currency_code,
        default_course_id,
        updated_at
    )
    values (
        p_club_id,
        v_short_name,
        nullif(trim(p_website_url), ''),
        nullif(trim(p_contact_email), ''),
        nullif(trim(p_phone), ''),
        nullif(trim(p_address_line_1), ''),
        nullif(trim(p_address_line_2), ''),
        nullif(trim(p_town_city), ''),
        nullif(trim(p_county_region), ''),
        nullif(trim(p_postcode), ''),
        v_country_code,
        v_currency_code,
        p_default_course_id,
        now()
    )
    on conflict (club_id)
    do update set
        short_name = excluded.short_name,
        website_url = excluded.website_url,
        contact_email = excluded.contact_email,
        phone = excluded.phone,
        address_line_1 = excluded.address_line_1,
        address_line_2 = excluded.address_line_2,
        town_city = excluded.town_city,
        county_region = excluded.county_region,
        postcode = excluded.postcode,
        country_code = excluded.country_code,
        currency_code = excluded.currency_code,
        default_course_id = excluded.default_course_id,
        updated_at = now();

    insert into public.club_branding (
        club_id,
        logo_path,
        primary_color,
        secondary_color,
        accent_color,
        updated_at
    )
    values (
        p_club_id,
        nullif(trim(p_logo_path), ''),
        v_primary,
        v_secondary,
        v_accent,
        now()
    )
    on conflict (club_id)
    do update set
        logo_path = excluded.logo_path,
        primary_color = excluded.primary_color,
        secondary_color = excluded.secondary_color,
        accent_color = excluded.accent_color,
        updated_at = now();

    return query
    select *
    from public.get_club_configuration(p_club_id);
end;
$$;

revoke all
on function public.admin_update_club_configuration(
    uuid,
    text,
    text,
    text,
    text,
    text,
    text,
    text,
    text,
    text,
    text,
    text,
    text,
    text,
    uuid,
    text,
    text,
    text,
    text
)
from public, anon;

grant execute
on function public.admin_update_club_configuration(
    uuid,
    text,
    text,
    text,
    text,
    text,
    text,
    text,
    text,
    text,
    text,
    text,
    text,
    text,
    uuid,
    text,
    text,
    text,
    text
)
to authenticated;


-- =========================================================
-- CLUB BRANDING STORAGE
--
-- Club logos are public assets. Upload/update/delete is restricted
-- to managers and club administrators for the owning tenant.
-- =========================================================

insert into storage.buckets (
    id,
    name,
    public,
    file_size_limit,
    allowed_mime_types
)
values (
    'club-branding',
    'club-branding',
    true,
    2097152,
    array[
        'image/png',
        'image/jpeg',
        'image/webp'
    ]
)
on conflict (id)
do update set
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;


drop policy if exists
    "Paryx managers can upload club branding"
on storage.objects;

create policy
    "Paryx managers can upload club branding"
on storage.objects
for insert
to authenticated
with check (
    bucket_id = 'club-branding'
    and public.user_can_manage_club(
        split_part(name, '/', 1)::uuid
    )
);


drop policy if exists
    "Paryx managers can update club branding"
on storage.objects;

create policy
    "Paryx managers can update club branding"
on storage.objects
for update
to authenticated
using (
    bucket_id = 'club-branding'
    and public.user_can_manage_club(
        split_part(name, '/', 1)::uuid
    )
)
with check (
    bucket_id = 'club-branding'
    and public.user_can_manage_club(
        split_part(name, '/', 1)::uuid
    )
);


drop policy if exists
    "Paryx managers can delete club branding"
on storage.objects;

create policy
    "Paryx managers can delete club branding"
on storage.objects
for delete
to authenticated
using (
    bucket_id = 'club-branding'
    and public.user_can_manage_club(
        split_part(name, '/', 1)::uuid
    )
);

commit;
