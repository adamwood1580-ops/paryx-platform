-- =========================================================
-- PARYX MIGRATION 044
-- PUBLIC WEBSITE BOOKING WIDGET
-- =========================================================
--
-- Purpose
-- 1. Allow a club to opt in to displaying tee-time availability on its
--    existing public website without requiring a Paryx sign-in.
-- 2. Expose only availability-safe data to anonymous visitors. Player names,
--    booking contact information and membership data are never returned.
-- 3. Hand booking actions back to the authenticated Paryx Player flow.
-- 4. Keep widget enablement and booking horizon under ClubHub control.
--
-- Prerequisite: migrations through 043_player_membership_club_services.sql.
-- =========================================================

begin;

alter table public.club_settings
    add column if not exists public_booking_enabled boolean not null default false,
    add column if not exists public_booking_advance_days smallint not null default 14;

do $$
begin
    if not exists (
        select 1
        from pg_catalog.pg_constraint
        where conname = 'club_settings_public_booking_advance_days_valid'
          and conrelid = 'public.club_settings'::regclass
    ) then
        alter table public.club_settings
            add constraint club_settings_public_booking_advance_days_valid
            check (public_booking_advance_days between 1 and 14);
    end if;
end;
$$;

-- =========================================================
-- CLUBHUB: WIDGET CONFIGURATION
-- =========================================================

create or replace function public.admin_get_public_booking_widget(
    p_club_id uuid
)
returns table (
    club_id uuid,
    club_slug text,
    public_booking_enabled boolean,
    public_booking_advance_days smallint
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
        raise exception 'Club management access required.';
    end if;

    return query
    select
        club.id,
        club.slug::text,
        coalesce(settings.public_booking_enabled, false),
        coalesce(settings.public_booking_advance_days, 14)::smallint
    from public.clubs as club
    left join public.club_settings as settings
        on settings.club_id = club.id
    where club.id = p_club_id
      and club.is_active = true
    limit 1;
end;
$$;

revoke all
on function public.admin_get_public_booking_widget(uuid)
from public, anon;

grant execute
on function public.admin_get_public_booking_widget(uuid)
to authenticated;


create or replace function public.admin_update_public_booking_widget(
    p_club_id uuid,
    p_enabled boolean,
    p_advance_days integer default 14
)
returns table (
    club_id uuid,
    club_slug text,
    public_booking_enabled boolean,
    public_booking_advance_days smallint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_advance_days smallint;
begin
    if auth.uid() is null
       or p_club_id is null
       or not public.user_can_manage_club(p_club_id) then
        raise exception 'Club management access required.';
    end if;

    v_advance_days := coalesce(p_advance_days, 14)::smallint;

    if v_advance_days < 1 or v_advance_days > 14 then
        raise exception 'Website booking availability must be between 1 and 14 days.';
    end if;

    insert into public.club_settings (
        club_id,
        public_booking_enabled,
        public_booking_advance_days,
        updated_at
    )
    values (
        p_club_id,
        coalesce(p_enabled, false),
        v_advance_days,
        now()
    )
    on conflict on constraint club_settings_pkey
    do update set
        public_booking_enabled = excluded.public_booking_enabled,
        public_booking_advance_days = excluded.public_booking_advance_days,
        updated_at = now();

    return query
    select *
    from public.admin_get_public_booking_widget(p_club_id);
end;
$$;

revoke all
on function public.admin_update_public_booking_widget(uuid, boolean, integer)
from public, anon;

grant execute
on function public.admin_update_public_booking_widget(uuid, boolean, integer)
to authenticated;


-- =========================================================
-- PUBLIC: CLUB + COURSE BOOTSTRAP
-- =========================================================
-- This is intentionally callable by anon. Only public club identity,
-- branding and active course names are returned.

create or replace function public.public_booking_widget_bootstrap(
    p_club_slug text
)
returns table (
    club_id uuid,
    club_name text,
    club_slug text,
    club_timezone text,
    short_name text,
    town_city text,
    county_region text,
    contact_email text,
    phone text,
    logo_path text,
    primary_color text,
    secondary_color text,
    accent_color text,
    public_booking_enabled boolean,
    public_booking_advance_days smallint,
    default_course_id uuid,
    courses jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_slug text;
begin
    v_slug := lower(nullif(trim(coalesce(p_club_slug, '')), ''));

    if v_slug is null then
        return;
    end if;

    return query
    select
        club.id,
        club.name::text,
        club.slug::text,
        club.timezone::text,
        settings.short_name,
        settings.town_city,
        settings.county_region,
        settings.contact_email,
        settings.phone,
        branding.logo_path,
        coalesce(branding.primary_color, '#064831')::text,
        coalesce(branding.secondary_color, '#022D1D')::text,
        coalesce(branding.accent_color, '#E5C45F')::text,
        coalesce(settings.public_booking_enabled, false),
        coalesce(settings.public_booking_advance_days, 14)::smallint,
        settings.default_course_id,
        coalesce(
            (
                select jsonb_agg(
                    jsonb_build_object(
                        'course_id', course.id,
                        'course_name', course.name,
                        'holes', course.holes
                    )
                    order by lower(course.name), course.created_at
                )
                from public.courses as course
                where course.club_id = club.id
                  and course.is_active = true
            ),
            '[]'::jsonb
        )
    from public.clubs as club
    left join public.club_settings as settings
        on settings.club_id = club.id
    left join public.club_branding as branding
        on branding.club_id = club.id
    where lower(club.slug) = v_slug
      and club.is_active = true
    limit 1;
end;
$$;

revoke all
on function public.public_booking_widget_bootstrap(text)
from public;

grant execute
on function public.public_booking_widget_bootstrap(text)
to anon, authenticated;


-- =========================================================
-- PUBLIC: AVAILABILITY-SAFE TEE SHEET
-- =========================================================
-- Never return booking ids, Player/member ids, names, emails, telephone
-- numbers or booking notes. The website only needs time + remaining capacity.

create or replace function public.public_booking_widget_tee_times(
    p_club_slug text,
    p_course_id uuid,
    p_play_date date
)
returns table (
    tee_time_id uuid,
    course_id uuid,
    play_date date,
    start_time time without time zone,
    max_players smallint,
    spaces_remaining smallint,
    availability text,
    bookable boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_club_id uuid;
    v_timezone text;
    v_today date;
    v_advance_days integer;
begin
    select
        club.id,
        coalesce(nullif(trim(club.timezone), ''), 'Europe/London'),
        coalesce(settings.public_booking_advance_days, 14)
    into
        v_club_id,
        v_timezone,
        v_advance_days
    from public.clubs as club
    join public.club_settings as settings
        on settings.club_id = club.id
    where lower(club.slug) = lower(trim(coalesce(p_club_slug, '')))
      and club.is_active = true
      and settings.public_booking_enabled = true
    limit 1;

    if v_club_id is null
       or p_course_id is null
       or p_play_date is null then
        return;
    end if;

    if not exists (
        select 1
        from public.courses as course
        where course.id = p_course_id
          and course.club_id = v_club_id
          and course.is_active = true
    ) then
        return;
    end if;

    v_today := (now() at time zone v_timezone)::date;

    if p_play_date < v_today
       or p_play_date > (v_today + v_advance_days) then
        return;
    end if;

    return query
    select
        tee_time.id,
        tee_time.course_id,
        tee_time.play_date,
        tee_time.start_time,
        tee_time.max_players,
        greatest(
            tee_time.max_players - coalesce(booking.player_count, 0),
            0
        )::smallint,
        case
            when tee_time.operational_status <> 'open' then 'closed'
            when booking.id is null then 'open'
            when booking.booking_type = 'private' then 'unavailable'
            when coalesce(booking.player_count, 0) >= tee_time.max_players then 'full'
            when booking.booking_type = 'joinable' then 'joinable'
            else 'unavailable'
        end::text,
        (
            tee_time.operational_status = 'open'
            and (
                booking.id is null
                or (
                    booking.booking_type = 'joinable'
                    and coalesce(booking.player_count, 0) < tee_time.max_players
                )
            )
        )::boolean
    from public.tee_times as tee_time
    left join public.bookings as booking
        on booking.tee_time_id = tee_time.id
       and booking.booking_status = 'active'
    where tee_time.course_id = p_course_id
      and tee_time.play_date = p_play_date
    order by tee_time.start_time;
end;
$$;

revoke all
on function public.public_booking_widget_tee_times(text, uuid, date)
from public;

grant execute
on function public.public_booking_widget_tee_times(text, uuid, date)
to anon, authenticated;

commit;

notify pgrst, 'reload schema';
