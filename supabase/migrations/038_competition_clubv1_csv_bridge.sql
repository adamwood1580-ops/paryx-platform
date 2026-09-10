-- =========================================================
-- PARYX MIGRATION 038
-- CLUBV1 CSV INGEST + WINDOWS BRIDGE STAGING
-- =========================================================
-- Prerequisite: Migration 037.
--
-- Adds a secure staging layer for ClubV1 CSV result files and revocable
-- per-device Windows Bridge credentials. The Edge Function owns ingestion;
-- browser and Bridge clients never receive a Supabase service-role key.
-- =========================================================

begin;

create table if not exists public.club_competition_bridge_devices (
    id uuid primary key default gen_random_uuid(),
    club_id uuid not null references public.clubs(id) on delete cascade,
    device_name text not null,
    token_hash text not null unique,
    is_active boolean not null default true,
    created_by uuid references public.profiles(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    last_seen_at timestamptz,
    last_upload_at timestamptz,
    revoked_at timestamptz
);

create index if not exists club_competition_bridge_devices_club_idx
on public.club_competition_bridge_devices (club_id, is_active, created_at desc);

alter table public.club_competition_bridge_devices enable row level security;

-- Deliberately no direct browser RLS policies. Device credentials are managed
-- only by the competition-result-ingest Edge Function after it validates a
-- Club Admin session.

create table if not exists public.club_competition_ingest_files (
    id uuid primary key default gen_random_uuid(),
    club_id uuid not null references public.clubs(id) on delete cascade,
    competition_id uuid references public.club_competitions(id) on delete set null,
    bridge_device_id uuid references public.club_competition_bridge_devices(id) on delete set null,
    provider text not null default 'clubv1',
    source_method text not null,
    source_filename text not null,
    source_file_sha256 text not null,
    source_size_bytes integer not null default 0,
    detected_competition_name text,
    detected_competition_date date,
    detected_header_row integer,
    normalized_result_count integer not null default 0,
    normalized_results jsonb,
    raw_csv text,
    ingest_status text not null default 'received',
    ingest_error text,
    received_at timestamptz not null default now(),
    processed_at timestamptz,
    updated_at timestamptz not null default now(),
    constraint club_competition_ingest_source_method_valid
        check (source_method in ('manual_upload','windows_bridge')),
    constraint club_competition_ingest_status_valid
        check (ingest_status in ('received','needs_review','imported','duplicate','error')),
    constraint club_competition_ingest_size_nonnegative
        check (source_size_bytes >= 0),
    unique (club_id, source_file_sha256)
);

create index if not exists club_competition_ingest_files_club_status_idx
on public.club_competition_ingest_files (club_id, ingest_status, received_at desc);

create index if not exists club_competition_ingest_files_competition_idx
on public.club_competition_ingest_files (competition_id, received_at desc);

alter table public.club_competition_ingest_files enable row level security;

-- Ingest rows can contain names, membership numbers and scoring information.
-- They are intentionally server-only and are not exposed through table RLS.

create or replace function public.competition_bridge_ingest_summary(p_club_id uuid)
returns table (
    pending_review_count bigint,
    last_received_at timestamptz,
    last_imported_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null or not public.user_can_manage_competitions(p_club_id) then
        raise exception 'Competition management access required.';
    end if;

    return query
    select
        count(*) filter (where ingest.ingest_status = 'needs_review')::bigint,
        max(ingest.received_at),
        max(ingest.processed_at) filter (where ingest.ingest_status = 'imported')
    from public.club_competition_ingest_files as ingest
    where ingest.club_id = p_club_id;
end;
$$;

revoke all on function public.competition_bridge_ingest_summary(uuid) from public, anon;
grant execute on function public.competition_bridge_ingest_summary(uuid) to authenticated;

create or replace function public.competition_get_bridge_devices(p_club_id uuid)
returns table (
    device_id uuid,
    device_name text,
    is_active boolean,
    created_at timestamptz,
    last_seen_at timestamptz,
    last_upload_at timestamptz,
    revoked_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null then
        raise exception 'Club Admin access required.';
    end if;

    if not exists (
        select 1
        from public.club_memberships as membership
        where membership.profile_id = auth.uid()
          and membership.club_id = p_club_id
          and membership.status = 'active'
          and membership.role = 'club_admin'
    ) then
        raise exception 'Club Admin access required.';
    end if;

    return query
    select
        device.id,
        device.device_name,
        device.is_active,
        device.created_at,
        device.last_seen_at,
        device.last_upload_at,
        device.revoked_at
    from public.club_competition_bridge_devices as device
    where device.club_id = p_club_id
    order by device.created_at desc;
end;
$$;

revoke all on function public.competition_get_bridge_devices(uuid) from public, anon;
grant execute on function public.competition_get_bridge_devices(uuid) to authenticated;

create or replace function public.competition_revoke_bridge_device(p_device_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_club_id uuid;
begin
    select device.club_id
    into v_club_id
    from public.club_competition_bridge_devices as device
    where device.id = p_device_id;

    if v_club_id is null or auth.uid() is null then
        raise exception 'Club Admin access required.';
    end if;

    if not exists (
        select 1
        from public.club_memberships as membership
        where membership.profile_id = auth.uid()
          and membership.club_id = v_club_id
          and membership.status = 'active'
          and membership.role = 'club_admin'
    ) then
        raise exception 'Club Admin access required.';
    end if;

    update public.club_competition_bridge_devices
    set
        is_active = false,
        revoked_at = now(),
        updated_at = now()
    where id = p_device_id;

    return true;
end;
$$;

revoke all on function public.competition_revoke_bridge_device(uuid) from public, anon;
grant execute on function public.competition_revoke_bridge_device(uuid) to authenticated;

commit;

notify pgrst, 'reload schema';
