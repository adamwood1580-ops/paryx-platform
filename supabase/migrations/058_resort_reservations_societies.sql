-- Paryx Stage 3: Resort Reservations (Hotel Method A + Society Manager).
-- REQUIRES applied 055, 056, 057. Deploy to staging before production.
-- Console exclusively owns activation and role permissions (055).
-- Booking and provisional allocations share the existing tee_times/bookings tables.
begin;

create table public.resort_reservations (
    id uuid primary key default gen_random_uuid(),
    club_id uuid not null references public.clubs(id) on delete cascade,
    kind text not null check (kind in ('hotel','society')),
    status text not null check (status in ('provisional','confirmed','cancelled')),
    lead_name text not null check (length(btrim(lead_name)) between 2 and 150),
    contact_number text,
    accommodation_ref text,
    party_size integer not null check (party_size between 1 and 128),
    notes text,
    hold_expires_at timestamptz,
    created_by uuid not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint resort_hotel_always_confirmed check (kind <> 'hotel' or status <> 'provisional'),
    constraint resort_provisional_has_expiry check (status <> 'provisional' or hold_expires_at is not null)
);
create index resort_reservations_club_date_idx on public.resort_reservations(club_id,created_at desc);

create table public.resort_reservation_slots (
    id uuid primary key default gen_random_uuid(),
    reservation_id uuid not null references public.resort_reservations(id) on delete cascade,
    tee_time_id uuid not null references public.tee_times(id) on delete restrict,
    booking_id uuid unique references public.bookings(id) on delete set null,
    players integer not null check (players between 1 and 8),
    status text not null check (status in ('held','confirmed','released')),
    created_at timestamptz not null default now(),
    unique (reservation_id, tee_time_id),
    constraint resort_confirmed_booking_required check (status <> 'confirmed' or booking_id is not null)
);
-- A tee time may have one currently held allocation. Expired holds are
-- marked released by the next reservation operation (no cron required).
create unique index resort_one_live_hold_per_tee on public.resort_reservation_slots(tee_time_id)
where status = 'held';
create index resort_slot_booking_idx on public.resort_reservation_slots(booking_id);

create table public.resort_reservation_audit (
    id bigint generated always as identity primary key,
    reservation_id uuid not null references public.resort_reservations(id) on delete cascade,
    actor_id uuid not null,
    action text not null,
    details jsonb not null default '{}'::jsonb,
    happened_at timestamptz not null default now()
);

alter table public.resort_reservations enable row level security;
alter table public.resort_reservation_slots enable row level security;
alter table public.resort_reservation_audit enable row level security;
revoke all on public.resort_reservations from public, anon, authenticated;
revoke all on public.resort_reservation_slots from public, anon, authenticated;
revoke all on public.resort_reservation_audit from public, anon, authenticated;
revoke all on sequence public.resort_reservation_audit_id_seq from public, anon, authenticated;

-- Function invoked by client and ClubHub nav. No direct table access.
create or replace function public.resort_staff_context(p_club_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_enabled boolean;
begin
    if auth.uid() is null or p_club_id is null
        or not public.user_can_operate_tee_sheet(p_club_id) then
        raise exception 'Club tee-sheet access required.';
    end if;
    select coalesce(h.enabled,false) into v_enabled
    from public.hotel_mode_settings h where h.club_id = p_club_id;
    return jsonb_build_object(
        'enabled', coalesce(v_enabled,false),
        'can_hotel', public.hotel_mode_staff_can(p_club_id,'hotel'),
        'can_society', public.hotel_mode_staff_can(p_club_id,'society'),
        'can_override', public.hotel_mode_staff_can(p_club_id,'override')
    );
end;
$$;
revoke all on function public.resort_staff_context(uuid) from public, anon;
grant execute on function public.resort_staff_context(uuid) to authenticated;

create or replace function public.hotel_mode_can_book(
    p_tee_time_id uuid, p_audience text default 'auto'
)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
    v_club_id uuid;
    v_play_date date;
    v_start_time time;
    v_timezone text;
    v_local_now timestamp;
    v_days integer;
    v_slot text;
    v_audience text := p_audience;
    v_window integer;
    v_cfg public.hotel_mode_settings%rowtype;
    v_public_max integer;
    v_request_path text := lower(coalesce(current_setting('request.path',true),''));
    v_resort_action text := nullif(current_setting('paryx.resort_booking_action',true),'');
begin
    -- An unknown tee time must not be considered bookable.
    select c.club_id, tt.play_date, tt.start_time,
           coalesce(nullif(trim(club.timezone),''),'Europe/London'),
           coalesce(cs.public_booking_advance_days,14)
    into v_club_id,v_play_date,v_start_time,v_timezone,v_public_max
    from public.tee_times tt
    join public.courses c on c.id = tt.course_id
    join public.clubs club on club.id = c.club_id and club.is_active
    left join public.club_settings cs on cs.club_id = club.id
    where tt.id = p_tee_time_id and c.is_active;

    if not found then return false; end if;

    select * into v_cfg from public.hotel_mode_settings
    where club_id = v_club_id;
    -- Phase 3: enforce provisional society holds in both read-time availability
    -- and write-time guards, for staff, Player and public widget clients.
    if exists (
        select 1 from public.resort_reservation_slots s
        join public.resort_reservations r on r.id=s.reservation_id
        where s.tee_time_id=p_tee_time_id and s.status='held'
          and r.status='provisional' and r.hold_expires_at > now()
    ) then return false; end if;
    if not found or not v_cfg.enabled then return true; end if;

    v_local_now := now() at time zone v_timezone;
    v_days := v_play_date - v_local_now::date;
    if v_days < 0 or
       (v_days = 0 and v_start_time <= v_local_now::time) then
        return false;
    end if;

    -- 'auto' is the only option intended for untrusted booking clients.
    -- Supplying 'staff' cannot create staff permissions: those are checked
    -- against real active club staff membership and Console-owned role rules.
    if v_audience not in ('auto','staff','member','visitor') then
        return false;
    end if;

    if v_audience = 'auto' then
        -- A signed-in staff member is NOT automatically a hotel-booking agent
        -- when they book from the Player app or public visitor widget.
        -- Only the protected ClubHub staff booking RPCs can use staff access.
        if v_request_path like '%public_booking_widget_create_guest%' then
            v_audience := 'visitor';
        elsif (v_request_path like '%staff_create_booking%' or
               v_request_path like '%staff_update_booking%' or
               v_request_path like '%staff_move_booking%' or
               v_request_path like '%staff_replace_booking_players%')
              and auth.uid() is not null
              and public.user_can_operate_tee_sheet(v_club_id) then
            v_audience := 'staff';
        elsif auth.uid() is not null and public.member_is_linked_club_member(v_club_id) then
            v_audience := 'member';
        else
            v_audience := 'visitor';
        end if;
    elsif v_audience = 'staff' and
          (auth.uid() is null or not public.user_can_operate_tee_sheet(v_club_id)) then
        return false;
    elsif v_audience = 'member' and
          (auth.uid() is null or not public.member_is_linked_club_member(v_club_id)) then
        return false;
    end if;

    case v_audience
        when 'staff' then
            -- Staff may handle advance reservations on available general inventory.
            -- Future society-specific inventory is reserved for Phase 3.
            v_window := greatest(v_cfg.hotel_booking_days,v_cfg.society_booking_days);
        when 'member' then v_window := v_cfg.member_booking_days;
        else v_window := least(v_cfg.visitor_booking_days,v_public_max);
    end case;
    if v_days > v_window then return false; end if;

    v_slot := public.hotel_mode_slot_class(p_tee_time_id);
    if v_slot = 'hotel' and v_days > v_cfg.hotel_release_days then
        return v_audience = 'staff' and (
            public.hotel_mode_staff_can(v_club_id,'hotel')
            or (v_resort_action='society'
                and (v_request_path like '%resort_create_reservation%' or
                     v_request_path like '%resort_confirm_reservation%')
                and public.hotel_mode_staff_can(v_club_id,'society'))
        );
    end if;
    if v_slot = 'member' and v_days > v_cfg.member_release_days then
        return v_audience in ('member','staff');
    end if;
    return true;
end;
$$;
revoke all on function public.hotel_mode_can_book(uuid,text) from public;
grant execute on function public.hotel_mode_can_book(uuid,text) to authenticated, anon;

-- Reservation writes set a transaction-local scope only after authenticating
-- the actual ClubHub user and role. Reuse the Stage-2 booking trigger: it
-- must recognise this service call, otherwise hotel inventory is refused.
create or replace function public.hotel_mode_assert_booking_allowed(p_tee_time_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
    v_club_id uuid;
    v_scope text := nullif(current_setting('paryx.resort_booking_action',true),'');
    v_override boolean := current_setting('paryx.resort_override',true) = 'on';
    v_path text := lower(coalesce(current_setting('request.path',true),''));
    v_class text;
    v_cfg public.hotel_mode_settings%rowtype;
    v_date date;
begin
    if public.hotel_mode_can_book(p_tee_time_id,'auto') then return; end if;
    select c.club_id,t.play_date into v_club_id,v_date
    from public.tee_times t join public.courses c on c.id=t.course_id where t.id=p_tee_time_id;
    select * into v_cfg from public.hotel_mode_settings where club_id=v_club_id;
    if v_cfg.enabled and v_scope in ('hotel','society')
       and (v_path like '%resort_create_reservation%' or v_path like '%resort_confirm_reservation%')
       and public.hotel_mode_staff_can(v_club_id,v_scope)
       and public.hotel_mode_can_book(p_tee_time_id,'staff') then
        v_class := public.hotel_mode_slot_class(p_tee_time_id);
        -- Protected member inventory remains for members until its release.
        if v_class <> 'member' or (v_override and public.hotel_mode_staff_can(v_club_id,'override'))
           or v_date - (now() at time zone
            coalesce((select nullif(trim(timezone),'') from public.clubs where id=v_club_id),'Europe/London'))::date
            <= v_cfg.member_release_days then
            return;
        end if;
    end if;
    raise exception using errcode='P0001',
        message='This tee time is outside the permitted booking window or is protected for another audience.';
end;
$$;
revoke all on function public.hotel_mode_assert_booking_allowed(uuid) from public, anon, authenticated;

-- Held society inventory blocks all booking entry points, including direct
-- bookings through existing staff, player and visitor RPCs. Serialise on
-- tee_time row to prevent a confirmation race with a new provisional hold.
create or replace function public.resort_guard_held_tee_time()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    if new.booking_status = 'active' then
      if tg_op = 'UPDATE' then
        if old.booking_status = 'active'
           and new.tee_time_id is not distinct from old.tee_time_id then
            return new;
        end if;
      end if;
        perform 1 from public.tee_times where id=new.tee_time_id for update;
        if exists (
            select 1 from public.resort_reservation_slots s
            join public.resort_reservations r on r.id=s.reservation_id
            where s.tee_time_id=new.tee_time_id and s.status='held'
              and r.status='provisional' and r.hold_expires_at > now()
        ) then
            raise exception 'This tee time is on a provisional society hold.';
        end if;
    end if;
    return new;
end;
$$;
revoke all on function public.resort_guard_held_tee_time() from public, anon, authenticated;
create trigger resort_guard_held_tee_time before insert or update on public.bookings
for each row execute function public.resort_guard_held_tee_time();

-- A hold cannot be bypassed by joining an existing open booking; normally
-- holds only use empty slots but this check also handles older data.
create or replace function public.resort_assert_no_hold(p_booking_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
    if exists (
        select 1 from public.bookings b
        join public.resort_reservation_slots s on s.tee_time_id=b.tee_time_id
        join public.resort_reservations r on r.id=s.reservation_id
        where b.id=p_booking_id and s.status='held'
          and r.status='provisional' and r.hold_expires_at > now()
    ) then raise exception 'This tee time has a provisional society hold.'; end if;
end;
$$;
revoke all on function public.resort_assert_no_hold(uuid) from public, anon, authenticated;
create or replace function public.resort_guard_guest_join()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    perform public.resort_assert_no_hold(new.booking_id);
    return new;
end;
$$;
create trigger resort_guard_guest_join before insert or update on public.booking_guests
for each row execute function public.resort_guard_guest_join();
create trigger resort_guard_member_join before insert or update on public.booking_members
for each row execute function public.resort_guard_guest_join();

-- Shared method-A and society creation. Exact tee times are locked in order;
-- society places are the consecutive generated tee times after chosen start.
create or replace function public.resort_create_reservation(
    p_club_id uuid, p_kind text, p_first_tee_time_id uuid,
    p_party_size integer, p_lead_name text, p_contact_number text default null,
    p_accommodation_ref text default null, p_notes text default null,
    p_provisional boolean default false, p_guest_names text[] default null,
    p_hold_hours integer default 24, p_override_member boolean default false
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
    v_cfg public.hotel_mode_settings%rowtype;
    v_tz text;
    v_day date;
    v_start time;
    v_course uuid;
    v_limit integer;
    v_slot public.tee_times%rowtype;
    v_remaining integer := p_party_size;
    v_taken integer;
    v_count integer := 0;
    v_idx integer := 1;
    v_total_names integer;
    v_names text[];
    v_id uuid;
    v_booking_id uuid;
    v_hold_until timestamptz;
    v_path text := lower(coalesce(current_setting('request.path',true),''));
begin
    if auth.uid() is null or p_club_id is null or p_first_tee_time_id is null
        or p_kind not in ('hotel','society')
        or p_party_size is null or p_party_size not between 1 and 128
        or length(btrim(coalesce(p_lead_name,''))) not between 2 and 150
        or length(coalesce(p_notes,'')) > 2000
        or length(coalesce(p_contact_number,'')) > 80
        or length(coalesce(p_accommodation_ref,'')) > 100
        or not public.hotel_mode_staff_can(p_club_id,p_kind)
        or (coalesce(p_override_member,false) and not public.hotel_mode_staff_can(p_club_id,'override'))
        or not public.user_can_operate_tee_sheet(p_club_id) then
        raise exception 'Invalid reservation or Console Hotel Mode permission denied.';
    end if;
    if p_kind='hotel' and nullif(btrim(coalesce(p_accommodation_ref,'')),'') is null then
        raise exception 'Accommodation booking reference is required to link confirmed hotel golf.';
    end if;
    if p_kind='hotel' and p_provisional then
        raise exception 'Hotel golf is confirmed at the time of accommodation booking.';
    end if;
    if p_provisional and coalesce(p_override_member,false) then
        raise exception 'Member allocation overrides require an immediately confirmed booking.';
    end if;
    if p_provisional and (p_hold_hours is null or p_hold_hours not between 1 and 48) then
        raise exception 'Society holds must expire in 1–48 hours.';
    end if;
    if v_path <> '' and v_path not like '%resort_create_reservation%' then
        raise exception 'Hotel reservations must use the authorised reservation endpoint.';
    end if;
    select * into v_cfg from public.hotel_mode_settings where club_id=p_club_id and enabled;
    if not found then raise exception 'Hotel Mode is disabled by Console.'; end if;
    select tt.course_id,tt.play_date,tt.start_time,
           coalesce(nullif(trim(club.timezone),''),'Europe/London')
      into v_course,v_day,v_start,v_tz
    from public.tee_times tt join public.courses c on c.id=tt.course_id
    join public.clubs club on club.id=c.club_id
    where tt.id=p_first_tee_time_id and club.id=p_club_id and c.is_active and club.is_active;
    if not found then raise exception 'This tee time does not belong to the selected club.'; end if;
    v_limit := case p_kind when 'hotel' then v_cfg.hotel_booking_days else v_cfg.society_booking_days end;
    if v_day - (now() at time zone v_tz)::date > v_limit
       or (v_day + v_start) <= (now() at time zone v_tz) then
        raise exception 'This date is outside the permitted booking window.';
    end if;
    v_total_names := coalesce(cardinality(p_guest_names),0);
    if not p_provisional then
        if p_kind='hotel' and v_total_names <> p_party_size then
            raise exception 'Enter a guest name for every golfer in the confirmed hotel reservation.';
        end if;
        if p_kind='society' and v_total_names not in (0,p_party_size) then
            raise exception 'Enter all society golfer names or leave names blank pending details.';
        end if;
        if exists (select 1 from unnest(coalesce(p_guest_names,array[]::text[])) name
                   where length(btrim(name)) < 2 or length(btrim(name)) > 150) then
            raise exception 'Guest names must be between 2 and 150 characters.';
        end if;
    end if;
    v_hold_until := case when p_provisional then now() + make_interval(hours => p_hold_hours) else null end;
    insert into public.resort_reservations (
        club_id,kind,status,lead_name,contact_number,accommodation_ref,notes,
        party_size,hold_expires_at,created_by
    ) values (
        p_club_id,p_kind,case when p_provisional then 'provisional' else 'confirmed' end,
        btrim(p_lead_name),nullif(btrim(p_contact_number),''),nullif(btrim(p_accommodation_ref),''),
        nullif(btrim(p_notes),''),p_party_size,v_hold_until,auth.uid()
    ) returning id into v_id;

    -- Explicitly scope this authenticated resort workflow. Nested booking
    -- triggers require the path, actor role and scope to all match.
    perform set_config('paryx.resort_booking_action',p_kind,true);
    perform set_config('paryx.resort_override',case when coalesce(p_override_member,false) then 'on' else 'off' end,true);
    -- Lock each tee time before checking active bookings/holds. If the next
    -- available time is occupied, fail rather than skip (consecutive groups).
    for v_slot in
        select tt.* from public.tee_times tt
        where tt.course_id=v_course and tt.play_date=v_day and tt.start_time>=v_start
        order by tt.start_time for update
    loop
        exit when v_remaining=0;
        if p_kind='hotel' and v_count>0 then
            raise exception 'Hotel bookings are limited to one exact tee time; use Society Manager for groups.';
        end if;
        if v_slot.operational_status <> 'open' or exists (
            select 1 from public.bookings b where b.tee_time_id=v_slot.id and b.booking_status='active'
        ) then raise exception 'One or more consecutive tee times are unavailable. Select another start time.'; end if;
        -- Expired holds do not block course inventory.
        update public.resort_reservation_slots s set status='released'
        from public.resort_reservations r
        where s.tee_time_id=v_slot.id and s.reservation_id=r.id
          and s.status='held' and (r.status <> 'provisional' or r.hold_expires_at <= now());
        if exists(select 1 from public.resort_reservation_slots s
                  where s.tee_time_id=v_slot.id and s.status='held') then
            raise exception 'One or more tee times are held by another society.';
        end if;
        if not public.hotel_mode_can_book(v_slot.id,'staff') then
            raise exception 'The requested tee time is outside the booking window.';
        end if;
        if public.hotel_mode_slot_class(v_slot.id)='member'
          and not coalesce(p_override_member,false)
          and v_day - (now() at time zone v_tz)::date > v_cfg.member_release_days then
            raise exception 'Member-priority inventory is still protected.';
        end if;
        v_taken := least(v_remaining,v_slot.max_players::integer);
        if p_provisional then
            insert into public.resort_reservation_slots(reservation_id,tee_time_id,players,status)
            values(v_id,v_slot.id,v_taken,'held');
        else
            if v_total_names=0 then
                select array_agg('Society golfer ' || i::text || ' (details pending)' order by i)
                into v_names from generate_series(v_idx,v_idx+v_taken-1) as i;
            else
                v_names := p_guest_names[v_idx:v_idx+v_taken-1];
            end if;
            -- The confirmed booking uses the EXISTING staff booking machinery.
            perform set_config('paryx.resort_booking_action',p_kind,true);
            perform set_config('paryx.resort_override',case when p_override_member then 'on' else 'off' end,true);
            v_booking_id := public.staff_create_booking(
                p_club_id,v_slot.id,array[]::uuid[],array[]::smallint[],v_names,
                'private',p_lead_name,p_contact_number,p_notes
            );
            insert into public.resort_reservation_slots(
                reservation_id,tee_time_id,booking_id,players,status
            ) values(v_id,v_slot.id,v_booking_id,v_taken,'confirmed');
        end if;
        v_idx := v_idx + v_taken;
        v_remaining := v_remaining - v_taken;
        v_count := v_count + 1;
    end loop;
    perform set_config('paryx.resort_booking_action','',true);
    perform set_config('paryx.resort_override','off',true);
    if v_remaining>0 then raise exception 'Not enough consecutive tee times to accommodate this group.'; end if;
    insert into public.resort_reservation_audit(reservation_id,actor_id,action,details)
    values(v_id,auth.uid(),case when p_provisional then 'held' else 'created_confirmed' end,
        jsonb_build_object('slots',v_count,'players',p_party_size,'kind',p_kind,
        'member_override',coalesce(p_override_member,false)));
    return v_id;
end;
$$;
revoke all on function public.resort_create_reservation(uuid,text,uuid,integer,text,text,text,text,boolean,text[],integer,boolean) from public, anon;
grant execute on function public.resort_create_reservation(uuid,text,uuid,integer,text,text,text,text,boolean,text[],integer,boolean) to authenticated;

-- Confirm provisional society: within a single transaction, release holds,
-- create ALL real tee-time bookings or rollback every change on failure.
create or replace function public.resort_confirm_reservation(
    p_reservation_id uuid,p_guest_names text[] default null
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
    v_r public.resort_reservations%rowtype;
    v_s record;
    v_names text[];
    v_n integer;
    v_idx integer := 1;
    v_bid uuid;
begin
    select * into v_r from public.resort_reservations where id=p_reservation_id for update;
    if not found or v_r.kind <> 'society' or v_r.status <> 'provisional'
        or v_r.hold_expires_at <= now()
        or not public.hotel_mode_staff_can(v_r.club_id,'society')
        or not public.user_can_operate_tee_sheet(v_r.club_id) then
        raise exception 'Society hold expired, unavailable or permission denied.';
    end if;
    perform set_config('paryx.resort_booking_action','society',true);
    perform set_config('paryx.resort_override','off',true);
    v_n := coalesce(cardinality(p_guest_names),0);
    if v_n not in (0,v_r.party_size) then
        raise exception 'Provide all golfer names or leave blank pending details.';
    end if;
    if exists(select 1 from unnest(coalesce(p_guest_names,array[]::text[])) as n
              where length(btrim(n)) not between 2 and 150) then
        raise exception 'Invalid golfer name.';
    end if;
    for v_s in
        select s.id,s.tee_time_id,s.players from public.resort_reservation_slots s
        join public.tee_times t on t.id=s.tee_time_id
        where s.reservation_id=v_r.id and s.status='held'
        order by t.play_date,t.start_time for update of s
    loop
        if v_n=0 then
            select array_agg('Society golfer ' || i::text || ' (details pending)' order by i)
            into v_names from generate_series(v_idx,v_idx+v_s.players-1) as i;
        else
            v_names := p_guest_names[v_idx:v_idx+v_s.players-1];
        end if;
        -- Free only this reservation's held row. Any failed booking rolls back.
        update public.resort_reservation_slots set status='released' where id=v_s.id;
        perform set_config('paryx.resort_booking_action','society',true);
        perform set_config('paryx.resort_override','off',true);
        v_bid := public.staff_create_booking(
            v_r.club_id,v_s.tee_time_id,array[]::uuid[],array[]::smallint[],v_names,
            'private',v_r.lead_name,v_r.contact_number,v_r.notes
        );
        update public.resort_reservation_slots set status='confirmed',booking_id=v_bid where id=v_s.id;
        v_idx := v_idx+v_s.players;
    end loop;
    perform set_config('paryx.resort_booking_action','',true);
    perform set_config('paryx.resort_override','off',true);
    if v_idx-1<>v_r.party_size then
        raise exception 'The full group allocation could not be confirmed.';
    end if;
    update public.resort_reservations set status='confirmed',hold_expires_at=null,updated_at=now()
    where id=v_r.id;
    insert into public.resort_reservation_audit(reservation_id,actor_id,action)
    values(v_r.id,auth.uid(),'confirmed');
    return true;
end;
$$;
revoke all on function public.resort_confirm_reservation(uuid,text[]) from public, anon;
grant execute on function public.resort_confirm_reservation(uuid,text[]) to authenticated;

-- Cancellation uses the existing staff cancellation function and retains audit.
create or replace function public.resort_cancel_reservation(p_reservation_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_r public.resort_reservations%rowtype; v_s record;
begin
    select * into v_r from public.resort_reservations where id=p_reservation_id for update;
    if not found or v_r.status='cancelled'
       or not public.hotel_mode_staff_can(v_r.club_id,v_r.kind)
       or not public.user_can_operate_tee_sheet(v_r.club_id) then
        raise exception 'Reservation not found or cancellation permission denied.';
    end if;
    for v_s in select booking_id from public.resort_reservation_slots
        where reservation_id=v_r.id and status='confirmed' and booking_id is not null
    loop
        if exists(select 1 from public.bookings where id=v_s.booking_id and booking_status='active') then
            perform public.staff_cancel_booking(v_r.club_id,v_s.booking_id);
        end if;
    end loop;
    update public.resort_reservation_slots set status='released' where reservation_id=v_r.id;
    update public.resort_reservations set status='cancelled',updated_at=now() where id=v_r.id;
    insert into public.resort_reservation_audit(reservation_id,actor_id,action)
    values(v_r.id,auth.uid(),'cancelled');
    return true;
end;
$$;
revoke all on function public.resort_cancel_reservation(uuid) from public, anon;
grant execute on function public.resort_cancel_reservation(uuid) to authenticated;

-- Reservations list is staff-only and club scoped. No personal data is exposed
-- to the public widget or to the Player application.
create or replace function public.resort_list_reservations(
    p_club_id uuid,p_from date,p_to date
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_data jsonb;
begin
    if auth.uid() is null or p_club_id is null or p_from is null or p_to is null
       or p_to < p_from or p_to > p_from + 90
       or not public.user_can_operate_tee_sheet(p_club_id)
       or not (public.hotel_mode_staff_can(p_club_id,'hotel')
           or public.hotel_mode_staff_can(p_club_id,'society')) then
        raise exception 'Resort reservation access required.';
    end if;
    select coalesce(jsonb_agg(x.row order by x.play_date,x.first_time),'[]'::jsonb)
    into v_data from (
        select min(t.play_date) as play_date,min(t.start_time) as first_time,
          jsonb_build_object(
            'id',r.id,'kind',r.kind,'status',case
                when r.status='provisional' and r.hold_expires_at<=now() then 'expired'
                when r.status='confirmed' and bool_or(s.status='released') then 'partially_changed'
                else r.status end,
            'lead_name',r.lead_name,'contact_number',r.contact_number,
            'accommodation_ref',r.accommodation_ref,'party_size',r.party_size,
            'notes',r.notes,'hold_expires_at',r.hold_expires_at,
            'play_date',min(t.play_date),'first_time',min(t.start_time),
            'slots',jsonb_agg(jsonb_build_object('tee_time_id',t.id,'start_time',t.start_time,
                'booking_id',s.booking_id,'players',s.players,'status',s.status)
                order by t.start_time)
          ) as row
        from public.resort_reservations r
        join public.resort_reservation_slots s on s.reservation_id=r.id
        join public.tee_times t on t.id=s.tee_time_id
        where r.club_id=p_club_id and t.play_date between p_from and p_to
          and (r.kind='hotel' and public.hotel_mode_staff_can(p_club_id,'hotel')
            or r.kind='society' and public.hotel_mode_staff_can(p_club_id,'society'))
        group by r.id
    ) x;
    return v_data;
end;
$$;
revoke all on function public.resort_list_reservations(uuid,date,date) from public, anon;
grant execute on function public.resort_list_reservations(uuid,date,date) to authenticated;

-- Day availability and provisional society holds for the dedicated staff UI.
create or replace function public.resort_day_tee_times(p_club_id uuid,p_course_id uuid,p_play_date date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
    if auth.uid() is null or not public.user_can_operate_tee_sheet(p_club_id)
       or not (public.hotel_mode_staff_can(p_club_id,'hotel')
           or public.hotel_mode_staff_can(p_club_id,'society'))
       or not exists(select 1 from public.courses where id=p_course_id and club_id=p_club_id and is_active)
    then raise exception 'Resort tee-sheet access required.'; end if;
    select coalesce(jsonb_agg(jsonb_build_object(
        'id',t.id,'time',t.start_time,'max_players',t.max_players,
        'allocation',public.hotel_mode_slot_class(t.id),
        'open',t.operational_status='open' and b.id is null
          and s.id is null,
        'hold',s.id is not null,'booked',b.id is not null
    ) order by t.start_time),'[]'::jsonb) into v_result
    from public.tee_times t
    left join public.bookings b on b.tee_time_id=t.id and b.booking_status='active'
    left join public.resort_reservation_slots s on s.tee_time_id=t.id and s.status='held'
      and exists(select 1 from public.resort_reservations r
                 where r.id=s.reservation_id and r.status='provisional' and r.hold_expires_at>now())
    where t.course_id=p_course_id and t.play_date=p_play_date;
    return v_result;
end;
$$;
revoke all on function public.resort_day_tee_times(uuid,uuid,date) from public, anon;
grant execute on function public.resort_day_tee_times(uuid,uuid,date) to authenticated;

-- Staff tee sheet needs to show provisional inventory even if a role may
-- not view guests' names. Returns only public-safe operational indicators.
create or replace function public.resort_staff_overlay(
    p_club_id uuid,p_course_id uuid,p_play_date date
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_data jsonb;
begin
    if auth.uid() is null or not public.user_can_operate_tee_sheet(p_club_id)
       or not exists(select 1 from public.courses
                     where id=p_course_id and club_id=p_club_id) then
        raise exception 'Tee-sheet access required.';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object(
        'tee_time_id',t.id,'kind',r.kind,'status','provisional',
        'hold_expires_at',r.hold_expires_at) order by t.start_time),'[]'::jsonb)
    into v_data
    from public.resort_reservation_slots s
    join public.resort_reservations r on r.id=s.reservation_id
    join public.tee_times t on t.id=s.tee_time_id
    where r.club_id=p_club_id and t.course_id=p_course_id and t.play_date=p_play_date
      and r.status='provisional' and r.hold_expires_at>now() and s.status='held';
    return v_data;
end;
$$;
revoke all on function public.resort_staff_overlay(uuid,uuid,date) from public, anon;
grant execute on function public.resort_staff_overlay(uuid,uuid,date) to authenticated;

-- If a booking is cancelled through the normal tee sheet, its society/hotel
-- reservation slot is freed rather than appearing as falsely confirmed.
create or replace function public.resort_sync_cancelled_booking()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    if old.booking_status='active' and new.booking_status<>'active' then
        with changed as (
          update public.resort_reservation_slots set status='released'
          where booking_id=new.id and status='confirmed'
          returning reservation_id
        ) insert into public.resort_reservation_audit(reservation_id,actor_id,action)
        select reservation_id,coalesce(auth.uid(),(select created_by from public.resort_reservations rr where rr.id=changed.reservation_id)),'booking_released_externally'
        from changed;
    elsif new.tee_time_id is distinct from old.tee_time_id then
        with changed as (
          update public.resort_reservation_slots set status='released'
          where booking_id=new.id and status='confirmed'
          returning reservation_id
        ) insert into public.resort_reservation_audit(reservation_id,actor_id,action)
        select reservation_id,coalesce(auth.uid(),(select created_by from public.resort_reservations rr where rr.id=changed.reservation_id)),'booking_released_externally'
        from changed;
    end if;
    return new;
end;
$$;
revoke all on function public.resort_sync_cancelled_booking() from public, anon, authenticated;
create trigger resort_sync_cancelled_booking after update on public.bookings
for each row execute function public.resort_sync_cancelled_booking();

commit;
notify pgrst,'reload schema';
