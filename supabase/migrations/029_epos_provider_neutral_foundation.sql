-- =========================================================
-- PARYX MIGRATION 029
-- PROVIDER-NEUTRAL EPOS FOUNDATION V1
--
-- Requires Migration 026 (optional modules + Stock Inventory).
--
-- This migration deliberately does NOT connect to a named EPOS provider.
-- It creates the provider-neutral contract that a future adapter will use.
--
-- Adds:
--   - EPOS connection profile (non-secret metadata only)
--   - product mappings
--   - sync-run audit
--   - idempotent external-event inbox
--   - ClubHub RPCs
--   - service-role adapter functions for sales/refunds
--
-- No API keys/passwords are stored in these tables.
-- =========================================================

begin;

-- =========================================================
-- CONNECTION PROFILE
-- =========================================================

create table if not exists public.epos_connections (
    id uuid primary key
        default gen_random_uuid(),

    club_id uuid not null unique
        references public.clubs(id)
        on delete cascade,

    provider_name text,
    adapter_key text
        not null default 'unassigned',

    connection_status text
        not null default 'not_configured',

    merchant_ref text,
    location_ref text,
    api_base_url text,

    sales_sync_enabled boolean
        not null default true,

    refunds_sync_enabled boolean
        not null default true,

    product_sync_enabled boolean
        not null default false,

    secret_configured boolean
        not null default false,

    adapter_version text,

    last_sync_at timestamptz,
    last_error text,

    settings jsonb
        not null default '{}'::jsonb,

    created_by uuid
        references public.profiles(id)
        on delete set null,

    updated_by uuid
        references public.profiles(id)
        on delete set null,

    created_at timestamptz
        not null default now(),

    updated_at timestamptz
        not null default now(),

    constraint epos_connections_status_valid
        check (
            connection_status in (
                'not_configured',
                'awaiting_adapter',
                'configured',
                'connected',
                'error',
                'disabled'
            )
        ),

    constraint epos_connections_settings_object
        check (
            jsonb_typeof(settings) = 'object'
        )
);

alter table public.epos_connections
enable row level security;

-- =========================================================
-- PRODUCT MAPPINGS
-- =========================================================

create table if not exists public.epos_product_mappings (
    id uuid primary key
        default gen_random_uuid(),

    club_id uuid not null
        references public.clubs(id)
        on delete cascade,

    stock_product_id uuid not null
        references public.stock_products(id)
        on delete restrict,

    provider_product_id text not null,
    provider_sku text,

    is_active boolean
        not null default true,

    last_synced_at timestamptz,

    created_by uuid
        references public.profiles(id)
        on delete set null,

    updated_by uuid
        references public.profiles(id)
        on delete set null,

    created_at timestamptz
        not null default now(),

    updated_at timestamptz
        not null default now(),

    constraint epos_mapping_provider_id_not_blank
        check (
            length(
                trim(
                    provider_product_id
                )
            ) > 0
        )
);

create unique index if not exists
epos_product_mapping_stock_unique
on public.epos_product_mappings (
    club_id,
    stock_product_id
)
where is_active;

create unique index if not exists
epos_product_mapping_provider_unique
on public.epos_product_mappings (
    club_id,
    lower(provider_product_id)
)
where is_active;

alter table public.epos_product_mappings
enable row level security;

-- =========================================================
-- SYNC RUN AUDIT
-- =========================================================

create table if not exists public.epos_sync_runs (
    id uuid primary key
        default gen_random_uuid(),

    club_id uuid not null
        references public.clubs(id)
        on delete cascade,

    connection_id uuid
        references public.epos_connections(id)
        on delete set null,

    provider_name text,

    sync_type text not null,
    direction text not null
        default 'inbound',

    status text not null
        default 'running',

    records_received integer
        not null default 0,

    records_applied integer
        not null default 0,

    records_failed integer
        not null default 0,

    message text,
    correlation_id text,

    requested_by uuid
        references public.profiles(id)
        on delete set null,

    started_at timestamptz
        not null default now(),

    completed_at timestamptz,

    constraint epos_sync_type_valid
        check (
            sync_type in (
                'products',
                'sales',
                'refunds',
                'full'
            )
        ),

    constraint epos_sync_direction_valid
        check (
            direction in (
                'inbound',
                'outbound',
                'bidirectional'
            )
        ),

    constraint epos_sync_status_valid
        check (
            status in (
                'running',
                'succeeded',
                'partial',
                'failed'
            )
        ),

    constraint epos_sync_counts_nonnegative
        check (
            records_received >= 0
            and records_applied >= 0
            and records_failed >= 0
        )
);

create index if not exists
epos_sync_runs_club_started_idx
on public.epos_sync_runs (
    club_id,
    started_at desc
);

alter table public.epos_sync_runs
enable row level security;

-- =========================================================
-- IDEMPOTENT PROVIDER EVENT INBOX
-- =========================================================

create table if not exists public.epos_external_events (
    id uuid primary key
        default gen_random_uuid(),

    club_id uuid not null
        references public.clubs(id)
        on delete cascade,

    external_event_id text not null,
    provider_product_id text not null,

    event_type text not null,
    quantity integer not null,

    transaction_ref text,
    occurred_at timestamptz,

    processing_status text
        not null default 'received',

    error_message text,

    raw_payload jsonb
        not null default '{}'::jsonb,

    applied_movement_id uuid
        references public.stock_movements(id)
        on delete set null,

    received_at timestamptz
        not null default now(),

    processed_at timestamptz,

    constraint epos_external_event_id_not_blank
        check (
            length(
                trim(
                    external_event_id
                )
            ) > 0
        ),

    constraint epos_external_product_not_blank
        check (
            length(
                trim(
                    provider_product_id
                )
            ) > 0
        ),

    constraint epos_external_event_type_valid
        check (
            event_type in (
                'sale',
                'refund'
            )
        ),

    constraint epos_external_event_quantity_positive
        check (
            quantity > 0
        ),

    constraint epos_external_event_status_valid
        check (
            processing_status in (
                'received',
                'applied',
                'failed',
                'duplicate'
            )
        ),

    constraint epos_external_payload_object
        check (
            jsonb_typeof(raw_payload) = 'object'
        )
);

create unique index if not exists
epos_external_events_idempotency_unique
on public.epos_external_events (
    club_id,
    external_event_id
);

create index if not exists
epos_external_events_club_received_idx
on public.epos_external_events (
    club_id,
    received_at desc
);

alter table public.epos_external_events
enable row level security;

-- =========================================================
-- ACCESS HELPERS
-- =========================================================

create or replace function public.user_can_view_epos(
    p_club_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select
        public.club_module_enabled(
            p_club_id,
            'epos_integration'
        )
        and exists (
            select 1
            from public.club_memberships as membership
            where membership.profile_id =
                    auth.uid()
              and membership.club_id =
                    p_club_id
              and membership.status =
                    'active'
              and membership.role in (
                    'professional',
                    'manager',
                    'club_admin'
              )
        );
$$;

revoke all
on function public.user_can_view_epos(uuid)
from public, anon;

grant execute
on function public.user_can_view_epos(uuid)
to authenticated;

create or replace function public.user_can_configure_epos(
    p_club_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select
        public.club_module_enabled(
            p_club_id,
            'epos_integration'
        )
        and exists (
            select 1
            from public.club_memberships as membership
            where membership.profile_id =
                    auth.uid()
              and membership.club_id =
                    p_club_id
              and membership.status =
                    'active'
              and membership.role in (
                    'manager',
                    'club_admin'
              )
        );
$$;

revoke all
on function public.user_can_configure_epos(uuid)
from public, anon;

grant execute
on function public.user_can_configure_epos(uuid)
to authenticated;

create or replace function public.user_can_map_epos_products(
    p_club_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select
        public.club_module_enabled(
            p_club_id,
            'epos_integration'
        )
        and exists (
            select 1
            from public.club_memberships as membership
            where membership.profile_id =
                    auth.uid()
              and membership.club_id =
                    p_club_id
              and membership.status =
                    'active'
              and membership.role in (
                    'professional',
                    'manager',
                    'club_admin'
              )
        );
$$;

revoke all
on function public.user_can_map_epos_products(uuid)
from public, anon;

grant execute
on function public.user_can_map_epos_products(uuid)
to authenticated;

-- =========================================================
-- STATUS RPC
-- =========================================================

create or replace function public.epos_get_status(
    p_club_id uuid
)
returns table (
    connection_id uuid,
    provider_name text,
    adapter_key text,
    connection_status text,
    merchant_ref text,
    location_ref text,
    api_base_url text,
    sales_sync_enabled boolean,
    refunds_sync_enabled boolean,
    product_sync_enabled boolean,
    secret_configured boolean,
    adapter_version text,
    mapped_product_count bigint,
    unmapped_product_count bigint,
    last_sync_at timestamptz,
    last_sync_status text,
    last_error text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null
       or not public.user_can_view_epos(
            p_club_id
       ) then
        raise exception
            'EPOS integration access required.';
    end if;

    return query
    select
        connection.id,
        connection.provider_name,
        connection.adapter_key,
        coalesce(
            connection.connection_status,
            'not_configured'
        ),
        connection.merchant_ref,
        connection.location_ref,
        connection.api_base_url,
        coalesce(
            connection.sales_sync_enabled,
            true
        ),
        coalesce(
            connection.refunds_sync_enabled,
            true
        ),
        coalesce(
            connection.product_sync_enabled,
            false
        ),
        coalesce(
            connection.secret_configured,
            false
        ),
        connection.adapter_version,

        (
            select count(*)
            from public.epos_product_mappings as mapping
            join public.stock_products as product
                on product.id =
                    mapping.stock_product_id
            where mapping.club_id =
                    p_club_id
              and mapping.is_active
              and product.removed_at is null
        )::bigint,

        (
            select count(*)
            from public.stock_products as product
            where product.club_id =
                    p_club_id
              and product.is_active
              and product.removed_at is null
              and not exists (
                    select 1
                    from public.epos_product_mappings as mapping
                    where mapping.club_id =
                            p_club_id
                      and mapping.stock_product_id =
                            product.id
                      and mapping.is_active
              )
        )::bigint,

        (
            select run.started_at
            from public.epos_sync_runs as run
            where run.club_id =
                    p_club_id
              and run.status in (
                    'succeeded',
                    'partial',
                    'failed'
              )
            order by
                run.started_at desc
            limit 1
        ),

        (
            select run.status
            from public.epos_sync_runs as run
            where run.club_id =
                    p_club_id
              and run.status in (
                    'succeeded',
                    'partial',
                    'failed'
              )
            order by
                run.started_at desc
            limit 1
        ),

        connection.last_error

    from (
        select *
        from public.epos_connections as existing
        where existing.club_id =
                p_club_id

        union all

        select
            null::uuid as id,
            p_club_id as club_id,
            null::text as provider_name,
            'unassigned'::text as adapter_key,
            'not_configured'::text as connection_status,
            null::text as merchant_ref,
            null::text as location_ref,
            null::text as api_base_url,
            true::boolean as sales_sync_enabled,
            true::boolean as refunds_sync_enabled,
            false::boolean as product_sync_enabled,
            false::boolean as secret_configured,
            null::text as adapter_version,
            null::timestamptz as last_sync_at,
            null::text as last_error,
            '{}'::jsonb as settings,
            null::uuid as created_by,
            null::uuid as updated_by,
            now() as created_at,
            now() as updated_at
        where not exists (
            select 1
            from public.epos_connections as existing
            where existing.club_id =
                    p_club_id
        )
    ) as connection

    limit 1;
end;
$$;

revoke all
on function public.epos_get_status(uuid)
from public, anon;

grant execute
on function public.epos_get_status(uuid)
to authenticated;

-- =========================================================
-- SAVE NON-SECRET CONNECTION PROFILE
-- =========================================================

create or replace function public.epos_save_connection(
    p_club_id uuid,
    p_provider_name text,
    p_merchant_ref text default null,
    p_location_ref text default null,
    p_api_base_url text default null,
    p_sales_sync_enabled boolean default true,
    p_refunds_sync_enabled boolean default true,
    p_product_sync_enabled boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_provider_name text;
    v_connection_id uuid;
begin
    if auth.uid() is null
       or not public.user_can_configure_epos(
            p_club_id
       ) then
        raise exception
            'EPOS configuration access required.';
    end if;

    v_provider_name :=
        nullif(
            trim(
                coalesce(
                    p_provider_name,
                    ''
                )
            ),
            ''
        );

    insert into public.epos_connections (
        club_id,
        provider_name,
        adapter_key,
        connection_status,
        merchant_ref,
        location_ref,
        api_base_url,
        sales_sync_enabled,
        refunds_sync_enabled,
        product_sync_enabled,
        created_by,
        updated_by,
        updated_at
    )
    values (
        p_club_id,
        v_provider_name,
        'unassigned',
        case
            when v_provider_name is null
                then 'not_configured'
            else 'awaiting_adapter'
        end,
        nullif(
            trim(
                coalesce(
                    p_merchant_ref,
                    ''
                )
            ),
            ''
        ),
        nullif(
            trim(
                coalesce(
                    p_location_ref,
                    ''
                )
            ),
            ''
        ),
        nullif(
            trim(
                coalesce(
                    p_api_base_url,
                    ''
                )
            ),
            ''
        ),
        coalesce(
            p_sales_sync_enabled,
            true
        ),
        coalesce(
            p_refunds_sync_enabled,
            true
        ),
        coalesce(
            p_product_sync_enabled,
            false
        ),
        auth.uid(),
        auth.uid(),
        now()
    )
    on conflict (
        club_id
    )
    do update set
        provider_name =
            excluded.provider_name,

        connection_status =
            case
                when excluded.provider_name is null
                    then 'not_configured'
                when public.epos_connections.adapter_key = 'unassigned'
                    then 'awaiting_adapter'
                else public.epos_connections.connection_status
            end,

        merchant_ref =
            excluded.merchant_ref,

        location_ref =
            excluded.location_ref,

        api_base_url =
            excluded.api_base_url,

        sales_sync_enabled =
            excluded.sales_sync_enabled,

        refunds_sync_enabled =
            excluded.refunds_sync_enabled,

        product_sync_enabled =
            excluded.product_sync_enabled,

        updated_by =
            auth.uid(),

        updated_at =
            now()

    returning id
    into v_connection_id;

    return v_connection_id;
end;
$$;

revoke all
on function public.epos_save_connection(
    uuid,
    text,
    text,
    text,
    text,
    boolean,
    boolean,
    boolean
)
from public, anon;

grant execute
on function public.epos_save_connection(
    uuid,
    text,
    text,
    text,
    text,
    boolean,
    boolean,
    boolean
)
to authenticated;

-- =========================================================
-- PRODUCT MAPPING SEARCH
-- Database-style: requires a nonblank search term.
-- =========================================================

create or replace function public.epos_list_product_mappings(
    p_club_id uuid,
    p_search text
)
returns table (
    stock_product_id uuid,
    stock_sku text,
    barcode text,
    product_name text,
    category text,
    mapping_id uuid,
    provider_product_id text,
    provider_sku text,
    mapping_active boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_search text;
begin
    if auth.uid() is null
       or not public.user_can_view_epos(
            p_club_id
       ) then
        raise exception
            'EPOS integration access required.';
    end if;

    v_search :=
        nullif(
            lower(
                trim(
                    coalesce(
                        p_search,
                        ''
                    )
                )
            ),
            ''
        );

    if v_search is null then
        return;
    end if;

    return query
    select
        product.id,
        product.sku,
        product.barcode,
        product.name,
        product.category,
        mapping.id,
        mapping.provider_product_id,
        mapping.provider_sku,
        coalesce(
            mapping.is_active,
            false
        )

    from public.stock_products as product

    left join public.epos_product_mappings as mapping
        on mapping.club_id =
            p_club_id
       and mapping.stock_product_id =
            product.id
       and mapping.is_active

    where product.club_id =
            p_club_id
      and product.removed_at is null
      and (
          lower(
              product.name
          ) like
              '%' || v_search || '%'
          or lower(
              product.sku
          ) like
              '%' || v_search || '%'
          or lower(
              coalesce(
                  product.barcode,
                  ''
              )
          ) like
              '%' || v_search || '%'
          or lower(
              coalesce(
                  product.category,
                  ''
              )
          ) like
              '%' || v_search || '%'
      )

    order by
        product.is_active desc,
        lower(
            product.name
        )

    limit 100;
end;
$$;

revoke all
on function public.epos_list_product_mappings(uuid, text)
from public, anon;

grant execute
on function public.epos_list_product_mappings(uuid, text)
to authenticated;

-- =========================================================
-- SAVE / DELETE PRODUCT MAPPING
-- =========================================================

create or replace function public.epos_save_product_mapping(
    p_club_id uuid,
    p_stock_product_id uuid,
    p_provider_product_id text,
    p_provider_sku text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_provider_product_id text;
    v_mapping_id uuid;
begin
    if auth.uid() is null
       or not public.user_can_map_epos_products(
            p_club_id
       ) then
        raise exception
            'EPOS product mapping access required.';
    end if;

    if not exists (
        select 1
        from public.stock_products as product
        where product.id =
                p_stock_product_id
          and product.club_id =
                p_club_id
          and product.removed_at is null
    ) then
        raise exception
            'Stock product not found for selected club.';
    end if;

    v_provider_product_id :=
        trim(
            coalesce(
                p_provider_product_id,
                ''
            )
        );

    if v_provider_product_id = '' then
        raise exception
            'EPOS product ID is required.';
    end if;

    update public.epos_product_mappings
    set
        is_active =
            false,

        updated_by =
            auth.uid(),

        updated_at =
            now()

    where club_id =
            p_club_id
      and stock_product_id =
            p_stock_product_id
      and is_active;

    insert into public.epos_product_mappings (
        club_id,
        stock_product_id,
        provider_product_id,
        provider_sku,
        is_active,
        created_by,
        updated_by
    )
    values (
        p_club_id,
        p_stock_product_id,
        v_provider_product_id,
        nullif(
            trim(
                coalesce(
                    p_provider_sku,
                    ''
                )
            ),
            ''
        ),
        true,
        auth.uid(),
        auth.uid()
    )
    returning id
    into v_mapping_id;

    return v_mapping_id;
end;
$$;

revoke all
on function public.epos_save_product_mapping(
    uuid,
    uuid,
    text,
    text
)
from public, anon;

grant execute
on function public.epos_save_product_mapping(
    uuid,
    uuid,
    text,
    text
)
to authenticated;

create or replace function public.epos_delete_product_mapping(
    p_club_id uuid,
    p_stock_product_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_count integer;
begin
    if auth.uid() is null
       or not public.user_can_map_epos_products(
            p_club_id
       ) then
        raise exception
            'EPOS product mapping access required.';
    end if;

    update public.epos_product_mappings
    set
        is_active =
            false,

        updated_by =
            auth.uid(),

        updated_at =
            now()

    where club_id =
            p_club_id
      and stock_product_id =
            p_stock_product_id
      and is_active;

    get diagnostics
        v_count = row_count;

    return v_count > 0;
end;
$$;

revoke all
on function public.epos_delete_product_mapping(uuid, uuid)
from public, anon;

grant execute
on function public.epos_delete_product_mapping(uuid, uuid)
to authenticated;

-- =========================================================
-- SYNC HISTORY
-- =========================================================

create or replace function public.epos_get_sync_runs(
    p_club_id uuid,
    p_limit integer default 50
)
returns table (
    sync_run_id uuid,
    provider_name text,
    sync_type text,
    direction text,
    status text,
    records_received integer,
    records_applied integer,
    records_failed integer,
    message text,
    started_at timestamptz,
    completed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null
       or not public.user_can_view_epos(
            p_club_id
       ) then
        raise exception
            'EPOS integration access required.';
    end if;

    return query
    select
        run.id,
        run.provider_name,
        run.sync_type,
        run.direction,
        run.status,
        run.records_received,
        run.records_applied,
        run.records_failed,
        run.message,
        run.started_at,
        run.completed_at

    from public.epos_sync_runs as run

    where run.club_id =
            p_club_id

    order by
        run.started_at desc

    limit greatest(
        1,
        least(
            coalesce(
                p_limit,
                50
            ),
            200
        )
    );
end;
$$;

revoke all
on function public.epos_get_sync_runs(uuid, integer)
from public, anon;

grant execute
on function public.epos_get_sync_runs(uuid, integer)
to authenticated;

-- =========================================================
-- SERVICE-ROLE ADAPTER CONTRACT
--
-- These functions are NOT granted to authenticated ClubHub users.
-- A future provider Edge Function / adapter will call them using
-- the Supabase service role after validating the provider webhook/API.
-- =========================================================

create or replace function public.epos_adapter_set_connection_state(
    p_club_id uuid,
    p_adapter_key text,
    p_connection_status text,
    p_secret_configured boolean default null,
    p_adapter_version text default null,
    p_last_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_status text;
begin
    v_status :=
        lower(
            trim(
                coalesce(
                    p_connection_status,
                    ''
                )
            )
        );

    if v_status not in (
        'configured',
        'connected',
        'error',
        'disabled'
    ) then
        raise exception
            'Unsupported adapter connection status.';
    end if;

    insert into public.epos_connections (
        club_id,
        adapter_key,
        connection_status,
        secret_configured,
        adapter_version,
        last_error,
        updated_at
    )
    values (
        p_club_id,
        trim(
            coalesce(
                p_adapter_key,
                'unassigned'
            )
        ),
        v_status,
        coalesce(
            p_secret_configured,
            false
        ),
        p_adapter_version,
        p_last_error,
        now()
    )
    on conflict (
        club_id
    )
    do update set
        adapter_key =
            excluded.adapter_key,

        connection_status =
            excluded.connection_status,

        secret_configured =
            coalesce(
                p_secret_configured,
                public.epos_connections.secret_configured
            ),

        adapter_version =
            coalesce(
                p_adapter_version,
                public.epos_connections.adapter_version
            ),

        last_error =
            p_last_error,

        updated_at =
            now();

    return true;
end;
$$;

revoke all
on function public.epos_adapter_set_connection_state(
    uuid,
    text,
    text,
    boolean,
    text,
    text
)
from public, anon, authenticated;

grant execute
on function public.epos_adapter_set_connection_state(
    uuid,
    text,
    text,
    boolean,
    text,
    text
)
to service_role;

create or replace function public.epos_adapter_start_sync(
    p_club_id uuid,
    p_sync_type text,
    p_direction text default 'inbound',
    p_correlation_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_connection public.epos_connections%rowtype;
    v_run_id uuid;
begin
    select *
    into v_connection
    from public.epos_connections as connection
    where connection.club_id =
            p_club_id
    limit 1;

    if v_connection.id is null then
        raise exception
            'EPOS connection is not configured.';
    end if;

    insert into public.epos_sync_runs (
        club_id,
        connection_id,
        provider_name,
        sync_type,
        direction,
        status,
        correlation_id
    )
    values (
        p_club_id,
        v_connection.id,
        v_connection.provider_name,
        lower(
            trim(
                p_sync_type
            )
        ),
        lower(
            trim(
                coalesce(
                    p_direction,
                    'inbound'
                )
            )
        ),
        'running',
        p_correlation_id
    )
    returning id
    into v_run_id;

    return v_run_id;
end;
$$;

revoke all
on function public.epos_adapter_start_sync(
    uuid,
    text,
    text,
    text
)
from public, anon, authenticated;

grant execute
on function public.epos_adapter_start_sync(
    uuid,
    text,
    text,
    text
)
to service_role;

create or replace function public.epos_adapter_finish_sync(
    p_sync_run_id uuid,
    p_status text,
    p_records_received integer default 0,
    p_records_applied integer default 0,
    p_records_failed integer default 0,
    p_message text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_club_id uuid;
    v_status text;
begin
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
        'succeeded',
        'partial',
        'failed'
    ) then
        raise exception
            'Unsupported final sync status.';
    end if;

    update public.epos_sync_runs
    set
        status =
            v_status,

        records_received =
            greatest(
                coalesce(
                    p_records_received,
                    0
                ),
                0
            ),

        records_applied =
            greatest(
                coalesce(
                    p_records_applied,
                    0
                ),
                0
            ),

        records_failed =
            greatest(
                coalesce(
                    p_records_failed,
                    0
                ),
                0
            ),

        message =
            p_message,

        completed_at =
            now()

    where id =
            p_sync_run_id

    returning club_id
    into v_club_id;

    if v_club_id is null then
        raise exception
            'EPOS sync run not found.';
    end if;

    update public.epos_connections
    set
        last_sync_at =
            now(),

        last_error =
            case
                when v_status = 'failed'
                    then coalesce(
                        p_message,
                        'EPOS sync failed.'
                    )
                when v_status = 'partial'
                    then p_message
                else null
            end,

        updated_at =
            now()

    where club_id =
            v_club_id;

    return true;
end;
$$;

revoke all
on function public.epos_adapter_finish_sync(
    uuid,
    text,
    integer,
    integer,
    integer,
    text
)
from public, anon, authenticated;

grant execute
on function public.epos_adapter_finish_sync(
    uuid,
    text,
    integer,
    integer,
    integer,
    text
)
to service_role;

create or replace function public.epos_adapter_ingest_stock_event(
    p_club_id uuid,
    p_external_event_id text,
    p_provider_product_id text,
    p_event_type text,
    p_quantity integer,
    p_transaction_ref text default null,
    p_occurred_at timestamptz default null,
    p_raw_payload jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_event_id uuid;
    v_mapping public.epos_product_mappings%rowtype;
    v_product public.stock_products%rowtype;
    v_event_type text;
    v_delta integer;
    v_after integer;
    v_movement_id uuid;
begin
    if p_quantity is null
       or p_quantity <= 0 then
        raise exception
            'EPOS event quantity must be positive.';
    end if;

    v_event_type :=
        lower(
            trim(
                coalesce(
                    p_event_type,
                    ''
                )
            )
        );

    if v_event_type not in (
        'sale',
        'refund'
    ) then
        raise exception
            'Unsupported EPOS stock event.';
    end if;

    if exists (
        select 1
        from public.epos_external_events as event
        where event.club_id =
                p_club_id
          and event.external_event_id =
                p_external_event_id
    ) then
        return false;
    end if;

    insert into public.epos_external_events (
        club_id,
        external_event_id,
        provider_product_id,
        event_type,
        quantity,
        transaction_ref,
        occurred_at,
        raw_payload
    )
    values (
        p_club_id,
        trim(
            p_external_event_id
        ),
        trim(
            p_provider_product_id
        ),
        v_event_type,
        p_quantity,
        p_transaction_ref,
        p_occurred_at,
        coalesce(
            p_raw_payload,
            '{}'::jsonb
        )
    )
    returning id
    into v_event_id;

    select *
    into v_mapping
    from public.epos_product_mappings as mapping
    where mapping.club_id =
            p_club_id
      and lower(
            mapping.provider_product_id
          ) =
            lower(
                trim(
                    p_provider_product_id
                )
            )
      and mapping.is_active
    limit 1;

    if v_mapping.id is null then
        update public.epos_external_events
        set
            processing_status =
                'failed',

            error_message =
                'No active Paryx stock mapping exists for this EPOS product.',

            processed_at =
                now()

        where id =
                v_event_id;

        return false;
    end if;

    select *
    into v_product
    from public.stock_products as product
    where product.id =
            v_mapping.stock_product_id
      and product.club_id =
            p_club_id
      and product.removed_at is null
    for update;

    if v_product.id is null then
        update public.epos_external_events
        set
            processing_status =
                'failed',

            error_message =
                'Mapped Paryx stock product is unavailable.',

            processed_at =
                now()

        where id =
                v_event_id;

        return false;
    end if;

    v_delta :=
        case
            when v_event_type = 'sale'
                then -p_quantity
            else p_quantity
        end;

    v_after :=
        v_product.quantity_on_hand +
        v_delta;

    if v_after < 0 then
        update public.epos_external_events
        set
            processing_status =
                'failed',

            error_message =
                'EPOS sale exceeds Paryx quantity on hand.',

            processed_at =
                now()

        where id =
                v_event_id;

        return false;
    end if;

    update public.stock_products
    set
        quantity_on_hand =
            v_after,

        updated_at =
            now()

    where id =
            v_product.id;

    insert into public.stock_movements (
        club_id,
        product_id,
        movement_type,
        quantity_delta,
        quantity_before,
        quantity_after,
        unit_cost,
        reference,
        note,
        source
    )
    values (
        p_club_id,
        v_product.id,
        case
            when v_event_type = 'sale'
                then 'epos_sale'
            else 'epos_refund'
        end,
        v_delta,
        v_product.quantity_on_hand,
        v_after,
        v_product.cost_price,
        coalesce(
            p_transaction_ref,
            p_external_event_id
        ),
        'Imported through Paryx EPOS adapter',
        'epos'
    )
    returning id
    into v_movement_id;

    update public.epos_external_events
    set
        processing_status =
            'applied',

        applied_movement_id =
            v_movement_id,

        processed_at =
            now()

    where id =
            v_event_id;

    update public.epos_product_mappings
    set
        last_synced_at =
            now(),

        updated_at =
            now()

    where id =
            v_mapping.id;

    return true;
end;
$$;

revoke all
on function public.epos_adapter_ingest_stock_event(
    uuid,
    text,
    text,
    text,
    integer,
    text,
    timestamptz,
    jsonb
)
from public, anon, authenticated;

grant execute
on function public.epos_adapter_ingest_stock_event(
    uuid,
    text,
    text,
    text,
    integer,
    text,
    timestamptz,
    jsonb
)
to service_role;

commit;

notify pgrst, 'reload schema';
