-- =========================================================
-- PARYX MIGRATION 040
-- CONSOLE ACCOUNT DELETION + 12-MONTH INACTIVITY RETENTION
-- =========================================================
--
-- Purpose
-- 1. Add a Platform Owner-only destructive account deletion RPC.
-- 2. Preserve club-owned membership records while deleting the global
--    Paryx/Auth identity and all profile-owned data.
-- 3. Record manual and automatic deletion activity in the platform audit log.
-- 4. Track authenticated Paryx activity so inactivity retention is based on
--    real application use rather than sign-in time alone.
-- 5. Provide an automatic 12-month inactivity purge function for pg_cron.
--
-- IMPORTANT
-- - Active Console users cannot be deleted.
-- - Active ClubHub staff accounts cannot be deleted.
-- - A Platform Owner cannot delete their own account.
-- - Automatic deletion skips any currently-active paid/scoring entitlement.
-- - Club-owned club_memberships rows are retained and detached from the
--   deleted Paryx identity, preserving club records, bookings and Club Credit.
-- =========================================================

begin;


-- =========================================================
-- RETENTION POLICY
-- =========================================================

create table if not exists public.platform_account_retention_policy (
    singleton boolean primary key default true,
    auto_delete_enabled boolean not null default true,
    inactive_months integer not null default 12,
    batch_limit integer not null default 50,
    updated_at timestamptz not null default now(),

    constraint platform_account_retention_singleton
        check (singleton = true),

    constraint platform_account_retention_months_valid
        check (inactive_months between 1 and 120),

    constraint platform_account_retention_batch_valid
        check (batch_limit between 1 and 500)
);

insert into public.platform_account_retention_policy (
    singleton,
    auto_delete_enabled,
    inactive_months,
    batch_limit
)
values (
    true,
    true,
    12,
    50
)
on conflict (singleton) do nothing;

alter table public.platform_account_retention_policy
    enable row level security;

revoke all
on table public.platform_account_retention_policy
from anon, authenticated;


-- =========================================================
-- ACCOUNT ACTIVITY
-- =========================================================

create table if not exists public.paryx_account_activity (
    user_id uuid primary key
        references auth.users(id)
        on delete cascade,

    last_activity_at timestamptz not null default now(),
    last_source text,
    updated_at timestamptz not null default now(),

    constraint paryx_account_activity_source_not_blank
        check (
            last_source is null
            or length(trim(last_source)) > 0
        ),

    constraint paryx_account_activity_source_length
        check (
            last_source is null
            or length(last_source) <= 40
        )
);

create index if not exists paryx_account_activity_last_activity_idx
on public.paryx_account_activity (last_activity_at);

alter table public.paryx_account_activity
    enable row level security;

revoke all
on table public.paryx_account_activity
from anon, authenticated;


-- =========================================================
-- INTERNAL LAST-ACTIVITY CALCULATION
-- =========================================================

create or replace function public._platform_account_last_activity(
    p_user_id uuid
)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
    select greatest(
        au.created_at,
        coalesce(au.updated_at, au.created_at),
        coalesce(au.last_sign_in_at, au.created_at),
        coalesce(profile.updated_at, au.created_at),
        coalesce(activity.last_activity_at, au.created_at),
        coalesce(
            (
                select max(booking.created_at)
                from public.bookings as booking
                join public.club_memberships as membership
                    on membership.id = booking.created_by_membership_id
                where membership.profile_id = au.id
            ),
            au.created_at
        ),
        coalesce(
            (
                select max(request.created_at)
                from public.club_membership_access_requests as request
                where request.profile_id = au.id
            ),
            au.created_at
        )
    )
    from auth.users as au
    left join public.profiles as profile
        on profile.id = au.id
    left join public.paryx_account_activity as activity
        on activity.user_id = au.id
    where au.id = p_user_id;
$$;

revoke all
on function public._platform_account_last_activity(uuid)
from public, anon, authenticated;


-- Backfill an activity baseline for every existing Auth account. This prevents
-- the retention job from relying only on a nullable last_sign_in_at value.
insert into public.paryx_account_activity (
    user_id,
    last_activity_at,
    last_source,
    updated_at
)
select
    au.id,
    public._platform_account_last_activity(au.id),
    'migration_backfill',
    now()
from auth.users as au
on conflict (user_id)
do nothing;


-- =========================================================
-- AUTHENTICATED ACTIVITY TOUCH
-- =========================================================

create or replace function public.touch_my_paryx_activity(
    p_source text default null
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid;
    v_source text;
    v_activity timestamptz;
begin
    v_user_id := auth.uid();

    if v_user_id is null then
        raise exception 'Authentication required.';
    end if;

    v_source := nullif(
        left(trim(coalesce(p_source, 'authenticated')), 40),
        ''
    );

    insert into public.paryx_account_activity (
        user_id,
        last_activity_at,
        last_source,
        updated_at
    )
    values (
        v_user_id,
        now(),
        coalesce(v_source, 'authenticated'),
        now()
    )
    on conflict (user_id)
    do update
    set
        last_activity_at = now(),
        last_source = excluded.last_source,
        updated_at = now()
    returning last_activity_at
    into v_activity;

    return v_activity;
end;
$$;

revoke all
on function public.touch_my_paryx_activity(text)
from public, anon;

grant execute
on function public.touch_my_paryx_activity(text)
to authenticated;


-- =========================================================
-- CONSOLE ACCOUNT DIRECTORY
-- Preserve the existing function return shape, but the last_sign_in_at field
-- now represents the best available last authenticated/app activity timestamp.
-- The frontend labels it "Last activity" in this release.
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
                        profile.display_name
                    ),
                    ''
                ),
                nullif(
                    trim(
                        concat_ws(
                            ' ',
                            profile.first_name,
                            profile.last_name
                        )
                    ),
                    ''
                ),
                au.email::text,
                'Paryx player'
            )::text as display_name,
            au.created_at as auth_created_at,
            public._platform_account_last_activity(au.id)
                as last_activity_at,
            coalesce(
                entitlement.plan,
                'free'
            )::text as plan,
            entitlement.tier2_until,
            entitlement.scorecard_pass_until,
            (
                select count(*)
                from public.club_memberships as membership
                where membership.profile_id = au.id
                  and membership.status = 'active'
                  and membership.membership_type not in (
                      'visitor',
                      'guest',
                      'staff'
                  )
            )::bigint as member_club_count,
            (
                select count(*)
                from public.club_memberships as membership
                where membership.profile_id = au.id
                  and membership.status = 'active'
                  and membership.membership_type in (
                      'visitor',
                      'guest'
                  )
            )::bigint as visitor_club_count,
            (
                select count(*)
                from public.club_memberships as membership
                where membership.profile_id = au.id
                  and membership.status = 'active'
                  and (
                      membership.membership_type = 'staff'
                      or membership.role in (
                          'starter',
                          'reception',
                          'professional',
                          'greenkeeper',
                          'manager',
                          'club_admin'
                      )
                  )
            )::bigint as staff_club_count,
            platform_user.role as console_role,
            platform_user.is_active as console_active
        from auth.users as au
        left join public.profiles as profile
            on profile.id = au.id
        left join public.player_entitlements as entitlement
            on entitlement.profile_id = au.id
        left join public.platform_users as platform_user
            on platform_user.user_id = au.id
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
                    profile.display_name,
                    ''
                )
            ) like
                '%' || v_search || '%'
            or lower(
                coalesce(
                    profile.first_name,
                    ''
                )
            ) like
                '%' || v_search || '%'
            or lower(
                coalesce(
                    profile.last_name,
                    ''
                )
            ) like
                '%' || v_search || '%'
            or exists (
                select 1
                from public.club_memberships as membership
                where membership.profile_id = au.id
                  and lower(
                      coalesce(
                          membership.membership_number,
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
        account.user_id,
        account.email,
        account.display_name,
        account.auth_created_at,
        account.last_activity_at,
        account.plan,
        account.tier2_until,
        account.scorecard_pass_until,
        account.member_club_count,
        account.visitor_club_count,
        account.staff_club_count,
        account.console_role,
        account.console_active,
        counted.total_count
    from account_rows as account
    cross join counted
    order by
        account.last_activity_at desc nulls last,
        lower(
            coalesce(
                account.display_name,
                account.email,
                ''
            )
        ),
        account.user_id
    limit v_limit
    offset v_offset;
end;
$$;

revoke all
on function public.platform_list_accounts(text, integer, integer)
from public, anon;

grant execute
on function public.platform_list_accounts(text, integer, integer)
to authenticated;


-- =========================================================
-- RETENTION POLICY READ
-- =========================================================

create or replace function public.platform_get_account_retention_policy()
returns table (
    auto_delete_enabled boolean,
    inactive_months integer,
    batch_limit integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null
       or not public.is_platform_user(null) then
        raise exception 'Paryx Console access required.';
    end if;

    return query
    select
        policy.auto_delete_enabled,
        policy.inactive_months,
        policy.batch_limit
    from public.platform_account_retention_policy as policy
    where policy.singleton = true;
end;
$$;

revoke all
on function public.platform_get_account_retention_policy()
from public, anon;

grant execute
on function public.platform_get_account_retention_policy()
to authenticated;


-- =========================================================
-- INTERNAL ACCOUNT DELETE
-- =========================================================

create or replace function public._platform_delete_account_record(
    p_user_id uuid,
    p_mode text,
    p_reason text,
    p_actor_user_id uuid default null,
    p_actor_role text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_email text;
    v_display_name text;
    v_mode text;
    v_reason text;
    v_actor_email text;
    v_membership_count integer;
    v_last_activity timestamptz;
    v_deleted integer;
begin
    if p_user_id is null then
        raise exception 'Account ID is required.';
    end if;

    v_mode := lower(trim(coalesce(p_mode, '')));
    v_reason := nullif(trim(coalesce(p_reason, '')), '');

    if v_mode not in ('manual', 'automatic') then
        raise exception 'Unsupported account deletion mode.';
    end if;

    if v_reason is null then
        raise exception 'A deletion reason is required.';
    end if;

    if p_actor_user_id is not null
       and p_actor_user_id = p_user_id then
        raise exception 'You cannot delete your own Paryx account from Console.';
    end if;

    if p_actor_user_id is not null then
        select auth_user.email::text
        into v_actor_email
        from auth.users as auth_user
        where auth_user.id = p_actor_user_id
        limit 1;
    end if;

    select
        auth_user.email::text,
        coalesce(
            nullif(trim(profile.display_name), ''),
            nullif(
                trim(
                    concat_ws(
                        ' ',
                        profile.first_name,
                        profile.last_name
                    )
                ),
                ''
            ),
            auth_user.email::text,
            auth_user.id::text
        )
    into
        v_email,
        v_display_name
    from auth.users as auth_user
    left join public.profiles as profile
        on profile.id = auth_user.id
    where auth_user.id = p_user_id
    limit 1;

    if not found then
        raise exception 'Paryx account not found.';
    end if;

    if exists (
        select 1
        from public.platform_users as platform_user
        where platform_user.user_id = p_user_id
          and platform_user.is_active = true
    ) then
        raise exception
            'Remove active Paryx Console access before deleting this account.';
    end if;

    if exists (
        select 1
        from public.club_memberships as membership
        where membership.profile_id = p_user_id
          and membership.status = 'active'
          and (
              membership.membership_type = 'staff'
              or membership.role in (
                  'starter',
                  'reception',
                  'professional',
                  'greenkeeper',
                  'manager',
                  'club_admin'
              )
          )
    ) then
        raise exception
            'Remove active ClubHub staff access before deleting this account.';
    end if;

    select count(*)::integer
    into v_membership_count
    from public.club_memberships as membership
    where membership.profile_id = p_user_id;

    v_last_activity :=
        public._platform_account_last_activity(p_user_id);

    -- Record the event before Auth deletion. target_user_id will become NULL via
    -- ON DELETE SET NULL, while the immutable identifiers remain in details.
    insert into public.platform_audit_log (
        actor_user_id,
        actor_role,
        action,
        target_user_id,
        details
    )
    values (
        p_actor_user_id,
        p_actor_role,
        case
            when v_mode = 'automatic'
                then 'player_account_auto_deleted'
            else 'player_account_deleted'
        end,
        p_user_id,
        jsonb_build_object(
            'target_user_id', p_user_id::text,
            'target_email', v_email,
            'display_name', v_display_name,
            'actor_user_id', case when p_actor_user_id is null then null else p_actor_user_id::text end,
            'actor_email', v_actor_email,
            'mode', v_mode,
            'reason', v_reason,
            'last_activity_at', v_last_activity,
            'club_memberships_preserved', v_membership_count,
            'deleted_at', now()
        )
    );

    -- Identity v2 rule: the club owns the membership record. Detach the global
    -- Paryx identity before Auth/Profile deletion so club history, bookings,
    -- results and Club Credit remain intact.
    update public.club_memberships as membership
    set
        profile_id = null,
        is_primary = false,
        updated_at = now()
    where membership.profile_id = p_user_id;

    -- This is normally removed by the profile FK cascade, but deleting it here
    -- makes the privacy boundary explicit before the Auth identity is removed.
    delete from public.club_membership_player_links as link
    where link.profile_id = p_user_id;

    -- Deleting auth.users cascades the Paryx profile and profile-owned records
    -- (entitlements, handicap identity, access requests and activity tracking).
    delete from auth.users as auth_user
    where auth_user.id = p_user_id;

    get diagnostics v_deleted = row_count;

    if v_deleted <> 1 then
        raise exception 'The Paryx Auth account could not be deleted.';
    end if;

    return jsonb_build_object(
        'user_id', p_user_id::text,
        'email', v_email,
        'display_name', v_display_name,
        'mode', v_mode,
        'club_memberships_preserved', v_membership_count,
        'deleted', true
    );
end;
$$;

revoke all
on function public._platform_delete_account_record(
    uuid,
    text,
    text,
    uuid,
    text
)
from public, anon, authenticated;


-- =========================================================
-- MANUAL CONSOLE DELETE
-- Platform Owner only, with a server-side exact confirmation requirement.
-- =========================================================

create or replace function public.platform_delete_account(
    p_user_id uuid,
    p_confirmation text,
    p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor_role text;
    v_email text;
    v_required_confirmation text;
begin
    if auth.uid() is null
       or not public.is_platform_user(
            array['platform_owner']
       ) then
        raise exception 'Platform Owner access required.';
    end if;

    if p_user_id is null then
        raise exception 'Account ID is required.';
    end if;

    if p_user_id = auth.uid() then
        raise exception 'You cannot delete your own Paryx account from Console.';
    end if;

    select platform_user.role
    into v_actor_role
    from public.platform_users as platform_user
    where platform_user.user_id = auth.uid()
      and platform_user.is_active = true
    limit 1;

    select auth_user.email::text
    into v_email
    from auth.users as auth_user
    where auth_user.id = p_user_id
    limit 1;

    if not found then
        raise exception 'Paryx account not found.';
    end if;

    v_required_confirmation :=
        coalesce(v_email, p_user_id::text);

    if lower(trim(coalesce(p_confirmation, ''))) <>
       lower(trim(v_required_confirmation)) then
        raise exception
            'Deletion confirmation did not match the target account.';
    end if;

    return public._platform_delete_account_record(
        p_user_id,
        'manual',
        p_reason,
        auth.uid(),
        v_actor_role
    );
end;
$$;

revoke all
on function public.platform_delete_account(uuid, text, text)
from public, anon;

grant execute
on function public.platform_delete_account(uuid, text, text)
to authenticated;


-- =========================================================
-- AUTOMATIC INACTIVITY PURGE
-- Intended for pg_cron. Not executable by browser roles.
-- =========================================================

create or replace function public.platform_purge_inactive_accounts()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_enabled boolean;
    v_months integer;
    v_limit integer;
    v_cutoff timestamptz;
    v_deleted integer := 0;
    candidate record;
begin
    select
        policy.auto_delete_enabled,
        policy.inactive_months,
        policy.batch_limit
    into
        v_enabled,
        v_months,
        v_limit
    from public.platform_account_retention_policy as policy
    where policy.singleton = true;

    if coalesce(v_enabled, false) = false then
        return 0;
    end if;

    v_months := greatest(1, coalesce(v_months, 12));
    v_limit := greatest(1, least(coalesce(v_limit, 50), 500));
    v_cutoff := now() - make_interval(months => v_months);

    for candidate in
        select
            auth_user.id as user_id,
            auth_user.email::text as email,
            public._platform_account_last_activity(auth_user.id)
                as last_activity_at
        from auth.users as auth_user
        where public._platform_account_last_activity(auth_user.id) < v_cutoff

          -- Never automatically remove an active Console account.
          and not exists (
              select 1
              from public.platform_users as platform_user
              where platform_user.user_id = auth_user.id
                and platform_user.is_active = true
          )

          -- Never automatically remove a current ClubHub staff account.
          and not exists (
              select 1
              from public.club_memberships as membership
              where membership.profile_id = auth_user.id
                and membership.status = 'active'
                and (
                    membership.membership_type = 'staff'
                    or membership.role in (
                        'starter',
                        'reception',
                        'professional',
                        'greenkeeper',
                        'manager',
                        'club_admin'
                    )
                )
          )

          -- Do not delete a currently-paid/permanent Tier 2 account or a live
          -- scorecard pass solely because it has not been used recently.
          and not exists (
              select 1
              from public.player_entitlements as entitlement
              where entitlement.profile_id = auth_user.id
                and (
                    (
                        entitlement.plan = 'tier2'
                        and (
                            entitlement.tier2_until is null
                            or entitlement.tier2_until > now()
                        )
                    )
                    or (
                        entitlement.scorecard_pass_until is not null
                        and entitlement.scorecard_pass_until > now()
                    )
                )
          )
        order by
            public._platform_account_last_activity(auth_user.id) asc,
            auth_user.id
        limit v_limit
    loop
        begin
            perform public._platform_delete_account_record(
                candidate.user_id,
                'automatic',
                format(
                    'Automatic retention: no Paryx activity for at least %s months.',
                    v_months
                ),
                null,
                'system_retention'
            );

            v_deleted := v_deleted + 1;
        exception
            when others then
                -- Keep the batch moving and leave an audit breadcrumb for review.
                insert into public.platform_audit_log (
                    actor_user_id,
                    actor_role,
                    action,
                    target_user_id,
                    details
                )
                values (
                    null,
                    'system_retention',
                    'player_account_auto_delete_failed',
                    candidate.user_id,
                    jsonb_build_object(
                        'target_user_id', candidate.user_id::text,
                        'target_email', candidate.email,
                        'last_activity_at', candidate.last_activity_at,
                        'inactive_months', v_months,
                        'error', sqlerrm,
                        'failed_at', now()
                    )
                );
        end;
    end loop;

    return v_deleted;
end;
$$;

revoke all
on function public.platform_purge_inactive_accounts()
from public, anon, authenticated;


-- =========================================================
-- AUDIT DIRECTORY
-- Preserve deleted target email from immutable audit details after the
-- auth.users FK has set target_user_id to NULL.
-- =========================================================

create or replace function public.platform_get_audit(
    p_limit integer default 100
)
returns table (
    audit_id bigint,
    actor_email text,
    actor_role text,
    action text,
    club_id uuid,
    club_name text,
    target_email text,
    details jsonb,
    created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_limit integer;
begin
    if auth.uid() is null
       or not public.is_platform_user(null) then
        raise exception 'Paryx Console access required.';
    end if;

    v_limit := greatest(
        1,
        least(coalesce(p_limit, 100), 250)
    );

    return query
    select
        audit.id,
        coalesce(
            actor.email::text,
            nullif(audit.details ->> 'actor_email', '')
        )::text,
        audit.actor_role,
        audit.action,
        audit.club_id,
        club.name,
        coalesce(
            target.email::text,
            nullif(audit.details ->> 'target_email', ''),
            nullif(audit.details ->> 'email', '')
        )::text,
        audit.details,
        audit.created_at
    from public.platform_audit_log as audit
    left join auth.users as actor
        on actor.id = audit.actor_user_id
    left join auth.users as target
        on target.id = audit.target_user_id
    left join public.clubs as club
        on club.id = audit.club_id
    order by audit.created_at desc
    limit v_limit;
end;
$$;

revoke all
on function public.platform_get_audit(integer)
from public, anon;

grant execute
on function public.platform_get_audit(integer)
to authenticated;


commit;

notify pgrst, 'reload schema';
