-- =========================================================
-- PARYX MIGRATION 015
-- CLUBHUB STAFF & PERMISSIONS
--
-- Adds staff directory + permission management for ClubHub.
--
-- Roles:
--   starter
--   reception
--   professional
--   greenkeeper
--   manager
--   club_admin
--
-- Rules:
--   - Manager can manage operational staff only.
--   - Club Admin can manage every staff role.
--   - The final active Club Admin cannot be demoted, suspended,
--     or stripped of staff access.
--   - Removing staff access preserves a genuine club membership.
-- =========================================================

begin;


-- =========================================================
-- STAFF DIRECTORY
-- =========================================================

create or replace function public.admin_get_club_staff(
    p_club_id uuid
)
returns table (
    membership_id uuid,
    profile_id uuid,
    email text,
    first_name text,
    last_name text,
    display_name text,
    membership_number text,
    membership_type text,
    status text,
    role text,
    joined_at date,
    is_primary boolean,
    created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null
       or p_club_id is null
       or not public.user_can_manage_club(
            p_club_id
       ) then
        raise exception
            'Admin access required.';
    end if;

    return query
    select
        cm.id,
        cm.profile_id,
        au.email::text,
        p.first_name,
        p.last_name,
        p.display_name,
        cm.membership_number,
        cm.membership_type,
        cm.status,
        cm.role,
        cm.joined_at,
        cm.is_primary,
        cm.created_at
    from public.club_memberships as cm
    join public.profiles as p
        on p.id = cm.profile_id
    left join auth.users as au
        on au.id = cm.profile_id
    where cm.club_id = p_club_id
      and cm.role in (
          'starter',
          'reception',
          'professional',
          'greenkeeper',
          'manager',
          'club_admin'
      )
    order by
        case cm.role
            when 'club_admin' then 1
            when 'manager' then 2
            when 'professional' then 3
            when 'reception' then 4
            when 'starter' then 5
            when 'greenkeeper' then 6
            else 7
        end,
        lower(
            coalesce(
                nullif(
                    trim(
                        p.display_name
                    ),
                    ''
                ),
                nullif(
                    trim(
                        concat_ws(
                            ' ',
                            p.first_name,
                            p.last_name
                        )
                    ),
                    ''
                ),
                au.email::text,
                ''
            )
        );
end;
$$;

revoke all
on function public.admin_get_club_staff(
    uuid
)
from public, anon;

grant execute
on function public.admin_get_club_staff(
    uuid
)
to authenticated;


-- =========================================================
-- UPDATE STAFF ROLE
-- =========================================================

create or replace function public.admin_update_staff_role(
    p_club_id uuid,
    p_membership_id uuid,
    p_role text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor_role text;
    v_target
        public.club_memberships%rowtype;
    v_role text;
    v_active_admin_count bigint;
begin
    if auth.uid() is null
       or p_club_id is null
       or p_membership_id is null then
        raise exception
            'Admin access required.';
    end if;

    v_role :=
        lower(
            trim(
                coalesce(
                    p_role,
                    ''
                )
            )
        );

    if v_role not in (
        'starter',
        'reception',
        'professional',
        'greenkeeper',
        'manager',
        'club_admin'
    ) then
        raise exception
            'Invalid ClubHub role.';
    end if;

    select cm.role
    into v_actor_role
    from public.club_memberships as cm
    where cm.profile_id = auth.uid()
      and cm.club_id = p_club_id
      and cm.status = 'active'
      and cm.role in (
          'manager',
          'club_admin'
      )
    limit 1;

    if v_actor_role is null then
        raise exception
            'Admin access required.';
    end if;

    select cm.*
    into v_target
    from public.club_memberships as cm
    where cm.id = p_membership_id
      and cm.club_id = p_club_id
      and cm.role in (
          'starter',
          'reception',
          'professional',
          'greenkeeper',
          'manager',
          'club_admin'
      )
    for update;

    if not found then
        raise exception
            'Staff membership not found.';
    end if;

    if v_target.profile_id = auth.uid() then
        raise exception
            'You cannot change your own ClubHub role.';
    end if;

    if (
        v_actor_role <> 'club_admin'
        and (
            v_target.role in (
                'manager',
                'club_admin'
            )
            or v_role in (
                'manager',
                'club_admin'
            )
        )
    ) then
        raise exception
            'A Club Admin is required to manage Manager or Club Admin access.';
    end if;

    if (
        v_target.role = 'club_admin'
        and v_role <> 'club_admin'
        and v_target.status = 'active'
    ) then
        select count(*)
        into v_active_admin_count
        from public.club_memberships as cm
        where cm.club_id = p_club_id
          and cm.status = 'active'
          and cm.role = 'club_admin';

        if v_active_admin_count <= 1 then
            raise exception
                'The club must retain at least one active Club Admin.';
        end if;
    end if;

    update public.club_memberships
    set
        role = v_role,
        membership_type =
            case
                when membership_type in (
                    'visitor',
                    'guest'
                )
                then 'staff'
                else membership_type
            end,
        updated_at = now()
    where id = p_membership_id;

    return true;
end;
$$;

revoke all
on function public.admin_update_staff_role(
    uuid,
    uuid,
    text
)
from public, anon;

grant execute
on function public.admin_update_staff_role(
    uuid,
    uuid,
    text
)
to authenticated;


-- =========================================================
-- SUSPEND / REACTIVATE STAFF
-- =========================================================

create or replace function public.admin_set_staff_status(
    p_club_id uuid,
    p_membership_id uuid,
    p_status text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor_role text;
    v_target
        public.club_memberships%rowtype;
    v_status text;
    v_active_admin_count bigint;
begin
    if auth.uid() is null
       or p_club_id is null
       or p_membership_id is null then
        raise exception
            'Admin access required.';
    end if;

    v_status :=
        lower(
            trim(
                coalesce(
                    p_status,
                    ''
                )
            )
        );

    if v_status not in (
        'active',
        'suspended'
    ) then
        raise exception
            'Staff status must be active or suspended.';
    end if;

    select cm.role
    into v_actor_role
    from public.club_memberships as cm
    where cm.profile_id = auth.uid()
      and cm.club_id = p_club_id
      and cm.status = 'active'
      and cm.role in (
          'manager',
          'club_admin'
      )
    limit 1;

    if v_actor_role is null then
        raise exception
            'Admin access required.';
    end if;

    select cm.*
    into v_target
    from public.club_memberships as cm
    where cm.id = p_membership_id
      and cm.club_id = p_club_id
      and cm.role in (
          'starter',
          'reception',
          'professional',
          'greenkeeper',
          'manager',
          'club_admin'
      )
    for update;

    if not found then
        raise exception
            'Staff membership not found.';
    end if;

    if v_target.profile_id = auth.uid() then
        raise exception
            'You cannot suspend or reactivate your own ClubHub access here.';
    end if;

    if (
        v_actor_role <> 'club_admin'
        and v_target.role in (
            'manager',
            'club_admin'
        )
    ) then
        raise exception
            'A Club Admin is required to manage Manager or Club Admin access.';
    end if;

    if (
        v_target.role = 'club_admin'
        and v_target.status = 'active'
        and v_status = 'suspended'
    ) then
        select count(*)
        into v_active_admin_count
        from public.club_memberships as cm
        where cm.club_id = p_club_id
          and cm.status = 'active'
          and cm.role = 'club_admin';

        if v_active_admin_count <= 1 then
            raise exception
                'The club must retain at least one active Club Admin.';
        end if;
    end if;

    update public.club_memberships
    set
        status = v_status,
        joined_at =
            case
                when v_status = 'active'
                then coalesce(
                    joined_at,
                    current_date
                )
                else joined_at
            end,
        updated_at = now()
    where id = p_membership_id;

    return true;
end;
$$;

revoke all
on function public.admin_set_staff_status(
    uuid,
    uuid,
    text
)
from public, anon;

grant execute
on function public.admin_set_staff_status(
    uuid,
    uuid,
    text
)
to authenticated;


-- =========================================================
-- REMOVE STAFF ACCESS
--
-- A genuine member keeps their club membership.
-- A pure staff relationship becomes an internal visitor
-- relationship so historical audit/booking references survive.
-- =========================================================

create or replace function public.admin_remove_staff_access(
    p_club_id uuid,
    p_membership_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor_role text;
    v_target
        public.club_memberships%rowtype;
    v_active_admin_count bigint;
    v_was_primary boolean;
begin
    if auth.uid() is null
       or p_club_id is null
       or p_membership_id is null then
        raise exception
            'Admin access required.';
    end if;

    select cm.role
    into v_actor_role
    from public.club_memberships as cm
    where cm.profile_id = auth.uid()
      and cm.club_id = p_club_id
      and cm.status = 'active'
      and cm.role in (
          'manager',
          'club_admin'
      )
    limit 1;

    if v_actor_role is null then
        raise exception
            'Admin access required.';
    end if;

    select cm.*
    into v_target
    from public.club_memberships as cm
    where cm.id = p_membership_id
      and cm.club_id = p_club_id
      and cm.role in (
          'starter',
          'reception',
          'professional',
          'greenkeeper',
          'manager',
          'club_admin'
      )
    for update;

    if not found then
        raise exception
            'Staff membership not found.';
    end if;

    if v_target.profile_id = auth.uid() then
        raise exception
            'You cannot remove your own ClubHub access here.';
    end if;

    if (
        v_actor_role <> 'club_admin'
        and v_target.role in (
            'manager',
            'club_admin'
        )
    ) then
        raise exception
            'A Club Admin is required to manage Manager or Club Admin access.';
    end if;

    if (
        v_target.role = 'club_admin'
        and v_target.status = 'active'
    ) then
        select count(*)
        into v_active_admin_count
        from public.club_memberships as cm
        where cm.club_id = p_club_id
          and cm.status = 'active'
          and cm.role = 'club_admin';

        if v_active_admin_count <= 1 then
            raise exception
                'The club must retain at least one active Club Admin.';
        end if;
    end if;

    v_was_primary :=
        v_target.is_primary;

    if v_target.membership_type = 'staff' then
        update public.club_memberships
        set
            membership_number = null,
            membership_type = 'visitor',
            status = 'active',
            role = 'member',
            joined_at = null,
            is_primary = false,
            updated_at = now()
        where id = p_membership_id;

        if v_was_primary then
            update public.club_memberships
            set
                is_primary = true,
                updated_at = now()
            where id = (
                select other.id
                from public.club_memberships as other
                where other.profile_id =
                        v_target.profile_id
                  and other.id <>
                        p_membership_id
                  and other.status = 'active'
                  and other.membership_type not in (
                      'visitor',
                      'guest',
                      'staff'
                  )
                order by
                    other.created_at asc
                limit 1
            );
        end if;
    else
        update public.club_memberships
        set
            role = 'member',
            updated_at = now()
        where id = p_membership_id;
    end if;

    return true;
end;
$$;

revoke all
on function public.admin_remove_staff_access(
    uuid,
    uuid
)
from public, anon;

grant execute
on function public.admin_remove_staff_access(
    uuid,
    uuid
)
to authenticated;


commit;

notify pgrst, 'reload schema';
