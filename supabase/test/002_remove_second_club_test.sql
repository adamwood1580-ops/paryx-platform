-- Removes only the temporary Paryx multi-club test tenant.
-- It does not touch your real club.

do $$
declare
    v_club_id uuid;
begin
    select id
    into v_club_id
    from public.clubs
    where slug = 'paryx-test-golf-club'
    limit 1;

    if v_club_id is null then
        raise notice 'Paryx Test Golf Club does not exist. Nothing to remove.';
        return;
    end if;

    delete from public.club_memberships
    where club_id = v_club_id;

    delete from public.clubs
    where id = v_club_id;

    raise notice 'Paryx Test Golf Club removed.';
end $$;
