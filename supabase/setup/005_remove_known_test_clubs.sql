-- PARYX DEVELOPMENT CLEANUP
-- Removes the temporary clubs used during the v0.2/v0.3 Console tests.
--
-- This is intentionally a setup utility, not a migration.
--
-- It only targets these exact test slugs:
--   paryx-test-golf-club
--   paryx-console-test-club
--
-- Club-owned rows with ON DELETE CASCADE are removed with the test tenant.

begin;

delete from public.clubs
where slug in (
    'paryx-test-golf-club',
    'paryx-console-test-club'
);

commit;

select
    id,
    name,
    slug,
    is_active
from public.clubs
order by lower(name);
