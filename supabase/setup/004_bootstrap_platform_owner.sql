-- PARYX PLATFORM
-- One-time bootstrap for the first Paryx Console owner.
--
-- 1. Replace YOUR_EMAIL_ADDRESS with your existing Paryx login email.
-- 2. Run this in the Supabase SQL Editor AFTER migration 004.
--
-- This file is intentionally separate from the migration so a fresh Paryx
-- installation never silently grants platform-level access to a club user.

insert into public.platform_users (
    user_id,
    role,
    is_active,
    updated_at
)
select
    au.id,
    'platform_owner',
    true,
    now()
from auth.users as au
where lower(au.email) = lower('clubhub.demo1@gmail.com')
on conflict on constraint platform_users_pkey
do update set
    role = 'platform_owner',
    is_active = true,
    updated_at = now();

select
    au.email,
    pu.role,
    pu.is_active
from public.platform_users as pu
join auth.users as au
    on au.id = pu.user_id
where lower(au.email) = lower('clubhub.demo1@gmail.com');
