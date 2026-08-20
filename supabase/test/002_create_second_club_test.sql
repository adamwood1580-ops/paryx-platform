-- Paryx v0.2 multi-club validation
-- Creates a temporary second club and grants one existing staff user access.
--
-- BEFORE RUNNING:
-- Replace BOTH occurrences of YOUR_ADMIN_EMAIL below with the email address
-- of the staff/admin account you are using to test Paryx.

do $$
declare
    v_user_id uuid;
    v_club_id uuid;
begin
    select id
    into v_user_id
    from auth.users
    where lower(email) = lower('clubhub.demo1@gmail.com')
    limit 1;

    if v_user_id is null then
        raise exception
            'No Supabase Auth user found for YOUR_ADMIN_EMAIL. Replace the placeholder first.';
    end if;

    insert into public.clubs (
        name,
        slug,
        timezone,
        is_active
    )
    values (
        'Paryx Test Golf Club',
        'paryx-test-golf-club',
        'Europe/London',
        true
    )
    on conflict (slug)
    do update set
        name = excluded.name,
        timezone = excluded.timezone,
        is_active = excluded.is_active
    returning id into v_club_id;

    if v_club_id is null then
        select id
        into v_club_id
        from public.clubs
        where slug = 'paryx-test-golf-club'
        limit 1;
    end if;

    if v_club_id is null then
        raise exception 'Could not create or locate Paryx Test Golf Club.';
    end if;

    if not exists (
        select 1
        from public.club_memberships
        where profile_id = v_user_id
          and club_id = v_club_id
    ) then
        insert into public.club_memberships (
            profile_id,
            club_id,
            membership_number,
            membership_type,
            status,
            role,
            is_primary
        )
        values (
            v_user_id,
            v_club_id,
            'PARYX-TEST-ADMIN',
            'member',
            'active',
            'club_admin',
            false
        );
    else
        update public.club_memberships
        set
            status = 'active',
            role = 'club_admin',
            updated_at = now()
        where profile_id = v_user_id
          and club_id = v_club_id;
    end if;

    raise notice
        'Second-club test ready. Club ID: %, User ID: %',
        v_club_id,
        v_user_id;
end $$;

-- Verification
select
    c.id,
    c.name,
    c.slug,
    cm.role,
    cm.status,
    cm.membership_number
from public.club_memberships cm
join public.clubs c
    on c.id = cm.club_id
join auth.users u
    on u.id = cm.profile_id
where lower(u.email) = lower('clubhub.demo1@gmail.com ')
order by c.name;
