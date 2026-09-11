-- =========================================================
-- PARYX 048 — DEMO RESET VERIFICATION (READ ONLY)
-- =========================================================
-- Run this after the Console Demo Reset action. It does not change data.
-- Expected clean state:
--   * one Auth account (clubhub.demo1@gmail.com)
--   * no Club Credit accounts/transactions
--   * no competition entrants/results/prizes/import history
--   * no player/visitor bookings
--   * no non-demo member records
--   * one fresh demo_environment_reset audit event
-- =========================================================

select
    id as user_id,
    email,
    created_at,
    last_sign_in_at
from auth.users
order by lower(email::text);

select
    count(*) as auth_account_count,
    count(*) filter (
        where lower(email::text) = lower('clubhub.demo1@gmail.com')
    ) as preserved_demo_account_count
from auth.users;

select
    count(*) as club_membership_count,
    count(*) filter (
        where profile_id is null
           or profile_id is distinct from (
                select id
                from auth.users
                where lower(email::text) = lower('clubhub.demo1@gmail.com')
                limit 1
           )
    ) as memberships_not_owned_by_demo_account
from public.club_memberships;

select
    count(*) as booking_count
from public.bookings;

select
    count(*) as club_credit_account_count,
    coalesce(sum(balance), 0) as total_credit_balance
from public.club_member_accounts;

select
    count(*) as club_credit_transaction_count
from public.club_member_account_transactions;

select
    (select count(*) from public.club_competition_entries) as competition_entry_count,
    (select count(*) from public.club_competition_prizes) as competition_prize_count,
    (select count(*) from public.club_competition_external_results) as external_result_count,
    (select count(*) from public.club_competition_result_imports) as result_import_count,
    (select count(*) from public.club_competition_ingest_files) as ingest_file_count,
    (select count(*) from public.club_competitions) as competition_definitions_preserved;

select
    (select count(*) from public.player_notifications) as notification_count,
    (select count(*) from public.player_tee_time_alerts) as tee_alert_count,
    (select count(*) from public.member_import_batches) as member_import_batch_count,
    (select count(*) from public.member_import_rows) as member_import_row_count;

select
    action,
    actor_role,
    details,
    created_at
from public.platform_audit_log
order by created_at desc
limit 10;
