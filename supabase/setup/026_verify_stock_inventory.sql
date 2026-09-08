-- Read-only verification for Stock Inventory v1.
select
    club.name as club_name,
    module.module_key,
    module.is_enabled
from public.clubs as club
join public.club_modules as module on module.club_id = club.id
where module.module_key in ('member_credit','stock_inventory','epos_integration')
order by lower(club.name),module.module_key;

select
    club.name as club_name,
    count(product.id) as product_count,
    coalesce(sum(product.quantity_on_hand * product.cost_price),0) as stock_cost_value
from public.clubs as club
left join public.stock_products as product on product.club_id = club.id
group by club.id,club.name
order by lower(club.name);
