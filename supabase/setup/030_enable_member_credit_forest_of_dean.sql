-- =========================================================
-- ENABLE MEMBER CLUB CREDIT FOR CURRENT LIVE DEMO CLUB
-- =========================================================

do $$
declare
    v_club_id uuid;
    v_match_count integer;
begin
    select count(*)
    into v_match_count
    from public.clubs as club
    where lower(trim(club.name)) =
        lower('Forest of Dean Golf Club');

    if v_match_count <> 1 then
        raise exception
            'Safety stop: expected exactly one Forest of Dean Golf Club tenant, found %.',
            v_match_count;
    end if;

    select club.id
    into v_club_id
    from public.clubs as club
    where lower(trim(club.name)) =
        lower('Forest of Dean Golf Club')
    limit 1;

    insert into public.club_modules (
        club_id,
        module_key,
        is_enabled,
        enabled_at,
        updated_at
    )
    values (
        v_club_id,
        'member_credit',
        true,
        now(),
        now()
    )
    on conflict (
        club_id,
        module_key
    )
    do update set
        is_enabled = true,
        enabled_at =
            coalesce(
                public.club_modules.enabled_at,
                now()
            ),
        updated_at = now();
end;
$$;

select
    club.name as club_name,
    module.module_key,
    module.is_enabled,
    module.enabled_at
from public.club_modules as module
join public.clubs as club
    on club.id = module.club_id
where lower(trim(club.name)) =
    lower('Forest of Dean Golf Club')
and module.module_key = 'member_credit';
