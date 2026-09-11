-- =========================================================
-- PARYX MIGRATION 045
-- PUBLIC GUEST BOOKING + COMPACT WEBSITE WIDGET
-- =========================================================
--
-- Purpose
-- 1. Let a website visitor book an available tee time without first creating
--    or signing into a Paryx account.
-- 2. Keep Paryx sign-in available as an optional path for players who want
--    their booking attached to their account.
-- 3. Preserve contact details for the club without exposing them through the
--    public availability RPC.
-- 4. Add idempotency and a small per-email rate limit to reduce accidental
--    duplicate submissions and basic automated abuse.
--
-- Prerequisite: migrations through 044_public_website_booking_widget.sql.
-- =========================================================

begin;

-- Migration 042 makes this nullable so historical/member deletion and
-- guest-led bookings can exist without a Paryx membership row.
alter table public.bookings
    alter column created_by_membership_id drop not null;

alter table public.bookings
    add column if not exists contact_email text;


do $$
begin
    if not exists (
        select 1
        from pg_catalog.pg_constraint
        where conname = 'bookings_contact_email_not_blank'
          and conrelid = 'public.bookings'::regclass
    ) then
        alter table public.bookings
            add constraint bookings_contact_email_not_blank
            check (
                contact_email is null
                or length(trim(contact_email)) > 0
            );
    end if;
end;
$$;


-- =========================================================
-- PUBLIC WEBSITE GUEST PARTY AUDIT
-- =========================================================
-- A booking can contain more than one anonymous website party when the tee
-- time is joinable. Keep each party's contact details separately so ClubHub
-- can support this model later without mixing contacts into one booking row.

create table if not exists public.public_booking_guest_parties (
    id uuid primary key default gen_random_uuid(),

    booking_id uuid not null
        references public.bookings(id)
        on delete cascade,

    club_id uuid not null
        references public.clubs(id)
        on delete cascade,

    tee_time_id uuid not null
        references public.tee_times(id)
        on delete restrict,

    lead_name text not null,
    contact_email text not null,
    contact_number text,
    party_size smallint not null,

    booking_reference text not null default (
        'PX-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
    ),

    idempotency_key text not null,
    source text not null default 'website_widget',
    created_at timestamptz not null default now(),

    constraint public_booking_guest_parties_name_not_blank
        check (length(trim(lead_name)) between 2 and 100),

    constraint public_booking_guest_parties_email_not_blank
        check (length(trim(contact_email)) between 5 and 254),

    constraint public_booking_guest_parties_phone_not_blank
        check (
            contact_number is null
            or length(trim(contact_number)) between 5 and 40
        ),

    constraint public_booking_guest_parties_size_valid
        check (party_size between 1 and 8),

    constraint public_booking_guest_parties_source_valid
        check (source in ('website_widget')),

    constraint public_booking_guest_parties_reference_unique
        unique (booking_reference),

    constraint public_booking_guest_parties_idempotency_unique
        unique (club_id, idempotency_key)
);

create index if not exists public_booking_guest_parties_booking_idx
on public.public_booking_guest_parties (booking_id, created_at);

create index if not exists public_booking_guest_parties_email_created_idx
on public.public_booking_guest_parties (club_id, lower(contact_email), created_at desc);

alter table public.public_booking_guest_parties enable row level security;

revoke all
on table public.public_booking_guest_parties
from public, anon, authenticated;


-- Link the named booking_guests rows back to the anonymous website party.
alter table public.booking_guests
    add column if not exists public_guest_party_id uuid
        references public.public_booking_guest_parties(id)
        on delete cascade;

create index if not exists booking_guests_public_guest_party_idx
on public.booking_guests (public_guest_party_id)
where public_guest_party_id is not null;


-- =========================================================
-- PUBLIC GUEST BOOKING RPC
-- =========================================================
-- This RPC deliberately returns only a public booking reference and summary.
-- It never returns internal booking ids, membership ids or other Player data.

create or replace function public.public_booking_widget_create_guest(
    p_club_slug text,
    p_tee_time_id uuid,
    p_lead_name text,
    p_contact_email text,
    p_contact_number text default null,
    p_party_size integer default 1,
    p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_slug text;
    v_name text;
    v_email text;
    v_phone text;
    v_idempotency text;
    v_party_size smallint;

    v_club_id uuid;
    v_club_name text;
    v_timezone text;
    v_advance_days integer;
    v_today date;
    v_local_now timestamp;

    v_tee public.tee_times%rowtype;
    v_booking_id uuid;
    v_booking_type text;
    v_existing_count integer;
    v_spaces integer;
    v_party_id uuid;
    v_reference text;
    v_position integer;
    v_guest_index integer;
    v_recent_count integer;
    v_existing_result jsonb;
begin
    v_slug := lower(nullif(trim(coalesce(p_club_slug, '')), ''));
    v_name := nullif(trim(coalesce(p_lead_name, '')), '');
    v_email := lower(nullif(trim(coalesce(p_contact_email, '')), ''));
    v_phone := nullif(trim(coalesce(p_contact_number, '')), '');
    v_idempotency := nullif(trim(coalesce(p_idempotency_key, '')), '');
    v_party_size := coalesce(p_party_size, 1)::smallint;

    if v_slug is null or p_tee_time_id is null then
        raise exception 'The selected tee time is unavailable.';
    end if;

    if v_name is null or length(v_name) < 2 or length(v_name) > 100 then
        raise exception 'Enter the lead player name.';
    end if;

    if v_email is null
       or length(v_email) > 254
       or v_email !~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$' then
        raise exception 'Enter a valid email address.';
    end if;

    if v_phone is not null
       and (length(v_phone) < 5 or length(v_phone) > 40) then
        raise exception 'Enter a valid contact number or leave it blank.';
    end if;

    if v_party_size < 1 or v_party_size > 8 then
        raise exception 'Party size must be between 1 and 8.';
    end if;

    if v_idempotency is null
       or length(v_idempotency) < 8
       or length(v_idempotency) > 120 then
        raise exception 'The booking request is invalid. Refresh and try again.';
    end if;

    select
        club.id,
        club.name::text,
        coalesce(nullif(trim(club.timezone), ''), 'Europe/London'),
        coalesce(settings.public_booking_advance_days, 14)
    into
        v_club_id,
        v_club_name,
        v_timezone,
        v_advance_days
    from public.clubs as club
    join public.club_settings as settings
        on settings.club_id = club.id
    where lower(club.slug) = v_slug
      and club.is_active = true
      and settings.public_booking_enabled = true
    limit 1;

    if v_club_id is null then
        raise exception 'Website booking is not available for this club.';
    end if;

    -- Return the original result if the same browser retries the request.
    select jsonb_build_object(
        'booking_reference', party.booking_reference,
        'club_name', v_club_name,
        'play_date', tee_time.play_date,
        'start_time', to_char(tee_time.start_time, 'HH24:MI'),
        'party_size', party.party_size,
        'joined_existing_booking', exists (
            select 1
            from public.public_booking_guest_parties as earlier
            where earlier.booking_id = party.booking_id
              and earlier.created_at < party.created_at
        )
    )
    into v_existing_result
    from public.public_booking_guest_parties as party
    join public.tee_times as tee_time
        on tee_time.id = party.tee_time_id
    where party.club_id = v_club_id
      and party.idempotency_key = v_idempotency
    limit 1;

    if v_existing_result is not null then
        return v_existing_result;
    end if;

    -- Basic rate limit. This mainly stops accidental repeated submits and the
    -- simplest scripted abuse without requiring a third-party CAPTCHA service.
    select count(*)::integer
    into v_recent_count
    from public.public_booking_guest_parties as party
    where party.club_id = v_club_id
      and lower(party.contact_email) = v_email
      and party.created_at > now() - interval '15 minutes';

    if v_recent_count >= 3 then
        raise exception 'Too many recent booking attempts. Please wait a few minutes and try again.';
    end if;

    select tee_time.*
    into v_tee
    from public.tee_times as tee_time
    join public.courses as course
        on course.id = tee_time.course_id
    where tee_time.id = p_tee_time_id
      and course.club_id = v_club_id
      and course.is_active = true
    for update of tee_time;

    if not found or v_tee.operational_status <> 'open' then
        raise exception 'The selected tee time is no longer available.';
    end if;

    v_local_now := now() at time zone v_timezone;
    v_today := v_local_now::date;

    if v_tee.play_date < v_today
       or v_tee.play_date > (v_today + v_advance_days) then
        raise exception 'The selected tee time is outside the online booking window.';
    end if;

    if v_tee.play_date = v_today
       and v_tee.start_time <= v_local_now::time then
        raise exception 'The selected tee time has already passed.';
    end if;

    select
        booking.id,
        booking.booking_type,
        booking.player_count
    into
        v_booking_id,
        v_booking_type,
        v_existing_count
    from public.bookings as booking
    where booking.tee_time_id = v_tee.id
      and booking.booking_status = 'active'
    for update;

    if v_booking_id is not null and v_booking_type <> 'joinable' then
        raise exception 'The selected tee time is no longer available.';
    end if;

    v_existing_count := coalesce(v_existing_count, 0);
    v_spaces := greatest(v_tee.max_players - v_existing_count, 0);

    if v_party_size > v_spaces then
        raise exception 'There are not enough places remaining for that party size.';
    end if;

    if v_booking_id is null then
        insert into public.bookings (
            tee_time_id,
            created_by_membership_id,
            player_count,
            booking_type,
            booking_status,
            lead_name,
            contact_number,
            contact_email,
            notes
        )
        values (
            v_tee.id,
            null,
            v_party_size,
            'joinable',
            'active',
            v_name,
            v_phone,
            v_email,
            null
        )
        returning id into v_booking_id;
    end if;

    insert into public.public_booking_guest_parties (
        booking_id,
        club_id,
        tee_time_id,
        lead_name,
        contact_email,
        contact_number,
        party_size,
        idempotency_key
    )
    values (
        v_booking_id,
        v_club_id,
        v_tee.id,
        v_name,
        v_email,
        v_phone,
        v_party_size,
        v_idempotency
    )
    returning id, booking_reference
    into v_party_id, v_reference;

    -- Add anonymous occupants to the same guest table ClubHub already reads.
    for v_guest_index in 1..v_party_size loop
        select candidate.position
        into v_position
        from generate_series(1, v_tee.max_players) as candidate(position)
        where not exists (
            select 1
            from public.booking_members as member
            where member.booking_id = v_booking_id
              and member.position = candidate.position
        )
          and not exists (
            select 1
            from public.booking_guests as guest
            where guest.booking_id = v_booking_id
              and guest.position = candidate.position
        )
        order by candidate.position
        limit 1;

        if v_position is null then
            raise exception 'The selected tee time changed while booking. Refresh and try again.';
        end if;

        insert into public.booking_guests (
            booking_id,
            guest_name,
            position,
            added_by_membership_id,
            public_guest_party_id
        )
        values (
            v_booking_id,
            case
                when v_guest_index = 1 then v_name
                else 'Guest ' || v_guest_index::text
            end,
            v_position,
            null,
            v_party_id
        );
    end loop;

    if v_existing_count > 0 then
        update public.bookings
        set
            player_count = v_existing_count + v_party_size,
            updated_at = now()
        where id = v_booking_id;
    end if;

    return jsonb_build_object(
        'booking_reference', v_reference,
        'club_name', v_club_name,
        'play_date', v_tee.play_date,
        'start_time', to_char(v_tee.start_time, 'HH24:MI'),
        'party_size', v_party_size,
        'joined_existing_booking', (v_existing_count > 0)
    );
exception
    when unique_violation then
        raise exception 'That tee time changed while you were booking. Refresh and try again.';
end;
$$;

revoke all
on function public.public_booking_widget_create_guest(
    text,
    uuid,
    text,
    text,
    text,
    integer,
    text
)
from public;

grant execute
on function public.public_booking_widget_create_guest(
    text,
    uuid,
    text,
    text,
    text,
    integer,
    text
)
to anon, authenticated;


-- =========================================================
-- PUBLIC: COMPACT / CURRENT AVAILABILITY
-- =========================================================
-- Override the v0.27.0 availability RPC so today's already-passed tee times
-- are omitted completely. This keeps the public selector focused on times a
-- visitor can still use and avoids filling the compact UI with dead slots.

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
    v_local_now timestamp;
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

    v_local_now := now() at time zone v_timezone;
    v_today := v_local_now::date;

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
      and (
          p_play_date > v_today
          or tee_time.start_time > v_local_now::time
      )
    order by tee_time.start_time;
end;
$$;

revoke all
on function public.public_booking_widget_tee_times(text, uuid, date)
from public;

grant execute
on function public.public_booking_widget_tee_times(text, uuid, date)
to anon, authenticated;


-- =========================================================
-- CLUBHUB: IDENTIFY WEBSITE-LED BOOKINGS ON THE TEE SHEET
-- =========================================================
-- Keep the existing return shape; only the booking_source value gains the
-- documented `website` option. A Player booking that later has a website
-- visitor join it remains a Player-led booking.

create or replace function public.staff_get_tee_sheet(
    p_club_id uuid,
    p_course_id uuid,
    p_play_date date
)
returns table (
    tee_time_id uuid,
    start_time time,
    max_players smallint,
    operational_status text,
    tee_time_notes text,
    club_event_id uuid,
    event_title text,
    event_section text,
    event_type text,
    booking_id uuid,
    booking_type text,
    booking_status text,
    player_count smallint,
    lead_name text,
    booking_notes text,
    player_names text[],
    contact_number text,
    staff_checked_in_at timestamptz,
    booking_source text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null
       or p_club_id is null
       or p_course_id is null
       or p_play_date is null
       or not public.user_can_operate_tee_sheet(p_club_id) then
        raise exception 'Tee sheet access required.';
    end if;

    if not exists (
        select 1
        from public.courses as course
        where course.id = p_course_id
          and course.club_id = p_club_id
    ) then
        raise exception 'The selected course is not available at this club.';
    end if;

    return query
    select
        tee_time.id,
        tee_time.start_time,
        tee_time.max_players,
        tee_time.operational_status,
        tee_time.notes,
        event.id,
        event.title,
        event.section,
        event.event_type,
        booking.id,
        booking.booking_type,
        booking.booking_status,
        booking.player_count,
        booking.lead_name,
        booking.notes,
        coalesce(
            (
                select array_agg(players.name order by players.position)
                from (
                    select
                        booking_member.position,
                        coalesce(
                            nullif(trim(membership.club_display_name), ''),
                            nullif(trim(concat_ws(' ', membership.club_first_name, membership.club_last_name)), ''),
                            nullif(trim(membership.club_email), ''),
                            'Member'
                        )::text as name
                    from public.booking_members as booking_member
                    join public.club_memberships as membership
                        on membership.id = booking_member.membership_id
                    where booking_member.booking_id = booking.id
                      and booking_member.member_status in ('invited','confirmed','checked_in')

                    union all

                    select
                        guest.position,
                        (guest.guest_name || ' (Guest)')::text
                    from public.booking_guests as guest
                    where guest.booking_id = booking.id
                ) as players
            ),
            array[]::text[]
        ),
        booking.contact_number,
        booking.staff_checked_in_at,
        case
            when booking.staff_created_by_membership_id is not null then 'staff'
            when booking.created_by_membership_id is null
                 and exists (
                     select 1
                     from public.public_booking_guest_parties as party
                     where party.booking_id = booking.id
                 ) then 'website'
            when booking.id is not null then 'player'
            else null
        end::text
    from public.tee_times as tee_time
    left join public.club_events as event
        on event.id = tee_time.club_event_id
    left join public.bookings as booking
        on booking.tee_time_id = tee_time.id
       and booking.booking_status = 'active'
    where tee_time.course_id = p_course_id
      and tee_time.play_date = p_play_date
    order by tee_time.start_time;
end;
$$;

revoke all
on function public.staff_get_tee_sheet(uuid, uuid, date)
from public, anon;

grant execute
on function public.staff_get_tee_sheet(uuid, uuid, date)
to authenticated;


-- =========================================================
-- CLUBHUB: SURFACE WEBSITE GUEST CONTACTS IN BOOKING DETAIL
-- =========================================================
-- Keep the existing RPC return shape. The existing `guests` JSON simply gains
-- contact fields for the lead row of each website visitor party.

create or replace function public.staff_get_booking_detail(
    p_club_id uuid,
    p_booking_id uuid
)
returns table (
    booking_id uuid,
    tee_time_id uuid,
    course_id uuid,
    course_name text,
    play_date date,
    start_time time,
    max_players smallint,
    booking_type text,
    booking_status text,
    player_count smallint,
    lead_name text,
    contact_number text,
    notes text,
    members jsonb,
    guests jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null
       or p_club_id is null
       or p_booking_id is null
       or not public.user_can_operate_tee_sheet(p_club_id) then
        raise exception 'Tee sheet access required.';
    end if;

    return query
    select
        b.id,
        tt.id,
        c.id,
        c.name,
        tt.play_date,
        tt.start_time,
        tt.max_players,
        b.booking_type,
        b.booking_status,
        b.player_count,
        b.lead_name,
        b.contact_number,
        b.notes,

        coalesce(
            (
                select jsonb_agg(
                    jsonb_build_object(
                        'membership_id', cm.id,
                        'profile_id', null,
                        'display_name', coalesce(
                            nullif(trim(cm.club_display_name), ''),
                            nullif(trim(concat_ws(' ', cm.club_first_name, cm.club_last_name)), ''),
                            nullif(trim(cm.club_email), ''),
                            'Member'
                        ),
                        'email', cm.club_email,
                        'membership_number', cm.membership_number,
                        'membership_type', cm.membership_type,
                        'membership_status', cm.status,
                        'is_active_member', (
                            cm.status = 'active'
                            and coalesce(cm.membership_type, 'member') not in ('visitor','guest','staff')
                        ),
                        'party_size', bm.party_size,
                        'position', bm.position,
                        'member_status', bm.member_status
                    )
                    order by bm.position
                )
                from public.booking_members as bm
                join public.club_memberships as cm
                    on cm.id = bm.membership_id
                where bm.booking_id = b.id
                  and bm.member_status in ('invited','confirmed','checked_in')
            ),
            '[]'::jsonb
        ),

        coalesce(
            (
                select jsonb_agg(
                    jsonb_build_object(
                        'guest_id', bg.id,
                        'guest_name', bg.guest_name,
                        'position', bg.position,
                        'public_guest_party_id', bg.public_guest_party_id,
                        'is_website_booking', (bg.public_guest_party_id is not null),
                        'is_party_lead', (
                            bg.public_guest_party_id is not null
                            and bg.position = (
                                select min(other_guest.position)
                                from public.booking_guests as other_guest
                                where other_guest.public_guest_party_id = bg.public_guest_party_id
                            )
                        ),
                        'contact_email', case
                            when bg.public_guest_party_id is not null then party.contact_email
                            else null
                        end,
                        'contact_number', case
                            when bg.public_guest_party_id is not null then party.contact_number
                            else null
                        end,
                        'booking_reference', case
                            when bg.public_guest_party_id is not null then party.booking_reference
                            else null
                        end
                    )
                    order by bg.position
                )
                from public.booking_guests as bg
                left join public.public_booking_guest_parties as party
                    on party.id = bg.public_guest_party_id
                where bg.booking_id = b.id
            ),
            '[]'::jsonb
        )

    from public.bookings as b
    join public.tee_times as tt
        on tt.id = b.tee_time_id
    join public.courses as c
        on c.id = tt.course_id
    where b.id = p_booking_id
      and c.club_id = p_club_id;

    if not found then
        raise exception 'The selected booking was not found.';
    end if;
end;
$$;

revoke all
on function public.staff_get_booking_detail(uuid, uuid)
from public, anon;

grant execute
on function public.staff_get_booking_detail(uuid, uuid)
to authenticated;


commit;

notify pgrst, 'reload schema';
