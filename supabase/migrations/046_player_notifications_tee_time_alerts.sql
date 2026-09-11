-- =========================================================
-- PARYX MIGRATION 046
-- PLAYER NOTIFICATIONS + TEE-TIME AVAILABILITY ALERTS
-- =========================================================
--
-- Adds a private Player notification centre and one-shot tee-time alerts.
-- Alerts are tied to an exact tee_time row and requested party size.
-- When an occupied tee time gains enough space (cancel/leave/staff change),
-- Paryx creates an in-app notification and marks the alert notified.
--
-- Direct table access is intentionally revoked. Player access is through
-- security-definer RPCs scoped to auth.uid(). ClubHub does not receive any
-- Player alert/link-state data.
-- =========================================================

begin;

-- =========================================================
-- PLAYER NOTIFICATIONS
-- =========================================================

create table if not exists public.player_notifications (
    id uuid primary key default gen_random_uuid(),

    profile_id uuid not null
        references public.profiles(id)
        on delete cascade,

    club_id uuid
        references public.clubs(id)
        on delete set null,

    notification_type text not null,
    title text not null,
    body text,
    action_url text,
    payload jsonb not null default '{}'::jsonb,
    dedupe_key text,

    read_at timestamptz,
    created_at timestamptz not null default now(),

    constraint player_notifications_type_not_blank
        check (length(trim(notification_type)) > 0),
    constraint player_notifications_title_not_blank
        check (length(trim(title)) > 0),
    constraint player_notifications_body_not_blank
        check (body is null or length(trim(body)) > 0),
    constraint player_notifications_action_not_blank
        check (action_url is null or length(trim(action_url)) > 0),
    constraint player_notifications_dedupe_not_blank
        check (dedupe_key is null or length(trim(dedupe_key)) > 0)
);

create index if not exists player_notifications_profile_created_idx
on public.player_notifications (profile_id, created_at desc);

create index if not exists player_notifications_profile_unread_idx
on public.player_notifications (profile_id, created_at desc)
where read_at is null;

create unique index if not exists player_notifications_profile_dedupe_unique
on public.player_notifications (profile_id, dedupe_key)
where dedupe_key is not null;

alter table public.player_notifications enable row level security;

revoke all on table public.player_notifications
from public, anon, authenticated;


-- =========================================================
-- TEE-TIME ALERTS / WAITLIST
-- =========================================================

create table if not exists public.player_tee_time_alerts (
    id uuid primary key default gen_random_uuid(),

    profile_id uuid not null
        references public.profiles(id)
        on delete cascade,

    tee_time_id uuid not null
        references public.tee_times(id)
        on delete cascade,

    requested_places smallint not null default 1,
    status text not null default 'active',

    notified_at timestamptz,
    cancelled_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint player_tee_time_alerts_places_valid
        check (requested_places between 1 and 8),

    constraint player_tee_time_alerts_status_valid
        check (status in ('active','notified','cancelled','expired')),

    constraint player_tee_time_alerts_notified_consistent
        check (
            (status = 'notified' and notified_at is not null)
            or status <> 'notified'
        ),

    constraint player_tee_time_alerts_cancelled_consistent
        check (
            (status = 'cancelled' and cancelled_at is not null)
            or status <> 'cancelled'
        )
);

create unique index if not exists player_tee_time_alerts_one_active_per_time
on public.player_tee_time_alerts (profile_id, tee_time_id)
where status = 'active';

create index if not exists player_tee_time_alerts_tee_active_idx
on public.player_tee_time_alerts (tee_time_id, requested_places)
where status = 'active';

create index if not exists player_tee_time_alerts_profile_created_idx
on public.player_tee_time_alerts (profile_id, created_at desc);

alter table public.player_tee_time_alerts enable row level security;

revoke all on table public.player_tee_time_alerts
from public, anon, authenticated;


-- =========================================================
-- INTERNAL: CREATE A NOTIFICATION SAFELY
-- =========================================================

create or replace function public._player_create_notification(
    p_profile_id uuid,
    p_club_id uuid,
    p_notification_type text,
    p_title text,
    p_body text default null,
    p_action_url text default null,
    p_payload jsonb default '{}'::jsonb,
    p_dedupe_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_id uuid;
begin
    if p_profile_id is null
       or nullif(trim(coalesce(p_notification_type, '')), '') is null
       or nullif(trim(coalesce(p_title, '')), '') is null then
        return null;
    end if;

    insert into public.player_notifications (
        profile_id,
        club_id,
        notification_type,
        title,
        body,
        action_url,
        payload,
        dedupe_key
    )
    values (
        p_profile_id,
        p_club_id,
        trim(p_notification_type),
        trim(p_title),
        nullif(trim(coalesce(p_body, '')), ''),
        nullif(trim(coalesce(p_action_url, '')), ''),
        coalesce(p_payload, '{}'::jsonb),
        nullif(trim(coalesce(p_dedupe_key, '')), '')
    )
    on conflict (profile_id, dedupe_key)
        where dedupe_key is not null
    do nothing
    returning id into v_id;

    return v_id;
end;
$$;

revoke all
on function public._player_create_notification(uuid,uuid,text,text,text,text,jsonb,text)
from public, anon, authenticated;


-- =========================================================
-- INTERNAL: PROCESS ALERTS FOR ONE TEE TIME
-- =========================================================

create or replace function public._player_process_tee_time_alerts(
    p_tee_time_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_tee_id uuid;
    v_play_date date;
    v_start_time time;
    v_max_players smallint;
    v_operational_status text;
    v_course_id uuid;
    v_course_name text;
    v_club_id uuid;
    v_club_name text;
    v_timezone text;
    v_local_now timestamp;
    v_booking_id uuid;
    v_booking_type text;
    v_player_count integer;
    v_spaces integer;
    v_action_url text;
    v_alert record;
    v_notified integer := 0;
begin
    if p_tee_time_id is null then
        return 0;
    end if;

    select
        tee_time.id,
        tee_time.play_date,
        tee_time.start_time,
        tee_time.max_players,
        tee_time.operational_status,
        course.id,
        course.name::text,
        club.id,
        club.name::text,
        coalesce(nullif(trim(club.timezone), ''), 'Europe/London')
    into
        v_tee_id,
        v_play_date,
        v_start_time,
        v_max_players,
        v_operational_status,
        v_course_id,
        v_course_name,
        v_club_id,
        v_club_name,
        v_timezone
    from public.tee_times as tee_time
    join public.courses as course
        on course.id = tee_time.course_id
    join public.clubs as club
        on club.id = course.club_id
    where tee_time.id = p_tee_time_id
      and course.is_active = true
      and club.is_active = true
    limit 1;

    if not found or v_operational_status <> 'open' then
        return 0;
    end if;

    v_local_now := now() at time zone v_timezone;

    if v_play_date < v_local_now::date
       or (
            v_play_date = v_local_now::date
            and v_start_time <= v_local_now::time
       ) then
        update public.player_tee_time_alerts as alert
        set
            status = 'expired',
            updated_at = now()
        where alert.tee_time_id = p_tee_time_id
          and alert.status = 'active';

        return 0;
    end if;

    select
        booking.id,
        booking.booking_type,
        booking.player_count
    into
        v_booking_id,
        v_booking_type,
        v_player_count
    from public.bookings as booking
    where booking.tee_time_id = p_tee_time_id
      and booking.booking_status = 'active'
    limit 1;

    if v_booking_id is not null and v_booking_type = 'private' then
        v_spaces := 0;
    else
        v_spaces := greatest(
            v_max_players - coalesce(v_player_count, 0),
            0
        );
    end if;

    if v_spaces <= 0 then
        return 0;
    end if;

    v_action_url :=
        'booking.html?club=' || v_club_id::text ||
        '&course=' || v_course_id::text ||
        '&date=' || v_play_date::text ||
        '&tee=' || v_tee_id::text;

    for v_alert in
        select
            alert.id,
            alert.profile_id,
            alert.requested_places
        from public.player_tee_time_alerts as alert
        where alert.tee_time_id = p_tee_time_id
          and alert.status = 'active'
          and alert.requested_places <= v_spaces
        order by alert.created_at
        for update skip locked
    loop
        perform public._player_create_notification(
            v_alert.profile_id,
            v_club_id,
            'tee_time_available',
            'Tee time available',
            v_club_name || ' · ' || v_course_name || ' · ' ||
                to_char(v_play_date, 'Dy DD Mon') || ' at ' ||
                to_char(v_start_time, 'HH24:MI') ||
                ' now has ' || v_spaces::text ||
                case when v_spaces = 1 then ' place available.' else ' places available.' end,
            v_action_url,
            jsonb_build_object(
                'alert_id', v_alert.id,
                'tee_time_id', v_tee_id,
                'requested_places', v_alert.requested_places,
                'spaces_available', v_spaces,
                'play_date', v_play_date,
                'start_time', to_char(v_start_time, 'HH24:MI')
            ),
            'tee-alert:' || v_alert.id::text
        );

        update public.player_tee_time_alerts as alert
        set
            status = 'notified',
            notified_at = now(),
            updated_at = now()
        where alert.id = v_alert.id;

        v_notified := v_notified + 1;
    end loop;

    return v_notified;
end;
$$;

revoke all
on function public._player_process_tee_time_alerts(uuid)
from public, anon, authenticated;


-- =========================================================
-- TRIGGERS: AVAILABILITY CHANGES
-- =========================================================

create or replace function public._player_booking_availability_alert_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if tg_op = 'DELETE' then
        perform public._player_process_tee_time_alerts(old.tee_time_id);
        return old;
    end if;

    if tg_op = 'UPDATE' then
        if old.tee_time_id is distinct from new.tee_time_id then
            perform public._player_process_tee_time_alerts(old.tee_time_id);
        end if;

        if old.tee_time_id is distinct from new.tee_time_id
           or old.booking_status is distinct from new.booking_status
           or old.booking_type is distinct from new.booking_type
           or old.player_count is distinct from new.player_count then
            perform public._player_process_tee_time_alerts(new.tee_time_id);
        end if;

        return new;
    end if;

    return new;
end;
$$;

revoke all
on function public._player_booking_availability_alert_trigger()
from public, anon, authenticated;


drop trigger if exists player_booking_availability_alerts
on public.bookings;

create trigger player_booking_availability_alerts
after update of tee_time_id, booking_status, booking_type, player_count
or delete
on public.bookings
for each row
execute function public._player_booking_availability_alert_trigger();


create or replace function public._player_tee_status_alert_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if old.operational_status is distinct from new.operational_status
       or old.max_players is distinct from new.max_players then
        perform public._player_process_tee_time_alerts(new.id);
    end if;

    return new;
end;
$$;

revoke all
on function public._player_tee_status_alert_trigger()
from public, anon, authenticated;


drop trigger if exists player_tee_status_alerts
on public.tee_times;

create trigger player_tee_status_alerts
after update of operational_status, max_players
on public.tee_times
for each row
execute function public._player_tee_status_alert_trigger();


-- =========================================================
-- TRIGGER: BOOKING/JOIN CONFIRMATIONS
-- =========================================================

create or replace function public._player_booking_member_notification_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_profile_id uuid;
    v_club_id uuid;
    v_club_name text;
    v_course_name text;
    v_play_date date;
    v_start_time time;
    v_is_lead boolean;
    v_action_url text;
begin
    if new.member_status not in ('confirmed','checked_in') then
        return new;
    end if;

    select membership.profile_id
    into v_profile_id
    from public.club_memberships as membership
    where membership.id = new.membership_id
    limit 1;

    if v_profile_id is null then
        return new;
    end if;

    select
        club.id,
        club.name::text,
        course.name::text,
        tee_time.play_date,
        tee_time.start_time,
        (booking.created_by_membership_id = new.membership_id)
    into
        v_club_id,
        v_club_name,
        v_course_name,
        v_play_date,
        v_start_time,
        v_is_lead
    from public.bookings as booking
    join public.tee_times as tee_time
        on tee_time.id = booking.tee_time_id
    join public.courses as course
        on course.id = tee_time.course_id
    join public.clubs as club
        on club.id = course.club_id
    where booking.id = new.booking_id
    limit 1;

    if v_club_id is null then
        return new;
    end if;

    v_action_url := 'booking.html#my-bookings';

    perform public._player_create_notification(
        v_profile_id,
        v_club_id,
        case when v_is_lead then 'booking_confirmed' else 'booking_joined' end,
        case when v_is_lead then 'Booking confirmed' else 'Booking joined' end,
        v_club_name || ' · ' || v_course_name || ' · ' ||
            to_char(v_play_date, 'Dy DD Mon') || ' at ' ||
            to_char(v_start_time, 'HH24:MI'),
        v_action_url,
        jsonb_build_object(
            'booking_id', new.booking_id,
            'membership_id', new.membership_id,
            'play_date', v_play_date,
            'start_time', to_char(v_start_time, 'HH24:MI')
        ),
        'booking-member:' || new.booking_id::text || ':' || new.membership_id::text
    );

    return new;
end;
$$;

revoke all
on function public._player_booking_member_notification_trigger()
from public, anon, authenticated;


drop trigger if exists player_booking_member_notifications
on public.booking_members;

create trigger player_booking_member_notifications
after insert
on public.booking_members
for each row
execute function public._player_booking_member_notification_trigger();


-- =========================================================
-- PLAYER RPC: CREATE ALERT
-- =========================================================

create or replace function public.player_create_tee_time_alert(
    p_tee_time_id uuid,
    p_requested_places integer default 1
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_places smallint;
    v_alert_id uuid;
    v_play_date date;
    v_start_time time;
    v_max_players smallint;
    v_operational_status text;
    v_club_id uuid;
    v_timezone text;
    v_local_now timestamp;
    v_booking_id uuid;
    v_booking_type text;
    v_player_count integer;
    v_spaces integer;
begin
    if auth.uid() is null then
        raise exception 'You must be signed in.';
    end if;

    if p_tee_time_id is null then
        raise exception 'Choose a tee time to watch.';
    end if;

    v_places := coalesce(p_requested_places, 1)::smallint;

    if v_places < 1 or v_places > 8 then
        raise exception 'Party size must be between 1 and 8.';
    end if;

    select
        tee_time.play_date,
        tee_time.start_time,
        tee_time.max_players,
        tee_time.operational_status,
        course.club_id,
        coalesce(nullif(trim(club.timezone), ''), 'Europe/London')
    into
        v_play_date,
        v_start_time,
        v_max_players,
        v_operational_status,
        v_club_id,
        v_timezone
    from public.tee_times as tee_time
    join public.courses as course
        on course.id = tee_time.course_id
       and course.is_active = true
    join public.clubs as club
        on club.id = course.club_id
       and club.is_active = true
    where tee_time.id = p_tee_time_id
    limit 1;

    if not found then
        raise exception 'The selected tee time is unavailable.';
    end if;

    if v_places > v_max_players then
        raise exception 'That party size cannot fit on this tee time.';
    end if;

    if v_operational_status <> 'open' then
        raise exception 'Availability alerts are only available for playable tee times.';
    end if;

    v_local_now := now() at time zone v_timezone;

    if v_play_date < v_local_now::date
       or (
            v_play_date = v_local_now::date
            and v_start_time <= v_local_now::time
       ) then
        raise exception 'That tee time has already passed.';
    end if;

    select
        booking.id,
        booking.booking_type,
        booking.player_count
    into
        v_booking_id,
        v_booking_type,
        v_player_count
    from public.bookings as booking
    where booking.tee_time_id = p_tee_time_id
      and booking.booking_status = 'active'
    limit 1;

    if v_booking_id is not null and v_booking_type = 'private' then
        v_spaces := 0;
    else
        v_spaces := greatest(
            v_max_players - coalesce(v_player_count, 0),
            0
        );
    end if;

    if v_spaces >= v_places then
        raise exception 'That tee time already has enough space. Book it now instead.';
    end if;

    select alert.id
    into v_alert_id
    from public.player_tee_time_alerts as alert
    where alert.profile_id = auth.uid()
      and alert.tee_time_id = p_tee_time_id
      and alert.status = 'active'
    limit 1;

    if v_alert_id is not null then
        update public.player_tee_time_alerts as alert
        set
            requested_places = v_places,
            updated_at = now()
        where alert.id = v_alert_id;

        return v_alert_id;
    end if;

    insert into public.player_tee_time_alerts (
        profile_id,
        tee_time_id,
        requested_places
    )
    values (
        auth.uid(),
        p_tee_time_id,
        v_places
    )
    returning id into v_alert_id;

    -- Covers the narrow race where availability changed between the check
    -- above and the alert insert.
    perform public._player_process_tee_time_alerts(p_tee_time_id);

    return v_alert_id;
end;
$$;

revoke all
on function public.player_create_tee_time_alert(uuid,integer)
from public, anon;

grant execute
on function public.player_create_tee_time_alert(uuid,integer)
to authenticated;


-- =========================================================
-- PLAYER RPC: CANCEL ALERT
-- =========================================================

create or replace function public.player_cancel_tee_time_alert(
    p_alert_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null then
        raise exception 'You must be signed in.';
    end if;

    update public.player_tee_time_alerts as alert
    set
        status = 'cancelled',
        cancelled_at = now(),
        updated_at = now()
    where alert.id = p_alert_id
      and alert.profile_id = auth.uid()
      and alert.status = 'active';

    return found;
end;
$$;

revoke all
on function public.player_cancel_tee_time_alert(uuid)
from public, anon;

grant execute
on function public.player_cancel_tee_time_alert(uuid)
to authenticated;


-- =========================================================
-- PLAYER RPC: LIST ALERTS
-- =========================================================

create or replace function public.player_list_tee_time_alerts()
returns table (
    alert_id uuid,
    tee_time_id uuid,
    club_id uuid,
    club_name text,
    course_id uuid,
    course_name text,
    play_date date,
    start_time time,
    requested_places smallint,
    alert_status text,
    notified_at timestamptz,
    created_at timestamptz,
    action_url text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null then
        raise exception 'You must be signed in.';
    end if;

    update public.player_tee_time_alerts as alert
    set
        status = 'expired',
        updated_at = now()
    from public.tee_times as tee_time
    join public.courses as course
        on course.id = tee_time.course_id
    join public.clubs as club
        on club.id = course.club_id
    where alert.profile_id = auth.uid()
      and alert.tee_time_id = tee_time.id
      and alert.status = 'active'
      and (
        tee_time.play_date < (now() at time zone coalesce(nullif(trim(club.timezone), ''), 'Europe/London'))::date
        or (
            tee_time.play_date = (now() at time zone coalesce(nullif(trim(club.timezone), ''), 'Europe/London'))::date
            and tee_time.start_time <= (now() at time zone coalesce(nullif(trim(club.timezone), ''), 'Europe/London'))::time
        )
      );

    return query
    select
        alert.id,
        tee_time.id,
        club.id,
        club.name::text,
        course.id,
        course.name::text,
        tee_time.play_date,
        tee_time.start_time,
        alert.requested_places,
        alert.status,
        alert.notified_at,
        alert.created_at,
        (
            'booking.html?club=' || club.id::text ||
            '&course=' || course.id::text ||
            '&date=' || tee_time.play_date::text ||
            '&tee=' || tee_time.id::text
        )::text
    from public.player_tee_time_alerts as alert
    join public.tee_times as tee_time
        on tee_time.id = alert.tee_time_id
    join public.courses as course
        on course.id = tee_time.course_id
    join public.clubs as club
        on club.id = course.club_id
    where alert.profile_id = auth.uid()
      and alert.status in ('active','notified')
      and alert.created_at >= now() - interval '30 days'
    order by
        case alert.status when 'active' then 0 else 1 end,
        tee_time.play_date,
        tee_time.start_time,
        alert.created_at desc;
end;
$$;

revoke all
on function public.player_list_tee_time_alerts()
from public, anon;

grant execute
on function public.player_list_tee_time_alerts()
to authenticated;


-- =========================================================
-- PLAYER RPC: NOTIFICATION SUMMARY
-- =========================================================

create or replace function public.player_notification_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_unread integer;
    v_active_alerts integer;
begin
    if auth.uid() is null then
        raise exception 'You must be signed in.';
    end if;

    select count(*)::integer
    into v_unread
    from public.player_notifications as notification
    where notification.profile_id = auth.uid()
      and notification.read_at is null;

    select count(*)::integer
    into v_active_alerts
    from public.player_tee_time_alerts as alert
    where alert.profile_id = auth.uid()
      and alert.status = 'active';

    return jsonb_build_object(
        'unread_count', coalesce(v_unread, 0),
        'active_alert_count', coalesce(v_active_alerts, 0)
    );
end;
$$;

revoke all
on function public.player_notification_summary()
from public, anon;

grant execute
on function public.player_notification_summary()
to authenticated;


-- =========================================================
-- PLAYER RPC: LIST NOTIFICATIONS
-- =========================================================

create or replace function public.player_list_notifications(
    p_limit integer default 50,
    p_offset integer default 0
)
returns table (
    notification_id uuid,
    notification_type text,
    club_id uuid,
    club_name text,
    title text,
    body text,
    action_url text,
    payload jsonb,
    read_at timestamptz,
    created_at timestamptz,
    total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_limit integer;
    v_offset integer;
begin
    if auth.uid() is null then
        raise exception 'You must be signed in.';
    end if;

    v_limit := greatest(1, least(coalesce(p_limit, 50), 100));
    v_offset := greatest(0, coalesce(p_offset, 0));

    return query
    select
        notification.id,
        notification.notification_type,
        notification.club_id,
        club.name::text,
        notification.title,
        notification.body,
        notification.action_url,
        notification.payload,
        notification.read_at,
        notification.created_at,
        count(*) over()::bigint
    from public.player_notifications as notification
    left join public.clubs as club
        on club.id = notification.club_id
    where notification.profile_id = auth.uid()
    order by notification.created_at desc
    limit v_limit
    offset v_offset;
end;
$$;

revoke all
on function public.player_list_notifications(integer,integer)
from public, anon;

grant execute
on function public.player_list_notifications(integer,integer)
to authenticated;


-- =========================================================
-- PLAYER RPC: MARK READ
-- =========================================================

create or replace function public.player_mark_notification_read(
    p_notification_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null then
        raise exception 'You must be signed in.';
    end if;

    update public.player_notifications as notification
    set read_at = coalesce(notification.read_at, now())
    where notification.id = p_notification_id
      and notification.profile_id = auth.uid();

    return found;
end;
$$;

revoke all
on function public.player_mark_notification_read(uuid)
from public, anon;

grant execute
on function public.player_mark_notification_read(uuid)
to authenticated;


create or replace function public.player_mark_all_notifications_read()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_updated integer;
begin
    if auth.uid() is null then
        raise exception 'You must be signed in.';
    end if;

    update public.player_notifications as notification
    set read_at = now()
    where notification.profile_id = auth.uid()
      and notification.read_at is null;

    get diagnostics v_updated = row_count;
    return v_updated;
end;
$$;

revoke all
on function public.player_mark_all_notifications_read()
from public, anon;

grant execute
on function public.player_mark_all_notifications_read()
to authenticated;


commit;

notify pgrst, 'reload schema';
