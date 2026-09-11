-- =========================================================
-- PARYX MIGRATION 048
-- TEMPORARY PRE-RELEASE DEMO RESET TOOL
-- =========================================================
--
-- PURPOSE
-- Provide a guarded, repeatable Platform Owner reset for the pre-release
-- demo environment. This tooling is intentionally temporary and must be
-- removed/disabled before the final production release.
--
-- PRESERVED
-- - Clubs, branding, settings and modules
-- - Courses, tees, holes and tee-time inventory
-- - Calendar events and competition definitions
-- - Competition integration/device configuration
-- - Stock/EPOS configuration and inventory data
-- - One explicitly allow-listed Platform Owner / ClubHub account
--
-- CLEARED
-- - Club Credit accounts and transactions
-- - Competition entrants, results, prizes, imports and CSV ingest history
-- - Player bookings and guest booking history
-- - Player notifications and tee-time alerts
-- - Membership claim/access/import history
-- - Club members except staff/admin relationships owned by the keep account
-- - Paryx Auth accounts except the keep account
-- - Development/demo audit history, replaced by one reset audit event
--
-- SAFETY
-- - Platform Owner only
-- - The currently signed-in owner MUST be the account being preserved
-- - Keep account must itself be an active Platform Owner
-- - Exact server-side confirmation phrase: RESET DEMO DATA
-- - Audit reason required
-- - Whole reset runs in one database transaction
-- =========================================================

begin;

-- ---------------------------------------------------------
-- READ-ONLY PREVIEW
-- ---------------------------------------------------------

create or replace function public.platform_demo_reset_preview(
    p_keep_email text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_keep_email text;
    v_keep_user_id uuid;
    v_credit_balance numeric := 0;
    v_keep_staff_memberships bigint := 0;
begin
    if auth.uid() is null
       or not public.is_platform_user(array['platform_owner']) then
        raise exception 'Paryx Platform Owner access required.';
    end if;

    v_keep_email := lower(trim(coalesce(p_keep_email, '')));

    if v_keep_email = '' then
        raise exception 'The account to preserve is required.';
    end if;

    select auth_user.id
    into v_keep_user_id
    from auth.users as auth_user
    join public.platform_users as platform_user
      on platform_user.user_id = auth_user.id
    where lower(auth_user.email::text) = v_keep_email
      and platform_user.role = 'platform_owner'
      and platform_user.is_active = true
    limit 1;

    if v_keep_user_id is null then
        raise exception 'The preserved account must be an active Platform Owner.';
    end if;

    if auth.uid() <> v_keep_user_id then
        raise exception 'Sign in as the account being preserved before running the demo reset.';
    end if;

    select coalesce(sum(account.balance), 0)
    into v_credit_balance
    from public.club_member_accounts as account;

    select count(*)
    into v_keep_staff_memberships
    from public.club_memberships as membership
    where membership.profile_id = v_keep_user_id
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
      );

    return jsonb_build_object(
        'keep_email', v_keep_email,
        'keep_user_id', v_keep_user_id::text,
        'keep_staff_memberships', v_keep_staff_memberships,
        'auth_accounts_total', (select count(*) from auth.users),
        'auth_accounts_to_delete', (
            select count(*) from auth.users where id <> v_keep_user_id
        ),
        'club_memberships_total', (
            select count(*) from public.club_memberships
        ),
        'club_memberships_to_delete', (
            select count(*)
            from public.club_memberships as membership
            where membership.profile_id is distinct from v_keep_user_id
               or not (
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
        ),
        'bookings_to_delete', (
            select count(*) from public.bookings
        ),
        'club_credit_accounts_to_delete', (
            select count(*) from public.club_member_accounts
        ),
        'club_credit_transactions_to_delete', (
            select count(*) from public.club_member_account_transactions
        ),
        'club_credit_balance_to_clear', v_credit_balance,
        'competition_entries_to_delete', (
            select count(*) from public.club_competition_entries
        ),
        'competition_prizes_to_delete', (
            select count(*) from public.club_competition_prizes
        ),
        'competition_external_results_to_delete', (
            select count(*) from public.club_competition_external_results
        ),
        'competition_result_imports_to_delete', (
            select count(*) from public.club_competition_result_imports
        ),
        'competition_ingest_files_to_delete', (
            select count(*) from public.club_competition_ingest_files
        ),
        'competition_definitions_preserved', (
            select count(*) from public.club_competitions
        ),
        'notifications_to_delete', (
            select count(*) from public.player_notifications
        ),
        'tee_time_alerts_to_delete', (
            select count(*) from public.player_tee_time_alerts
        ),
        'member_import_batches_to_delete', (
            select count(*) from public.member_import_batches
        ),
        'member_import_rows_to_delete', (
            select count(*) from public.member_import_rows
        ),
        'audit_rows_to_replace', (
            select count(*) from public.platform_audit_log
        )
    );
end;
$$;

revoke all
on function public.platform_demo_reset_preview(text)
from public, anon;

grant execute
on function public.platform_demo_reset_preview(text)
to authenticated;


-- ---------------------------------------------------------
-- DESTRUCTIVE RESET
-- ---------------------------------------------------------

create or replace function public.platform_demo_reset(
    p_keep_email text,
    p_confirmation text,
    p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_keep_email text;
    v_keep_user_id uuid;
    v_reason text;
    v_preview jsonb;
    v_deleted_auth integer := 0;
    v_deleted_memberships integer := 0;
    v_deleted_bookings integer := 0;
    v_deleted_credit_accounts integer := 0;
    v_deleted_credit_transactions integer := 0;
    v_deleted_competition_entries integer := 0;
    v_deleted_competition_prizes integer := 0;
    v_deleted_external_results integer := 0;
    v_deleted_result_imports integer := 0;
    v_deleted_ingest_files integer := 0;
begin
    if auth.uid() is null
       or not public.is_platform_user(array['platform_owner']) then
        raise exception 'Paryx Platform Owner access required.';
    end if;

    -- Prevent two destructive resets from running at the same time.
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext('paryx_platform_demo_reset')
    );

    v_keep_email := lower(trim(coalesce(p_keep_email, '')));
    v_reason := nullif(trim(coalesce(p_reason, '')), '');

    if v_keep_email = '' then
        raise exception 'The account to preserve is required.';
    end if;

    if trim(coalesce(p_confirmation, '')) <> 'RESET DEMO DATA' then
        raise exception 'The demo reset confirmation phrase did not match.';
    end if;

    if v_reason is null then
        raise exception 'An audit reason is required.';
    end if;

    select auth_user.id
    into v_keep_user_id
    from auth.users as auth_user
    join public.platform_users as platform_user
      on platform_user.user_id = auth_user.id
    where lower(auth_user.email::text) = v_keep_email
      and platform_user.role = 'platform_owner'
      and platform_user.is_active = true
    limit 1;

    if v_keep_user_id is null then
        raise exception 'The preserved account must be an active Platform Owner.';
    end if;

    if auth.uid() <> v_keep_user_id then
        raise exception 'Sign in as the account being preserved before running the demo reset.';
    end if;

    -- Capture the before-state while every row still exists.
    v_preview := public.platform_demo_reset_preview(v_keep_email);

    -- -----------------------------------------------------
    -- PLAYER COMMUNICATION / CLAIM HISTORY
    -- -----------------------------------------------------

    delete from public.player_tee_time_alerts;
    delete from public.player_notifications;
    delete from public.player_membership_claim_attempts;
    delete from public.club_membership_access_requests;

    -- CSV member-import history stores club-supplied names/emails and must be
    -- removed when the demo environment is reset. Rows cascade from batches.
    delete from public.member_import_batches;

    -- -----------------------------------------------------
    -- PLAYER BOOKING / GUEST HISTORY
    -- -----------------------------------------------------
    -- booking_members, booking_guests and public_booking_guest_parties cascade
    -- from bookings. Tee-time inventory itself is deliberately preserved.

    delete from public.bookings;
    get diagnostics v_deleted_bookings = row_count;

    -- -----------------------------------------------------
    -- COMPETITION RESULT HISTORY
    -- -----------------------------------------------------

    delete from public.club_competition_prizes;
    get diagnostics v_deleted_competition_prizes = row_count;

    delete from public.club_competition_external_results;
    get diagnostics v_deleted_external_results = row_count;

    delete from public.club_competition_result_imports;
    get diagnostics v_deleted_result_imports = row_count;

    delete from public.club_competition_ingest_files;
    get diagnostics v_deleted_ingest_files = row_count;

    delete from public.club_competition_entries;
    get diagnostics v_deleted_competition_entries = row_count;

    delete from public.club_external_player_links;

    -- Keep the competition/calendar definitions but remove every result/sync
    -- marker so they behave like clean calendar-driven competitions again.
    update public.club_competitions as competition
    set
        status = case
            when competition.status = 'cancelled' then 'cancelled'
            when competition.competition_date < current_date then 'results_pending'
            when competition.competition_date = current_date then 'open'
            else 'draft'
        end,
        external_competition_id = null,
        external_status = null,
        result_sync_status = case
            when coalesce(competition.result_provider, 'manual') = 'manual'
                then 'manual'
            else 'awaiting_results'
        end,
        last_result_sync_at = null,
        result_imported_at = null,
        result_sync_error = null,
        results_verified_at = null,
        results_verified_by = null,
        results_verified_source = null,
        results_confirmed_at = null,
        results_confirmed_by = null,
        updated_at = now();

    update public.club_competition_result_integrations as integration
    set
        last_sync_at = null,
        last_sync_status = null,
        last_sync_error = null,
        updated_at = now();

    update public.club_competition_bridge_devices as device
    set
        last_seen_at = null,
        last_upload_at = null,
        updated_at = now();

    -- -----------------------------------------------------
    -- CLUB CREDIT
    -- -----------------------------------------------------

    delete from public.club_member_account_transactions;
    get diagnostics v_deleted_credit_transactions = row_count;

    delete from public.club_member_accounts;
    get diagnostics v_deleted_credit_accounts = row_count;

    -- -----------------------------------------------------
    -- MEMBERSHIP / PLAYER IDENTITY
    -- -----------------------------------------------------

    -- Private player/member links for rows being removed are normally cascaded,
    -- but clearing all non-kept links first makes the reset intent explicit.
    delete from public.club_membership_player_links as link
    where link.profile_id <> v_keep_user_id;

    -- Preserve only staff/admin relationships owned by the retained demo
    -- account. All imported members, visitor memberships and old player rows
    -- are removed so the demo CSV can start from a clean directory.
    delete from public.club_memberships as membership
    where membership.profile_id is distinct from v_keep_user_id
       or not (
            membership.membership_type = 'staff'
            or membership.role in (
                'starter',
                'reception',
                'professional',
                'greenkeeper',
                'manager',
                'club_admin'
            )
       );
    get diagnostics v_deleted_memberships = row_count;

    -- The retained account is staff/admin infrastructure, not a paid Player
    -- entitlement in the reset environment.
    update public.player_entitlements as entitlement
    set
        plan = 'free',
        tier2_until = null,
        scorecard_pass_until = null,
        updated_at = now()
    where entitlement.profile_id = v_keep_user_id;

    -- Only the retained owner keeps Console access.
    delete from public.platform_users as platform_user
    where platform_user.user_id <> v_keep_user_id;

    update public.platform_users
    set
        role = 'platform_owner',
        is_active = true,
        updated_at = now()
    where user_id = v_keep_user_id;

    -- Deleting Auth removes Profiles and all profile-owned Player data by FK.
    -- The club-owned member rows have already been deliberately handled above.
    delete from auth.users as auth_user
    where auth_user.id <> v_keep_user_id;
    get diagnostics v_deleted_auth = row_count;

    -- -----------------------------------------------------
    -- DEVELOPMENT AUDIT HISTORY
    -- -----------------------------------------------------
    -- Old audit rows can contain development/test identifiers in immutable
    -- JSON details. Replace them with one non-personal reset event.

    delete from public.platform_audit_log;

    insert into public.platform_audit_log (
        actor_user_id,
        actor_role,
        action,
        details
    )
    values (
        v_keep_user_id,
        'platform_owner',
        'demo_environment_reset',
        jsonb_build_object(
            'reason', v_reason,
            'preserved_account', v_keep_email,
            'reset_at', now(),
            'before', v_preview,
            'deleted', jsonb_build_object(
                'auth_accounts', v_deleted_auth,
                'club_memberships', v_deleted_memberships,
                'bookings', v_deleted_bookings,
                'club_credit_accounts', v_deleted_credit_accounts,
                'club_credit_transactions', v_deleted_credit_transactions,
                'competition_entries', v_deleted_competition_entries,
                'competition_prizes', v_deleted_competition_prizes,
                'competition_external_results', v_deleted_external_results,
                'competition_result_imports', v_deleted_result_imports,
                'competition_ingest_files', v_deleted_ingest_files
            )
        )
    );

    -- Keep the retained owner's inactivity clock current after the reset.
    insert into public.paryx_account_activity (
        user_id,
        last_activity_at,
        last_source,
        updated_at
    )
    values (
        v_keep_user_id,
        now(),
        'demo_reset',
        now()
    )
    on conflict (user_id)
    do update set
        last_activity_at = excluded.last_activity_at,
        last_source = excluded.last_source,
        updated_at = now();

    return jsonb_build_object(
        'reset', true,
        'preserved_account', v_keep_email,
        'auth_accounts_deleted', v_deleted_auth,
        'club_memberships_deleted', v_deleted_memberships,
        'bookings_deleted', v_deleted_bookings,
        'club_credit_accounts_deleted', v_deleted_credit_accounts,
        'club_credit_transactions_deleted', v_deleted_credit_transactions,
        'competition_entries_deleted', v_deleted_competition_entries,
        'competition_prizes_deleted', v_deleted_competition_prizes,
        'competition_external_results_deleted', v_deleted_external_results,
        'competition_result_imports_deleted', v_deleted_result_imports,
        'competition_ingest_files_deleted', v_deleted_ingest_files,
        'completed_at', now()
    );
end;
$$;

revoke all
on function public.platform_demo_reset(text, text, text)
from public, anon;

grant execute
on function public.platform_demo_reset(text, text, text)
to authenticated;

commit;

notify pgrst, 'reload schema';
