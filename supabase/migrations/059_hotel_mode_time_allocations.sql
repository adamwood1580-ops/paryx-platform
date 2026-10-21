-- Paryx Hotel Mode - Stage 4: exact time-band allocation rules.
-- Requires 055/056/057/058. Run in staging and back up before production.
-- Console alone controls schedules. Bookings are never cancelled or moved.
-- Existing percentage allocations remain the default and serve as fallback.
begin;

alter table public.hotel_mode_settings
    add column if not exists allocation_mode text not null default 'percentage';
alter table public.hotel_mode_settings
    drop constraint if exists hotel_mode_allocation_mode_valid;
alter table public.hotel_mode_settings
    add constraint hotel_mode_allocation_mode_valid
    check (allocation_mode in ('percentage','time_bands'));

create table if not exists public.hotel_mode_time_allocations (
    id uuid primary key default gen_random_uuid(),
    club_id uuid not null references public.clubs(id) on delete cascade,
    course_id uuid references public.courses(id) on delete cascade,
    weekday smallint check (weekday between 0 and 6), -- Sunday = 0
    specific_date date,
    start_time time without time zone not null,
    end_time time without time zone not null,
    allocation text not null check (allocation in ('hotel','member','general')),
    created_at timestamptz not null default now(),
    constraint hotel_mode_rule_one_calendar_scope
        check ((weekday is not null) <> (specific_date is not null)),
    constraint hotel_mode_rule_positive_time check (start_time < end_time)
);
create index if not exists hotel_mode_time_allocations_lookup
    on public.hotel_mode_time_allocations (club_id,specific_date,weekday,course_id,start_time);
alter table public.hotel_mode_time_allocations enable row level security;
revoke all on public.hotel_mode_time_allocations from public, anon, authenticated;

-- Database validation as well as form validation: prevent ambiguous overlaps,
-- out-of-club courses and direct writes from other tenants.
create or replace function public.hotel_mode_validate_time_allocation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    if new.course_id is not null and not exists (
        select 1 from public.courses c
        where c.id = new.course_id and c.club_id = new.club_id and c.is_active
    ) then
        raise exception 'The selected course does not belong to this active club.';
    end if;
    if exists (
        select 1 from public.hotel_mode_time_allocations existing
        where existing.club_id = new.club_id
          and existing.id <> new.id
          and existing.course_id is not distinct from new.course_id
          and existing.weekday is not distinct from new.weekday
          and existing.specific_date is not distinct from new.specific_date
          and new.start_time < existing.end_time and existing.start_time < new.end_time
    ) then
        raise exception 'Overlapping Hotel Mode time allocations in the same scope are not allowed.';
    end if;
    return new;
end;
$$;
revoke all on function public.hotel_mode_validate_time_allocation() from public, anon, authenticated;
drop trigger if exists hotel_mode_validate_time_allocation on public.hotel_mode_time_allocations;
create trigger hotel_mode_validate_time_allocation
before insert or update on public.hotel_mode_time_allocations
for each row execute function public.hotel_mode_validate_time_allocation();

create or replace function public.platform_hotel_mode_get(p_club_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
    v_settings jsonb;
    v_roles jsonb;
    v_rules jsonb;
    v_courses jsonb;
begin
    if auth.uid() is null or not public.is_platform_user(
        array['platform_owner','platform_admin','platform_support']
    ) then
        raise exception 'Paryx Console access required.';
    end if;

    if not exists (select 1 from public.clubs where id = p_club_id) then
        raise exception 'Club not found.';
    end if;

    select jsonb_build_object(
        'enabled', s.enabled,
        'allocation_mode', s.allocation_mode,
        'hotel_booking_days', s.hotel_booking_days,
        'society_booking_days', s.society_booking_days,
        'member_booking_days', s.member_booking_days,
        'visitor_booking_days', s.visitor_booking_days,
        'hotel_allocation_percent', s.hotel_allocation_percent,
        'member_allocation_percent', s.member_allocation_percent,
        'hotel_release_days', s.hotel_release_days,
        'member_release_days', s.member_release_days
    ) into v_settings
    from public.hotel_mode_settings as s where s.club_id = p_club_id;

    select coalesce(jsonb_agg(jsonb_build_object(
        'course_id',r.course_id,
        'weekday',r.weekday,
        'specific_date',r.specific_date,
        'start_time',to_char(r.start_time,'HH24:MI'),
        'end_time',to_char(r.end_time,'HH24:MI'),
        'allocation',r.allocation
    ) order by r.specific_date nulls last,r.weekday nulls last,r.start_time), '[]'::jsonb)
    into v_rules from public.hotel_mode_time_allocations r where r.club_id = p_club_id;

    select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name)
                 order by c.name), '[]'::jsonb)
    into v_courses from public.courses c
    where c.club_id = p_club_id and c.is_active;

    select coalesce(jsonb_object_agg(r.staff_role, jsonb_build_object(
        'can_manage_hotel', r.can_manage_hotel,
        'can_manage_societies', r.can_manage_societies,
        'can_override', r.can_override
    )), '{}'::jsonb) into v_roles
    from public.hotel_mode_role_permissions as r where r.club_id = p_club_id;

    return jsonb_build_object(
        'config', coalesce(v_settings, '{}'::jsonb) || jsonb_build_object('allocation_rules',v_rules),
        'courses',v_courses,
        'permissions', coalesce(v_roles, '{}'::jsonb)
    );
end;
$$;
revoke all on function public.platform_hotel_mode_get(uuid) from public, anon;
grant execute on function public.platform_hotel_mode_get(uuid) to authenticated;

-- All settings, including role access, can ONLY be changed by Paryx Console.
create or replace function public.platform_hotel_mode_save(
    p_club_id uuid, p_config jsonb, p_permissions jsonb
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
    v_old jsonb;
    v_role text;
    v_perm jsonb;
    v_hotels boolean;
    v_societies boolean;
    v_override boolean;
    v_actor_role text;
    v_rule jsonb;
    v_mode text;
begin
    if auth.uid() is null or p_club_id is null or not public.is_platform_user(
        array['platform_owner','platform_admin']
    ) then
        raise exception 'Paryx Console Admin or Owner access required.';
    end if;

    if p_config is null or jsonb_typeof(p_config) <> 'object'
       or p_permissions is null or jsonb_typeof(p_permissions) <> 'object' then
        raise exception 'Hotel settings and role permissions must be objects.';
    end if;

    select public.platform_hotel_mode_get(p_club_id) into v_old;

    -- Explicit values required so partial form submits cannot silently reset policy.
    if not (p_config ?& array[
        'enabled','hotel_booking_days','society_booking_days',
        'member_booking_days','visitor_booking_days','hotel_allocation_percent',
        'member_allocation_percent','hotel_release_days','member_release_days'
    ]) then
        raise exception 'Hotel Mode configuration is incomplete.';
    end if;

    -- The new allocation options are optional for older Console builds.
    -- Do not silently reset a timetable when an older client saves other fields.
    if p_config ? 'allocation_mode' then
        v_mode := p_config->>'allocation_mode';
        if v_mode not in ('percentage','time_bands') then
            raise exception 'Unknown hotel allocation mode.';
        end if;
    end if;
    if p_config ? 'allocation_rules' then
        if jsonb_typeof(p_config->'allocation_rules') <> 'array'
           or jsonb_array_length(p_config->'allocation_rules') > 200 then
            raise exception 'Allocation rules must be an array with at most 200 entries.';
        end if;
    end if;

    -- Lock club settings to serialize competing Console configuration saves.
    perform 1 from public.hotel_mode_settings s where s.club_id = p_club_id for update;
    if not found then
        raise exception 'Hotel Mode settings not found for club.';
    end if;

    update public.hotel_mode_settings set
        allocation_mode = coalesce(v_mode,allocation_mode),
        enabled = (p_config->>'enabled')::boolean,
        hotel_booking_days = (p_config->>'hotel_booking_days')::integer,
        society_booking_days = (p_config->>'society_booking_days')::integer,
        member_booking_days = (p_config->>'member_booking_days')::integer,
        visitor_booking_days = (p_config->>'visitor_booking_days')::integer,
        hotel_allocation_percent = (p_config->>'hotel_allocation_percent')::integer,
        member_allocation_percent = (p_config->>'member_allocation_percent')::integer,
        hotel_release_days = (p_config->>'hotel_release_days')::integer,
        member_release_days = (p_config->>'member_release_days')::integer,
        updated_at = now()
    where club_id = p_club_id;

    if not found then
        raise exception 'Hotel Mode settings not found for club.';
    end if;

    if p_config ? 'allocation_rules' then
        -- Replacing the timetable is atomic with the rest of the club save.
        delete from public.hotel_mode_time_allocations where club_id = p_club_id;
        for v_rule in select value from jsonb_array_elements(p_config->'allocation_rules') loop
            if jsonb_typeof(v_rule) <> 'object'
               or not (v_rule ?& array['start_time','end_time','allocation']) then
                raise exception 'Each time allocation needs a start, end and category.';
            end if;
            insert into public.hotel_mode_time_allocations (
                club_id,course_id,weekday,specific_date,start_time,end_time,allocation
            ) values (
                p_club_id,
                nullif(v_rule->>'course_id','')::uuid,
                (v_rule->>'weekday')::integer,
                nullif(v_rule->>'specific_date','')::date,
                (v_rule->>'start_time')::time,
                (v_rule->>'end_time')::time,
                v_rule->>'allocation'
            );
        end loop;
    end if;

    foreach v_role in array array[
        'starter','reception','professional','greenkeeper','manager','club_admin'
    ] loop
        v_perm := p_permissions -> v_role;
        if v_perm is null or jsonb_typeof(v_perm) <> 'object'
           or not (v_perm ?& array[
              'can_manage_hotel','can_manage_societies','can_override'
           ]) then
            raise exception 'Permissions missing or incomplete for %.', v_role;
        end if;

        v_hotels := (v_perm->>'can_manage_hotel')::boolean;
        v_societies := (v_perm->>'can_manage_societies')::boolean;
        v_override := (v_perm->>'can_override')::boolean;

        if v_override and not (v_hotels or v_societies) then
            raise exception 'Override requires Hotel or Society access for %.', v_role;
        end if;

        insert into public.hotel_mode_role_permissions (
            club_id,staff_role,can_manage_hotel,can_manage_societies,can_override,updated_at
        ) values (
            p_club_id,v_role,v_hotels,v_societies,v_override,now()
        ) on conflict (club_id,staff_role) do update set
            can_manage_hotel = excluded.can_manage_hotel,
            can_manage_societies = excluded.can_manage_societies,
            can_override = excluded.can_override,
            updated_at = now();
    end loop;

    select pu.role into v_actor_role from public.platform_users as pu
    where pu.user_id = auth.uid() and pu.is_active limit 1;

    insert into public.platform_audit_log (
        actor_user_id,actor_role,action,club_id,details
    ) values (
        auth.uid(),v_actor_role,'hotel_mode_configuration_updated',p_club_id,
        jsonb_build_object('previous',v_old,'new',public.platform_hotel_mode_get(p_club_id))
    );
    return true;
end;
$$;
revoke all on function public.platform_hotel_mode_save(uuid,jsonb,jsonb) from public, anon;
grant execute on function public.platform_hotel_mode_save(uuid,jsonb,jsonb) to authenticated;

create or replace function public.hotel_mode_slot_class(p_tee_time_id uuid)
returns text
language plpgsql stable security definer set search_path = ''
as $$
declare
    v_course_id uuid;
    v_play_date date;
    v_start_time time;
    v_enabled boolean;
    v_mode text;
    v_club_id uuid;
    v_match text;
    v_h integer;
    v_m integer;
    v_rank bigint;
    v_nonhotel_rank bigint;
begin
    select t.course_id, t.play_date, t.start_time,
           coalesce(s.enabled,false),
           coalesce(s.hotel_allocation_percent,0),
           coalesce(s.member_allocation_percent,0),
           coalesce(s.allocation_mode,'percentage'), c.club_id
    into v_course_id, v_play_date, v_start_time, v_enabled, v_h, v_m, v_mode, v_club_id
    from public.tee_times t
    join public.courses c on c.id = t.course_id
    left join public.hotel_mode_settings s on s.club_id = c.club_id
    where t.id = p_tee_time_id;

    if not found or not v_enabled then return 'general'; end if;

    if v_mode = 'time_bands' then
        -- Specific calendar dates trump weekly patterns. Within the same type,
        -- course-specific entries trump all-course rules. No match falls back
        -- to the existing deterministic percentage distribution.
        select r.allocation into v_match
        from public.hotel_mode_time_allocations r
        where r.club_id = v_club_id
          and (r.course_id is null or r.course_id = v_course_id)
          and (r.specific_date = v_play_date
               or (r.specific_date is null
                   and r.weekday = extract(dow from v_play_date)::integer))
          and v_start_time >= r.start_time and v_start_time < r.end_time
        order by (r.specific_date is not null) desc,
                 (r.course_id is not null) desc
        limit 1;
        if found then return v_match; end if;
    end if;

    select count(*) into v_rank
    from public.tee_times tt
    where tt.course_id = v_course_id and tt.play_date = v_play_date
      and tt.start_time <= v_start_time;

    if floor(v_rank * v_h::numeric / 100) >
       floor((v_rank-1) * v_h::numeric / 100) then
        return 'hotel';
    end if;

    -- Choose member slots from the slots NOT already classified as hotel,
    -- avoiding overlap and preserving the intended split (e.g. 30/20/50).
    v_nonhotel_rank := v_rank - floor(v_rank * v_h::numeric / 100)::bigint;
    if v_m > 0 and
       floor(v_nonhotel_rank * v_m::numeric / (100-v_h)) >
       floor((v_nonhotel_rank-1) * v_m::numeric / (100-v_h)) then
        return 'member';
    end if;
    return 'general';
end;
$$;
revoke all on function public.hotel_mode_slot_class(uuid) from public, anon;
grant execute on function public.hotel_mode_slot_class(uuid) to authenticated;


-- Automatic booking/release and society APIs already consult
-- hotel_mode_slot_class(), so the new timetable flows through all channels.
commit;
