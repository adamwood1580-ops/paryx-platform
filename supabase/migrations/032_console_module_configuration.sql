-- =========================================================
-- PARYX MIGRATION 032
-- CONSOLE MODULE CONFIGURATION V1
--
-- Requires:
--   Migration 004 — Console foundation
--   Migration 020 — Club oversight
--   Migration 026 — Optional module framework
--
-- Adds:
--   platform_get_club_modules
--   platform_create_club_configured
--   platform_update_club_configuration
--
-- EPOS currently depends on Stock Inventory because the provider-neutral
-- EPOS layer maps provider products to public.stock_products.
-- =========================================================

begin;

-- =========================================================
-- READ CLUB MODULES
-- Support can inspect. Admin/Owner can inspect and edit through other RPCs.
-- =========================================================

create or replace function public.platform_get_club_modules(
    p_club_id uuid
)
returns table (
    module_key text,
    is_enabled boolean,
    enabled_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null
       or not public.is_platform_user(
            array[
                'platform_owner',
                'platform_admin',
                'platform_support'
            ]
       ) then
        raise exception
            'Paryx Console access required.';
    end if;

    if not exists (
        select 1
        from public.clubs as club
        where club.id = p_club_id
    ) then
        raise exception
            'Club not found.';
    end if;

    return query
    select
        modules.module_key,
        coalesce(
            configured.is_enabled,
            false
        )::boolean,
        configured.enabled_at
    from (
        values
            ('stock_inventory'::text),
            ('member_credit'::text),
            ('epos_integration'::text)
    ) as modules(module_key)
    left join public.club_modules as configured
        on configured.club_id = p_club_id
       and configured.module_key =
            modules.module_key
    order by
        case modules.module_key
            when 'stock_inventory' then 1
            when 'member_credit' then 2
            when 'epos_integration' then 3
            else 99
        end;
end;
$$;

revoke all
on function public.platform_get_club_modules(uuid)
from public, anon;

grant execute
on function public.platform_get_club_modules(uuid)
to authenticated;

-- =========================================================
-- CREATE CLUB WITH INITIAL MODULE CONFIGURATION
-- Atomic provisioning from Console.
-- =========================================================

create or replace function public.platform_create_club_configured(
    p_name text,
    p_slug text,
    p_timezone text default 'Europe/London',
    p_stock_inventory boolean default false,
    p_member_credit boolean default false,
    p_epos_integration boolean default false
)
returns table (
    club_id uuid,
    club_name text,
    club_slug text,
    club_timezone text,
    is_active boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_name text;
    v_slug text;
    v_timezone text;
    v_club_id uuid;
    v_actor_role text;
    v_stock boolean;
    v_credit boolean;
    v_epos boolean;
begin
    if auth.uid() is null
       or not public.is_platform_user(
            array[
                'platform_owner',
                'platform_admin'
            ]
       ) then
        raise exception
            'Paryx platform admin access required.';
    end if;

    select platform_user.role
    into v_actor_role
    from public.platform_users as platform_user
    where platform_user.user_id =
            auth.uid()
      and platform_user.is_active
    limit 1;

    v_name :=
        nullif(
            trim(
                coalesce(
                    p_name,
                    ''
                )
            ),
            ''
        );

    v_slug :=
        lower(
            nullif(
                trim(
                    coalesce(
                        p_slug,
                        ''
                    )
                ),
                ''
            )
        );

    v_timezone :=
        coalesce(
            nullif(
                trim(
                    coalesce(
                        p_timezone,
                        ''
                    )
                ),
                ''
            ),
            'Europe/London'
        );

    v_stock :=
        coalesce(
            p_stock_inventory,
            false
        );

    v_credit :=
        coalesce(
            p_member_credit,
            false
        );

    v_epos :=
        coalesce(
            p_epos_integration,
            false
        );

    if v_name is null then
        raise exception
            'Club name is required.';
    end if;

    if v_slug is null
       or v_slug !~
            '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
        raise exception
            'Slug must use lowercase letters, numbers and single hyphens.';
    end if;

    if not exists (
        select 1
        from pg_catalog.pg_timezone_names as timezone
        where timezone.name =
                v_timezone
    ) then
        raise exception
            'Invalid timezone.';
    end if;

    if v_epos
       and not v_stock then
        raise exception
            'EPOS Integration requires Stock Inventory.';
    end if;

    insert into public.clubs (
        name,
        slug,
        timezone,
        is_active
    )
    values (
        v_name,
        v_slug,
        v_timezone,
        true
    )
    returning id
    into v_club_id;

    -- Migration 026's club-created trigger normally creates these rows.
    -- INSERT ... ON CONFLICT also makes this function robust if the rows
    -- have not yet been created by the trigger.
    insert into public.club_modules (
        club_id,
        module_key,
        is_enabled,
        enabled_at,
        enabled_by,
        updated_at
    )
    values
        (
            v_club_id,
            'stock_inventory',
            v_stock,
            case
                when v_stock
                    then now()
                else null
            end,
            case
                when v_stock
                    then auth.uid()
                else null
            end,
            now()
        ),
        (
            v_club_id,
            'member_credit',
            v_credit,
            case
                when v_credit
                    then now()
                else null
            end,
            case
                when v_credit
                    then auth.uid()
                else null
            end,
            now()
        ),
        (
            v_club_id,
            'epos_integration',
            v_epos,
            case
                when v_epos
                    then now()
                else null
            end,
            case
                when v_epos
                    then auth.uid()
                else null
            end,
            now()
        )
    on conflict (
        club_id,
        module_key
    )
    do update set
        is_enabled =
            excluded.is_enabled,

        enabled_at =
            case
                when excluded.is_enabled
                    then coalesce(
                        public.club_modules.enabled_at,
                        now()
                    )
                else null
            end,

        enabled_by =
            case
                when excluded.is_enabled
                    then auth.uid()
                else null
            end,

        updated_at =
            now();

    insert into public.platform_audit_log (
        actor_user_id,
        actor_role,
        action,
        club_id,
        details
    )
    values (
        auth.uid(),
        v_actor_role,
        'club_created',
        v_club_id,
        jsonb_build_object(
            'name',
                v_name,
            'slug',
                v_slug,
            'timezone',
                v_timezone,
            'modules',
                jsonb_build_object(
                    'stock_inventory',
                        v_stock,
                    'member_credit',
                        v_credit,
                    'epos_integration',
                        v_epos
                )
        )
    );

    return query
    select
        club.id,
        club.name,
        club.slug,
        club.timezone,
        club.is_active
    from public.clubs as club
    where club.id =
            v_club_id;
end;
$$;

revoke all
on function public.platform_create_club_configured(
    text,
    text,
    text,
    boolean,
    boolean,
    boolean
)
from public, anon;

grant execute
on function public.platform_create_club_configured(
    text,
    text,
    text,
    boolean,
    boolean,
    boolean
)
to authenticated;

-- =========================================================
-- UPDATE CLUB DETAILS + MODULES IN ONE TRANSACTION
-- =========================================================

create or replace function public.platform_update_club_configuration(
    p_club_id uuid,
    p_name text,
    p_timezone text,
    p_stock_inventory boolean,
    p_member_credit boolean,
    p_epos_integration boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor_role text;
    v_name text;
    v_timezone text;

    v_stock boolean;
    v_credit boolean;
    v_epos boolean;

    v_old_name text;
    v_old_timezone text;

    v_old_stock boolean;
    v_old_credit boolean;
    v_old_epos boolean;
begin
    if auth.uid() is null
       or p_club_id is null
       or not public.is_platform_user(
            array[
                'platform_owner',
                'platform_admin'
            ]
       ) then
        raise exception
            'Platform Admin or Owner access required.';
    end if;

    v_name :=
        nullif(
            trim(
                coalesce(
                    p_name,
                    ''
                )
            ),
            ''
        );

    v_timezone :=
        nullif(
            trim(
                coalesce(
                    p_timezone,
                    ''
                )
            ),
            ''
        );

    v_stock :=
        coalesce(
            p_stock_inventory,
            false
        );

    v_credit :=
        coalesce(
            p_member_credit,
            false
        );

    v_epos :=
        coalesce(
            p_epos_integration,
            false
        );

    if v_name is null then
        raise exception
            'Club name is required.';
    end if;

    if v_timezone is null
       or not exists (
            select 1
            from pg_catalog.pg_timezone_names as timezone
            where timezone.name =
                    v_timezone
       ) then
        raise exception
            'Invalid timezone.';
    end if;

    if v_epos
       and not v_stock then
        raise exception
            'EPOS Integration requires Stock Inventory.';
    end if;

    select
        club.name,
        club.timezone
    into
        v_old_name,
        v_old_timezone
    from public.clubs as club
    where club.id =
            p_club_id
    for update;

    if not found then
        raise exception
            'Club not found.';
    end if;

    select
        coalesce(
            max(
                case
                    when module.module_key =
                        'stock_inventory'
                    then module.is_enabled::int
                    else 0
                end
            ),
            0
        ) = 1,

        coalesce(
            max(
                case
                    when module.module_key =
                        'member_credit'
                    then module.is_enabled::int
                    else 0
                end
            ),
            0
        ) = 1,

        coalesce(
            max(
                case
                    when module.module_key =
                        'epos_integration'
                    then module.is_enabled::int
                    else 0
                end
            ),
            0
        ) = 1

    into
        v_old_stock,
        v_old_credit,
        v_old_epos

    from public.club_modules as module
    where module.club_id =
            p_club_id;

    select
        platform_user.role
    into
        v_actor_role
    from public.platform_users as platform_user
    where platform_user.user_id =
            auth.uid()
      and platform_user.is_active
    limit 1;

    update public.clubs
    set
        name =
            v_name,

        timezone =
            v_timezone

    where id =
            p_club_id;

    insert into public.club_modules (
        club_id,
        module_key,
        is_enabled,
        enabled_at,
        enabled_by,
        updated_at
    )
    values
        (
            p_club_id,
            'stock_inventory',
            v_stock,
            case
                when v_stock
                    then now()
                else null
            end,
            case
                when v_stock
                    then auth.uid()
                else null
            end,
            now()
        ),
        (
            p_club_id,
            'member_credit',
            v_credit,
            case
                when v_credit
                    then now()
                else null
            end,
            case
                when v_credit
                    then auth.uid()
                else null
            end,
            now()
        ),
        (
            p_club_id,
            'epos_integration',
            v_epos,
            case
                when v_epos
                    then now()
                else null
            end,
            case
                when v_epos
                    then auth.uid()
                else null
            end,
            now()
        )

    on conflict (
        club_id,
        module_key
    )
    do update set
        is_enabled =
            excluded.is_enabled,

        enabled_at =
            case
                when excluded.is_enabled
                     and not public.club_modules.is_enabled
                    then now()

                when excluded.is_enabled
                    then public.club_modules.enabled_at

                else null
            end,

        enabled_by =
            case
                when excluded.is_enabled
                    then auth.uid()
                else null
            end,

        updated_at =
            now();

    insert into public.platform_audit_log (
        actor_user_id,
        actor_role,
        action,
        club_id,
        details
    )
    values (
        auth.uid(),
        v_actor_role,
        'club_configuration_updated',
        p_club_id,
        jsonb_build_object(
            'previous',
                jsonb_build_object(
                    'name',
                        v_old_name,
                    'timezone',
                        v_old_timezone,
                    'modules',
                        jsonb_build_object(
                            'stock_inventory',
                                coalesce(
                                    v_old_stock,
                                    false
                                ),
                            'member_credit',
                                coalesce(
                                    v_old_credit,
                                    false
                                ),
                            'epos_integration',
                                coalesce(
                                    v_old_epos,
                                    false
                                )
                        )
                ),
            'new',
                jsonb_build_object(
                    'name',
                        v_name,
                    'timezone',
                        v_timezone,
                    'modules',
                        jsonb_build_object(
                            'stock_inventory',
                                v_stock,
                            'member_credit',
                                v_credit,
                            'epos_integration',
                                v_epos
                        )
                )
        )
    );

    return true;
end;
$$;

revoke all
on function public.platform_update_club_configuration(
    uuid,
    text,
    text,
    boolean,
    boolean,
    boolean
)
from public, anon;

grant execute
on function public.platform_update_club_configuration(
    uuid,
    text,
    text,
    boolean,
    boolean,
    boolean
)
to authenticated;

commit;

notify pgrst, 'reload schema';
