-- =========================================================
-- FIX NOTE:
-- PostgreSQL treats PLACING as a reserved keyword.
-- Physical table columns have been renamed to finishing_position.
-- API-facing JSON key 'placing', RPC parameter p_placing and prize JSON input
-- key 'placing' are deliberately retained for frontend compatibility.
--
-- PARYX MIGRATION 034
-- COMPETITION MANAGEMENT V1
-- =========================================================

begin;

create table if not exists public.club_competitions (
    id uuid primary key default gen_random_uuid(),
    club_id uuid not null references public.clubs(id) on delete cascade,
    club_event_id uuid references public.club_events(id) on delete set null,
    name text not null,
    competition_date date not null,
    competition_format text not null default 'stableford',
    section text not null default 'club',
    status text not null default 'draft',
    is_qualifier boolean not null default false,
    notes text,
    results_confirmed_at timestamptz,
    results_confirmed_by uuid references public.profiles(id) on delete set null,
    created_by uuid references public.profiles(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint club_competition_format_valid check (
        competition_format in ('stableford','stroke_play','match_play','fourball','greensomes','texas_scramble','other')
    ),
    constraint club_competition_section_valid check (
        section in ('club','mens','seniors','ladies')
    ),
    constraint club_competition_status_valid check (
        status in ('draft','open','closed','results_pending','completed','cancelled')
    )
);

create unique index if not exists club_competitions_calendar_event_unique
on public.club_competitions (club_event_id)
where club_event_id is not null;

create index if not exists club_competitions_club_date_idx
on public.club_competitions (club_id, competition_date);

create index if not exists club_competitions_club_status_date_idx
on public.club_competitions (club_id, status, competition_date);

alter table public.club_competitions enable row level security;

create table if not exists public.club_competition_entries (
    id uuid primary key default gen_random_uuid(),
    competition_id uuid not null references public.club_competitions(id) on delete cascade,
    membership_id uuid references public.club_memberships(id) on delete set null,
    entry_type text not null default 'member',
    entrant_name text not null,
    entrant_email text,
    membership_number text,
    entry_status text not null default 'entered',
    gross_score integer,
    nett_score integer,
    points integer,
    finishing_position integer,
    result_text text,
    created_by uuid references public.profiles(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint club_competition_entry_type_valid check (entry_type in ('member','manual')),
    constraint club_competition_entry_status_valid check (entry_status in ('entered','completed','no_return','disqualified','withdrawn')),
    constraint club_competition_gross_nonnegative check (gross_score is null or gross_score >= 0),
    constraint club_competition_nett_nonnegative check (nett_score is null or nett_score >= 0),
    constraint club_competition_points_nonnegative check (points is null or points >= 0),
    constraint club_competition_finishing_position_positive check (finishing_position is null or finishing_position >= 1)
);

create unique index if not exists club_competition_entry_member_unique
on public.club_competition_entries (competition_id, membership_id)
where membership_id is not null;

create index if not exists club_competition_entries_competition_idx
on public.club_competition_entries (competition_id, finishing_position, entrant_name);

alter table public.club_competition_entries enable row level security;

create table if not exists public.club_competition_prizes (
    id uuid primary key default gen_random_uuid(),
    competition_id uuid not null references public.club_competitions(id) on delete cascade,
    finishing_position integer not null,
    label text,
    amount numeric(12,2) not null default 0,
    currency_code text not null default 'GBP',
    created_by uuid references public.profiles(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (competition_id, finishing_position),
    constraint club_competition_prize_place_valid check (finishing_position between 1 and 20),
    constraint club_competition_prize_amount_nonnegative check (amount >= 0),
    constraint club_competition_prize_currency_format check (currency_code ~ '^[A-Z]{3}$')
);

create index if not exists club_competition_prizes_competition_idx
on public.club_competition_prizes (competition_id, finishing_position);

alter table public.club_competition_prizes enable row level security;

-- =========================================================
-- ACCESS HELPERS
-- =========================================================

create or replace function public.user_can_view_competitions(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.club_memberships as membership
        join public.clubs as club on club.id = membership.club_id
        where membership.profile_id = auth.uid()
          and membership.club_id = p_club_id
          and membership.status = 'active'
          and membership.role in ('reception','professional','manager','club_admin')
          and club.is_active = true
    );
$$;

revoke all on function public.user_can_view_competitions(uuid) from public, anon;
grant execute on function public.user_can_view_competitions(uuid) to authenticated;

create or replace function public.user_can_manage_competitions(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.club_memberships as membership
        join public.clubs as club on club.id = membership.club_id
        where membership.profile_id = auth.uid()
          and membership.club_id = p_club_id
          and membership.status = 'active'
          and membership.role in ('professional','manager','club_admin')
          and club.is_active = true
    );
$$;

revoke all on function public.user_can_manage_competitions(uuid) from public, anon;
grant execute on function public.user_can_manage_competitions(uuid) to authenticated;

create or replace function public.user_can_confirm_competition_results(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.club_memberships as membership
        join public.clubs as club on club.id = membership.club_id
        where membership.profile_id = auth.uid()
          and membership.club_id = p_club_id
          and membership.status = 'active'
          and membership.role in ('manager','club_admin')
          and club.is_active = true
    );
$$;

revoke all on function public.user_can_confirm_competition_results(uuid) from public, anon;
grant execute on function public.user_can_confirm_competition_results(uuid) to authenticated;

-- =========================================================
-- SUMMARY / DIRECTORY
-- =========================================================

create or replace function public.competition_get_summary(p_club_id uuid)
returns table (
    upcoming_count bigint,
    open_count bigint,
    results_pending_count bigint,
    completed_30d_count bigint
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
        count(*) filter (where competition.competition_date >= current_date and competition.status not in ('completed','cancelled'))::bigint,
        count(*) filter (where competition.status = 'open')::bigint,
        count(*) filter (where competition.status in ('closed','results_pending'))::bigint,
        count(*) filter (where competition.status = 'completed' and competition.results_confirmed_at >= now() - interval '30 days')::bigint
    from public.club_competitions as competition
    where competition.club_id = p_club_id;
end;
$$;

revoke all on function public.competition_get_summary(uuid) from public, anon;
grant execute on function public.competition_get_summary(uuid) to authenticated;

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
    select event.id, event.title, event.event_date, event.section, event.is_qualifier, event.status, competition.id
    from public.club_events as event
    left join public.club_competitions as competition on competition.club_event_id = event.id
    where event.club_id = p_club_id
      and event.event_type = 'competition'
      and event.event_date between p_from_date and p_to_date
      and event.status <> 'cancelled'
    order by event.event_date, lower(event.title);
end;
$$;

revoke all on function public.competition_get_calendar_events(uuid,date,date) from public, anon;
grant execute on function public.competition_get_calendar_events(uuid,date,date) to authenticated;

create or replace function public.competition_list(
    p_club_id uuid,
    p_from_date date,
    p_to_date date,
    p_status text default null,
    p_search text default null
)
returns table (
    competition_id uuid,
    name text,
    competition_date date,
    competition_format text,
    section text,
    section_label text,
    status text,
    is_qualifier boolean,
    club_event_id uuid,
    entry_count bigint,
    completed_result_count bigint,
    prize_total numeric,
    currency_code text,
    results_confirmed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_search text;
begin
    if auth.uid() is null or not public.user_can_view_competitions(p_club_id) then
        raise exception 'Competition access required.';
    end if;
    if p_from_date is null or p_to_date is null or p_to_date < p_from_date then
        raise exception 'A valid competition date range is required.';
    end if;

    v_search := nullif(lower(trim(coalesce(p_search,''))), '');

    return query
    select
        competition.id,
        coalesce(event.title, competition.name)::text,
        coalesce(event.event_date, competition.competition_date)::date,
        competition.competition_format,
        coalesce(event.section, competition.section)::text,
        case coalesce(event.section,competition.section)
            when 'mens' then 'Men'
            when 'seniors' then 'Seniors'
            when 'ladies' then 'Ladies'
            else 'Club'
        end::text,
        competition.status,
        coalesce(event.is_qualifier, competition.is_qualifier)::boolean,
        competition.club_event_id,
        (select count(*) from public.club_competition_entries as entry where entry.competition_id = competition.id)::bigint,
        (select count(*) from public.club_competition_entries as entry where entry.competition_id = competition.id and entry.entry_status = 'completed')::bigint,
        coalesce((select sum(prize.amount) from public.club_competition_prizes as prize where prize.competition_id = competition.id),0)::numeric,
        coalesce((select prize.currency_code from public.club_competition_prizes as prize where prize.competition_id = competition.id order by prize.finishing_position limit 1), settings.currency_code, 'GBP')::text,
        competition.results_confirmed_at
    from public.club_competitions as competition
    left join public.club_events as event on event.id = competition.club_event_id
    left join public.club_settings as settings on settings.club_id = competition.club_id
    where competition.club_id = p_club_id
      and coalesce(event.event_date, competition.competition_date) between p_from_date and p_to_date
      and (p_status is null or trim(p_status) = '' or competition.status = p_status)
      and (v_search is null or lower(coalesce(event.title,competition.name,'')) like '%' || v_search || '%')
    order by coalesce(event.event_date,competition.competition_date), lower(coalesce(event.title,competition.name));
end;
$$;

revoke all on function public.competition_list(uuid,date,date,text,text) from public, anon;
grant execute on function public.competition_list(uuid,date,date,text,text) to authenticated;

-- =========================================================
-- SAVE / DETAIL
-- =========================================================

create or replace function public.competition_save(
    p_club_id uuid,
    p_competition_id uuid,
    p_club_event_id uuid,
    p_name text,
    p_competition_date date,
    p_competition_format text,
    p_section text,
    p_status text,
    p_is_qualifier boolean,
    p_notes text
)
returns table (competition_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_id uuid;
    v_event_title text;
    v_event_date date;
    v_event_section text;
    v_event_qualifier boolean;
    v_name text;
    v_date date;
    v_section text;
    v_qualifier boolean;
begin
    if auth.uid() is null or not public.user_can_manage_competitions(p_club_id) then
        raise exception 'Competition management access required.';
    end if;

    if p_competition_id is not null and exists (
        select 1 from public.club_competitions as competition
        where competition.id = p_competition_id and competition.results_confirmed_at is not null
    ) then
        raise exception 'Confirmed results must be reopened before editing this competition.';
    end if;

    if p_competition_format not in ('stableford','stroke_play','match_play','fourball','greensomes','texas_scramble','other') then
        raise exception 'Unsupported competition format.';
    end if;
    if p_section not in ('club','mens','seniors','ladies') then
        raise exception 'Unsupported competition section.';
    end if;
    if p_status not in ('draft','open','closed','results_pending','cancelled') then
        raise exception 'Unsupported competition status.';
    end if;

    v_name := nullif(trim(coalesce(p_name,'')), '');
    v_date := p_competition_date;
    v_section := p_section;
    v_qualifier := coalesce(p_is_qualifier,false);

    if p_club_event_id is not null then
        select event.title,event.event_date,event.section,event.is_qualifier
        into v_event_title,v_event_date,v_event_section,v_event_qualifier
        from public.club_events as event
        where event.id = p_club_event_id
          and event.club_id = p_club_id
          and event.event_type = 'competition'
          and event.status <> 'cancelled';

        if not found then raise exception 'The selected Calendar competition is not available.'; end if;

        if exists (
            select 1 from public.club_competitions as other_competition
            where other_competition.club_event_id = p_club_event_id
              and (p_competition_id is null or other_competition.id <> p_competition_id)
        ) then
            raise exception 'That Calendar event is already linked to another competition.';
        end if;

        v_name := v_event_title;
        v_date := v_event_date;
        v_section := v_event_section;
        v_qualifier := v_event_qualifier;
    end if;

    if v_name is null then raise exception 'Competition name is required.'; end if;
    if v_date is null then raise exception 'Competition date is required.'; end if;

    if p_competition_id is null then
        insert into public.club_competitions (
            club_id,club_event_id,name,competition_date,competition_format,section,status,is_qualifier,notes,created_by
        ) values (
            p_club_id,p_club_event_id,v_name,v_date,p_competition_format,v_section,p_status,v_qualifier,
            nullif(trim(coalesce(p_notes,'')),''),auth.uid()
        ) returning id into v_id;
    else
        update public.club_competitions
        set club_event_id = p_club_event_id,
            name = v_name,
            competition_date = v_date,
            competition_format = p_competition_format,
            section = v_section,
            status = p_status,
            is_qualifier = v_qualifier,
            notes = nullif(trim(coalesce(p_notes,'')),''),
            updated_at = now()
        where id = p_competition_id and club_id = p_club_id
        returning id into v_id;

        if v_id is null then raise exception 'Competition not found for selected club.'; end if;
    end if;

    return query select v_id;
end;
$$;

revoke all on function public.competition_save(uuid,uuid,uuid,text,date,text,text,text,boolean,text) from public, anon;
grant execute on function public.competition_save(uuid,uuid,uuid,text,date,text,text,text,boolean,text) to authenticated;

create or replace function public.competition_get_detail(p_competition_id uuid)
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
    select competition.club_id into v_club_id
    from public.club_competitions as competition
    where competition.id = p_competition_id;

    if v_club_id is null or auth.uid() is null or not public.user_can_view_competitions(v_club_id) then
        raise exception 'Competition access required.';
    end if;

    select jsonb_build_object(
        'competition', jsonb_build_object(
            'competition_id',competition.id,
            'club_id',competition.club_id,
            'club_event_id',competition.club_event_id,
            'name',coalesce(event.title,competition.name),
            'competition_date',coalesce(event.event_date,competition.competition_date),
            'competition_format',competition.competition_format,
            'section',coalesce(event.section,competition.section),
            'status',competition.status,
            'is_qualifier',coalesce(event.is_qualifier,competition.is_qualifier),
            'notes',competition.notes,
            'results_confirmed_at',competition.results_confirmed_at,
            'results_confirmed_by',competition.results_confirmed_by,
            'currency_code',coalesce(settings.currency_code,'GBP')
        ),
        'entries', coalesce((
            select jsonb_agg(jsonb_build_object(
                'entry_id',entry.id,
                'membership_id',entry.membership_id,
                'entry_type',entry.entry_type,
                'entrant_name',entry.entrant_name,
                'entrant_email',entry.entrant_email,
                'membership_number',entry.membership_number,
                'entry_status',entry.entry_status,
                'gross_score',entry.gross_score,
                'nett_score',entry.nett_score,
                'points',entry.points,
                'placing',entry.finishing_position,
                'result_text',entry.result_text
            ) order by entry.finishing_position nulls last, lower(entry.entrant_name), entry.created_at)
            from public.club_competition_entries as entry
            where entry.competition_id = competition.id
        ), '[]'::jsonb),
        'prizes', coalesce((
            select jsonb_agg(jsonb_build_object(
                'prize_id',prize.id,
                'placing',prize.finishing_position,
                'label',prize.label,
                'amount',prize.amount,
                'currency_code',prize.currency_code
            ) order by prize.finishing_position)
            from public.club_competition_prizes as prize
            where prize.competition_id = competition.id
        ), '[]'::jsonb)
    ) into v_result
    from public.club_competitions as competition
    left join public.club_events as event on event.id = competition.club_event_id
    left join public.club_settings as settings on settings.club_id = competition.club_id
    where competition.id = p_competition_id;

    return v_result;
end;
$$;

revoke all on function public.competition_get_detail(uuid) from public, anon;
grant execute on function public.competition_get_detail(uuid) to authenticated;

-- =========================================================
-- ENTRANTS / RESULTS
-- =========================================================

create or replace function public.competition_search_members(p_club_id uuid,p_search text)
returns table (
    membership_id uuid,
    profile_id uuid,
    display_name text,
    email text,
    membership_number text,
    membership_type text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_search text;
begin
    if auth.uid() is null or not public.user_can_manage_competitions(p_club_id) then
        raise exception 'Competition management access required.';
    end if;

    v_search := nullif(lower(trim(coalesce(p_search,''))), '');
    if v_search is null then return; end if;

    return query
    select
        membership.id,
        membership.profile_id,
        coalesce(nullif(trim(profile.display_name),''),nullif(trim(concat_ws(' ',profile.first_name,profile.last_name)),''),auth_user.email::text,'Member')::text,
        auth_user.email::text,
        membership.membership_number,
        membership.membership_type
    from public.club_memberships as membership
    join public.profiles as profile on profile.id = membership.profile_id
    join auth.users as auth_user on auth_user.id = membership.profile_id
    where membership.club_id = p_club_id
      and membership.status = 'active'
      and coalesce(membership.membership_type,'member') not in ('visitor','guest','staff')
      and (
          lower(coalesce(profile.display_name,'')) like '%' || v_search || '%'
          or lower(coalesce(profile.first_name,'')) like '%' || v_search || '%'
          or lower(coalesce(profile.last_name,'')) like '%' || v_search || '%'
          or lower(coalesce(auth_user.email,'')) like '%' || v_search || '%'
          or lower(coalesce(membership.membership_number,'')) like '%' || v_search || '%'
      )
    order by lower(coalesce(nullif(trim(profile.display_name),''),profile.last_name,auth_user.email::text,''))
    limit 100;
end;
$$;

revoke all on function public.competition_search_members(uuid,text) from public, anon;
grant execute on function public.competition_search_members(uuid,text) to authenticated;

create or replace function public.competition_add_member_entry(p_competition_id uuid,p_membership_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_club_id uuid;
    v_entry_id uuid;
    v_name text;
    v_email text;
    v_membership_number text;
begin
    select competition.club_id into v_club_id
    from public.club_competitions as competition
    where competition.id = p_competition_id and competition.results_confirmed_at is null;

    if v_club_id is null or auth.uid() is null or not public.user_can_manage_competitions(v_club_id) then
        raise exception 'Competition management access required.';
    end if;

    select
        coalesce(nullif(trim(profile.display_name),''),nullif(trim(concat_ws(' ',profile.first_name,profile.last_name)),''),auth_user.email::text,'Member')::text,
        auth_user.email::text,
        membership.membership_number
    into v_name,v_email,v_membership_number
    from public.club_memberships as membership
    join public.profiles as profile on profile.id = membership.profile_id
    join auth.users as auth_user on auth_user.id = membership.profile_id
    where membership.id = p_membership_id
      and membership.club_id = v_club_id
      and membership.status = 'active'
      and coalesce(membership.membership_type,'member') not in ('visitor','guest','staff');

    if v_name is null then raise exception 'An active genuine club member is required.'; end if;

    insert into public.club_competition_entries (
        competition_id,membership_id,entry_type,entrant_name,entrant_email,membership_number,created_by
    ) values (
        p_competition_id,p_membership_id,'member',v_name,v_email,v_membership_number,auth.uid()
    )
    on conflict (competition_id,membership_id) where membership_id is not null
    do update set entrant_name = excluded.entrant_name,
                  entrant_email = excluded.entrant_email,
                  membership_number = excluded.membership_number,
                  updated_at = now()
    returning id into v_entry_id;

    return v_entry_id;
end;
$$;

revoke all on function public.competition_add_member_entry(uuid,uuid) from public, anon;
grant execute on function public.competition_add_member_entry(uuid,uuid) to authenticated;

create or replace function public.competition_add_manual_entry(p_competition_id uuid,p_entrant_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_club_id uuid;
    v_name text;
    v_entry_id uuid;
begin
    select competition.club_id into v_club_id
    from public.club_competitions as competition
    where competition.id = p_competition_id and competition.results_confirmed_at is null;

    if v_club_id is null or auth.uid() is null or not public.user_can_manage_competitions(v_club_id) then
        raise exception 'Competition management access required.';
    end if;

    v_name := nullif(trim(coalesce(p_entrant_name,'')), '');
    if v_name is null then raise exception 'Entrant name is required.'; end if;

    insert into public.club_competition_entries (competition_id,entry_type,entrant_name,created_by)
    values (p_competition_id,'manual',v_name,auth.uid())
    returning id into v_entry_id;

    return v_entry_id;
end;
$$;

revoke all on function public.competition_add_manual_entry(uuid,text) from public, anon;
grant execute on function public.competition_add_manual_entry(uuid,text) to authenticated;

create or replace function public.competition_save_entry_result(
    p_entry_id uuid,
    p_entry_status text,
    p_gross_score integer,
    p_nett_score integer,
    p_points integer,
    p_placing integer,
    p_result_text text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_competition_id uuid;
    v_club_id uuid;
begin
    select entry.competition_id,competition.club_id
    into v_competition_id,v_club_id
    from public.club_competition_entries as entry
    join public.club_competitions as competition on competition.id = entry.competition_id
    where entry.id = p_entry_id and competition.results_confirmed_at is null;

    if v_club_id is null or auth.uid() is null or not public.user_can_manage_competitions(v_club_id) then
        raise exception 'Competition management access required.';
    end if;

    if p_entry_status not in ('entered','completed','no_return','disqualified','withdrawn') then
        raise exception 'Unsupported entry status.';
    end if;
    if p_gross_score is not null and p_gross_score < 0 then raise exception 'Gross score cannot be negative.'; end if;
    if p_nett_score is not null and p_nett_score < 0 then raise exception 'Nett score cannot be negative.'; end if;
    if p_points is not null and p_points < 0 then raise exception 'Points cannot be negative.'; end if;
    if p_placing is not null and p_placing < 1 then raise exception 'Placing must be at least 1.'; end if;
    if p_placing is not null and p_entry_status in ('withdrawn','disqualified','no_return') then
        raise exception 'Withdrawn, disqualified or no-return entrants cannot hold a placing.';
    end if;
    if p_placing is not null and exists (
        select 1 from public.club_competition_entries as other_entry
        where other_entry.competition_id = v_competition_id
          and other_entry.id <> p_entry_id
          and other_entry.finishing_position = p_placing
    ) then
        raise exception 'That placing is already assigned to another entrant.';
    end if;

    update public.club_competition_entries
    set entry_status = p_entry_status,
        gross_score = p_gross_score,
        nett_score = p_nett_score,
        points = p_points,
        finishing_position = p_placing,
        result_text = nullif(trim(coalesce(p_result_text,'')),''),
        updated_at = now()
    where id = p_entry_id;

    update public.club_competitions
    set status = case when status in ('draft','open','closed') then 'results_pending' else status end,
        updated_at = now()
    where id = v_competition_id;

    return true;
end;
$$;

revoke all on function public.competition_save_entry_result(uuid,text,integer,integer,integer,integer,text) from public, anon;
grant execute on function public.competition_save_entry_result(uuid,text,integer,integer,integer,integer,text) to authenticated;

create or replace function public.competition_remove_entry(p_entry_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_club_id uuid;
begin
    select competition.club_id into v_club_id
    from public.club_competition_entries as entry
    join public.club_competitions as competition on competition.id = entry.competition_id
    where entry.id = p_entry_id and competition.results_confirmed_at is null;

    if v_club_id is null or auth.uid() is null or not public.user_can_manage_competitions(v_club_id) then
        raise exception 'Competition management access required.';
    end if;

    delete from public.club_competition_entries where id = p_entry_id;
    return true;
end;
$$;

revoke all on function public.competition_remove_entry(uuid) from public, anon;
grant execute on function public.competition_remove_entry(uuid) to authenticated;

-- =========================================================
-- PRIZES / CONFIRMATION
-- =========================================================

create or replace function public.competition_save_prizes(p_competition_id uuid,p_prizes jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_club_id uuid;
    v_currency text;
    v_prize jsonb;
    v_placing integer;
    v_amount numeric(12,2);
    v_label text;
begin
    select competition.club_id into v_club_id
    from public.club_competitions as competition
    where competition.id = p_competition_id and competition.results_confirmed_at is null;

    if v_club_id is null or auth.uid() is null or not public.user_can_manage_competitions(v_club_id) then
        raise exception 'Competition management access required.';
    end if;
    if p_prizes is null or jsonb_typeof(p_prizes) <> 'array' then
        raise exception 'Prize structure must be an array.';
    end if;

    select coalesce(settings.currency_code,'GBP') into v_currency
    from public.club_settings as settings where settings.club_id = v_club_id limit 1;
    v_currency := coalesce(v_currency,'GBP');

    delete from public.club_competition_prizes where competition_id = p_competition_id;

    for v_prize in select value from jsonb_array_elements(p_prizes)
    loop
        v_placing := nullif(trim(coalesce(v_prize ->> 'placing','')),'')::integer;
        v_amount := round(coalesce(nullif(trim(coalesce(v_prize ->> 'amount','')),'')::numeric,0),2);
        v_label := nullif(trim(coalesce(v_prize ->> 'label','')),'');

        if v_placing is null or v_placing not between 1 and 20 then raise exception 'Prize placing must be between 1 and 20.'; end if;
        if v_amount < 0 then raise exception 'Prize value cannot be negative.'; end if;

        insert into public.club_competition_prizes (competition_id,finishing_position,label,amount,currency_code,created_by)
        values (p_competition_id,v_placing,v_label,v_amount,v_currency,auth.uid());
    end loop;

    return true;
end;
$$;

revoke all on function public.competition_save_prizes(uuid,jsonb) from public, anon;
grant execute on function public.competition_save_prizes(uuid,jsonb) to authenticated;

create or replace function public.competition_confirm_results(p_competition_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_club_id uuid;
begin
    select competition.club_id into v_club_id
    from public.club_competitions as competition
    where competition.id = p_competition_id and competition.results_confirmed_at is null;

    if v_club_id is null or auth.uid() is null or not public.user_can_confirm_competition_results(v_club_id) then
        raise exception 'Manager or Club Admin confirmation is required.';
    end if;

    if not exists (
        select 1 from public.club_competition_entries as entry
        where entry.competition_id = p_competition_id
          and entry.entry_status = 'completed'
          and entry.finishing_position is not null
    ) then
        raise exception 'At least one completed entrant with a placing is required.';
    end if;

    if exists (
        select 1 from public.club_competition_prizes as prize
        where prize.competition_id = p_competition_id
          and prize.amount > 0
          and not exists (
              select 1 from public.club_competition_entries as entry
              where entry.competition_id = p_competition_id
                and entry.entry_status = 'completed'
                and entry.finishing_position = prize.finishing_position
          )
    ) then
        raise exception 'Every positive-value prize place must have a matching completed entrant.';
    end if;

    update public.club_competitions
    set status = 'completed',
        results_confirmed_at = now(),
        results_confirmed_by = auth.uid(),
        updated_at = now()
    where id = p_competition_id;

    return true;
end;
$$;

revoke all on function public.competition_confirm_results(uuid) from public, anon;
grant execute on function public.competition_confirm_results(uuid) to authenticated;

create or replace function public.competition_reopen_results(p_competition_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_club_id uuid;
begin
    select competition.club_id into v_club_id
    from public.club_competitions as competition where competition.id = p_competition_id;

    if v_club_id is null or auth.uid() is null or not public.user_can_confirm_competition_results(v_club_id) then
        raise exception 'Manager or Club Admin confirmation is required.';
    end if;

    update public.club_competitions
    set status = 'results_pending', results_confirmed_at = null, results_confirmed_by = null, updated_at = now()
    where id = p_competition_id;

    return true;
end;
$$;

revoke all on function public.competition_reopen_results(uuid) from public, anon;
grant execute on function public.competition_reopen_results(uuid) to authenticated;

create or replace function public.competition_delete(p_competition_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_club_id uuid;
begin
    select competition.club_id into v_club_id
    from public.club_competitions as competition
    where competition.id = p_competition_id and competition.results_confirmed_at is null;

    if v_club_id is null or auth.uid() is null or not public.user_can_manage_competitions(v_club_id) then
        raise exception 'Competition management access required.';
    end if;

    delete from public.club_competitions where id = p_competition_id;
    return true;
end;
$$;

revoke all on function public.competition_delete(uuid) from public, anon;
grant execute on function public.competition_delete(uuid) to authenticated;

commit;

notify pgrst, 'reload schema';
