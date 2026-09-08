-- =========================================================
-- PARYX MIGRATION 026
-- OPTIONAL MODULE FRAMEWORK + STOCK INVENTORY V1
-- =========================================================

begin;

-- =========================================================
-- OPTIONAL CLUB MODULES
-- =========================================================

create table if not exists public.club_modules (
    club_id uuid not null
        references public.clubs(id)
        on delete cascade,
    module_key text not null,
    is_enabled boolean not null default false,
    settings jsonb not null default '{}'::jsonb,
    enabled_at timestamptz,
    enabled_by uuid
        references public.profiles(id)
        on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (club_id, module_key),
    constraint club_modules_key_valid
        check (module_key in ('member_credit','stock_inventory','epos_integration')),
    constraint club_modules_settings_object
        check (jsonb_typeof(settings) = 'object')
);

alter table public.club_modules enable row level security;

insert into public.club_modules (club_id, module_key)
select c.id, m.module_key
from public.clubs as c
cross join (
    values ('member_credit'),('stock_inventory'),('epos_integration')
) as m(module_key)
on conflict (club_id, module_key) do nothing;

create or replace function public.handle_new_club_modules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.club_modules (club_id, module_key)
    values
        (new.id, 'member_credit'),
        (new.id, 'stock_inventory'),
        (new.id, 'epos_integration')
    on conflict (club_id, module_key) do nothing;
    return new;
end;
$$;

drop trigger if exists on_club_created_modules on public.clubs;
create trigger on_club_created_modules
after insert on public.clubs
for each row execute function public.handle_new_club_modules();

create or replace function public.club_module_enabled(
    p_club_id uuid,
    p_module_key text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce(
        (
            select cm.is_enabled
            from public.club_modules as cm
            where cm.club_id = p_club_id
              and cm.module_key = lower(trim(coalesce(p_module_key, '')))
            limit 1
        ),
        false
    );
$$;

revoke all on function public.club_module_enabled(uuid,text) from public, anon;
grant execute on function public.club_module_enabled(uuid,text) to authenticated;

create or replace function public.get_my_club_modules(
    p_club_id uuid
)
returns table (
    module_key text,
    is_enabled boolean,
    settings jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null
       or p_club_id is null
       or not exists (
            select 1
            from public.club_memberships as membership
            where membership.profile_id = auth.uid()
              and membership.club_id = p_club_id
              and membership.status = 'active'
              and membership.role in (
                    'starter','reception','professional','greenkeeper','manager','club_admin'
              )
       ) then
        raise exception 'Club staff access required.';
    end if;

    return query
    select module.module_key, module.is_enabled, module.settings
    from public.club_modules as module
    where module.club_id = p_club_id
    order by module.module_key;
end;
$$;

revoke all on function public.get_my_club_modules(uuid) from public, anon;
grant execute on function public.get_my_club_modules(uuid) to authenticated;

create or replace function public.platform_set_club_module(
    p_club_id uuid,
    p_module_key text,
    p_enabled boolean,
    p_settings jsonb default null
)
returns table (
    club_id uuid,
    module_key text,
    is_enabled boolean,
    settings jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_module_key text;
begin
    if auth.uid() is null
       or not public.is_platform_user(array['platform_owner','platform_admin']) then
        raise exception 'Paryx platform admin access required.';
    end if;

    if not exists (select 1 from public.clubs as club where club.id = p_club_id) then
        raise exception 'Club not found.';
    end if;

    v_module_key := lower(trim(coalesce(p_module_key, '')));
    if v_module_key not in ('member_credit','stock_inventory','epos_integration') then
        raise exception 'Unsupported club module.';
    end if;

    if p_settings is not null and jsonb_typeof(p_settings) <> 'object' then
        raise exception 'Module settings must be a JSON object.';
    end if;

    insert into public.club_modules (
        club_id,module_key,is_enabled,settings,enabled_at,enabled_by,updated_at
    )
    values (
        p_club_id,
        v_module_key,
        coalesce(p_enabled,false),
        coalesce(p_settings,'{}'::jsonb),
        case when coalesce(p_enabled,false) then now() else null end,
        case when coalesce(p_enabled,false) then auth.uid() else null end,
        now()
    )
    on conflict on constraint club_modules_pkey
    do update set
        is_enabled = excluded.is_enabled,
        settings = case
            when p_settings is null then public.club_modules.settings
            else excluded.settings
        end,
        enabled_at = case
            when excluded.is_enabled and not public.club_modules.is_enabled then now()
            when excluded.is_enabled then public.club_modules.enabled_at
            else null
        end,
        enabled_by = case when excluded.is_enabled then auth.uid() else null end,
        updated_at = now();

    return query
    select m.club_id,m.module_key,m.is_enabled,m.settings
    from public.club_modules as m
    where m.club_id = p_club_id and m.module_key = v_module_key;
end;
$$;

revoke all on function public.platform_set_club_module(uuid,text,boolean,jsonb) from public, anon;
grant execute on function public.platform_set_club_module(uuid,text,boolean,jsonb) to authenticated;

-- =========================================================
-- STOCK PRODUCTS
-- =========================================================

create table if not exists public.stock_products (
    id uuid primary key default gen_random_uuid(),
    club_id uuid not null references public.clubs(id) on delete cascade,
    sku text not null,
    barcode text,
    name text not null,
    description text,
    category text,
    supplier text,
    cost_price numeric(12,2) not null default 0,
    sale_price numeric(12,2) not null default 0,
    vat_rate numeric(5,2) not null default 20,
    quantity_on_hand integer not null default 0,
    reorder_level integer not null default 0,
    track_stock boolean not null default true,
    is_active boolean not null default true,
    external_ref text,
    created_by uuid references public.profiles(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint stock_products_sku_not_blank check (length(trim(sku)) > 0),
    constraint stock_products_name_not_blank check (length(trim(name)) > 0),
    constraint stock_products_cost_nonnegative check (cost_price >= 0),
    constraint stock_products_sale_nonnegative check (sale_price >= 0),
    constraint stock_products_vat_valid check (vat_rate between 0 and 100),
    constraint stock_products_quantity_nonnegative check (quantity_on_hand >= 0),
    constraint stock_products_reorder_nonnegative check (reorder_level >= 0)
);

create unique index if not exists stock_products_club_sku_unique
on public.stock_products (club_id, lower(sku));

create unique index if not exists stock_products_club_barcode_unique
on public.stock_products (club_id, lower(barcode))
where barcode is not null and length(trim(barcode)) > 0;

create index if not exists stock_products_club_active_idx
on public.stock_products (club_id,is_active,name);

alter table public.stock_products enable row level security;

-- =========================================================
-- STOCK MOVEMENT LEDGER
-- =========================================================

create table if not exists public.stock_movements (
    id uuid primary key default gen_random_uuid(),
    club_id uuid not null references public.clubs(id) on delete cascade,
    product_id uuid not null references public.stock_products(id) on delete restrict,
    movement_type text not null,
    quantity_delta integer not null,
    quantity_before integer not null,
    quantity_after integer not null,
    unit_cost numeric(12,2),
    reference text,
    note text,
    source text not null default 'manual',
    created_by uuid references public.profiles(id) on delete set null,
    created_at timestamptz not null default now(),
    constraint stock_movements_type_valid check (
        movement_type in (
            'opening','receipt','sale','adjustment_in','adjustment_out','return',
            'stocktake','epos_sale','epos_refund'
        )
    ),
    constraint stock_movements_delta_nonzero check (quantity_delta <> 0),
    constraint stock_movements_quantities_nonnegative check (
        quantity_before >= 0 and quantity_after >= 0
    ),
    constraint stock_movements_unit_cost_nonnegative check (
        unit_cost is null or unit_cost >= 0
    ),
    constraint stock_movements_source_valid check (
        source in ('manual','epos','import','system')
    )
);

create index if not exists stock_movements_club_created_idx
on public.stock_movements (club_id,created_at desc);
create index if not exists stock_movements_product_created_idx
on public.stock_movements (product_id,created_at desc);

alter table public.stock_movements enable row level security;

-- =========================================================
-- STOCK ACCESS HELPERS
-- =========================================================

create or replace function public.user_can_view_stock(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select public.club_module_enabled(p_club_id,'stock_inventory')
       and exists (
            select 1
            from public.club_memberships as membership
            where membership.profile_id = auth.uid()
              and membership.club_id = p_club_id
              and membership.status = 'active'
              and membership.role in ('reception','professional','manager','club_admin')
       );
$$;

revoke all on function public.user_can_view_stock(uuid) from public, anon;
grant execute on function public.user_can_view_stock(uuid) to authenticated;

create or replace function public.user_can_manage_stock(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select public.club_module_enabled(p_club_id,'stock_inventory')
       and exists (
            select 1
            from public.club_memberships as membership
            where membership.profile_id = auth.uid()
              and membership.club_id = p_club_id
              and membership.status = 'active'
              and membership.role in ('professional','manager','club_admin')
       );
$$;

revoke all on function public.user_can_manage_stock(uuid) from public, anon;
grant execute on function public.user_can_manage_stock(uuid) to authenticated;

-- =========================================================
-- STOCK SUMMARY
-- =========================================================

create or replace function public.stock_get_summary(p_club_id uuid)
returns table (
    total_product_count bigint,
    active_product_count bigint,
    low_stock_count bigint,
    out_of_stock_count bigint,
    stock_cost_value numeric,
    stock_retail_value numeric,
    currency_code text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null or not public.user_can_view_stock(p_club_id) then
        raise exception 'Stock inventory access required.';
    end if;

    return query
    select
        count(*)::bigint,
        count(*) filter (where product.is_active)::bigint,
        count(*) filter (
            where product.is_active and product.track_stock
              and product.quantity_on_hand > 0
              and product.quantity_on_hand <= product.reorder_level
        )::bigint,
        count(*) filter (
            where product.is_active and product.track_stock
              and product.quantity_on_hand = 0
        )::bigint,
        coalesce(sum(product.quantity_on_hand * product.cost_price)
            filter (where product.is_active and product.track_stock),0)::numeric,
        coalesce(sum(product.quantity_on_hand * product.sale_price)
            filter (where product.is_active and product.track_stock),0)::numeric,
        coalesce(
            (
                select settings.currency_code
                from public.club_settings as settings
                where settings.club_id = p_club_id
                limit 1
            ),
            'GBP'
        )::text
    from public.stock_products as product
    where product.club_id = p_club_id;
end;
$$;

revoke all on function public.stock_get_summary(uuid) from public, anon;
grant execute on function public.stock_get_summary(uuid) to authenticated;

-- =========================================================
-- STOCK PRODUCT DIRECTORY
-- =========================================================

create or replace function public.stock_list_products(
    p_club_id uuid,
    p_search text default null,
    p_filter text default 'all'
)
returns table (
    product_id uuid,
    sku text,
    barcode text,
    product_name text,
    description text,
    category text,
    supplier text,
    cost_price numeric,
    sale_price numeric,
    vat_rate numeric,
    quantity_on_hand integer,
    reorder_level integer,
    track_stock boolean,
    is_active boolean,
    external_ref text,
    updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_search text;
    v_filter text;
begin
    if auth.uid() is null or not public.user_can_view_stock(p_club_id) then
        raise exception 'Stock inventory access required.';
    end if;

    v_search := nullif(lower(trim(coalesce(p_search,''))), '');
    v_filter := lower(trim(coalesce(p_filter,'all')));
    if v_filter not in ('all','low','out','inactive') then v_filter := 'all'; end if;

    return query
    select
        product.id,product.sku,product.barcode,product.name,product.description,
        product.category,product.supplier,product.cost_price,product.sale_price,
        product.vat_rate,product.quantity_on_hand,product.reorder_level,
        product.track_stock,product.is_active,product.external_ref,product.updated_at
    from public.stock_products as product
    where product.club_id = p_club_id
      and (
          v_search is null
          or lower(product.name) like '%' || v_search || '%'
          or lower(product.sku) like '%' || v_search || '%'
          or lower(coalesce(product.barcode,'')) like '%' || v_search || '%'
          or lower(coalesce(product.category,'')) like '%' || v_search || '%'
          or lower(coalesce(product.supplier,'')) like '%' || v_search || '%'
      )
      and (
          v_filter = 'all'
          or (v_filter = 'inactive' and not product.is_active)
          or (v_filter = 'out' and product.is_active and product.track_stock and product.quantity_on_hand = 0)
          or (v_filter = 'low' and product.is_active and product.track_stock
              and product.quantity_on_hand > 0 and product.quantity_on_hand <= product.reorder_level)
      )
    order by product.is_active desc, lower(product.name)
    limit 500;
end;
$$;

revoke all on function public.stock_list_products(uuid,text,text) from public, anon;
grant execute on function public.stock_list_products(uuid,text,text) to authenticated;

-- =========================================================
-- SAVE PRODUCT
-- =========================================================

create or replace function public.stock_save_product(
    p_club_id uuid,
    p_product_id uuid,
    p_sku text,
    p_barcode text,
    p_name text,
    p_description text,
    p_category text,
    p_supplier text,
    p_cost_price numeric,
    p_sale_price numeric,
    p_vat_rate numeric,
    p_reorder_level integer,
    p_track_stock boolean,
    p_is_active boolean,
    p_opening_quantity integer default null
)
returns table (
    product_id uuid,
    quantity_on_hand integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_product_id uuid;
    v_sku text;
    v_name text;
    v_barcode text;
    v_opening integer;
begin
    if auth.uid() is null or not public.user_can_manage_stock(p_club_id) then
        raise exception 'Stock management access required.';
    end if;

    v_sku := trim(coalesce(p_sku,''));
    v_name := trim(coalesce(p_name,''));
    v_barcode := nullif(trim(coalesce(p_barcode,'')), '');

    if v_sku = '' then raise exception 'SKU is required.'; end if;
    if v_name = '' then raise exception 'Product name is required.'; end if;
    if coalesce(p_cost_price,0) < 0 or coalesce(p_sale_price,0) < 0 then
        raise exception 'Prices cannot be negative.';
    end if;
    if coalesce(p_vat_rate,20) < 0 or coalesce(p_vat_rate,20) > 100 then
        raise exception 'VAT rate must be between 0 and 100.';
    end if;
    if coalesce(p_reorder_level,0) < 0 then
        raise exception 'Reorder level cannot be negative.';
    end if;

    if p_product_id is null then
        v_opening := case
            when coalesce(p_track_stock,true)
                then greatest(coalesce(p_opening_quantity,0),0)
            else 0
        end;

        insert into public.stock_products (
            club_id,sku,barcode,name,description,category,supplier,
            cost_price,sale_price,vat_rate,quantity_on_hand,reorder_level,
            track_stock,is_active,created_by
        ) values (
            p_club_id,v_sku,v_barcode,v_name,
            nullif(trim(coalesce(p_description,'')),''),
            nullif(trim(coalesce(p_category,'')),''),
            nullif(trim(coalesce(p_supplier,'')),''),
            coalesce(p_cost_price,0),coalesce(p_sale_price,0),coalesce(p_vat_rate,20),
            v_opening,coalesce(p_reorder_level,0),coalesce(p_track_stock,true),
            coalesce(p_is_active,true),auth.uid()
        )
        returning id into v_product_id;

        if v_opening > 0 then
            insert into public.stock_movements (
                club_id,product_id,movement_type,quantity_delta,
                quantity_before,quantity_after,unit_cost,reference,source,created_by
            ) values (
                p_club_id,v_product_id,'opening',v_opening,0,v_opening,
                coalesce(p_cost_price,0),'Opening stock','manual',auth.uid()
            );
        end if;
    else
        update public.stock_products
        set
            sku = v_sku,
            barcode = v_barcode,
            name = v_name,
            description = nullif(trim(coalesce(p_description,'')),''),
            category = nullif(trim(coalesce(p_category,'')),''),
            supplier = nullif(trim(coalesce(p_supplier,'')),''),
            cost_price = coalesce(p_cost_price,0),
            sale_price = coalesce(p_sale_price,0),
            vat_rate = coalesce(p_vat_rate,20),
            reorder_level = coalesce(p_reorder_level,0),
            track_stock = coalesce(p_track_stock,true),
            is_active = coalesce(p_is_active,true),
            updated_at = now()
        where id = p_product_id and club_id = p_club_id
        returning id into v_product_id;

        if v_product_id is null then
            raise exception 'Product not found for selected club.';
        end if;
    end if;

    return query
    select product.id,product.quantity_on_hand
    from public.stock_products as product
    where product.id = v_product_id;
end;
$$;

revoke all on function public.stock_save_product(
    uuid,uuid,text,text,text,text,text,text,numeric,numeric,numeric,integer,boolean,boolean,integer
) from public, anon;
grant execute on function public.stock_save_product(
    uuid,uuid,text,text,text,text,text,text,numeric,numeric,numeric,integer,boolean,boolean,integer
) to authenticated;

-- =========================================================
-- ADJUST QUANTITY
-- =========================================================

create or replace function public.stock_adjust_quantity(
    p_club_id uuid,
    p_product_id uuid,
    p_quantity_delta integer,
    p_movement_type text,
    p_reference text default null,
    p_note text default null
)
returns table (
    product_id uuid,
    quantity_before integer,
    quantity_after integer,
    movement_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_before integer;
    v_after integer;
    v_movement_type text;
    v_movement_id uuid;
begin
    if auth.uid() is null or not public.user_can_manage_stock(p_club_id) then
        raise exception 'Stock management access required.';
    end if;

    if coalesce(p_quantity_delta,0) = 0 then
        raise exception 'Quantity change cannot be zero.';
    end if;

    v_movement_type := lower(trim(coalesce(p_movement_type,'')));
    if v_movement_type not in ('receipt','adjustment_in','adjustment_out','return','stocktake') then
        raise exception 'Unsupported manual stock movement.';
    end if;

    if v_movement_type in ('receipt','adjustment_in','return') and p_quantity_delta < 0 then
        raise exception 'This movement must add stock.';
    end if;
    if v_movement_type = 'adjustment_out' and p_quantity_delta > 0 then
        raise exception 'Adjustment out must remove stock.';
    end if;

    select product.quantity_on_hand
    into v_before
    from public.stock_products as product
    where product.id = p_product_id and product.club_id = p_club_id
    for update;

    if v_before is null then
        raise exception 'Product not found for selected club.';
    end if;

    v_after := v_before + p_quantity_delta;
    if v_after < 0 then
        raise exception 'Stock quantity cannot fall below zero.';
    end if;

    update public.stock_products
    set quantity_on_hand = v_after, updated_at = now()
    where id = p_product_id and club_id = p_club_id;

    insert into public.stock_movements (
        club_id,product_id,movement_type,quantity_delta,quantity_before,quantity_after,
        reference,note,source,created_by
    ) values (
        p_club_id,p_product_id,v_movement_type,p_quantity_delta,v_before,v_after,
        nullif(trim(coalesce(p_reference,'')),''),
        nullif(trim(coalesce(p_note,'')),''),
        'manual',auth.uid()
    ) returning id into v_movement_id;

    return query select p_product_id,v_before,v_after,v_movement_id;
end;
$$;

revoke all on function public.stock_adjust_quantity(uuid,uuid,integer,text,text,text) from public, anon;
grant execute on function public.stock_adjust_quantity(uuid,uuid,integer,text,text,text) to authenticated;

-- =========================================================
-- MOVEMENT HISTORY
-- =========================================================

create or replace function public.stock_get_movements(
    p_club_id uuid,
    p_product_id uuid default null,
    p_limit integer default 30
)
returns table (
    movement_id uuid,
    product_id uuid,
    sku text,
    product_name text,
    movement_type text,
    quantity_delta integer,
    quantity_before integer,
    quantity_after integer,
    unit_cost numeric,
    reference text,
    note text,
    source text,
    created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null or not public.user_can_view_stock(p_club_id) then
        raise exception 'Stock inventory access required.';
    end if;

    return query
    select
        movement.id,product.id,product.sku,product.name,movement.movement_type,
        movement.quantity_delta,movement.quantity_before,movement.quantity_after,
        movement.unit_cost,movement.reference,movement.note,movement.source,movement.created_at
    from public.stock_movements as movement
    join public.stock_products as product on product.id = movement.product_id
    where movement.club_id = p_club_id
      and (p_product_id is null or movement.product_id = p_product_id)
    order by movement.created_at desc
    limit greatest(1,least(coalesce(p_limit,30),200));
end;
$$;

revoke all on function public.stock_get_movements(uuid,uuid,integer) from public, anon;
grant execute on function public.stock_get_movements(uuid,uuid,integer) to authenticated;

commit;

notify pgrst, 'reload schema';
