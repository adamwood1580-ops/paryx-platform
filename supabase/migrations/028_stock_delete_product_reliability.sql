-- =========================================================
-- PARYX MIGRATION 028
-- STOCK INVENTORY V1.3 — DELETE PRODUCT RELIABILITY FIX
--
-- Self-contained: safe to run whether Migration 027 succeeded or failed.
-- Delete remains audit-safe: live catalogue row is retired while historic
-- stock movements remain available in Audit.
-- =========================================================

begin;

alter table public.stock_products
    add column if not exists removed_at timestamptz;

alter table public.stock_products
    add column if not exists removed_by uuid
        references public.profiles(id)
        on delete set null;

drop index if exists public.stock_products_club_sku_unique;

create unique index stock_products_club_sku_unique
on public.stock_products (
    club_id,
    lower(sku)
)
where removed_at is null;

drop index if exists public.stock_products_club_barcode_unique;

create unique index stock_products_club_barcode_unique
on public.stock_products (
    club_id,
    lower(barcode)
)
where removed_at is null
  and barcode is not null
  and length(trim(barcode)) > 0;

-- Preserve Migration 026's exact return signature.
create or replace function public.stock_get_summary(
    p_club_id uuid
)
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
    if auth.uid() is null
       or not public.user_can_view_stock(p_club_id) then
        raise exception
            'Stock inventory access required.';
    end if;

    return query
    select
        count(*)::bigint,
        count(*) filter (
            where product.is_active
        )::bigint,
        count(*) filter (
            where product.is_active
              and product.track_stock
              and product.quantity_on_hand > 0
              and product.quantity_on_hand <= product.reorder_level
        )::bigint,
        count(*) filter (
            where product.is_active
              and product.track_stock
              and product.quantity_on_hand = 0
        )::bigint,
        coalesce(
            sum(product.quantity_on_hand * product.cost_price)
            filter (
                where product.is_active
                  and product.track_stock
            ),
            0
        )::numeric,
        coalesce(
            sum(product.quantity_on_hand * product.sale_price)
            filter (
                where product.is_active
                  and product.track_stock
            ),
            0
        )::numeric,
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
    where product.club_id = p_club_id
      and product.removed_at is null;
end;
$$;

revoke all
on function public.stock_get_summary(uuid)
from public, anon;

grant execute
on function public.stock_get_summary(uuid)
to authenticated;

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
    if auth.uid() is null
       or not public.user_can_view_stock(p_club_id) then
        raise exception
            'Stock inventory access required.';
    end if;

    v_search :=
        nullif(
            lower(trim(coalesce(p_search, ''))),
            ''
        );

    v_filter :=
        lower(trim(coalesce(p_filter, 'all')));

    if v_filter not in (
        'all',
        'low',
        'out',
        'inactive'
    ) then
        v_filter := 'all';
    end if;

    return query
    select
        product.id,
        product.sku,
        product.barcode,
        product.name,
        product.description,
        product.category,
        product.supplier,
        product.cost_price,
        product.sale_price,
        product.vat_rate,
        product.quantity_on_hand,
        product.reorder_level,
        product.track_stock,
        product.is_active,
        product.external_ref,
        product.updated_at
    from public.stock_products as product
    where product.club_id = p_club_id
      and product.removed_at is null
      and (
          v_search is null
          or lower(product.name) like '%' || v_search || '%'
          or lower(product.sku) like '%' || v_search || '%'
          or lower(coalesce(product.barcode, '')) like '%' || v_search || '%'
          or lower(coalesce(product.category, '')) like '%' || v_search || '%'
          or lower(coalesce(product.supplier, '')) like '%' || v_search || '%'
      )
      and (
          v_filter = 'all'
          or (
              v_filter = 'inactive'
              and not product.is_active
          )
          or (
              v_filter = 'out'
              and product.is_active
              and product.track_stock
              and product.quantity_on_hand = 0
          )
          or (
              v_filter = 'low'
              and product.is_active
              and product.track_stock
              and product.quantity_on_hand > 0
              and product.quantity_on_hand <= product.reorder_level
          )
      )
    order by
        product.is_active desc,
        lower(product.name)
    limit 500;
end;
$$;

revoke all
on function public.stock_list_products(uuid, text, text)
from public, anon;

grant execute
on function public.stock_list_products(uuid, text, text)
to authenticated;

create or replace function public.stock_delete_product(
    p_club_id uuid,
    p_product_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_deleted_count integer;
begin
    if auth.uid() is null
       or not public.user_can_manage_stock(p_club_id) then
        raise exception
            'Stock management access required.';
    end if;

    update public.stock_products
    set
        is_active = false,
        removed_at = now(),
        removed_by = auth.uid(),
        updated_at = now()
    where id = p_product_id
      and club_id = p_club_id
      and removed_at is null;

    get diagnostics
        v_deleted_count = row_count;

    if v_deleted_count <> 1 then
        raise exception
            'Product not found or has already been deleted.';
    end if;

    return true;
end;
$$;

revoke all
on function public.stock_delete_product(uuid, uuid)
from public, anon;

grant execute
on function public.stock_delete_product(uuid, uuid)
to authenticated;

commit;

notify pgrst, 'reload schema';
