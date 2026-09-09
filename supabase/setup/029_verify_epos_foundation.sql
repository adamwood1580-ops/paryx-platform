-- =========================================================
-- EPOS FOUNDATION V1 — READ-ONLY VERIFICATION
-- =========================================================

select
    club.name,
    module.module_key,
    module.is_enabled
from public.clubs as club
join public.club_modules as module
    on module.club_id =
        club.id
where module.module_key =
    'epos_integration'
order by
    lower(
        club.name
    );

select
    club.name,
    connection.provider_name,
    connection.adapter_key,
    connection.connection_status,
    connection.secret_configured,
    connection.last_sync_at,
    connection.last_error
from public.clubs as club
left join public.epos_connections as connection
    on connection.club_id =
        club.id
order by
    lower(
        club.name
    );

select
    club.name,
    count(mapping.id) filter (
        where mapping.is_active
    ) as active_mappings
from public.clubs as club
left join public.epos_product_mappings as mapping
    on mapping.club_id =
        club.id
group by
    club.id,
    club.name
order by
    lower(
        club.name
    );
