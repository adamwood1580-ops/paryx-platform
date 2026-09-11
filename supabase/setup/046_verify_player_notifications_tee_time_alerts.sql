-- =========================================================
-- PARYX v0.28.0 READ-ONLY VERIFICATION
-- PLAYER NOTIFICATIONS + TEE-TIME ALERTS
-- =========================================================

-- 1. Core tables
select
    to_regclass('public.player_notifications') as player_notifications,
    to_regclass('public.player_tee_time_alerts') as player_tee_time_alerts;

-- 2. Required RPCs/internal functions
select
    p.proname as function_name,
    pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc as p
join pg_namespace as n
    on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
      '_player_create_notification',
      '_player_process_tee_time_alerts',
      'player_create_tee_time_alert',
      'player_cancel_tee_time_alert',
      'player_list_tee_time_alerts',
      'player_notification_summary',
      'player_list_notifications',
      'player_mark_notification_read',
      'player_mark_all_notifications_read'
  )
order by p.proname;

-- 3. Required triggers
select
    event_object_table,
    trigger_name,
    action_timing,
    event_manipulation
from information_schema.triggers
where trigger_schema = 'public'
  and trigger_name in (
      'player_booking_availability_alerts',
      'player_tee_status_alerts',
      'player_booking_member_notifications'
  )
order by trigger_name, event_manipulation;

-- 4. Direct table access should not be granted to anon/authenticated
select
    grantee,
    table_name,
    privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in (
      'player_notifications',
      'player_tee_time_alerts'
  )
  and grantee in ('anon', 'authenticated')
order by table_name, grantee, privilege_type;

-- Expected: zero rows from query 4.

-- 5. Current operational counts
select
    (select count(*) from public.player_notifications) as notification_rows,
    (select count(*) from public.player_notifications where read_at is null) as unread_rows,
    (select count(*) from public.player_tee_time_alerts where status = 'active') as active_alerts,
    (select count(*) from public.player_tee_time_alerts where status = 'notified') as notified_alerts;
