-- PARYX PLATFORM
-- Migration 003: Fix club configuration save ambiguity
--
-- The v0.3 settings function returned a column named club_id and also used
-- ON CONFLICT (club_id). In PL/pgSQL that name could refer to either the
-- output variable or the table column.
--
-- This migration is idempotent and safe to keep in the repository after the
-- hotfix has already been applied to the development project.

begin;

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
        raise exception 'Club management access required.';
    end if;

    v_name := nullif(trim(p_club_name), '');
    if v_name is null then
        raise exception 'Club name is required.';
    end if;

    v_short_name := nullif(trim(p_short_name), '');
    v_timezone := coalesce(nullif(trim(p_timezone), ''), 'Europe/London');

    if not exists (
        select 1
        from pg_catalog.pg_timezone_names as tz
        where tz.name = v_timezone
    ) then
        raise exception 'Invalid timezone.';
    end if;

    v_country_code := upper(
        coalesce(nullif(trim(p_country_code), ''), 'GB')
    );
    if v_country_code !~ '^[A-Z]{2}$' then
        raise exception 'Country code must contain two letters.';
    end if;

    v_currency_code := upper(
        coalesce(nullif(trim(p_currency_code), ''), 'GBP')
    );
    if v_currency_code !~ '^[A-Z]{3}$' then
        raise exception 'Currency code must contain three letters.';
    end if;

    v_primary := upper(
        coalesce(nullif(trim(p_primary_color), ''), '#064831')
    );
    v_secondary := upper(
        coalesce(nullif(trim(p_secondary_color), ''), '#022D1D')
    );
    v_accent := upper(
        coalesce(nullif(trim(p_accent_color), ''), '#E5C45F')
    );

    if v_primary !~ '^#[0-9A-F]{6}$'
       or v_secondary !~ '^#[0-9A-F]{6}$'
       or v_accent !~ '^#[0-9A-F]{6}$' then
        raise exception 'Brand colours must use six-digit hex values.';
    end if;

    if p_default_course_id is not null
       and not exists (
            select 1
            from public.courses as course
            where course.id = p_default_course_id
              and course.club_id = p_club_id
              and course.is_active = true
       ) then
        raise exception 'Default course must belong to the selected club.';
    end if;

    update public.clubs as target_club
    set
        name = v_name,
        timezone = v_timezone,
        updated_at = now()
    where target_club.id = p_club_id;

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
    on conflict on constraint club_settings_pkey
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
    on conflict on constraint club_branding_pkey
    do update set
        logo_path = excluded.logo_path,
        primary_color = excluded.primary_color,
        secondary_color = excluded.secondary_color,
        accent_color = excluded.accent_color,
        updated_at = now();

    return query
    select cfg.*
    from public.get_club_configuration(p_club_id) as cfg;
end;
$$;

revoke all
on function public.admin_update_club_configuration(
    uuid, text, text, text, text, text, text, text, text, text,
    text, text, text, text, uuid, text, text, text, text
)
from public, anon;

grant execute
on function public.admin_update_club_configuration(
    uuid, text, text, text, text, text, text, text, text, text,
    text, text, text, text, uuid, text, text, text, text
)
to authenticated;

commit;
