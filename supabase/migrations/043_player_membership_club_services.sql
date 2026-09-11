-- =========================================================
-- PARYX MIGRATION 043
-- PLAYER MEMBERSHIP + CLUB SERVICES
-- =========================================================
--
-- v0.26.0 goals
-- 1. Player self-service club membership linking using club + membership number
--    + matching club-held email.
-- 2. Keep Player<->member link private to Paryx and invisible to ClubHub.
-- 3. Safely merge an existing visitor relationship when a golfer later claims
--    their real club membership.
-- 4. Expose Player-safe My Clubs, club information, Club Credit and confirmed
--    competition results without exposing private identity-link metadata.
-- 5. Rate-limit membership-number verification attempts.
--
-- Prerequisites: migrations through 042.
-- =========================================================

begin;

-- ---------------------------------------------------------
-- PRIVATE CLAIM ATTEMPT LOG / RATE LIMIT
-- ---------------------------------------------------------

create table if not exists public.player_membership_claim_attempts (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    club_id uuid references public.clubs(id) on delete cascade,
    attempted_at timestamptz not null default now(),
    outcome text not null default 'attempted',
    constraint player_membership_claim_attempts_outcome_valid
        check (outcome in ('attempted','linked','already_linked','failed','rate_limited'))
);

create index if not exists player_membership_claim_attempts_user_time_idx
on public.player_membership_claim_attempts (user_id, attempted_at desc);

alter table public.player_membership_claim_attempts enable row level security;
revoke all on table public.player_membership_claim_attempts from anon, authenticated;

-- ---------------------------------------------------------
-- INTERNAL PLAYER MEMBERSHIP RESOLUTION
-- ---------------------------------------------------------
-- The private link table is authoritative for genuine memberships. The
-- profile_id fallback keeps old installations/backfilled relationships working
-- while the remaining booking core is migrated incrementally.

create or replace function public._player_membership_id_for_club(
    p_club_id uuid,
    p_include_visitor boolean default false
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_membership_id uuid;
begin
    if auth.uid() is null or p_club_id is null then
        return null;
    end if;

    select membership.id
    into v_membership_id
    from public.club_membership_player_links as link
    join public.club_memberships as membership
      on membership.id = link.membership_id
     and membership.club_id = link.club_id
    where link.profile_id = auth.uid()
      and link.club_id = p_club_id
      and membership.status = 'active'
      and (
          p_include_visitor
          or coalesce(membership.membership_type, 'member') not in ('visitor','guest','staff')
      )
    order by membership.created_at asc
    limit 1;

    if v_membership_id is not null then
        return v_membership_id;
    end if;

    select membership.id
    into v_membership_id
    from public.club_memberships as membership
    where membership.profile_id = auth.uid()
      and membership.club_id = p_club_id
      and membership.status = 'active'
      and (
          p_include_visitor
          or coalesce(membership.membership_type, 'member') not in ('visitor','guest','staff')
      )
    order by membership.is_primary desc, membership.created_at asc
    limit 1;

    return v_membership_id;
end;
$$;

revoke all on function public._player_membership_id_for_club(uuid,boolean)
from public, anon, authenticated;

create or replace function public.member_is_linked_club_member(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select public._player_membership_id_for_club(p_club_id, false) is not null;
$$;

revoke all on function public.member_is_linked_club_member(uuid) from public, anon;
grant execute on function public.member_is_linked_club_member(uuid) to authenticated;

-- ---------------------------------------------------------
-- PLAYER BOOTSTRAP — PRIVATE LINK AWARE
-- ---------------------------------------------------------

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
            'id', profile.id,
            'first_name', profile.first_name,
            'last_name', profile.last_name,
            'display_name', coalesce(
                nullif(trim(profile.display_name), ''),
                nullif(trim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
                nullif(trim(auth_user.email::text), ''),
                'Player'
            ),
            'phone', profile.phone,
            'email', auth_user.email
        ),
        'entitlement', jsonb_build_object(
            'plan', coalesce(entitlement.plan, 'free'),
            'tier2_until', entitlement.tier2_until,
            'scorecard_pass_until', entitlement.scorecard_pass_until,
            'scorecard_access', coalesce((
                (entitlement.plan = 'tier2' and (entitlement.tier2_until is null or entitlement.tier2_until > now()))
                or (entitlement.scorecard_pass_until is not null and entitlement.scorecard_pass_until > now())
            ), false)
        ),
        'member_clubs', coalesce((
            select jsonb_agg(
                jsonb_build_object(
                    'membership_id', membership.id,
                    'club_id', club.id,
                    'club_name', club.name,
                    'membership_number', membership.membership_number,
                    'membership_type', membership.membership_type,
                    'joined_at', membership.joined_at,
                    'renewal_date', membership.renewal_date,
                    'handicap_index', membership.club_handicap_index,
                    'role', membership.role,
                    'is_primary', membership.is_primary,
                    'logo_path', branding.logo_path,
                    'primary_color', coalesce(branding.primary_color, '#064831'),
                    'secondary_color', coalesce(branding.secondary_color, '#022D1D'),
                    'accent_color', coalesce(branding.accent_color, '#E5C45F')
                )
                order by membership.is_primary desc, lower(club.name)
            )
            from public.club_memberships as membership
            join public.clubs as club
              on club.id = membership.club_id
             and club.is_active = true
            left join public.club_branding as branding
              on branding.club_id = club.id
            where membership.status = 'active'
              and coalesce(membership.membership_type, 'member') not in ('visitor','guest','staff')
              and (
                  membership.profile_id = auth.uid()
                  or exists (
                      select 1
                      from public.club_membership_player_links as link
                      where link.membership_id = membership.id
                        and link.profile_id = auth.uid()
                  )
              )
        ), '[]'::jsonb)
    )
    into v_result
    from public.profiles as profile
    left join auth.users as auth_user on auth_user.id = profile.id
    left join public.player_entitlements as entitlement on entitlement.profile_id = profile.id
    where profile.id = auth.uid();

    return coalesce(
        v_result,
        jsonb_build_object(
            'profile', jsonb_build_object('id', auth.uid(), 'display_name', 'Player'),
            'entitlement', jsonb_build_object('plan', 'free', 'scorecard_access', false),
            'member_clubs', '[]'::jsonb
        )
    );
end;
$$;

revoke all on function public.member_get_bootstrap() from public, anon;
grant execute on function public.member_get_bootstrap() to authenticated;

-- ---------------------------------------------------------
-- CLUB DISCOVERY FOR PLAYER
-- ---------------------------------------------------------

create or replace function public.player_list_clubs_v2(
    p_search text default null
)
returns table (
    club_id uuid,
    club_name text,
    club_slug text,
    town_city text,
    county_region text,
    logo_path text,
    is_member boolean,
    membership_id uuid,
    membership_number text,
    membership_type text,
    renewal_date date,
    handicap_index numeric,
    active_course_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_search text := nullif(lower(trim(coalesce(p_search, ''))), '');
begin
    if auth.uid() is null then
        raise exception 'You must be signed in.';
    end if;

    return query
    select
        club.id,
        club.name::text,
        club.slug::text,
        settings.town_city,
        settings.county_region,
        branding.logo_path,
        my_membership.id is not null,
        my_membership.id,
        my_membership.membership_number,
        my_membership.membership_type,
        my_membership.renewal_date,
        my_membership.club_handicap_index::numeric,
        (
            select count(*)
            from public.courses as course
            where course.club_id = club.id
              and course.is_active = true
        )::bigint
    from public.clubs as club
    left join public.club_settings as settings on settings.club_id = club.id
    left join public.club_branding as branding on branding.club_id = club.id
    left join lateral (
        select membership.*
        from public.club_memberships as membership
        where membership.club_id = club.id
          and membership.status = 'active'
          and coalesce(membership.membership_type, 'member') not in ('visitor','guest','staff')
          and (
              membership.profile_id = auth.uid()
              or exists (
                  select 1
                  from public.club_membership_player_links as link
                  where link.membership_id = membership.id
                    and link.profile_id = auth.uid()
              )
          )
        order by membership.is_primary desc, membership.created_at asc
        limit 1
    ) as my_membership on true
    where club.is_active = true
      and (
          v_search is null
          or lower(club.name) like '%' || v_search || '%'
          or lower(coalesce(settings.town_city, '')) like '%' || v_search || '%'
          or lower(coalesce(settings.county_region, '')) like '%' || v_search || '%'
      )
    order by (my_membership.id is not null) desc, lower(club.name);
end;
$$;

revoke all on function public.player_list_clubs_v2(text) from public, anon;
grant execute on function public.player_list_clubs_v2(text) to authenticated;

create or replace function public.player_get_my_clubs()
returns table (
    club_id uuid,
    club_name text,
    membership_id uuid,
    membership_number text,
    membership_type text,
    joined_at date,
    renewal_date date,
    handicap_index numeric,
    logo_path text,
    primary_color text,
    secondary_color text,
    accent_color text,
    town_city text,
    county_region text
)
language sql
stable
security definer
set search_path = ''
as $$
    select
        club.id,
        club.name::text,
        membership.id,
        membership.membership_number,
        membership.membership_type,
        membership.joined_at,
        membership.renewal_date,
        membership.club_handicap_index::numeric,
        branding.logo_path,
        coalesce(branding.primary_color, '#064831')::text,
        coalesce(branding.secondary_color, '#022D1D')::text,
        coalesce(branding.accent_color, '#E5C45F')::text,
        settings.town_city,
        settings.county_region
    from public.club_memberships as membership
    join public.clubs as club
      on club.id = membership.club_id
     and club.is_active = true
    left join public.club_branding as branding on branding.club_id = club.id
    left join public.club_settings as settings on settings.club_id = club.id
    where auth.uid() is not null
      and membership.status = 'active'
      and coalesce(membership.membership_type, 'member') not in ('visitor','guest','staff')
      and (
          membership.profile_id = auth.uid()
          or exists (
              select 1
              from public.club_membership_player_links as link
              where link.membership_id = membership.id
                and link.profile_id = auth.uid()
          )
      )
    order by membership.is_primary desc, lower(club.name);
$$;

revoke all on function public.player_get_my_clubs() from public, anon;
grant execute on function public.player_get_my_clubs() to authenticated;

-- ---------------------------------------------------------
-- PLAYER SELF-SERVICE MEMBERSHIP CLAIM
-- ---------------------------------------------------------
-- Failure responses deliberately do not disclose whether a supplied member
-- number exists. Successful claims retain the temporary profile_id mirror so
-- the mature booking core remains compatible, while the private link remains
-- the authoritative Paryx identity relationship.

create or replace function public.player_claim_club_membership(
    p_club_id uuid,
    p_membership_number text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := auth.uid();
    v_user_email text;
    v_number text := nullif(trim(coalesce(p_membership_number, '')), '');
    v_attempt_id uuid;
    v_attempt_club_id uuid;
    v_recent_attempts integer;
    v_daily_attempts integer;
    v_match_count integer;
    v_membership_id uuid;
    v_membership_profile_id uuid;
    v_membership_type text;
    v_club_email text;
    v_club_name text;
    v_existing_link_profile_id uuid;
    v_user_link_membership_id uuid;
    v_user_link_membership_type text;
    v_existing_user_membership_id uuid;
    v_existing_user_membership_type text;
    v_generic_message text :=
        'We could not automatically verify those membership details. Check your membership number and make sure your Paryx email matches the email held by the club. If it still does not work, contact the club and then try again.';
begin
    if v_user_id is null then
        raise exception 'You must be signed in.';
    end if;

    select club.id
    into v_attempt_club_id
    from public.clubs as club
    where club.id = p_club_id
      and club.is_active = true
    limit 1;

    select count(*)::integer
    into v_recent_attempts
    from public.player_membership_claim_attempts as attempt
    where attempt.user_id = v_user_id
      and attempt.attempted_at > now() - interval '15 minutes';

    select count(*)::integer
    into v_daily_attempts
    from public.player_membership_claim_attempts as attempt
    where attempt.user_id = v_user_id
      and attempt.attempted_at > now() - interval '24 hours';

    if v_recent_attempts >= 8 or v_daily_attempts >= 25 then
        insert into public.player_membership_claim_attempts (
            user_id, club_id, outcome
        ) values (
            v_user_id, v_attempt_club_id, 'rate_limited'
        );

        return jsonb_build_object(
            'status', 'rate_limited',
            'message', 'Too many verification attempts have been made. Please wait and try again later.'
        );
    end if;

    insert into public.player_membership_claim_attempts (
        user_id, club_id, outcome
    ) values (
        v_user_id, v_attempt_club_id, 'attempted'
    ) returning id into v_attempt_id;

    select lower(trim(coalesce(auth_user.email::text, '')))
    into v_user_email
    from auth.users as auth_user
    where auth_user.id = v_user_id;

    if v_attempt_club_id is null
       or v_number is null
       or v_user_email is null
       or v_user_email = '' then
        update public.player_membership_claim_attempts
        set outcome = 'failed'
        where id = v_attempt_id;

        return jsonb_build_object(
            'status', 'verification_required',
            'message', v_generic_message
        );
    end if;

    select count(*)::integer
    into v_match_count
    from public.club_memberships as membership
    where membership.club_id = p_club_id
      and membership.status = 'active'
      and coalesce(membership.membership_type, 'member') not in ('visitor','guest','staff')
      and lower(trim(coalesce(membership.membership_number, ''))) = lower(v_number);

    if v_match_count <> 1 then
        update public.player_membership_claim_attempts
        set outcome = 'failed'
        where id = v_attempt_id;

        return jsonb_build_object(
            'status', 'verification_required',
            'message', v_generic_message
        );
    end if;

    select
        membership.id,
        membership.profile_id,
        membership.membership_type,
        lower(trim(coalesce(membership.club_email, ''))),
        club.name
    into
        v_membership_id,
        v_membership_profile_id,
        v_membership_type,
        v_club_email,
        v_club_name
    from public.club_memberships as membership
    join public.clubs as club on club.id = membership.club_id
    where membership.club_id = p_club_id
      and membership.status = 'active'
      and coalesce(membership.membership_type, 'member') not in ('visitor','guest','staff')
      and lower(trim(coalesce(membership.membership_number, ''))) = lower(v_number)
    limit 1;

    select link.profile_id
    into v_existing_link_profile_id
    from public.club_membership_player_links as link
    where link.membership_id = v_membership_id;

    if v_existing_link_profile_id is not null
       and v_existing_link_profile_id <> v_user_id then
        update public.player_membership_claim_attempts
        set outcome = 'failed'
        where id = v_attempt_id;

        return jsonb_build_object(
            'status', 'verification_required',
            'message', v_generic_message
        );
    end if;

    if v_membership_profile_id is not null
       and v_membership_profile_id <> v_user_id then
        update public.player_membership_claim_attempts
        set outcome = 'failed'
        where id = v_attempt_id;

        return jsonb_build_object(
            'status', 'verification_required',
            'message', v_generic_message
        );
    end if;

    if v_club_email = '' or v_club_email <> v_user_email then
        update public.player_membership_claim_attempts
        set outcome = 'failed'
        where id = v_attempt_id;

        return jsonb_build_object(
            'status', 'verification_required',
            'message', v_generic_message
        );
    end if;

    -- A legacy visitor relationship may itself have been backfilled into the
    -- private link table in Migration 039. Genuine linked memberships cannot be
    -- silently replaced, but a visitor/guest link can be upgraded safely.
    select
        link.membership_id,
        membership.membership_type
    into
        v_user_link_membership_id,
        v_user_link_membership_type
    from public.club_membership_player_links as link
    join public.club_memberships as membership
      on membership.id = link.membership_id
    where link.profile_id = v_user_id
      and link.club_id = p_club_id
      and link.membership_id <> v_membership_id
    limit 1;

    if v_user_link_membership_id is not null
       and coalesce(v_user_link_membership_type, 'member') not in ('visitor','guest') then
        update public.player_membership_claim_attempts
        set outcome = 'failed'
        where id = v_attempt_id;

        return jsonb_build_object(
            'status', 'verification_required',
            'message', v_generic_message
        );
    end if;

    if v_user_link_membership_id is not null then
        delete from public.club_membership_player_links
        where membership_id = v_user_link_membership_id;
    end if;

    select
        membership.id,
        membership.membership_type
    into
        v_existing_user_membership_id,
        v_existing_user_membership_type
    from public.club_memberships as membership
    where membership.profile_id = v_user_id
      and membership.club_id = p_club_id
      and membership.id <> v_membership_id
    order by membership.created_at asc
    limit 1;

    if v_existing_user_membership_id is not null
       and coalesce(v_existing_user_membership_type, 'member') not in ('visitor','guest') then
        update public.player_membership_claim_attempts
        set outcome = 'failed'
        where id = v_attempt_id;

        return jsonb_build_object(
            'status', 'verification_required',
            'message', v_generic_message
        );
    end if;

    if v_existing_user_membership_id is not null then
        -- If both IDs somehow occur on one booking, keep the genuine member row.
        delete from public.booking_members as old_member
        using public.booking_members as real_member
        where old_member.membership_id = v_existing_user_membership_id
          and real_member.booking_id = old_member.booking_id
          and real_member.membership_id = v_membership_id
          and real_member.id <> old_member.id;

        update public.booking_members
        set membership_id = v_membership_id,
            updated_at = now()
        where membership_id = v_existing_user_membership_id;

        update public.booking_members
        set added_by_membership_id = v_membership_id,
            updated_at = now()
        where added_by_membership_id = v_existing_user_membership_id;

        update public.bookings
        set created_by_membership_id = v_membership_id,
            updated_at = now()
        where created_by_membership_id = v_existing_user_membership_id;

        update public.bookings
        set cancelled_by_membership_id = v_membership_id,
            updated_at = now()
        where cancelled_by_membership_id = v_existing_user_membership_id;

        update public.bookings
        set staff_created_by_membership_id = v_membership_id,
            updated_at = now()
        where staff_created_by_membership_id = v_existing_user_membership_id;

        update public.bookings
        set staff_checked_in_by_membership_id = v_membership_id,
            updated_at = now()
        where staff_checked_in_by_membership_id = v_existing_user_membership_id;

        update public.booking_guests
        set added_by_membership_id = v_membership_id,
            updated_at = now()
        where added_by_membership_id = v_existing_user_membership_id;

        update public.club_membership_access_requests
        set resolved_by_membership_id = v_membership_id,
            updated_at = now()
        where resolved_by_membership_id = v_existing_user_membership_id;

        delete from public.club_memberships
        where id = v_existing_user_membership_id;
    end if;

    if exists (
        select 1
        from public.club_membership_player_links as link
        where link.club_id = p_club_id
          and link.profile_id = v_user_id
          and link.membership_id <> v_membership_id
    ) then
        update public.player_membership_claim_attempts
        set outcome = 'failed'
        where id = v_attempt_id;

        return jsonb_build_object(
            'status', 'verification_required',
            'message', v_generic_message
        );
    end if;

    insert into public.club_membership_player_links (
        membership_id,
        club_id,
        profile_id,
        link_method,
        linked_at,
        updated_at
    ) values (
        v_membership_id,
        p_club_id,
        v_user_id,
        'membership_number_email',
        now(),
        now()
    )
    on conflict (membership_id)
    do update set
        profile_id = excluded.profile_id,
        link_method = excluded.link_method,
        updated_at = now();

    -- Temporary compatibility mirror for mature booking functions. ClubHub's
    -- privacy-safe RPCs deliberately never expose this relationship.
    update public.club_memberships as membership
    set
        profile_id = v_user_id,
        is_primary = case
            when exists (
                select 1
                from public.club_memberships as other_membership
                where other_membership.profile_id = v_user_id
                  and other_membership.is_primary = true
                  and other_membership.id <> v_membership_id
            ) then false
            else true
        end,
        updated_at = now()
    where membership.id = v_membership_id;

    -- The old request/approval workflow is no longer part of the normal claim
    -- path. Remove any stale pending request created by an earlier Player build.
    delete from public.club_membership_access_requests as request
    where request.profile_id = v_user_id
      and request.club_id = p_club_id
      and request.status = 'pending';

    update public.player_membership_claim_attempts
    set outcome = case
        when v_existing_link_profile_id = v_user_id then 'already_linked'
        else 'linked'
    end
    where id = v_attempt_id;

    return jsonb_build_object(
        'status', 'linked',
        'club_id', p_club_id,
        'club_name', v_club_name,
        'membership_id', v_membership_id,
        'membership_number', v_number,
        'membership_type', v_membership_type,
        'message', 'Membership linked successfully.'
    );
end;
$$;

revoke all on function public.player_claim_club_membership(uuid,text) from public, anon;
grant execute on function public.player_claim_club_membership(uuid,text) to authenticated;

-- ---------------------------------------------------------
-- PLAYER CLUB INFORMATION / DIGITAL CARD DATA
-- ---------------------------------------------------------

create or replace function public.player_get_club_services(
    p_club_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_membership_id uuid;
    v_result jsonb;
begin
    if auth.uid() is null then
        raise exception 'You must be signed in.';
    end if;

    v_membership_id := public._player_membership_id_for_club(p_club_id, false);

    if v_membership_id is null then
        raise exception 'Active club membership required.';
    end if;

    select jsonb_build_object(
        'club', jsonb_build_object(
            'club_id', club.id,
            'club_name', club.name,
            'club_slug', club.slug,
            'timezone', club.timezone,
            'town_city', settings.town_city,
            'county_region', settings.county_region,
            'postcode', settings.postcode,
            'address_line_1', settings.address_line_1,
            'address_line_2', settings.address_line_2,
            'contact_email', settings.contact_email,
            'phone', settings.phone,
            'website_url', settings.website_url,
            'currency_code', coalesce(settings.currency_code, 'GBP'),
            'logo_path', branding.logo_path,
            'primary_color', coalesce(branding.primary_color, '#064831'),
            'secondary_color', coalesce(branding.secondary_color, '#022D1D'),
            'accent_color', coalesce(branding.accent_color, '#E5C45F')
        ),
        'membership', jsonb_build_object(
            'membership_id', membership.id,
            'member_name', coalesce(
                nullif(trim(membership.club_display_name), ''),
                nullif(trim(concat_ws(' ', membership.club_first_name, membership.club_last_name)), '')
            ),
            'membership_number', membership.membership_number,
            'membership_type', membership.membership_type,
            'joined_at', membership.joined_at,
            'renewal_date', membership.renewal_date,
            'handicap_index', membership.club_handicap_index,
            'card_reference', upper(substr(replace(membership.id::text, '-', ''), 1, 12))
        ),
        'courses', coalesce((
            select jsonb_agg(
                jsonb_build_object(
                    'course_id', course.id,
                    'course_name', course.name,
                    'holes', course.holes
                )
                order by lower(course.name)
            )
            from public.courses as course
            where course.club_id = club.id
              and course.is_active = true
        ), '[]'::jsonb),
        'upcoming_events', coalesce((
            select jsonb_agg(event_row.payload order by event_row.event_date, event_row.start_time nulls last)
            from (
                select
                    event.event_date,
                    event.start_time,
                    jsonb_build_object(
                        'event_id', event.id,
                        'event_date', event.event_date,
                        'start_time', event.start_time,
                        'time_text', event.time_text,
                        'title', event.title,
                        'event_type', event.event_type,
                        'section', event.section,
                        'venue', event.venue,
                        'course_name', course.name
                    ) as payload
                from public.club_events as event
                left join public.courses as course on course.id = event.course_id
                where event.club_id = club.id
                  and event.is_published = true
                  and event.status <> 'cancelled'
                  and event.event_date >= current_date
                order by event.event_date, event.start_time nulls last, event.display_order
                limit 5
            ) as event_row
        ), '[]'::jsonb)
    )
    into v_result
    from public.club_memberships as membership
    join public.clubs as club on club.id = membership.club_id
    left join public.club_settings as settings on settings.club_id = club.id
    left join public.club_branding as branding on branding.club_id = club.id
    where membership.id = v_membership_id;

    return v_result;
end;
$$;

revoke all on function public.player_get_club_services(uuid) from public, anon;
grant execute on function public.player_get_club_services(uuid) to authenticated;

-- ---------------------------------------------------------
-- CLUB CREDIT — PRIVATE LINK AWARE
-- ---------------------------------------------------------

create or replace function public.member_get_club_credit_accounts()
returns table (
    club_id uuid,
    club_name text,
    membership_id uuid,
    balance numeric,
    currency_code text,
    transaction_count bigint,
    last_activity_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null then
        raise exception 'Authentication required.';
    end if;

    return query
    select
        club.id,
        club.name::text,
        membership.id,
        coalesce(account.balance, 0)::numeric,
        coalesce(account.currency_code, settings.currency_code, 'GBP')::text,
        (
            select count(*)
            from public.club_member_account_transactions as transaction
            where transaction.club_id = club.id
              and transaction.membership_id = membership.id
        )::bigint,
        (
            select max(transaction.created_at)
            from public.club_member_account_transactions as transaction
            where transaction.club_id = club.id
              and transaction.membership_id = membership.id
        )
    from public.club_memberships as membership
    join public.clubs as club on club.id = membership.club_id
    left join public.club_settings as settings on settings.club_id = club.id
    left join public.club_member_accounts as account
      on account.club_id = club.id
     and account.membership_id = membership.id
     and account.is_active
    where membership.status = 'active'
      and coalesce(membership.membership_type, 'member') not in ('visitor','guest','staff')
      and (
          membership.profile_id = auth.uid()
          or exists (
              select 1
              from public.club_membership_player_links as link
              where link.membership_id = membership.id
                and link.profile_id = auth.uid()
          )
      )
      and public.club_module_enabled(club.id, 'member_credit')
    order by lower(club.name);
end;
$$;

revoke all on function public.member_get_club_credit_accounts() from public, anon;
grant execute on function public.member_get_club_credit_accounts() to authenticated;

create or replace function public.member_get_club_credit_transactions(
    p_club_id uuid,
    p_limit integer default 50
)
returns table (
    transaction_id uuid,
    transaction_type text,
    amount numeric,
    balance_after numeric,
    currency_code text,
    reference text,
    description text,
    created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_membership_id uuid;
begin
    if auth.uid() is null then
        raise exception 'Authentication required.';
    end if;

    if not public.club_module_enabled(p_club_id, 'member_credit') then
        raise exception 'Club Credit is not enabled for this club.';
    end if;

    v_membership_id := public._player_membership_id_for_club(p_club_id, false);

    if v_membership_id is null then
        raise exception 'Active club membership required.';
    end if;

    return query
    select
        transaction.id,
        transaction.transaction_type,
        transaction.amount,
        transaction.balance_after,
        transaction.currency_code,
        transaction.reference,
        transaction.description,
        transaction.created_at
    from public.club_member_account_transactions as transaction
    where transaction.club_id = p_club_id
      and transaction.membership_id = v_membership_id
    order by transaction.created_at desc
    limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

revoke all on function public.member_get_club_credit_transactions(uuid,integer)
from public, anon;
grant execute on function public.member_get_club_credit_transactions(uuid,integer)
to authenticated;

-- ---------------------------------------------------------
-- PLAYER CONFIRMED COMPETITION RESULTS
-- ---------------------------------------------------------
-- Results are member-only in v0.26. Public/member/disabled club controls can
-- be added later without changing the Player UI contract.

create or replace function public.player_list_competition_results(
    p_club_id uuid default null,
    p_limit integer default 30,
    p_offset integer default 0
)
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

    if p_club_id is not null
       and public._player_membership_id_for_club(p_club_id, false) is null then
        raise exception 'Active club membership required.';
    end if;

    with my_memberships as (
        select membership.id as membership_id, membership.club_id
        from public.club_memberships as membership
        where membership.status = 'active'
          and coalesce(membership.membership_type, 'member') not in ('visitor','guest','staff')
          and (
              membership.profile_id = auth.uid()
              or exists (
                  select 1
                  from public.club_membership_player_links as link
                  where link.membership_id = membership.id
                    and link.profile_id = auth.uid()
              )
          )
    ), result_rows as (
        select
            competition.id as competition_id,
            competition.club_id,
            club.name as club_name,
            coalesce(event.title, competition.name) as competition_name,
            coalesce(event.event_date, competition.competition_date) as competition_date,
            competition.competition_format,
            coalesce(event.section, competition.section) as section,
            coalesce(event.is_qualifier, competition.is_qualifier) as is_qualifier,
            competition.result_provider,
            competition.results_verified_source,
            settings.currency_code,
            my_membership.membership_id,
            case
                when exists (
                    select 1
                    from public.club_competition_external_results as external_result
                    where external_result.competition_id = competition.id
                ) then (
                    select count(*)
                    from public.club_competition_external_results as external_result
                    where external_result.competition_id = competition.id
                )
                else (
                    select count(*)
                    from public.club_competition_entries as entry
                    where entry.competition_id = competition.id
                )
            end::bigint as result_count
        from public.club_competitions as competition
        join my_memberships as my_membership on my_membership.club_id = competition.club_id
        join public.clubs as club on club.id = competition.club_id
        left join public.club_events as event on event.id = competition.club_event_id
        left join public.club_settings as settings on settings.club_id = competition.club_id
        where competition.results_confirmed_at is not null
          and (p_club_id is null or competition.club_id = p_club_id)
        order by coalesce(event.event_date, competition.competition_date) desc, competition.created_at desc
        limit greatest(1, least(coalesce(p_limit, 30), 100))
        offset greatest(0, coalesce(p_offset, 0))
    )
    select coalesce(
        jsonb_agg(
            jsonb_build_object(
                'competition_id', row.competition_id,
                'club_id', row.club_id,
                'club_name', row.club_name,
                'competition_name', row.competition_name,
                'competition_date', row.competition_date,
                'competition_format', row.competition_format,
                'section', row.section,
                'is_qualifier', row.is_qualifier,
                'result_source', coalesce(row.results_verified_source, row.result_provider, 'manual'),
                'result_count', row.result_count,
                'currency_code', coalesce(row.currency_code, 'GBP'),
                'player_result', coalesce(
                    (
                        select jsonb_build_object(
                            'placing', external_result.finishing_position,
                            'gross_score', external_result.gross_score,
                            'nett_score', external_result.nett_score,
                            'points', external_result.points,
                            'result_text', external_result.result_text
                        )
                        from public.club_competition_external_results as external_result
                        where external_result.competition_id = row.competition_id
                          and external_result.membership_id = row.membership_id
                        order by external_result.finishing_position nulls last, external_result.imported_at desc
                        limit 1
                    ),
                    (
                        select jsonb_build_object(
                            'placing', entry.finishing_position,
                            'gross_score', entry.gross_score,
                            'nett_score', entry.nett_score,
                            'points', entry.points,
                            'result_text', entry.result_text
                        )
                        from public.club_competition_entries as entry
                        where entry.competition_id = row.competition_id
                          and entry.membership_id = row.membership_id
                        order by entry.finishing_position nulls last, entry.created_at asc
                        limit 1
                    )
                ),
                'player_award_total', coalesce((
                    select sum(prize.amount)
                    from public.club_competition_prizes as prize
                    where prize.competition_id = row.competition_id
                      and prize.recipient_membership_id = row.membership_id
                ), 0),
                'player_awards', coalesce((
                    select jsonb_agg(
                        jsonb_build_object(
                            'label', prize.label,
                            'award_type', prize.award_type,
                            'amount', prize.amount,
                            'currency_code', prize.currency_code
                        ) order by prize.finishing_position nulls last, prize.created_at
                    )
                    from public.club_competition_prizes as prize
                    where prize.competition_id = row.competition_id
                      and prize.recipient_membership_id = row.membership_id
                ), '[]'::jsonb)
            )
            order by row.competition_date desc, lower(row.competition_name)
        ),
        '[]'::jsonb
    )
    into v_result
    from result_rows as row;

    return v_result;
end;
$$;

revoke all on function public.player_list_competition_results(uuid,integer,integer)
from public, anon;
grant execute on function public.player_list_competition_results(uuid,integer,integer)
to authenticated;

create or replace function public.player_get_competition_result(
    p_competition_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_club_id uuid;
    v_membership_id uuid;
    v_has_external boolean;
    v_result jsonb;
begin
    if auth.uid() is null then
        raise exception 'You must be signed in.';
    end if;

    select competition.club_id
    into v_club_id
    from public.club_competitions as competition
    where competition.id = p_competition_id
      and competition.results_confirmed_at is not null;

    if v_club_id is null then
        raise exception 'Confirmed competition result not found.';
    end if;

    v_membership_id := public._player_membership_id_for_club(v_club_id, false);

    if v_membership_id is null then
        raise exception 'Active club membership required.';
    end if;

    select exists (
        select 1
        from public.club_competition_external_results as external_result
        where external_result.competition_id = p_competition_id
    ) into v_has_external;

    select jsonb_build_object(
        'competition', jsonb_build_object(
            'competition_id', competition.id,
            'club_id', club.id,
            'club_name', club.name,
            'name', coalesce(event.title, competition.name),
            'competition_date', coalesce(event.event_date, competition.competition_date),
            'competition_format', competition.competition_format,
            'section', coalesce(event.section, competition.section),
            'is_qualifier', coalesce(event.is_qualifier, competition.is_qualifier),
            'result_source', coalesce(competition.results_verified_source, competition.result_provider, 'manual'),
            'currency_code', coalesce(settings.currency_code, 'GBP')
        ),
        'leaderboard', case
            when v_has_external then coalesce((
                select jsonb_agg(
                    jsonb_build_object(
                        'player_name', external_result.external_player_name,
                        'placing', external_result.finishing_position,
                        'gross_score', external_result.gross_score,
                        'nett_score', external_result.nett_score,
                        'points', external_result.points,
                        'result_text', external_result.result_text,
                        'is_me', external_result.membership_id = v_membership_id
                    )
                    order by external_result.finishing_position nulls last,
                             lower(external_result.external_player_name)
                )
                from public.club_competition_external_results as external_result
                where external_result.competition_id = competition.id
            ), '[]'::jsonb)
            else coalesce((
                select jsonb_agg(
                    jsonb_build_object(
                        'player_name', entry.entrant_name,
                        'placing', entry.finishing_position,
                        'gross_score', entry.gross_score,
                        'nett_score', entry.nett_score,
                        'points', entry.points,
                        'result_text', entry.result_text,
                        'is_me', entry.membership_id = v_membership_id
                    )
                    order by entry.finishing_position nulls last,
                             lower(entry.entrant_name)
                )
                from public.club_competition_entries as entry
                where entry.competition_id = competition.id
            ), '[]'::jsonb)
        end,
        'awards', coalesce((
            select jsonb_agg(
                jsonb_build_object(
                    'label', prize.label,
                    'award_type', prize.award_type,
                    'placing', prize.finishing_position,
                    'amount', prize.amount,
                    'currency_code', prize.currency_code,
                    'recipient_name', coalesce(
                        external_result.external_player_name,
                        (
                            select entry.entrant_name
                            from public.club_competition_entries as entry
                            where entry.competition_id = prize.competition_id
                              and entry.membership_id = prize.recipient_membership_id
                            order by entry.created_at asc
                            limit 1
                        ),
                        nullif(trim(membership.club_display_name), ''),
                        nullif(trim(concat_ws(' ', membership.club_first_name, membership.club_last_name)), ''),
                        'Member'
                    ),
                    'is_me', prize.recipient_membership_id = v_membership_id
                )
                order by prize.finishing_position nulls last, prize.created_at
            )
            from public.club_competition_prizes as prize
            left join public.club_competition_external_results as external_result
              on external_result.id = prize.external_result_id
            left join public.club_memberships as membership
              on membership.id = prize.recipient_membership_id
            where prize.competition_id = competition.id
        ), '[]'::jsonb)
    )
    into v_result
    from public.club_competitions as competition
    join public.clubs as club on club.id = competition.club_id
    left join public.club_events as event on event.id = competition.club_event_id
    left join public.club_settings as settings on settings.club_id = competition.club_id
    where competition.id = p_competition_id;

    return v_result;
end;
$$;

revoke all on function public.player_get_competition_result(uuid) from public, anon;
grant execute on function public.player_get_competition_result(uuid) to authenticated;

commit;

notify pgrst, 'reload schema';
