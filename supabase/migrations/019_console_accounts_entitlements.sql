-- =========================================================
-- PARYX MIGRATION 019
-- CONSOLE BASELINE — GLOBAL ACCOUNTS + ENTITLEMENTS
--
-- Adds:
--   - richer Console overview
--   - global Paryx account directory
--   - account -> club relationship lookup
--   - secure manual Player entitlement support controls
--
-- Important:
--   - Paryx identity remains global.
--   - Club membership and Player scoring entitlement remain separate.
--   - Platform Support is read-only for entitlements.
--   - Platform Admin / Owner may change entitlements.
-- =========================================================

begin;


-- =========================================================
-- RICHER CONSOLE OVERVIEW
-- =========================================================

drop function if exists public.get_platform_console_overview();

create function public.get_platform_console_overview()
returns table (
    total_clubs bigint,
    active_clubs bigint,
    inactive_clubs bigint,
    total_player_accounts bigint,
    active_member_links bigint,
    today_bookings bigint,
    active_tier2 bigint,
    active_scorecard_passes bigint,
    platform_users bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null
       or not public.is_platform_user(null) then
        raise exception
            'Paryx Console access required.';
    end if;

    return query
    select
        (
            select count(*)
            from public.clubs
        )::bigint,

        (
            select count(*)
            from public.clubs
            where is_active = true
        )::bigint,

        (
            select count(*)
            from public.clubs
            where is_active = false
        )::bigint,

        (
            select count(*)
            from public.profiles
        )::bigint,

        (
            select count(*)
            from public.club_memberships as cm
            where cm.status = 'active'
              and cm.membership_type not in (
                  'visitor',
                  'guest',
                  'staff'
              )
        )::bigint,

        (
            select count(*)
            from public.bookings as b
            join public.tee_times as tt
                on tt.id = b.tee_time_id
            where tt.play_date = current_date
              and b.booking_status = 'active'
        )::bigint,

        (
            select count(*)
            from public.player_entitlements as pe
            where pe.plan = 'tier2'
              and (
                  pe.tier2_until is null
                  or pe.tier2_until > now()
              )
        )::bigint,

        (
            select count(*)
            from public.player_entitlements as pe
            where pe.scorecard_pass_until is not null
              and pe.scorecard_pass_until > now()
        )::bigint,

        (
            select count(*)
            from public.platform_users
            where is_active = true
        )::bigint;
end;
$$;

revoke all
on function public.get_platform_console_overview()
from public, anon;

grant execute
on function public.get_platform_console_overview()
to authenticated;


-- =========================================================
-- GLOBAL PARYX ACCOUNT DIRECTORY
-- =========================================================

create or replace function public.platform_list_accounts(
    p_search text default null,
    p_limit integer default 50,
    p_offset integer default 0
)
returns table (
    user_id uuid,
    email text,
    display_name text,
    auth_created_at timestamptz,
    last_sign_in_at timestamptz,
    plan text,
    tier2_until timestamptz,
    scorecard_pass_until timestamptz,
    member_club_count bigint,
    visitor_club_count bigint,
    staff_club_count bigint,
    console_role text,
    console_active boolean,
    total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_search text;
    v_limit integer;
    v_offset integer;
begin
    if auth.uid() is null
       or not public.is_platform_user(null) then
        raise exception
            'Paryx Console access required.';
    end if;

    v_search :=
        nullif(
            lower(
                trim(
                    coalesce(
                        p_search,
                        ''
                    )
                )
            ),
            ''
        );

    v_limit :=
        greatest(
            1,
            least(
                coalesce(
                    p_limit,
                    50
                ),
                100
            )
        );

    v_offset :=
        greatest(
            0,
            coalesce(
                p_offset,
                0
            )
        );

    return query
    with account_rows as (
        select
            au.id as user_id,
            au.email::text as email,
            coalesce(
                nullif(
                    trim(
                        p.display_name
                    ),
                    ''
                ),
                nullif(
                    trim(
                        concat_ws(
                            ' ',
                            p.first_name,
                            p.last_name
                        )
                    ),
                    ''
                ),
                au.email::text,
                'Paryx player'
            )::text as display_name,
            au.created_at as auth_created_at,
            au.last_sign_in_at,
            coalesce(
                pe.plan,
                'free'
            )::text as plan,
            pe.tier2_until,
            pe.scorecard_pass_until,
            (
                select count(*)
                from public.club_memberships as cm
                where cm.profile_id = au.id
                  and cm.status = 'active'
                  and cm.membership_type not in (
                      'visitor',
                      'guest',
                      'staff'
                  )
            )::bigint as member_club_count,
            (
                select count(*)
                from public.club_memberships as cm
                where cm.profile_id = au.id
                  and cm.status = 'active'
                  and cm.membership_type in (
                      'visitor',
                      'guest'
                  )
            )::bigint as visitor_club_count,
            (
                select count(*)
                from public.club_memberships as cm
                where cm.profile_id = au.id
                  and cm.status = 'active'
                  and cm.role in (
                      'starter',
                      'reception',
                      'professional',
                      'greenkeeper',
                      'manager',
                      'club_admin'
                  )
            )::bigint as staff_club_count,
            pu.role as console_role,
            pu.is_active as console_active
        from auth.users as au
        left join public.profiles as p
            on p.id = au.id
        left join public.player_entitlements as pe
            on pe.profile_id = au.id
        left join public.platform_users as pu
            on pu.user_id = au.id
        where (
            v_search is null
            or lower(
                coalesce(
                    au.email::text,
                    ''
                )
            ) like
                '%' || v_search || '%'
            or lower(
                coalesce(
                    p.display_name,
                    ''
                )
            ) like
                '%' || v_search || '%'
            or lower(
                coalesce(
                    p.first_name,
                    ''
                )
            ) like
                '%' || v_search || '%'
            or lower(
                coalesce(
                    p.last_name,
                    ''
                )
            ) like
                '%' || v_search || '%'
            or exists (
                select 1
                from public.club_memberships as cm
                where cm.profile_id = au.id
                  and lower(
                      coalesce(
                          cm.membership_number,
                          ''
                      )
                  ) like
                      '%' || v_search || '%'
            )
        )
    ),
    counted as (
        select count(*)::bigint
            as total_count
        from account_rows
    )
    select
        ar.user_id,
        ar.email,
        ar.display_name,
        ar.auth_created_at,
        ar.last_sign_in_at,
        ar.plan,
        ar.tier2_until,
        ar.scorecard_pass_until,
        ar.member_club_count,
        ar.visitor_club_count,
        ar.staff_club_count,
        ar.console_role,
        ar.console_active,
        c.total_count
    from account_rows as ar
    cross join counted as c
    order by
        ar.last_sign_in_at desc nulls last,
        lower(
            coalesce(
                ar.display_name,
                ar.email,
                ''
            )
        ),
        ar.user_id
    limit v_limit
    offset v_offset;
end;
$$;

revoke all
on function public.platform_list_accounts(
    text,
    integer,
    integer
)
from public, anon;

grant execute
on function public.platform_list_accounts(
    text,
    integer,
    integer
)
to authenticated;


-- =========================================================
-- ACCOUNT CLUB RELATIONSHIPS
-- =========================================================

create or replace function public.platform_get_account_clubs(
    p_user_id uuid
)
returns table (
    membership_id uuid,
    club_id uuid,
    club_name text,
    membership_number text,
    membership_type text,
    membership_status text,
    membership_role text,
    is_primary boolean,
    renewal_date date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null
       or p_user_id is null
       or not public.is_platform_user(null) then
        raise exception
            'Paryx Console access required.';
    end if;

    return query
    select
        cm.id,
        cm.club_id,
        c.name::text,
        cm.membership_number,
        cm.membership_type,
        cm.status,
        cm.role,
        cm.is_primary,
        cm.renewal_date
    from public.club_memberships as cm
    join public.clubs as c
        on c.id = cm.club_id
    where cm.profile_id =
        p_user_id
    order by
        cm.is_primary desc,
        case
            when cm.membership_type not in (
                'visitor',
                'guest',
                'staff'
            )
            then 0
            else 1
        end,
        lower(
            c.name
        );
end;
$$;

revoke all
on function public.platform_get_account_clubs(
    uuid
)
from public, anon;

grant execute
on function public.platform_get_account_clubs(
    uuid
)
to authenticated;


-- =========================================================
-- MANUAL PLAYER ENTITLEMENT SUPPORT
-- =========================================================

create or replace function public.platform_set_player_entitlement(
    p_user_id uuid,
    p_plan text,
    p_tier2_until timestamptz,
    p_scorecard_pass_until timestamptz
)
returns table (
    profile_id uuid,
    plan text,
    tier2_until timestamptz,
    scorecard_pass_until timestamptz,
    updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor_role text;
    v_plan text;
    v_email text;
    v_old_plan text;
    v_old_tier2_until timestamptz;
    v_old_pass_until timestamptz;
begin
    if auth.uid() is null
       or p_user_id is null
       or not public.is_platform_user(
            array[
                'platform_owner',
                'platform_admin'
            ]
       ) then
        raise exception
            'Platform Admin or Owner access required.';
    end if;

    if not exists (
        select 1
        from public.profiles as p
        where p.id = p_user_id
    ) then
        raise exception
            'This Auth account does not yet have a Paryx player profile.';
    end if;

    v_plan :=
        lower(
            trim(
                coalesce(
                    p_plan,
                    ''
                )
            )
        );

    if v_plan not in (
        'free',
        'tier2'
    ) then
        raise exception
            'Invalid Paryx entitlement plan.';
    end if;

    select
        pu.role
    into
        v_actor_role
    from public.platform_users as pu
    where pu.user_id = auth.uid()
      and pu.is_active = true
    limit 1;

    select
        au.email::text
    into
        v_email
    from auth.users as au
    where au.id = p_user_id;

    select
        pe.plan,
        pe.tier2_until,
        pe.scorecard_pass_until
    into
        v_old_plan,
        v_old_tier2_until,
        v_old_pass_until
    from public.player_entitlements as pe
    where pe.profile_id =
        p_user_id;

    insert into public.player_entitlements (
        profile_id,
        plan,
        tier2_until,
        scorecard_pass_until,
        updated_at
    )
    values (
        p_user_id,
        v_plan,
        case
            when v_plan = 'tier2'
            then p_tier2_until
            else null
        end,
        p_scorecard_pass_until,
        now()
    )
    on conflict (
        profile_id
    )
    do update
    set
        plan =
            excluded.plan,
        tier2_until =
            excluded.tier2_until,
        scorecard_pass_until =
            excluded.scorecard_pass_until,
        updated_at =
            now();

    insert into public.platform_audit_log (
        actor_user_id,
        actor_role,
        action,
        target_user_id,
        details
    )
    values (
        auth.uid(),
        v_actor_role,
        'player_entitlement_updated',
        p_user_id,
        jsonb_build_object(
            'email',
                v_email,
            'previous',
                jsonb_build_object(
                    'plan',
                        coalesce(
                            v_old_plan,
                            'free'
                        ),
                    'tier2_until',
                        v_old_tier2_until,
                    'scorecard_pass_until',
                        v_old_pass_until
                ),
            'new',
                jsonb_build_object(
                    'plan',
                        v_plan,
                    'tier2_until',
                        case
                            when v_plan = 'tier2'
                            then p_tier2_until
                            else null
                        end,
                    'scorecard_pass_until',
                        p_scorecard_pass_until
                )
        )
    );

    return query
    select
        pe.profile_id,
        pe.plan,
        pe.tier2_until,
        pe.scorecard_pass_until,
        pe.updated_at
    from public.player_entitlements as pe
    where pe.profile_id =
        p_user_id;
end;
$$;

revoke all
on function public.platform_set_player_entitlement(
    uuid,
    text,
    timestamptz,
    timestamptz
)
from public, anon;

grant execute
on function public.platform_set_player_entitlement(
    uuid,
    text,
    timestamptz,
    timestamptz
)
to authenticated;


commit;

notify pgrst, 'reload schema';
