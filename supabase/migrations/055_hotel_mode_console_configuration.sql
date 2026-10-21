-- Paryx Hotel Mode — Phase 1 (Console-owned configuration and access policy).
-- Apply after 053 and the v0.30.0 module/tenant migrations (051/052).
-- SAFE DEFAULT: every club begins with Hotel Mode disabled.
-- Phase 1 intentionally does NOT change tee-time availability or bookings.
begin;

create table if not exists public.hotel_mode_settings (
    club_id uuid primary key references public.clubs(id) on delete cascade,
    enabled boolean not null default false,
    hotel_booking_days integer not null default 180 check (hotel_booking_days between 1 and 730),
    society_booking_days integer not null default 365 check (society_booking_days between 1 and 730),
    member_booking_days integer not null default 14 check (member_booking_days between 1 and 365),
    visitor_booking_days integer not null default 7 check (visitor_booking_days between 1 and 365),
    hotel_allocation_percent integer not null default 30 check (hotel_allocation_percent between 0 and 90),
    member_allocation_percent integer not null default 20 check (member_allocation_percent between 0 and 90),
    hotel_release_days integer not null default 3 check (hotel_release_days between 0 and 90),
    member_release_days integer not null default 1 check (member_release_days between 0 and 90),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint hotel_mode_total_allocation_valid
        check (hotel_allocation_percent + member_allocation_percent <= 100),
    constraint hotel_mode_hotel_release_valid
        check (hotel_release_days < hotel_booking_days),
    constraint hotel_mode_member_release_valid
        check (member_release_days < member_booking_days)
);

create table if not exists public.hotel_mode_role_permissions (
    club_id uuid not null references public.clubs(id) on delete cascade,
    staff_role text not null check (
        staff_role in ('starter','reception','professional','greenkeeper','manager','club_admin')
    ),
    can_manage_hotel boolean not null default false,
    can_manage_societies boolean not null default false,
    can_override boolean not null default false,
    updated_at timestamptz not null default now(),
    primary key (club_id, staff_role),
    constraint hotel_mode_override_requires_access
        check (not can_override or can_manage_hotel or can_manage_societies)
);

alter table public.hotel_mode_settings enable row level security;
alter table public.hotel_mode_role_permissions enable row level security;
revoke all on table public.hotel_mode_settings from public, anon, authenticated;
revoke all on table public.hotel_mode_role_permissions from public, anon, authenticated;

-- Seed existing clubs without changing their current behaviour.
insert into public.hotel_mode_settings (club_id)
select id from public.clubs
on conflict (club_id) do nothing;

insert into public.hotel_mode_role_permissions (
    club_id, staff_role, can_manage_hotel, can_manage_societies, can_override
)
select c.id, r.staff_role, r.hotels, r.societies, r.override_allowed
from public.clubs as c
cross join (values
    ('starter'::text,false,false,false),
    ('reception',true,true,false),
    ('professional',true,true,false),
    ('greenkeeper',false,false,false),
    ('manager',true,true,true),
    ('club_admin',true,true,true)
) as r(staff_role,hotels,societies,override_allowed)
on conflict (club_id, staff_role) do nothing;

create or replace function public.hotel_mode_new_club_defaults()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
    insert into public.hotel_mode_settings (club_id)
    values (new.id) on conflict (club_id) do nothing;

    insert into public.hotel_mode_role_permissions (
        club_id, staff_role, can_manage_hotel, can_manage_societies, can_override
    ) values
        (new.id,'starter',false,false,false),
        (new.id,'reception',true,true,false),
        (new.id,'professional',true,true,false),
        (new.id,'greenkeeper',false,false,false),
        (new.id,'manager',true,true,true),
        (new.id,'club_admin',true,true,true)
    on conflict (club_id,staff_role) do nothing;
    return new;
end;
$$;

drop trigger if exists hotel_mode_new_club_defaults on public.clubs;
create trigger hotel_mode_new_club_defaults
    after insert on public.clubs for each row
    execute function public.hotel_mode_new_club_defaults();

-- Console read access: Owner/Admin can edit; Support can inspect.
create or replace function public.platform_hotel_mode_get(p_club_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
    v_settings jsonb;
    v_roles jsonb;
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

    select coalesce(jsonb_object_agg(r.staff_role, jsonb_build_object(
        'can_manage_hotel', r.can_manage_hotel,
        'can_manage_societies', r.can_manage_societies,
        'can_override', r.can_override
    )), '{}'::jsonb) into v_roles
    from public.hotel_mode_role_permissions as r where r.club_id = p_club_id;

    return jsonb_build_object(
        'config', coalesce(v_settings, '{}'::jsonb),
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

    update public.hotel_mode_settings set
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

-- Atomic club + Hotel Mode save: either every setting saves or none do.
create or replace function public.platform_update_club_configuration_hotel(
    p_club_id uuid,
    p_name text,
    p_timezone text,
    p_modules jsonb,
    p_hotel_config jsonb,
    p_hotel_permissions jsonb
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
    perform public.platform_update_club_configuration_v2(
        p_club_id,p_name,p_timezone,p_modules
    );
    perform public.platform_hotel_mode_save(
        p_club_id,p_hotel_config,p_hotel_permissions
    );
    return true;
end;
$$;
revoke all on function public.platform_update_club_configuration_hotel(
    uuid,text,text,jsonb,jsonb,jsonb
) from public, anon;
grant execute on function public.platform_update_club_configuration_hotel(
    uuid,text,text,jsonb,jsonb,jsonb
) to authenticated;

-- This backend helper will gate the Hotel/Soceity booking RPCs in Phase 2.
-- Membership and role are resolved server-side; frontend role labels are not trusted.
create or replace function public.hotel_mode_staff_can(
    p_club_id uuid, p_action text
)
returns boolean
language sql stable security definer set search_path = ''
as $$
    select auth.uid() is not null
       and coalesce((select h.enabled from public.hotel_mode_settings h
           join public.clubs c on c.id = h.club_id and c.is_active
           where h.club_id = p_club_id),false)
       and exists (
           select 1
           from public.club_memberships cm
           join public.hotel_mode_role_permissions r
             on r.club_id = cm.club_id and r.staff_role = cm.role
           where cm.club_id = p_club_id and cm.profile_id = auth.uid()
             and cm.status = 'active'
             and case p_action
                 when 'hotel' then r.can_manage_hotel
                 when 'society' then r.can_manage_societies
                 when 'override' then r.can_override
                 else false
             end
       );
$$;
revoke all on function public.hotel_mode_staff_can(uuid,text) from public, anon;
grant execute on function public.hotel_mode_staff_can(uuid,text) to authenticated;

commit;
