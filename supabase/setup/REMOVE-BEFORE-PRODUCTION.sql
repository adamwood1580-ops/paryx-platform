-- =========================================================
-- PARYX TEMPORARY DEMO RESET — SERVER-SIDE DISABLE SCRIPT
-- =========================================================
-- DO NOT RUN during the demo/testing phase.
-- Run only when the final production release is ready and the Console UI
-- patch that removes Demo Reset is being deployed.
-- =========================================================

begin;

revoke all
on function public.platform_demo_reset_preview(text)
from public, anon, authenticated;

revoke all
on function public.platform_demo_reset(text, text, text)
from public, anon, authenticated;

drop function if exists public.platform_demo_reset_preview(text);
drop function if exists public.platform_demo_reset(text, text, text);

commit;

notify pgrst, 'reload schema';
