-- PARYX SETUP 040 — READ-ONLY VERIFICATION
-- Safe to run after migration 040 and before/after scheduling.

select
    auto_delete_enabled,
    inactive_months,
    batch_limit,
    updated_at
from public.platform_account_retention_policy
where singleton = true;

select
    count(*) as tracked_auth_accounts,
    min(last_activity_at) as oldest_tracked_activity,
    max(last_activity_at) as newest_tracked_activity
from public.paryx_account_activity;

-- Oldest accounts by Paryx activity.
select
    au.id,
    au.email,
    public._platform_account_last_activity(au.id) as last_activity_at,
    now() - public._platform_account_last_activity(au.id) as inactive_for
from auth.users as au
order by last_activity_at asc
limit 25;

-- Exact automatic-deletion candidates under the current policy.
with policy as (
    select
        auto_delete_enabled,
        inactive_months,
        batch_limit
    from public.platform_account_retention_policy
    where singleton = true
)
select
    au.id,
    au.email,
    public._platform_account_last_activity(au.id) as last_activity_at,
    now() - public._platform_account_last_activity(au.id) as inactive_for
from auth.users as au
cross join policy
where policy.auto_delete_enabled = true
  and public._platform_account_last_activity(au.id) <
      now() - make_interval(months => policy.inactive_months)
  and not exists (
      select 1
      from public.platform_users as pu
      where pu.user_id = au.id
        and pu.is_active = true
  )
  and not exists (
      select 1
      from public.club_memberships as cm
      where cm.profile_id = au.id
        and cm.status = 'active'
        and (
            cm.membership_type = 'staff'
            or cm.role in (
                'starter','reception','professional',
                'greenkeeper','manager','club_admin'
            )
        )
  )
  and not exists (
      select 1
      from public.player_entitlements as pe
      where pe.profile_id = au.id
        and (
            (
                pe.plan = 'tier2'
                and (
                    pe.tier2_until is null
                    or pe.tier2_until > now()
                )
            )
            or (
                pe.scorecard_pass_until is not null
                and pe.scorecard_pass_until > now()
            )
        )
  )
order by last_activity_at asc;

-- Run this final query only after 040_schedule_account_retention.sql has enabled pg_cron.
select
    jobid,
    jobname,
    schedule,
    command,
    active
from cron.job
where jobname = 'paryx-inactive-account-purge';
