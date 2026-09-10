-- =========================================================
-- PARYX MIGRATION 037
-- CALENDAR-DRIVEN COMPETITIONS + API-READY RESULT IMPORT
-- =========================================================
--
-- Goals:
--   1. Every published Calendar event whose event_type = 'competition'
--      automatically has one linked Paryx competition record.
--   2. ClubHub's operational competition view can be driven from those
--      calendar-backed records without manual competition creation.
--   3. External result providers (ClubV1 first) can import a normalized
--      read-only result snapshot through a server-only RPC.
--   4. External players are matched to Paryx memberships using durable
--      provider-player links and, when available, membership number.
--   5. Result-derived prizes and manual special prizes share one audited
--      Club Credit confirmation path.
--
-- This migration does NOT assume any undocumented ClubV1 endpoint or
-- payload. A future Edge Function/provider adapter only has to normalize
-- the provider response and call competition_import_external_results().
--
-- Prerequisites: Migrations 030, 034 and 036.
-- Migration 035 may remain installed.
-- =========================================================

begin;

-- ---------------------------------------------------------
-- COMPETITION PROVIDER / SYNC STATE
-- ---------------------------------------------------------

alter table public.club_competitions
    add column if not exists result_provider text not null default 'manual',
    add column if not exists external_competition_id text,
    add column if not exists external_status text,
    add column if not exists result_sync_status text not null default 'manual',
    add column if not exists last_result_sync_at timestamptz,
    add column if not exists result_imported_at timestamptz,
    add column if not exists result_sync_error text,
    add column if not exists results_verified_at timestamptz,
    add column if not exists results_verified_by uuid references public.profiles(id) on delete set null,
    add column if not exists results_verified_source text;

create unique index if not exists club_competitions_provider_external_unique
on public.club_competitions (club_id, result_provider, external_competition_id)
where external_competition_id is not null;

create table if not exists public.club_competition_result_integrations (
    id uuid primary key default gen_random_uuid(),
    club_id uuid not null references public.clubs(id) on delete cascade,
    provider text not null,
    is_enabled boolean not null default false,
    external_club_id text,
    last_sync_at timestamptz,
    last_sync_status text,
    last_sync_error text,
    created_by uuid references public.profiles(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (club_id, provider)
);

alter table public.club_competition_result_integrations enable row level security;

-- Deliberately no browser RLS policies. Configuration is exposed only
-- through permission-checked RPCs. Provider credentials must NOT be put in
-- this table; keep credentials in Supabase server/Edge Function secrets.

create table if not exists public.club_external_player_links (
    id uuid primary key default gen_random_uuid(),
    club_id uuid not null references public.clubs(id) on delete cascade,
    provider text not null,
    external_player_id text not null,
    membership_id uuid not null references public.club_memberships(id) on delete cascade,
    match_source text not null default 'manual',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (club_id, provider, external_player_id)
);

create index if not exists club_external_player_links_membership_idx
on public.club_external_player_links (club_id, membership_id);

alter table public.club_external_player_links enable row level security;

create table if not exists public.club_competition_result_imports (
    id uuid primary key default gen_random_uuid(),
    competition_id uuid not null references public.club_competitions(id) on delete cascade,
    provider text not null,
    external_competition_id text,
    provider_status text,
    result_count integer not null default 0,
    raw_payload jsonb,
    imported_at timestamptz not null default now()
);

create index if not exists club_competition_result_imports_competition_idx
on public.club_competition_result_imports (competition_id, imported_at desc);

alter table public.club_competition_result_imports enable row level security;

create table if not exists public.club_competition_external_results (
    id uuid primary key default gen_random_uuid(),
    competition_id uuid not null references public.club_competitions(id) on delete cascade,
    import_id uuid references public.club_competition_result_imports(id) on delete set null,
    provider text not null,
    external_result_key text not null,
    external_result_id text,
    external_player_id text,
    external_membership_number text,
    external_player_name text not null,
    finishing_position integer,
    gross_score integer,
    nett_score integer,
    points integer,
    result_text text,
    membership_id uuid references public.club_memberships(id) on delete set null,
    match_status text not null default 'unmatched',
    raw_result jsonb,
    imported_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (competition_id, provider, external_result_key)
);

create index if not exists club_competition_external_results_competition_idx
on public.club_competition_external_results (competition_id, finishing_position, external_player_name);

create index if not exists club_competition_external_results_membership_idx
on public.club_competition_external_results (competition_id, membership_id)
where membership_id is not null;

alter table public.club_competition_external_results enable row level security;

-- ---------------------------------------------------------
-- PRIZES: SUPPORT PLACE-BASED AND SPECIAL MANUAL AWARDS
-- ---------------------------------------------------------

alter table public.club_competition_prizes
    alter column finishing_position drop not null;

-- Award identity is now award_key, not one-row-per-finishing-position. This
-- also allows legitimate tied positions or multiple awards linked to one place.
alter table public.club_competition_prizes
    drop constraint if exists club_competition_prizes_competition_id_finishing_position_key;

alter table public.club_competition_prizes
    add column if not exists award_key text,
    add column if not exists award_type text not null default 'placing',
    add column if not exists recipient_membership_id uuid references public.club_memberships(id) on delete set null,
    add column if not exists external_result_id uuid references public.club_competition_external_results(id) on delete set null,
    add column if not exists source_external_result_key text;

create unique index if not exists club_competition_prizes_award_key_unique
on public.club_competition_prizes (competition_id, award_key)
where award_key is not null;

create index if not exists club_competition_prizes_recipient_idx
on public.club_competition_prizes (competition_id, recipient_membership_id);

-- Backfill recipient/key details for awards created by Migration 036.
update public.club_competition_prizes as prize
set
    recipient_membership_id = coalesce(prize.recipient_membership_id, entry.membership_id),
    award_key = coalesce(prize.award_key, 'legacy-place:' || prize.id::text),
    award_type = coalesce(nullif(prize.award_type, ''), 'placing')
from public.club_competition_entries as entry
where entry.competition_id = prize.competition_id
  and entry.finishing_position = prize.finishing_position
  and prize.recipient_membership_id is null;

update public.club_competition_prizes
set award_key = 'legacy-prize:' || id::text
where award_key is null;

-- ---------------------------------------------------------
-- CALENDAR MATERIALISATION
-- ---------------------------------------------------------

create or replace function public.competition_materialise_calendar_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_provider text := 'manual';
    v_sync_status text := 'manual';
begin
    if tg_op = 'DELETE' then
        update public.club_competitions
        set
            status = case when results_confirmed_at is null then 'cancelled' else status end,
            updated_at = now()
        where club_event_id = old.id;
        return old;
    end if;

    if new.event_type = 'competition' and new.status <> 'cancelled' and coalesce(new.is_published, false) = true then
        select integration.provider
        into v_provider
        from public.club_competition_result_integrations as integration
        where integration.club_id = new.club_id
          and integration.is_enabled = true
        order by case when integration.provider = 'clubv1' then 0 else 1 end,
                 integration.created_at
        limit 1;

        v_provider := coalesce(v_provider, 'manual');
        v_sync_status := case when v_provider = 'manual' then 'manual' else 'awaiting_results' end;

        insert into public.club_competitions (
            club_id,
            club_event_id,
            name,
            competition_date,
            competition_format,
            section,
            status,
            is_qualifier,
            result_provider,
            result_sync_status,
            created_by
        )
        values (
            new.club_id,
            new.id,
            new.title,
            new.event_date,
            'other',
            coalesce(new.section, 'club'),
            case
                when new.event_date < current_date then 'results_pending'
                when new.event_date = current_date then 'open'
                else 'draft'
            end,
            coalesce(new.is_qualifier, false),
            v_provider,
            v_sync_status,
            null
        )
        on conflict (club_event_id) where club_event_id is not null
        do update set
            club_id = excluded.club_id,
            name = excluded.name,
            competition_date = excluded.competition_date,
            section = excluded.section,
            is_qualifier = excluded.is_qualifier,
            result_provider = case
                when club_competitions.external_competition_id is null
                     and club_competitions.results_confirmed_at is null
                    then excluded.result_provider
                else club_competitions.result_provider
            end,
            result_sync_status = case
                when club_competitions.external_competition_id is null
                     and club_competitions.results_confirmed_at is null
                    then excluded.result_sync_status
                else club_competitions.result_sync_status
            end,
            status = case
                when club_competitions.results_confirmed_at is not null
                    then club_competitions.status
                when new.event_date < current_date then 'results_pending'
                when new.event_date = current_date then 'open'
                when new.event_date > current_date
                     and club_competitions.status in ('open','closed','results_pending')
                    then 'draft'
                else club_competitions.status
            end,
            updated_at = now();
    else
        update public.club_competitions
        set
            status = case when results_confirmed_at is null then 'cancelled' else status end,
            updated_at = now()
        where club_event_id = new.id;
    end if;

    return new;
end;
$$;

drop trigger if exists club_events_materialise_competition on public.club_events;
drop trigger if exists club_events_materialise_competition_upsert on public.club_events;
drop trigger if exists club_events_materialise_competition_delete on public.club_events;

create trigger club_events_materialise_competition_upsert
after insert or update of club_id, event_type, title, event_date, section, is_qualifier, status, is_published
on public.club_events
for each row
execute function public.competition_materialise_calendar_event();

create trigger club_events_materialise_competition_delete
after delete
on public.club_events
for each row
execute function public.competition_materialise_calendar_event();

create or replace function public.competition_sync_calendar(p_club_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_provider text := 'manual';
    v_sync_status text := 'manual';
    v_count integer := 0;
begin
    if auth.uid() is null or not public.user_can_manage_competitions(p_club_id) then
        raise exception 'Competition management access required.';
    end if;

    select integration.provider
    into v_provider
    from public.club_competition_result_integrations as integration
    where integration.club_id = p_club_id
      and integration.is_enabled = true
    order by case when integration.provider = 'clubv1' then 0 else 1 end,
             integration.created_at
    limit 1;

    v_provider := coalesce(v_provider, 'manual');
    v_sync_status := case when v_provider = 'manual' then 'manual' else 'awaiting_results' end;

    insert into public.club_competitions (
        club_id,
        club_event_id,
        name,
        competition_date,
        competition_format,
        section,
        status,
        is_qualifier,
        result_provider,
        result_sync_status,
        created_by
    )
    select
        event.club_id,
        event.id,
        event.title,
        event.event_date,
        'other',
        coalesce(event.section, 'club'),
        case
            when event.event_date < current_date then 'results_pending'
            when event.event_date = current_date then 'open'
            else 'draft'
        end,
        coalesce(event.is_qualifier, false),
        v_provider,
        v_sync_status,
        auth.uid()
    from public.club_events as event
    where event.club_id = p_club_id
      and event.event_type = 'competition'
      and event.status <> 'cancelled'
      and coalesce(event.is_published, false) = true
    on conflict (club_event_id) where club_event_id is not null
    do update set
        name = excluded.name,
        competition_date = excluded.competition_date,
        section = excluded.section,
        is_qualifier = excluded.is_qualifier,
        result_provider = case
            when club_competitions.external_competition_id is null
                 and club_competitions.results_confirmed_at is null
                then excluded.result_provider
            else club_competitions.result_provider
        end,
        result_sync_status = case
            when club_competitions.external_competition_id is null
                 and club_competitions.results_confirmed_at is null
                then excluded.result_sync_status
            else club_competitions.result_sync_status
        end,
        status = case
            when club_competitions.results_confirmed_at is not null
                then club_competitions.status
            when excluded.competition_date < current_date then 'results_pending'
            when excluded.competition_date = current_date then 'open'
            when excluded.competition_date > current_date
                 and club_competitions.status in ('open','closed','results_pending')
                then 'draft'
            else club_competitions.status
        end,
        updated_at = now();

    get diagnostics v_count = row_count;

    update public.club_competitions as competition
    set
        status = case
            when event.status = 'cancelled' or event.event_type <> 'competition' or coalesce(event.is_published, false) = false
                then 'cancelled'
            when competition.results_confirmed_at is not null
                then competition.status
            when event.event_date < current_date
                then 'results_pending'
            when event.event_date = current_date
                then 'open'
            when event.event_date > current_date
                 and competition.status in ('open','closed','results_pending')
                then 'draft'
            else competition.status
        end,
        updated_at = now()
    from public.club_events as event
    where competition.club_event_id = event.id
      and competition.club_id = p_club_id;

    return jsonb_build_object('calendar_competitions_seen', v_count);
end;
$$;

revoke all on function public.competition_sync_calendar(uuid) from public, anon;
grant execute on function public.competition_sync_calendar(uuid) to authenticated;

-- Backfill all existing Calendar competition events now. This is intentionally
-- done without an auth-dependent RPC so Migration 037 materialises the current
-- calendar immediately.
insert into public.club_competitions (
    club_id,
    club_event_id,
    name,
    competition_date,
    competition_format,
    section,
    status,
    is_qualifier,
    result_provider,
    result_sync_status,
    created_by
)
select
    event.club_id,
    event.id,
    event.title,
    event.event_date,
    'other',
    coalesce(event.section, 'club'),
    case
        when event.event_date < current_date then 'results_pending'
        when event.event_date = current_date then 'open'
        else 'draft'
    end,
    coalesce(event.is_qualifier, false),
    coalesce(integration.provider, 'manual'),
    case when integration.provider is null then 'manual' else 'awaiting_results' end,
    null
from public.club_events as event
left join lateral (
    select configured.provider
    from public.club_competition_result_integrations as configured
    where configured.club_id = event.club_id
      and configured.is_enabled = true
    order by case when configured.provider = 'clubv1' then 0 else 1 end,
             configured.created_at
    limit 1
) as integration on true
where event.event_type = 'competition'
  and event.status <> 'cancelled'
  and coalesce(event.is_published, false) = true
on conflict (club_event_id) where club_event_id is not null
do update set
    name = excluded.name,
    competition_date = excluded.competition_date,
    section = excluded.section,
    is_qualifier = excluded.is_qualifier,
    updated_at = now();

-- Keep the calendar-link helper aligned with what users can actually see
-- in the published club calendar.
create or replace function public.competition_get_calendar_events(
    p_club_id uuid,
    p_from_date date,
    p_to_date date
)
returns table (
    event_id uuid,
    title text,
    event_date date,
    section text,
    is_qualifier boolean,
    status text,
    linked_competition_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null or not public.user_can_view_competitions(p_club_id) then
        raise exception 'Competition access required.';
    end if;

    return query
    select
        event.id,
        event.title,
        event.event_date,
        event.section,
        event.is_qualifier,
        event.status,
        competition.id
    from public.club_events as event
    left join public.club_competitions as competition
      on competition.club_event_id = event.id
    where event.club_id = p_club_id
      and event.event_type = 'competition'
      and event.event_date between p_from_date and p_to_date
      and event.status <> 'cancelled'
      and coalesce(event.is_published, false) = true
    order by event.event_date, lower(event.title);
end;
$$;

revoke all on function public.competition_get_calendar_events(uuid,date,date) from public, anon;
grant execute on function public.competition_get_calendar_events(uuid,date,date) to authenticated;

-- ---------------------------------------------------------
-- RESULT PROVIDER CONFIGURATION (NO SECRETS)
-- ---------------------------------------------------------

create or replace function public.competition_set_result_integration(
    p_club_id uuid,
    p_provider text,
    p_external_club_id text,
    p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_provider text;
begin
    if auth.uid() is null or not public.user_can_confirm_competition_results(p_club_id) then
        raise exception 'Manager or Club Admin access is required.';
    end if;

    v_provider := lower(trim(coalesce(p_provider, '')));
    if v_provider not in ('clubv1', 'other') then
        raise exception 'Unsupported competition result provider.';
    end if;

    if coalesce(p_enabled, false) then
        update public.club_competition_result_integrations
        set is_enabled = false, updated_at = now()
        where club_id = p_club_id
          and provider <> v_provider
          and is_enabled = true;
    end if;

    insert into public.club_competition_result_integrations (
        club_id,
        provider,
        is_enabled,
        external_club_id,
        created_by
    )
    values (
        p_club_id,
        v_provider,
        coalesce(p_enabled, false),
        nullif(trim(coalesce(p_external_club_id, '')), ''),
        auth.uid()
    )
    on conflict (club_id, provider)
    do update set
        is_enabled = excluded.is_enabled,
        external_club_id = excluded.external_club_id,
        updated_at = now();

    if coalesce(p_enabled, false) then
        update public.club_competitions
        set
            result_provider = v_provider,
            result_sync_status = case
                when result_imported_at is null then 'awaiting_results'
                else result_sync_status
            end,
            updated_at = now()
        where club_id = p_club_id
          and results_confirmed_at is null
          and club_event_id is not null;
    else
        update public.club_competitions
        set
            result_provider = 'manual',
            result_sync_status = case
                when result_imported_at is null then 'manual'
                else result_sync_status
            end,
            updated_at = now()
        where club_id = p_club_id
          and result_provider = v_provider
          and results_confirmed_at is null;
    end if;

    return jsonb_build_object(
        'provider', v_provider,
        'enabled', coalesce(p_enabled, false),
        'external_club_id', nullif(trim(coalesce(p_external_club_id, '')), '')
    );
end;
$$;

revoke all on function public.competition_set_result_integration(uuid,text,text,boolean) from public, anon;
grant execute on function public.competition_set_result_integration(uuid,text,text,boolean) to authenticated;

create or replace function public.competition_get_result_integration(p_club_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_result jsonb;
begin
    if auth.uid() is null or not public.user_can_view_competitions(p_club_id) then
        raise exception 'Competition access required.';
    end if;

    select jsonb_build_object(
        'provider', integration.provider,
        'enabled', integration.is_enabled,
        'external_club_id', integration.external_club_id,
        'last_sync_at', integration.last_sync_at,
        'last_sync_status', integration.last_sync_status,
        'last_sync_error', integration.last_sync_error
    )
    into v_result
    from public.club_competition_result_integrations as integration
    where integration.club_id = p_club_id
      and integration.is_enabled = true
    order by case when integration.provider = 'clubv1' then 0 else 1 end,
             integration.created_at
    limit 1;

    return coalesce(v_result, jsonb_build_object(
        'provider', 'manual',
        'enabled', false,
        'external_club_id', null,
        'last_sync_at', null,
        'last_sync_status', 'not_configured',
        'last_sync_error', null
    ));
end;
$$;

revoke all on function public.competition_get_result_integration(uuid) from public, anon;
grant execute on function public.competition_get_result_integration(uuid) to authenticated;

-- ---------------------------------------------------------
-- OPERATIONAL LIST / DETAIL FOR CLUBHUB V0.22
-- ---------------------------------------------------------

create or replace function public.competition_list_v2(
    p_club_id uuid,
    p_from_date date,
    p_to_date date,
    p_status text default null,
    p_search text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_search text;
    v_result jsonb;
begin
    if auth.uid() is null or not public.user_can_view_competitions(p_club_id) then
        raise exception 'Competition access required.';
    end if;

    if p_from_date is null or p_to_date is null or p_to_date < p_from_date then
        raise exception 'A valid competition date range is required.';
    end if;

    v_search := nullif(lower(trim(coalesce(p_search, ''))), '');

    select coalesce(jsonb_agg(row_data order by row_date, row_name), '[]'::jsonb)
    into v_result
    from (
        select
            jsonb_build_object(
                'competition_id', competition.id,
                'name', coalesce(event.title, competition.name),
                'competition_date', coalesce(event.event_date, competition.competition_date),
                'competition_format', competition.competition_format,
                'section', coalesce(event.section, competition.section),
                'section_label', case coalesce(event.section, competition.section)
                    when 'mens' then 'Men'
                    when 'seniors' then 'Seniors'
                    when 'ladies' then 'Ladies'
                    else 'Club'
                end,
                'status', competition.status,
                'is_qualifier', coalesce(event.is_qualifier, competition.is_qualifier),
                'club_event_id', competition.club_event_id,
                'result_provider', competition.result_provider,
                'external_competition_id', competition.external_competition_id,
                'external_status', competition.external_status,
                'result_sync_status', competition.result_sync_status,
                'last_result_sync_at', competition.last_result_sync_at,
                'result_imported_at', competition.result_imported_at,
                'result_sync_error', competition.result_sync_error,
                'external_result_count', (
                    select count(*)
                    from public.club_competition_external_results as external_result
                    where external_result.competition_id = competition.id
                ),
                'matched_result_count', (
                    select count(*)
                    from public.club_competition_external_results as external_result
                    where external_result.competition_id = competition.id
                      and external_result.membership_id is not null
                ),
                'unmatched_result_count', (
                    select count(*)
                    from public.club_competition_external_results as external_result
                    where external_result.competition_id = competition.id
                      and external_result.membership_id is null
                ),
                'award_count', (
                    select count(*)
                    from public.club_competition_prizes as prize
                    where prize.competition_id = competition.id
                ),
                'prize_total', coalesce((
                    select sum(prize.amount)
                    from public.club_competition_prizes as prize
                    where prize.competition_id = competition.id
                ), 0),
                'currency_code', coalesce((
                    select prize.currency_code
                    from public.club_competition_prizes as prize
                    where prize.competition_id = competition.id
                    order by prize.created_at
                    limit 1
                ), settings.currency_code, 'GBP'),
                'results_confirmed_at', competition.results_confirmed_at
            ) as row_data,
            coalesce(event.event_date, competition.competition_date) as row_date,
            lower(coalesce(event.title, competition.name)) as row_name
        from public.club_competitions as competition
        left join public.club_events as event on event.id = competition.club_event_id
        left join public.club_settings as settings on settings.club_id = competition.club_id
        where competition.club_id = p_club_id
          and coalesce(event.event_date, competition.competition_date) between p_from_date and p_to_date
          and (p_status is null or trim(p_status) = '' or competition.status = p_status)
          and (v_search is null or lower(coalesce(event.title, competition.name, '')) like '%' || v_search || '%')
    ) as rows;

    return v_result;
end;
$$;

revoke all on function public.competition_list_v2(uuid,date,date,text,text) from public, anon;
grant execute on function public.competition_list_v2(uuid,date,date,text,text) to authenticated;

create or replace function public.competition_get_detail_v2(p_competition_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_club_id uuid;
    v_result jsonb;
begin
    select competition.club_id
    into v_club_id
    from public.club_competitions as competition
    where competition.id = p_competition_id;

    if v_club_id is null or auth.uid() is null or not public.user_can_view_competitions(v_club_id) then
        raise exception 'Competition access required.';
    end if;

    select jsonb_build_object(
        'competition', jsonb_build_object(
            'competition_id', competition.id,
            'club_id', competition.club_id,
            'club_event_id', competition.club_event_id,
            'name', coalesce(event.title, competition.name),
            'competition_date', coalesce(event.event_date, competition.competition_date),
            'competition_format', competition.competition_format,
            'section', coalesce(event.section, competition.section),
            'status', competition.status,
            'is_qualifier', coalesce(event.is_qualifier, competition.is_qualifier),
            'notes', competition.notes,
            'currency_code', coalesce(settings.currency_code, 'GBP'),
            'result_provider', competition.result_provider,
            'external_competition_id', competition.external_competition_id,
            'external_status', competition.external_status,
            'result_sync_status', competition.result_sync_status,
            'last_result_sync_at', competition.last_result_sync_at,
            'result_imported_at', competition.result_imported_at,
            'result_sync_error', competition.result_sync_error,
            'results_verified_at', competition.results_verified_at,
            'results_verified_by', competition.results_verified_by,
            'results_verified_source', competition.results_verified_source,
            'results_confirmed_at', competition.results_confirmed_at,
            'results_confirmed_by', competition.results_confirmed_by
        ),
        'external_results', coalesce((
            select jsonb_agg(
                jsonb_build_object(
                    'external_result_id', external_result.id,
                    'provider', external_result.provider,
                    'external_result_key', external_result.external_result_key,
                    'provider_result_id', external_result.external_result_id,
                    'external_player_id', external_result.external_player_id,
                    'membership_number', external_result.external_membership_number,
                    'player_name', external_result.external_player_name,
                    'placing', external_result.finishing_position,
                    'gross_score', external_result.gross_score,
                    'nett_score', external_result.nett_score,
                    'points', external_result.points,
                    'result_text', external_result.result_text,
                    'membership_id', external_result.membership_id,
                    'match_status', external_result.match_status,
                    'matched_name', coalesce(
                        nullif(trim(profile.display_name), ''),
                        nullif(trim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
                        auth_user.email::text
                    ),
                    'matched_membership_number', membership.membership_number
                )
                order by external_result.finishing_position nulls last,
                         lower(external_result.external_player_name)
            )
            from public.club_competition_external_results as external_result
            left join public.club_memberships as membership
                on membership.id = external_result.membership_id
            left join public.profiles as profile
                on profile.id = membership.profile_id
            left join auth.users as auth_user
                on auth_user.id = membership.profile_id
            where external_result.competition_id = competition.id
        ), '[]'::jsonb),
        'awards', coalesce((
            select jsonb_agg(
                jsonb_build_object(
                    'prize_id', prize.id,
                    'award_key', prize.award_key,
                    'award_type', prize.award_type,
                    'placing', prize.finishing_position,
                    'label', prize.label,
                    'amount', prize.amount,
                    'currency_code', prize.currency_code,
                    'recipient_membership_id', coalesce(prize.recipient_membership_id, legacy_entry.membership_id),
                    'recipient_name', coalesce(
                        nullif(trim(profile.display_name), ''),
                        nullif(trim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
                        auth_user.email::text,
                        legacy_entry.entrant_name
                    ),
                    'recipient_membership_number', coalesce(membership.membership_number, legacy_entry.membership_number),
                    'external_result_id', prize.external_result_id,
                    'source_external_result_key', prize.source_external_result_key,
                    'credit_transaction_id', prize.credit_transaction_id
                )
                order by prize.finishing_position nulls last, prize.created_at
            )
            from public.club_competition_prizes as prize
            left join public.club_competition_entries as legacy_entry
                on legacy_entry.competition_id = prize.competition_id
               and legacy_entry.finishing_position = prize.finishing_position
            left join public.club_memberships as membership
                on membership.id = coalesce(prize.recipient_membership_id, legacy_entry.membership_id)
            left join public.profiles as profile
                on profile.id = membership.profile_id
            left join auth.users as auth_user
                on auth_user.id = membership.profile_id
            where prize.competition_id = competition.id
        ), '[]'::jsonb)
    )
    into v_result
    from public.club_competitions as competition
    left join public.club_events as event on event.id = competition.club_event_id
    left join public.club_settings as settings on settings.club_id = competition.club_id
    where competition.id = p_competition_id;

    return v_result;
end;
$$;

revoke all on function public.competition_get_detail_v2(uuid) from public, anon;
grant execute on function public.competition_get_detail_v2(uuid) to authenticated;

-- ---------------------------------------------------------
-- SERVER-SIDE RESULT IMPORT CONTRACT
-- ---------------------------------------------------------

create or replace function public.competition_external_sync_queue(
    p_provider text,
    p_limit integer default 50
)
returns table (
    competition_id uuid,
    club_id uuid,
    external_club_id text,
    external_competition_id text,
    competition_name text,
    competition_date date,
    last_result_sync_at timestamptz,
    result_sync_status text
)
language sql
stable
security definer
set search_path = ''
as $$
    select
        competition.id,
        competition.club_id,
        integration.external_club_id,
        competition.external_competition_id,
        coalesce(event.title, competition.name)::text,
        coalesce(event.event_date, competition.competition_date)::date,
        competition.last_result_sync_at,
        competition.result_sync_status
    from public.club_competitions as competition
    join public.club_competition_result_integrations as integration
      on integration.club_id = competition.club_id
     and integration.provider = lower(trim(p_provider))
     and integration.is_enabled = true
    left join public.club_events as event on event.id = competition.club_event_id
    where competition.result_provider = lower(trim(p_provider))
      and competition.results_confirmed_at is null
      and coalesce(event.event_date, competition.competition_date)
            between current_date - 30 and current_date + 1
    order by coalesce(event.event_date, competition.competition_date), competition.updated_at
    limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

revoke all on function public.competition_external_sync_queue(text,integer) from public, anon, authenticated;
grant execute on function public.competition_external_sync_queue(text,integer) to service_role;

create or replace function public.competition_import_external_results(
    p_competition_id uuid,
    p_provider text,
    p_external_competition_id text,
    p_provider_status text,
    p_results jsonb,
    p_raw_payload jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_club_id uuid;
    v_provider text;
    v_import_id uuid;
    v_result jsonb;
    v_external_result_key text;
    v_external_result_id text;
    v_external_player_id text;
    v_membership_number text;
    v_player_name text;
    v_membership_id uuid;
    v_match_status text;
    v_placing integer;
    v_gross integer;
    v_nett integer;
    v_points integer;
    v_result_text text;
    v_result_count integer := 0;
    v_matched_count integer := 0;
    v_unmatched_count integer := 0;
begin
    v_provider := lower(trim(coalesce(p_provider, '')));
    if v_provider not in ('clubv1', 'other') then
        raise exception 'Unsupported competition result provider.';
    end if;

    if p_results is null or jsonb_typeof(p_results) <> 'array' then
        raise exception 'External competition results must be supplied as an array.';
    end if;

    select competition.club_id
    into v_club_id
    from public.club_competitions as competition
    where competition.id = p_competition_id
      and competition.results_confirmed_at is null;

    if v_club_id is null then
        raise exception 'Competition is not available for result import or has already been confirmed.';
    end if;

    if not exists (
        select 1
        from public.club_competition_result_integrations as integration
        where integration.club_id = v_club_id
          and integration.provider = v_provider
          and integration.is_enabled = true
    ) then
        raise exception 'The result provider is not enabled for this club.';
    end if;

    insert into public.club_competition_result_imports (
        competition_id,
        provider,
        external_competition_id,
        provider_status,
        result_count,
        raw_payload
    )
    values (
        p_competition_id,
        v_provider,
        nullif(trim(coalesce(p_external_competition_id, '')), ''),
        nullif(trim(coalesce(p_provider_status, '')), ''),
        jsonb_array_length(p_results),
        p_raw_payload
    )
    returning id into v_import_id;

    delete from public.club_competition_external_results
    where competition_id = p_competition_id
      and provider = v_provider;

    for v_result in
        select value
        from jsonb_array_elements(p_results)
    loop
        v_external_result_id := nullif(trim(coalesce(v_result ->> 'external_result_id', '')), '');
        v_external_player_id := nullif(trim(coalesce(v_result ->> 'external_player_id', '')), '');
        v_membership_number := nullif(trim(coalesce(v_result ->> 'membership_number', '')), '');
        v_player_name := nullif(trim(coalesce(v_result ->> 'player_name', '')), '');
        v_placing := nullif(trim(coalesce(v_result ->> 'finishing_position', '')), '')::integer;
        v_gross := nullif(trim(coalesce(v_result ->> 'gross_score', '')), '')::integer;
        v_nett := nullif(trim(coalesce(v_result ->> 'nett_score', '')), '')::integer;
        v_points := nullif(trim(coalesce(v_result ->> 'points', '')), '')::integer;
        v_result_text := nullif(trim(coalesce(v_result ->> 'result_text', '')), '');
        v_membership_id := null;
        v_match_status := 'unmatched';

        if v_player_name is null then
            raise exception 'Every imported result requires player_name.';
        end if;

        if v_placing is not null and v_placing < 1 then
            raise exception 'Imported finishing positions must be positive.';
        end if;

        -- A provider adapter may supply a Paryx membership_id if it already
        -- has a durable mapping. Otherwise Paryx resolves from its link table,
        -- then falls back to an exact active membership number match.
        if nullif(trim(coalesce(v_result ->> 'membership_id', '')), '') is not null then
            select membership.id
            into v_membership_id
            from public.club_memberships as membership
            where membership.id = (v_result ->> 'membership_id')::uuid
              and membership.club_id = v_club_id
              and membership.status = 'active'
              and coalesce(membership.membership_type, 'member') not in ('visitor','guest','staff');
        end if;

        if v_membership_id is null and v_external_player_id is not null then
            select link.membership_id
            into v_membership_id
            from public.club_external_player_links as link
            join public.club_memberships as membership
              on membership.id = link.membership_id
             and membership.club_id = v_club_id
             and membership.status = 'active'
             and coalesce(membership.membership_type, 'member') not in ('visitor','guest','staff')
            where link.club_id = v_club_id
              and link.provider = v_provider
              and link.external_player_id = v_external_player_id
            limit 1;
        end if;

        if v_membership_id is null and v_membership_number is not null then
            select (array_agg(membership.id))[1]
            into v_membership_id
            from public.club_memberships as membership
            where membership.club_id = v_club_id
              and membership.status = 'active'
              and coalesce(membership.membership_type, 'member') not in ('visitor','guest','staff')
              and lower(trim(coalesce(membership.membership_number, ''))) = lower(v_membership_number)
            having count(*) = 1;
        end if;

        if v_membership_id is not null then
            v_match_status := 'matched';
            v_matched_count := v_matched_count + 1;

            if v_external_player_id is not null then
                insert into public.club_external_player_links (
                    club_id,
                    provider,
                    external_player_id,
                    membership_id,
                    match_source
                )
                values (
                    v_club_id,
                    v_provider,
                    v_external_player_id,
                    v_membership_id,
                    case when v_membership_number is not null then 'membership_number' else 'provider' end
                )
                on conflict (club_id, provider, external_player_id)
                do update set
                    membership_id = excluded.membership_id,
                    updated_at = now();
            end if;
        else
            v_unmatched_count := v_unmatched_count + 1;
        end if;

        v_external_result_key := coalesce(
            v_external_result_id,
            case
                when v_external_player_id is not null
                    then 'player:' || v_external_player_id || ':place:' || coalesce(v_placing::text, 'none')
                else 'name:' || md5(lower(v_player_name)) || ':place:' || coalesce(v_placing::text, 'none')
            end
        );

        insert into public.club_competition_external_results (
            competition_id,
            import_id,
            provider,
            external_result_key,
            external_result_id,
            external_player_id,
            external_membership_number,
            external_player_name,
            finishing_position,
            gross_score,
            nett_score,
            points,
            result_text,
            membership_id,
            match_status,
            raw_result,
            imported_at,
            updated_at
        )
        values (
            p_competition_id,
            v_import_id,
            v_provider,
            v_external_result_key,
            v_external_result_id,
            v_external_player_id,
            v_membership_number,
            v_player_name,
            v_placing,
            v_gross,
            v_nett,
            v_points,
            v_result_text,
            v_membership_id,
            v_match_status,
            v_result,
            now(),
            now()
        );

        v_result_count := v_result_count + 1;
    end loop;

    update public.club_competitions
    set
        result_provider = v_provider,
        external_competition_id = coalesce(nullif(trim(coalesce(p_external_competition_id, '')), ''), external_competition_id),
        external_status = nullif(trim(coalesce(p_provider_status, '')), ''),
        result_sync_status = case when v_unmatched_count > 0 then 'partial_match' else 'imported' end,
        last_result_sync_at = now(),
        result_imported_at = now(),
        result_sync_error = null,
        status = case
            when results_confirmed_at is not null then status
            else 'results_pending'
        end,
        updated_at = now()
    where id = p_competition_id;

    update public.club_competition_result_integrations
    set
        last_sync_at = now(),
        last_sync_status = case when v_unmatched_count > 0 then 'partial_match' else 'success' end,
        last_sync_error = null,
        updated_at = now()
    where club_id = v_club_id
      and provider = v_provider;

    return jsonb_build_object(
        'competition_id', p_competition_id,
        'provider', v_provider,
        'import_id', v_import_id,
        'result_count', v_result_count,
        'matched_count', v_matched_count,
        'unmatched_count', v_unmatched_count,
        'sync_status', case when v_unmatched_count > 0 then 'partial_match' else 'imported' end
    );
end;
$$;

revoke all on function public.competition_import_external_results(uuid,text,text,text,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.competition_import_external_results(uuid,text,text,text,jsonb,jsonb) to service_role;

create or replace function public.competition_mark_result_sync_error(
    p_competition_id uuid,
    p_provider text,
    p_error text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_club_id uuid;
begin
    select competition.club_id
    into v_club_id
    from public.club_competitions as competition
    where competition.id = p_competition_id;

    if v_club_id is null then
        return false;
    end if;

    update public.club_competitions
    set
        result_provider = lower(trim(p_provider)),
        result_sync_status = 'error',
        last_result_sync_at = now(),
        result_sync_error = left(coalesce(p_error, 'Unknown provider sync error.'), 1000),
        updated_at = now()
    where id = p_competition_id;

    update public.club_competition_result_integrations
    set
        last_sync_at = now(),
        last_sync_status = 'error',
        last_sync_error = left(coalesce(p_error, 'Unknown provider sync error.'), 1000),
        updated_at = now()
    where club_id = v_club_id
      and provider = lower(trim(p_provider));

    return true;
end;
$$;

revoke all on function public.competition_mark_result_sync_error(uuid,text,text) from public, anon, authenticated;
grant execute on function public.competition_mark_result_sync_error(uuid,text,text) to service_role;

create or replace function public.competition_link_external_player(
    p_external_result_id uuid,
    p_membership_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_club_id uuid;
    v_provider text;
    v_external_player_id text;
begin
    select
        competition.club_id,
        external_result.provider,
        external_result.external_player_id
    into
        v_club_id,
        v_provider,
        v_external_player_id
    from public.club_competition_external_results as external_result
    join public.club_competitions as competition
      on competition.id = external_result.competition_id
    where external_result.id = p_external_result_id
      and competition.results_confirmed_at is null;

    if v_club_id is null
       or auth.uid() is null
       or not public.user_can_manage_competitions(v_club_id) then
        raise exception 'Competition management access required.';
    end if;

    if not exists (
        select 1
        from public.club_memberships as membership
        where membership.id = p_membership_id
          and membership.club_id = v_club_id
          and membership.status = 'active'
          and coalesce(membership.membership_type, 'member') not in ('visitor', 'guest', 'staff')
    ) then
        raise exception 'Select an active club member.';
    end if;

    update public.club_competition_external_results
    set
        membership_id = p_membership_id,
        match_status = 'matched',
        updated_at = now()
    where id = p_external_result_id;

    if v_external_player_id is not null then
        insert into public.club_external_player_links (
            club_id,
            provider,
            external_player_id,
            membership_id,
            match_source
        )
        values (
            v_club_id,
            v_provider,
            v_external_player_id,
            p_membership_id,
            'manual'
        )
        on conflict (club_id, provider, external_player_id)
        do update set
            membership_id = excluded.membership_id,
            match_source = 'manual',
            updated_at = now();
    end if;

    update public.club_competitions as competition
    set
        result_sync_status = case
            when exists (
                select 1
                from public.club_competition_external_results as remaining
                where remaining.competition_id = competition.id
                  and remaining.membership_id is null
            ) then 'partial_match'
            else 'imported'
        end,
        updated_at = now()
    where competition.id = (
        select external_result.competition_id
        from public.club_competition_external_results as external_result
        where external_result.id = p_external_result_id
    );

    return true;
end;
$$;

revoke all on function public.competition_link_external_player(uuid,uuid) from public, anon;
grant execute on function public.competition_link_external_player(uuid,uuid) to authenticated;

-- ---------------------------------------------------------
-- UNIFIED AWARD SAVE / CONFIRM
-- ---------------------------------------------------------

create or replace function public.competition_save_awards_v2(
    p_competition_id uuid,
    p_awards jsonb,
    p_confirm boolean default false,
    p_verified boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_club_id uuid;
    v_competition_name text;
    v_club_event_id uuid;
    v_currency text;
    v_provider text;
    v_award jsonb;
    v_award_key text;
    v_award_type text;
    v_membership_id uuid;
    v_external_result_id uuid;
    v_source_external_result_key text;
    v_placing integer;
    v_label text;
    v_amount numeric(12,2);
    v_account_id uuid;
    v_account_currency text;
    v_balance_before numeric(12,2);
    v_balance_after numeric(12,2);
    v_transaction_id uuid;
    v_external_event_id text;
    v_award_count integer := 0;
    v_credit_count integer := 0;
    v_total_credit numeric(12,2) := 0;
    v_seen_keys text[] := '{}'::text[];
begin
    select
        competition.club_id,
        coalesce(event.title, competition.name),
        competition.club_event_id,
        coalesce(settings.currency_code, 'GBP'),
        competition.result_provider
    into
        v_club_id,
        v_competition_name,
        v_club_event_id,
        v_currency,
        v_provider
    from public.club_competitions as competition
    left join public.club_events as event on event.id = competition.club_event_id
    left join public.club_settings as settings on settings.club_id = competition.club_id
    where competition.id = p_competition_id
      and competition.results_confirmed_at is null;

    if v_club_id is null
       or auth.uid() is null
       or not public.user_can_manage_competitions(v_club_id) then
        raise exception 'Competition management access required.';
    end if;

    if coalesce(p_confirm, false)
       and not public.user_can_confirm_competition_results(v_club_id) then
        raise exception 'Manager or Club Admin confirmation is required.';
    end if;

    if p_awards is null or jsonb_typeof(p_awards) <> 'array' then
        raise exception 'Competition awards must be supplied as an array.';
    end if;

    if coalesce(p_confirm, false) and not coalesce(p_verified, false) then
        raise exception 'Verify the official result against HowDidiDo / ClubV1 before confirming awards.';
    end if;

    if coalesce(p_confirm, false) and jsonb_array_length(p_awards) = 0 then
        raise exception 'Add at least one competition award before confirming.';
    end if;

    -- Validate the entire batch before replacing saved draft awards.
    for v_award in select value from jsonb_array_elements(p_awards)
    loop
        v_award_key := nullif(trim(coalesce(v_award ->> 'award_key', '')), '');
        v_award_type := lower(trim(coalesce(v_award ->> 'award_type', '')));
        v_membership_id := nullif(trim(coalesce(v_award ->> 'membership_id', '')), '')::uuid;
        v_external_result_id := nullif(trim(coalesce(v_award ->> 'external_result_id', '')), '')::uuid;
        v_source_external_result_key := nullif(trim(coalesce(v_award ->> 'source_external_result_key', '')), '');
        v_placing := nullif(trim(coalesce(v_award ->> 'finishing_position', '')), '')::integer;
        v_label := nullif(trim(coalesce(v_award ->> 'label', '')), '');
        v_amount := round(coalesce(nullif(trim(coalesce(v_award ->> 'amount', '')), '')::numeric, 0), 2);

        if v_award_key is null then
            raise exception 'Every competition award requires an award key.';
        end if;

        if v_award_key = any(v_seen_keys) then
            raise exception 'The same competition award is included more than once.';
        end if;
        v_seen_keys := array_append(v_seen_keys, v_award_key);

        if v_award_type not in ('winner','runner_up','third_place','place_prize','best_gross','nearest_pin','longest_drive','twos','division','other') then
            raise exception 'Unsupported competition prize type.';
        end if;

        if v_membership_id is null or not exists (
            select 1
            from public.club_memberships as membership
            where membership.id = v_membership_id
              and membership.club_id = v_club_id
              and membership.status = 'active'
              and coalesce(membership.membership_type, 'member') not in ('visitor','guest','staff')
        ) then
            raise exception 'Every competition award must be assigned to an active club member.';
        end if;

        if v_placing is not null and (v_placing < 1 or v_placing > 20) then
            raise exception 'Prize placing must be between 1 and 20.';
        end if;

        if v_amount < 0 then
            raise exception 'Competition credit cannot be negative.';
        end if;

        if v_external_result_id is not null and not exists (
            select 1
            from public.club_competition_external_results as external_result
            where external_result.id = v_external_result_id
              and external_result.competition_id = p_competition_id
        ) then
            raise exception 'The linked imported result does not belong to this competition.';
        end if;

        if v_label is null then
            v_label := case v_award_type
                when 'winner' then 'Winner'
                when 'runner_up' then 'Runner-up'
                when 'third_place' then 'Third place'
                when 'place_prize' then coalesce(v_placing::text || ' place', 'Place prize')
                when 'best_gross' then 'Best gross'
                when 'nearest_pin' then 'Nearest the pin'
                when 'longest_drive' then 'Longest drive'
                when 'twos' then 'Two''s prize'
                when 'division' then 'Division prize'
                else 'Competition prize'
            end;
        end if;

        v_award_count := v_award_count + 1;
        v_total_credit := v_total_credit + v_amount;
    end loop;

    if coalesce(p_confirm, false)
       and v_total_credit > 0
       and not public.user_can_manage_club_credit(v_club_id) then
        raise exception 'Member Club Credit must be enabled before competition prizes can be awarded.';
    end if;

    delete from public.club_competition_prizes
    where competition_id = p_competition_id
      and credit_transaction_id is null;

    for v_award in select value from jsonb_array_elements(p_awards)
    loop
        v_award_key := trim(v_award ->> 'award_key');
        v_award_type := lower(trim(v_award ->> 'award_type'));
        v_membership_id := (v_award ->> 'membership_id')::uuid;
        v_external_result_id := nullif(trim(coalesce(v_award ->> 'external_result_id', '')), '')::uuid;
        v_source_external_result_key := nullif(trim(coalesce(v_award ->> 'source_external_result_key', '')), '');
        v_placing := nullif(trim(coalesce(v_award ->> 'finishing_position', '')), '')::integer;
        v_amount := round(coalesce(nullif(trim(coalesce(v_award ->> 'amount', '')), '')::numeric, 0), 2);
        v_label := nullif(trim(coalesce(v_award ->> 'label', '')), '');

        if v_label is null then
            v_label := case v_award_type
                when 'winner' then 'Winner'
                when 'runner_up' then 'Runner-up'
                when 'third_place' then 'Third place'
                when 'place_prize' then coalesce(v_placing::text || ' place', 'Place prize')
                when 'best_gross' then 'Best gross'
                when 'nearest_pin' then 'Nearest the pin'
                when 'longest_drive' then 'Longest drive'
                when 'twos' then 'Two''s prize'
                when 'division' then 'Division prize'
                else 'Competition prize'
            end;
        end if;

        insert into public.club_competition_prizes (
            competition_id,
            finishing_position,
            label,
            amount,
            currency_code,
            created_by,
            award_key,
            award_type,
            recipient_membership_id,
            external_result_id,
            source_external_result_key
        )
        values (
            p_competition_id,
            v_placing,
            v_label,
            v_amount,
            v_currency,
            auth.uid(),
            v_award_key,
            v_award_type,
            v_membership_id,
            v_external_result_id,
            v_source_external_result_key
        );
    end loop;

    if coalesce(p_confirm, false) then
        for v_award in
            select value
            from jsonb_array_elements(p_awards)
            where coalesce(nullif(trim(coalesce(value ->> 'amount', '')), '')::numeric, 0) > 0
        loop
            v_award_key := trim(v_award ->> 'award_key');
            v_membership_id := (v_award ->> 'membership_id')::uuid;
            v_amount := round((v_award ->> 'amount')::numeric, 2);
            v_label := coalesce(nullif(trim(coalesce(v_award ->> 'label', '')), ''), 'Competition prize');
            v_external_event_id := 'competition:' || p_competition_id::text || ':award:' || v_award_key;

            if exists (
                select 1
                from public.club_member_account_transactions as transaction
                where transaction.club_id = v_club_id
                  and transaction.external_event_id = v_external_event_id
            ) then
                raise exception 'This competition prize has already been awarded.';
            end if;

            insert into public.club_member_accounts (
                club_id,
                membership_id,
                balance,
                currency_code
            )
            values (v_club_id, v_membership_id, 0, v_currency)
            on conflict (club_id, membership_id) do nothing;

            select
                account.id,
                account.balance,
                account.currency_code
            into
                v_account_id,
                v_balance_before,
                v_account_currency
            from public.club_member_accounts as account
            where account.club_id = v_club_id
              and account.membership_id = v_membership_id
              and account.is_active
            for update;

            if v_account_id is null then
                raise exception 'The selected member does not have an available Club Credit account.';
            end if;

            v_balance_after := v_balance_before + v_amount;

            update public.club_member_accounts
            set balance = v_balance_after, updated_at = now()
            where id = v_account_id;

            insert into public.club_member_account_transactions (
                club_id,
                account_id,
                membership_id,
                transaction_type,
                amount,
                balance_before,
                balance_after,
                currency_code,
                reference,
                description,
                club_event_id,
                source,
                external_event_id,
                created_by
            )
            values (
                v_club_id,
                v_account_id,
                v_membership_id,
                'competition_prize',
                v_amount,
                v_balance_before,
                v_balance_after,
                coalesce(v_account_currency, v_currency),
                v_competition_name,
                'Competition prize — ' || v_label,
                v_club_event_id,
                'competition',
                v_external_event_id,
                auth.uid()
            )
            returning id into v_transaction_id;

            update public.club_competition_prizes
            set credit_transaction_id = v_transaction_id, updated_at = now()
            where competition_id = p_competition_id
              and award_key = v_award_key;

            v_credit_count := v_credit_count + 1;
        end loop;

        update public.club_competitions
        set
            status = 'completed',
            results_verified_at = now(),
            results_verified_by = auth.uid(),
            results_verified_source = case
                when v_provider = 'clubv1' then 'clubv1/howdidido'
                when v_provider = 'manual' then 'manual/howdidido'
                else v_provider || '/howdidido'
            end,
            results_confirmed_at = now(),
            results_confirmed_by = auth.uid(),
            updated_at = now()
        where id = p_competition_id;
    else
        update public.club_competitions
        set
            status = case
                when jsonb_array_length(p_awards) > 0 and status in ('draft','open','closed')
                    then 'results_pending'
                else status
            end,
            updated_at = now()
        where id = p_competition_id;
    end if;

    return jsonb_build_object(
        'saved_awards', v_award_count,
        'awarded_transactions', v_credit_count,
        'total_credit', v_total_credit,
        'currency_code', v_currency,
        'confirmed', coalesce(p_confirm, false)
    );
end;
$$;

revoke all on function public.competition_save_awards_v2(uuid,jsonb,boolean,boolean) from public, anon;
grant execute on function public.competition_save_awards_v2(uuid,jsonb,boolean,boolean) to authenticated;

-- Keep reopen behaviour compatible with the new verification audit fields.
-- Results with posted Club Credit remain locked; zero-credit confirmations can
-- be reopened by Manager / Club Admin.
create or replace function public.competition_reopen_results(p_competition_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_club_id uuid;
begin
    select competition.club_id
    into v_club_id
    from public.club_competitions as competition
    where competition.id = p_competition_id;

    if v_club_id is null
       or auth.uid() is null
       or not public.user_can_confirm_competition_results(v_club_id) then
        raise exception 'Manager or Club Admin confirmation is required.';
    end if;

    if exists (
        select 1
        from public.club_competition_prizes as prize
        where prize.competition_id = p_competition_id
          and prize.credit_transaction_id is not null
    ) then
        raise exception 'Club Credit has already been awarded. Correct the balance through Club Credit rather than reopening this result.';
    end if;

    update public.club_competitions
    set
        status = 'results_pending',
        results_verified_at = null,
        results_verified_by = null,
        results_verified_source = null,
        results_confirmed_at = null,
        results_confirmed_by = null,
        updated_at = now()
    where id = p_competition_id;

    return true;
end;
$$;

revoke all on function public.competition_reopen_results(uuid) from public, anon;
grant execute on function public.competition_reopen_results(uuid) to authenticated;

commit;

notify pgrst, 'reload schema';
