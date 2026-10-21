-- NON-DESTRUCTIVE Stage 3 verification, run as Supabase database administrator.
-- All 'ok' checks must be true. This tests schema/deployment, not live
-- permissions, booking conflicts, hold expiration or frontend integration.
select
    to_regclass('public.resort_reservations') is not null as reservations_table_ok,
    to_regclass('public.resort_reservation_slots') is not null as slots_table_ok,
    to_regclass('public.resort_reservation_audit') is not null as audit_table_ok,
    to_regprocedure('public.resort_staff_context(uuid)') is not null as context_rpc_ok,
    to_regprocedure('public.resort_create_reservation(uuid,text,uuid,integer,text,text,text,text,boolean,text[],integer,boolean)') is not null as create_rpc_ok,
    to_regprocedure('public.resort_confirm_reservation(uuid,text[])') is not null as confirm_rpc_ok,
    to_regprocedure('public.resort_cancel_reservation(uuid)') is not null as cancel_rpc_ok,
    to_regprocedure('public.resort_day_tee_times(uuid,uuid,date)') is not null as day_rpc_ok,
    to_regprocedure('public.resort_list_reservations(uuid,date,date)') is not null as list_rpc_ok,
    to_regprocedure('public.resort_staff_overlay(uuid,uuid,date)') is not null as overlay_rpc_ok;

select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in (
    'resort_reservations','resort_reservation_slots','resort_reservation_audit'
) order by c.relname;

select tgname as trigger_name,tgrelid::regclass as installed_on
from pg_trigger
where not tgisinternal and tgname in (
    'resort_guard_held_tee_time','resort_guard_guest_join',
    'resort_guard_member_join','resort_sync_cancelled_booking'
) order by tgname;

select h.club_id,c.name,h.enabled,h.hotel_booking_days,h.society_booking_days,
       h.hotel_allocation_percent,h.member_allocation_percent
from public.hotel_mode_settings h join public.clubs c on c.id=h.club_id
order by c.name;

-- Confirm there is no existing duplicate live society hold before testing.
select tee_time_id,count(*) as live_holds
from public.resort_reservation_slots s
join public.resort_reservations r on r.id=s.reservation_id
where s.status='held' and r.status='provisional' and r.hold_expires_at>now()
group by tee_time_id having count(*)>1;
