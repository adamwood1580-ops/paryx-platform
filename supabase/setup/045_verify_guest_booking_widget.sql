-- =========================================================
-- PARYX v0.27.1 READ-ONLY VERIFICATION
-- =========================================================

-- 1. Guest party table exists.
select
    to_regclass('public.public_booking_guest_parties') as guest_party_table;

-- 2. Expected booking/contact columns exist.
select
    table_name,
    column_name,
    data_type,
    is_nullable
from information_schema.columns
where table_schema = 'public'
  and (
      (table_name = 'bookings' and column_name in ('created_by_membership_id','contact_email'))
      or (table_name = 'booking_guests' and column_name = 'public_guest_party_id')
  )
order by table_name, column_name;

-- 3. Public RPCs are present.
select
    p.proname,
    pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc as p
join pg_namespace as n
    on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
      'public_booking_widget_bootstrap',
      'public_booking_widget_tee_times',
      'public_booking_widget_create_guest'
  )
order by p.proname;

-- 4. Club website-booking settings.
select
    c.name as club_name,
    c.slug as club_slug,
    cs.public_booking_enabled,
    cs.public_booking_advance_days
from public.clubs as c
left join public.club_settings as cs
    on cs.club_id = c.id
order by lower(c.name);

-- 5. Summary only: recent website guest bookings, no contact PII.
select
    c.name as club_name,
    count(*) as website_guest_parties,
    max(p.created_at) as latest_booking_at
from public.public_booking_guest_parties as p
join public.clubs as c
    on c.id = p.club_id
group by c.id, c.name
order by lower(c.name);
