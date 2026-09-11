-- PARYX SETUP 040
-- Enable and schedule automatic inactive-account deletion.
-- Run after migration 040.
--
-- The job runs daily at 03:17 database time and deletes at most the configured
-- batch_limit (default 50) accounts per run. Default inactivity period: 12 months.

create extension if not exists pg_cron;

do $$
declare
    v_job_id bigint;
begin
    for v_job_id in
        select jobid
        from cron.job
        where jobname = 'paryx-inactive-account-purge'
    loop
        perform cron.unschedule(v_job_id);
    end loop;

    perform cron.schedule(
        'paryx-inactive-account-purge',
        '17 3 * * *',
        'select public.platform_purge_inactive_accounts();'
    );
end;
$$;

select
    jobid,
    jobname,
    schedule,
    command,
    active
from cron.job
where jobname = 'paryx-inactive-account-purge';
