-- =========================================================
-- PARYX MEMBER APP FOUNDATION
-- Run after migrations 007-010.
--
-- Core rule: one global Paryx player account. Club memberships
-- and paid scoring access are separate entitlements.
-- =========================================================

begin;

create table if not exists public.player_entitlements (
    profile_id uuid primary key
        references public.profiles(id)
        on delete cascade,
    plan text not null default 'free',
    tier2_until timestamptz,
    scorecard_pass_until timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint player_entitlements_plan_valid
        check (plan in ('free', 'tier2'))
);

alter table public.player_entitlements enable row level security;

insert into public.player_entitlements (profile_id)
select id from public.profiles
on conflict (profile_id) do nothing;

create or replace function public.handle_new_player_entitlement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.player_entitlements (profile_id)
    values (new.id)
    on conflict (profile_id) do nothing;
    return new;
end;
$$;

drop trigger if exists on_profile_created_player_entitlement on public.profiles;
create trigger on_profile_created_player_entitlement
after insert on public.profiles
for each row execute function public.handle_new_player_entitlement();

create table if not exists public.club_membership_access_requests (
    id uuid primary key default gen_random_uuid(),
    profile_id uuid not null references public.profiles(id) on delete cascade,
    club_id uuid not null references public.clubs(id) on delete cascade,
    requested_membership_number text,
    message text,
    status text not null default 'pending',
    resolved_by_membership_id uuid references public.club_memberships(id) on delete set null,
    resolved_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint club_membership_access_request_status_valid
        check (status in ('pending','approved','rejected','cancelled'))
);

alter table public.club_membership_access_requests enable row level security;

create unique index if not exists club_membership_access_requests_one_pending_idx
on public.club_membership_access_requests(profile_id, club_id)
where status = 'pending';

create index if not exists club_membership_access_requests_club_status_idx
on public.club_membership_access_requests(club_id, status, created_at);

create or replace function public.member_is_linked_club_member(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.club_memberships cm
        where cm.profile_id = auth.uid()
          and cm.club_id = p_club_id
          and cm.status = 'active'
          and cm.membership_type not in ('visitor','guest')
    );
$$;

revoke all on function public.member_is_linked_club_member(uuid) from public, anon;
grant execute on function public.member_is_linked_club_member(uuid) to authenticated;

create or replace function public.ensure_player_club_access(p_club_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_id uuid;
begin
    if auth.uid() is null then
        raise exception 'You must be signed in.';
    end if;

    if not exists (
        select 1 from public.clubs c
        where c.id = p_club_id and c.is_active = true
    ) then
        raise exception 'The selected club is not available.';
    end if;

    select id into v_id
    from public.club_memberships
    where profile_id = auth.uid() and club_id = p_club_id
    limit 1;

    if v_id is not null then
        if not exists (
            select 1 from public.club_memberships
            where id = v_id and status = 'active'
        ) then
            raise exception 'Your access to this club is not active.';
        end if;
        return v_id;
    end if;

    insert into public.club_memberships(
        profile_id, club_id, membership_type, status, role, is_primary
    ) values (
        auth.uid(), p_club_id, 'visitor', 'active', 'member', false
    ) returning id into v_id;

    return v_id;
end;
$$;

revoke all on function public.ensure_player_club_access(uuid) from public, anon, authenticated;

create or replace function public.member_get_bootstrap()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_result jsonb;
begin
    if auth.uid() is null then
        raise exception 'You must be signed in.';
    end if;

    select jsonb_build_object(
        'profile', jsonb_build_object(
            'id', p.id,
            'first_name', p.first_name,
            'last_name', p.last_name,
            'display_name', coalesce(
                nullif(trim(p.display_name), ''),
                nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''),
                nullif(trim(au.email::text), ''),
                'Player'
            ),
            'phone', p.phone,
            'email', au.email
        ),
        'entitlement', jsonb_build_object(
            'plan', coalesce(pe.plan, 'free'),
            'tier2_until', pe.tier2_until,
            'scorecard_pass_until', pe.scorecard_pass_until,
            'scorecard_access', coalesce((
                (pe.plan = 'tier2' and (pe.tier2_until is null or pe.tier2_until > now()))
                or (pe.scorecard_pass_until is not null and pe.scorecard_pass_until > now())
            ), false)
        ),
        'member_clubs', coalesce((
            select jsonb_agg(jsonb_build_object(
                'membership_id', cm.id,
                'club_id', c.id,
                'club_name', c.name,
                'membership_number', cm.membership_number,
                'membership_type', cm.membership_type,
                'role', cm.role,
                'is_primary', cm.is_primary,
                'logo_path', cb.logo_path,
                'primary_color', coalesce(cb.primary_color, '#064831'),
                'secondary_color', coalesce(cb.secondary_color, '#022D1D'),
                'accent_color', coalesce(cb.accent_color, '#E5C45F')
            ) order by cm.is_primary desc, lower(c.name))
            from public.club_memberships cm
            join public.clubs c on c.id = cm.club_id and c.is_active = true
            left join public.club_branding cb on cb.club_id = c.id
            where cm.profile_id = auth.uid()
              and cm.status = 'active'
              and cm.membership_type not in ('visitor','guest')
        ), '[]'::jsonb)
    ) into v_result
    from public.profiles p
    left join auth.users au on au.id = p.id
    left join public.player_entitlements pe on pe.profile_id = p.id
    where p.id = auth.uid();

    return coalesce(v_result, jsonb_build_object(
        'profile', jsonb_build_object('id', auth.uid(), 'display_name', 'Player'),
        'entitlement', jsonb_build_object('plan', 'free', 'scorecard_access', false),
        'member_clubs', '[]'::jsonb
    ));
end;
$$;

revoke all on function public.member_get_bootstrap() from public, anon;
grant execute on function public.member_get_bootstrap() to authenticated;

create or replace function public.member_list_clubs(p_search text default null)
returns table (
    club_id uuid,
    club_name text,
    club_slug text,
    town_city text,
    county_region text,
    logo_path text,
    is_member boolean,
    membership_number text,
    pending_access_request boolean,
    active_course_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_search text := nullif(lower(trim(coalesce(p_search,''))), '');
begin
    if auth.uid() is null then
        raise exception 'You must be signed in.';
    end if;

    return query
    select
        c.id,
        c.name,
        c.slug,
        cs.town_city,
        cs.county_region,
        cb.logo_path,
        (cm.id is not null and cm.status = 'active' and cm.membership_type not in ('visitor','guest')),
        case when cm.membership_type not in ('visitor','guest') then cm.membership_number else null end,
        exists (
            select 1 from public.club_membership_access_requests req
            where req.profile_id = auth.uid()
              and req.club_id = c.id
              and req.status = 'pending'
        ),
        (select count(*) from public.courses course where course.club_id = c.id and course.is_active = true)
    from public.clubs c
    left join public.club_settings cs on cs.club_id = c.id
    left join public.club_branding cb on cb.club_id = c.id
    left join public.club_memberships cm on cm.club_id = c.id and cm.profile_id = auth.uid()
    where c.is_active = true
      and (
        v_search is null
        or lower(c.name) like '%' || v_search || '%'
        or lower(coalesce(cs.town_city,'')) like '%' || v_search || '%'
        or lower(coalesce(cs.county_region,'')) like '%' || v_search || '%'
      )
    order by
        (cm.id is not null and cm.status = 'active' and cm.membership_type not in ('visitor','guest')) desc,
        lower(c.name);
end;
$$;

revoke all on function public.member_list_clubs(text) from public, anon;
grant execute on function public.member_list_clubs(text) to authenticated;

create or replace function public.member_get_courses(p_club_id uuid)
returns table(course_id uuid, course_name text, holes smallint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null then raise exception 'You must be signed in.'; end if;
    return query
    select c.id, c.name, c.holes
    from public.courses c
    join public.clubs club on club.id = c.club_id and club.is_active = true
    where c.club_id = p_club_id and c.is_active = true
    order by lower(c.name);
end;
$$;

revoke all on function public.member_get_courses(uuid) from public, anon;
grant execute on function public.member_get_courses(uuid) to authenticated;

create or replace function public.member_get_tee_sheet(p_course_id uuid, p_play_date date)
returns table (
    tee_time_id uuid,
    club_id uuid,
    club_name text,
    course_name text,
    play_date date,
    start_time time,
    max_players smallint,
    operational_status text,
    event_title text,
    booking_id uuid,
    booking_type text,
    player_count smallint,
    spaces_remaining smallint,
    player_names text[],
    current_user_role text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null then raise exception 'You must be signed in.'; end if;

    return query
    select
        tt.id,
        club.id,
        club.name,
        course.name,
        tt.play_date,
        tt.start_time,
        tt.max_players,
        tt.operational_status,
        ce.title,
        b.id,
        b.booking_type,
        coalesce(b.player_count,0)::smallint,
        greatest(tt.max_players - coalesce(b.player_count,0),0)::smallint,
        case
            when b.id is null then array[]::text[]
            when b.booking_type = 'private'
                 and not exists (
                    select 1
                    from public.booking_members mine
                    join public.club_memberships mycm on mycm.id = mine.membership_id
                    where mine.booking_id = b.id
                      and mine.member_status in ('invited','confirmed','checked_in')
                      and mycm.profile_id = auth.uid()
                 )
            then array[]::text[]
            else coalesce((
                select array_agg(x.name order by x.position)
                from (
                    select bm.position,
                           coalesce(nullif(trim(p.display_name),''), nullif(trim(concat_ws(' ',p.first_name,p.last_name)),''), 'Member')::text as name
                    from public.booking_members bm
                    join public.club_memberships cm on cm.id = bm.membership_id
                    join public.profiles p on p.id = cm.profile_id
                    where bm.booking_id = b.id and bm.member_status in ('invited','confirmed','checked_in')
                    union all
                    select bg.position, 'Guest'::text
                    from public.booking_guests bg
                    where bg.booking_id = b.id
                ) x
            ), array[]::text[])
        end,
        case
            when b.id is null then null
            when exists (
                select 1 from public.club_memberships leadcm
                where leadcm.id = b.created_by_membership_id and leadcm.profile_id = auth.uid()
            ) then 'lead'
            when exists (
                select 1
                from public.booking_members bm
                join public.club_memberships cm on cm.id = bm.membership_id
                where bm.booking_id = b.id
                  and cm.profile_id = auth.uid()
                  and bm.member_status in ('invited','confirmed','checked_in')
            ) then 'joined'
            else null
        end
    from public.tee_times tt
    join public.courses course on course.id = tt.course_id and course.is_active = true
    join public.clubs club on club.id = course.club_id and club.is_active = true
    left join public.club_events ce on ce.id = tt.club_event_id
    left join public.bookings b on b.tee_time_id = tt.id and b.booking_status = 'active'
    where tt.course_id = p_course_id and tt.play_date = p_play_date
    order by tt.start_time;
end;
$$;

revoke all on function public.member_get_tee_sheet(uuid,date) from public, anon;
grant execute on function public.member_get_tee_sheet(uuid,date) to authenticated;

create or replace function public.member_create_booking(
    p_tee_time_id uuid,
    p_player_count smallint default 1,
    p_booking_type text default 'joinable'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_club_id uuid;
begin
    select c.club_id into v_club_id
    from public.tee_times tt
    join public.courses c on c.id = tt.course_id
    join public.clubs club on club.id = c.club_id and club.is_active = true
    where tt.id = p_tee_time_id;

    if v_club_id is null then raise exception 'The selected tee time is not available.'; end if;
    perform public.ensure_player_club_access(v_club_id);
    return public.create_booking(p_tee_time_id, p_player_count, p_booking_type, null, null);
end;
$$;

revoke all on function public.member_create_booking(uuid,smallint,text) from public, anon;
grant execute on function public.member_create_booking(uuid,smallint,text) to authenticated;

create or replace function public.member_join_booking(
    p_booking_id uuid,
    p_player_count smallint default 1
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_club_id uuid;
begin
    select c.club_id into v_club_id
    from public.bookings b
    join public.tee_times tt on tt.id = b.tee_time_id
    join public.courses c on c.id = tt.course_id
    join public.clubs club on club.id = c.club_id and club.is_active = true
    where b.id = p_booking_id and b.booking_status = 'active';

    if v_club_id is null then raise exception 'The selected booking is not available.'; end if;
    perform public.ensure_player_club_access(v_club_id);
    return public.join_booking(p_booking_id, p_player_count);
end;
$$;

revoke all on function public.member_join_booking(uuid,smallint) from public, anon;
grant execute on function public.member_join_booking(uuid,smallint) to authenticated;

create or replace function public.member_get_upcoming_bookings(p_limit integer default 20)
returns table (
    booking_id uuid,
    club_name text,
    course_name text,
    play_date date,
    start_time time,
    player_count smallint,
    booking_type text,
    player_names text[],
    member_role text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null then raise exception 'You must be signed in.'; end if;

    return query
    select
        b.id,
        club.name,
        course.name,
        tt.play_date,
        tt.start_time,
        b.player_count,
        b.booking_type,
        coalesce((
            select array_agg(x.name order by x.position)
            from (
                select bm.position,
                       coalesce(nullif(trim(p.display_name),''), nullif(trim(concat_ws(' ',p.first_name,p.last_name)),''), 'Member')::text as name
                from public.booking_members bm
                join public.club_memberships cm2 on cm2.id = bm.membership_id
                join public.profiles p on p.id = cm2.profile_id
                where bm.booking_id = b.id and bm.member_status in ('invited','confirmed','checked_in')
                union all
                select bg.position, 'Guest'::text
                from public.booking_guests bg
                where bg.booking_id = b.id
            ) x
        ), array[]::text[]),
        case
            when exists (
                select 1 from public.club_memberships leadcm
                where leadcm.id = b.created_by_membership_id and leadcm.profile_id = auth.uid()
            ) then 'lead'
            else 'joined'
        end
    from public.bookings b
    join public.tee_times tt on tt.id = b.tee_time_id
    join public.courses course on course.id = tt.course_id
    join public.clubs club on club.id = course.club_id
    where b.booking_status = 'active'
      and (tt.play_date > current_date or (tt.play_date = current_date and tt.start_time > localtime))
      and (
        exists (
            select 1 from public.club_memberships leadcm
            where leadcm.id = b.created_by_membership_id and leadcm.profile_id = auth.uid()
        )
        or exists (
            select 1
            from public.booking_members bm
            join public.club_memberships cm on cm.id = bm.membership_id
            where bm.booking_id = b.id
              and cm.profile_id = auth.uid()
              and bm.member_status in ('invited','confirmed','checked_in')
        )
      )
    order by tt.play_date, tt.start_time
    limit greatest(1, least(coalesce(p_limit,20),100));
end;
$$;

revoke all on function public.member_get_upcoming_bookings(integer) from public, anon;
grant execute on function public.member_get_upcoming_bookings(integer) to authenticated;

create or replace function public.member_get_calendar_events(
    p_club_id uuid,
    p_from_date date,
    p_to_date date
)
returns table (
    event_id uuid,
    event_date date,
    start_time time,
    time_text text,
    title text,
    section text,
    event_type text,
    location_type text,
    venue text,
    course_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if not public.member_is_linked_club_member(p_club_id) then
        raise exception 'Club member access is required.';
    end if;

    return query
    select ce.id, ce.event_date, ce.start_time, ce.time_text, ce.title,
           ce.section, ce.event_type, ce.location_type, ce.venue, c.name
    from public.club_events ce
    left join public.courses c on c.id = ce.course_id
    where ce.club_id = p_club_id
      and ce.is_published = true
      and ce.status <> 'cancelled'
      and ce.event_date between p_from_date and p_to_date
    order by ce.event_date, ce.start_time nulls last, ce.display_order, lower(ce.title);
end;
$$;

revoke all on function public.member_get_calendar_events(uuid,date,date) from public, anon;
grant execute on function public.member_get_calendar_events(uuid,date,date) to authenticated;

create or replace function public.member_request_club_access(
    p_club_id uuid,
    p_membership_number text default null,
    p_message text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_id uuid;
begin
    if auth.uid() is null then raise exception 'You must be signed in.'; end if;
    if public.member_is_linked_club_member(p_club_id) then
        raise exception 'Your account is already linked as a member of this club.';
    end if;

    select id into v_id
    from public.club_membership_access_requests
    where profile_id = auth.uid() and club_id = p_club_id and status = 'pending'
    limit 1;

    if v_id is not null then return v_id; end if;

    insert into public.club_membership_access_requests(
        profile_id, club_id, requested_membership_number, message
    ) values (
        auth.uid(), p_club_id,
        nullif(trim(p_membership_number),''),
        nullif(trim(p_message),'')
    ) returning id into v_id;

    return v_id;
end;
$$;

revoke all on function public.member_request_club_access(uuid,text,text) from public, anon;
grant execute on function public.member_request_club_access(uuid,text,text) to authenticated;

commit;

notify pgrst, 'reload schema';
