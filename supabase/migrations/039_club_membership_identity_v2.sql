-- =========================================================
-- PARYX MIGRATION 039
-- CLUB MEMBERSHIP IDENTITY V2
-- =========================================================
--
-- Purpose
-- 1. Treat a club membership as a club-owned record that can exist without
--    a Paryx Player account.
-- 2. Keep the Player <-> club-member relationship private to Paryx.
-- 3. Allow unclaimed club members to receive Club Credit and competition
--    results before they ever use Paryx.
-- 4. Preserve backwards compatibility for existing linked members/staff.
--
-- Prerequisites: current Demo Ready database plus Competition migrations
-- through 038 when those modules are installed.
-- =========================================================

begin;

-- ---------------------------------------------------------
-- CLUB-OWNED IDENTITY ON THE MEMBERSHIP RECORD
-- ---------------------------------------------------------

alter table public.club_memberships
    alter column profile_id drop not null;

alter table public.club_memberships
    add column if not exists club_first_name text,
    add column if not exists club_last_name text,
    add column if not exists club_display_name text,
    add column if not exists club_email text,
    add column if not exists club_handicap_index numeric(4,1),
    add column if not exists club_handicap_status text;

-- Backfill existing linked memberships from the data the club already saw.
update public.club_memberships as membership
set
    club_first_name = coalesce(membership.club_first_name, profile.first_name),
    club_last_name = coalesce(membership.club_last_name, profile.last_name),
    club_display_name = coalesce(
        nullif(trim(membership.club_display_name), ''),
        nullif(trim(profile.display_name), ''),
        nullif(trim(concat_ws(' ', profile.first_name, profile.last_name)), '')
    ),
    club_email = coalesce(
        nullif(trim(membership.club_email), ''),
        auth_user.email::text
    )
from public.profiles as profile
left join auth.users as auth_user
    on auth_user.id = profile.id
where membership.profile_id = profile.id;

update public.club_memberships as membership
set
    club_handicap_index = coalesce(
        membership.club_handicap_index,
        handicap.handicap_index
    ),
    club_handicap_status = coalesce(
        nullif(trim(membership.club_handicap_status), ''),
        handicap.verification_status
    )
from public.player_handicaps as handicap
where membership.profile_id = handicap.profile_id;

-- Membership number is scoped by club. Keep this as a non-unique lookup index
-- for now so any legacy duplicates can be identified safely before enforcing
-- uniqueness in a later migration.
create index if not exists club_memberships_club_membership_number_lookup_idx
on public.club_memberships (
    club_id,
    lower(trim(membership_number))
)
where membership_number is not null
  and trim(membership_number) <> '';

create index if not exists club_memberships_club_email_lookup_idx
on public.club_memberships (
    club_id,
    lower(trim(club_email))
)
where club_email is not null
  and trim(club_email) <> '';

-- ---------------------------------------------------------
-- PRIVATE PARYX IDENTITY LINK
-- ---------------------------------------------------------
-- No ClubHub RLS policy is created for this table. Club staff do not need to
-- know whether a membership is linked to Paryx.

create table if not exists public.club_membership_player_links (
    membership_id uuid primary key
        references public.club_memberships(id)
        on delete cascade,

    club_id uuid not null
        references public.clubs(id)
        on delete cascade,

    profile_id uuid not null
        references public.profiles(id)
        on delete cascade,

    link_method text not null default 'membership_number_email',
    linked_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint club_membership_player_links_method_valid
        check (link_method in ('legacy', 'membership_number_email', 'platform_support')),

    unique (club_id, profile_id)
);

create index if not exists club_membership_player_links_profile_idx
on public.club_membership_player_links (profile_id, club_id);

alter table public.club_membership_player_links enable row level security;

revoke all on table public.club_membership_player_links from anon, authenticated;

-- Existing profile-linked memberships become private legacy links. This does
-- not change anything visible to either Player or ClubHub.
insert into public.club_membership_player_links (
    membership_id,
    club_id,
    profile_id,
    link_method,
    linked_at,
    updated_at
)
select
    membership.id,
    membership.club_id,
    membership.profile_id,
    'legacy',
    coalesce(membership.created_at, now()),
    now()
from public.club_memberships as membership
where membership.profile_id is not null
on conflict do nothing;

-- Historical import audit rows must not disclose a Paryx profile identifier
-- to ClubHub. The membership id is the only club-side identifier required.
alter table public.member_import_rows
    drop column if exists profile_id;

-- ---------------------------------------------------------
-- CLUBHUB MEMBER DIRECTORY — PRIVACY-SAFE COMPATIBILITY RPC
-- ---------------------------------------------------------
-- Retains the old return shape so the current ClubHub frontend keeps working,
-- but profile_id is always NULL and is_primary is always FALSE. All displayed
-- identity/contact fields now come from the club-owned membership record.

create or replace function public.get_admin_members(
    p_club_id uuid,
    p_search text default null,
    p_status text default null,
    p_limit integer default 50,
    p_offset integer default 0
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
    membership_status text,
    membership_role text,
    joined_at date,
    is_primary boolean,
    handicap_index numeric,
    handicap_status text,
    member_created_at timestamptz,
    total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_limit integer;
    v_offset integer;
    v_search text;
    v_status text;
begin
    if auth.uid() is null
       or p_club_id is null
       or not public.user_has_admin_access(p_club_id) then
        raise exception 'Admin access required.';
    end if;

    v_limit := greatest(1, least(coalesce(p_limit, 50), 100));
    v_offset := greatest(0, coalesce(p_offset, 0));
    v_search := nullif(lower(trim(coalesce(p_search, ''))), '');
    v_status := nullif(lower(trim(coalesce(p_status, ''))), '');

    if v_status = 'all' then
        v_status := null;
    end if;

    return query
    with filtered as (
        select
            membership.id,
            membership.club_email,
            membership.club_first_name,
            membership.club_last_name,
            coalesce(
                nullif(trim(membership.club_display_name), ''),
                nullif(trim(concat_ws(' ', membership.club_first_name, membership.club_last_name)), ''),
                nullif(trim(membership.club_email), ''),
                'Member'
            )::text as resolved_display_name,
            membership.membership_number,
            membership.membership_type,
            membership.status,
            membership.role,
            membership.joined_at,
            membership.club_handicap_index,
            membership.club_handicap_status,
            membership.created_at
        from public.club_memberships as membership
        where membership.club_id = p_club_id
          and (
              v_status is null
              or membership.status = v_status
          )
          and (
              v_search is null
              or lower(coalesce(membership.club_email, '')) like '%' || v_search || '%'
              or lower(coalesce(membership.club_first_name, '')) like '%' || v_search || '%'
              or lower(coalesce(membership.club_last_name, '')) like '%' || v_search || '%'
              or lower(coalesce(membership.club_display_name, '')) like '%' || v_search || '%'
              or lower(coalesce(membership.membership_number, '')) like '%' || v_search || '%'
          )
    ),
    counted as (
        select count(*)::bigint as total_count
        from filtered
    )
    select
        filtered.id,
        null::uuid,
        filtered.club_email,
        filtered.club_first_name,
        filtered.club_last_name,
        filtered.resolved_display_name,
        filtered.membership_number,
        filtered.membership_type,
        filtered.status,
        filtered.role,
        filtered.joined_at,
        false,
        filtered.club_handicap_index::numeric,
        filtered.club_handicap_status,
        filtered.created_at,
        counted.total_count
    from filtered
    cross join counted
    order by lower(filtered.resolved_display_name), filtered.membership_number
    limit v_limit
    offset v_offset;
end;
$$;

revoke all on function public.get_admin_members(uuid,text,text,integer,integer) from public, anon;
grant execute on function public.get_admin_members(uuid,text,text,integer,integer) to authenticated;

-- Legacy no-club overload retained for older ClubHub pages.
create or replace function public.get_admin_members(
    p_search text default null,
    p_status text default null,
    p_limit integer default 50,
    p_offset integer default 0
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
    membership_status text,
    membership_role text,
    joined_at date,
    is_primary boolean,
    handicap_index numeric,
    handicap_status text,
    member_created_at timestamptz,
    total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_club_id uuid;
begin
    select membership.club_id
    into v_club_id
    from public.club_memberships as membership
    where membership.profile_id = auth.uid()
      and membership.status = 'active'
      and membership.role in ('manager', 'club_admin')
    order by membership.is_primary desc, membership.created_at asc
    limit 1;

    if v_club_id is null then
        raise exception 'Admin access required.';
    end if;

    return query
    select *
    from public.get_admin_members(
        v_club_id,
        p_search,
        p_status,
        p_limit,
        p_offset
    );
end;
$$;

revoke all on function public.get_admin_members(text,text,integer,integer) from public, anon;
grant execute on function public.get_admin_members(text,text,integer,integer) to authenticated;

-- ---------------------------------------------------------
-- MEMBER STATUS MANAGEMENT — SUPPORT UNCLAIMED MEMBERS
-- ---------------------------------------------------------

create or replace function public.admin_set_member_status(
    p_club_id uuid,
    p_membership_id uuid,
    p_status text
)
returns table (
    membership_id uuid,
    membership_status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_admin_role text;
    v_target_profile_id uuid;
    v_target_role text;
    v_member_exists boolean;
    v_new_status text;
begin
    v_new_status := lower(trim(coalesce(p_status, '')));

    if auth.uid() is null or p_club_id is null then
        raise exception 'Admin access required.';
    end if;

    if v_new_status not in ('invited','pending','active','suspended','expired','cancelled') then
        raise exception 'Invalid membership status.';
    end if;

    select
        true,
        membership.profile_id,
        membership.role
    into
        v_member_exists,
        v_target_profile_id,
        v_target_role
    from public.club_memberships as membership
    where membership.id = p_membership_id
      and membership.club_id = p_club_id;

    if not coalesce(v_member_exists, false) then
        raise exception 'Member not found for selected club.';
    end if;

    select membership.role
    into v_admin_role
    from public.club_memberships as membership
    where membership.profile_id = auth.uid()
      and membership.club_id = p_club_id
      and membership.status = 'active'
      and membership.role in ('manager','club_admin')
    limit 1;

    if v_admin_role is null then
        raise exception 'Admin access required.';
    end if;

    if v_target_profile_id = auth.uid()
       and v_new_status <> 'active' then
        raise exception 'You cannot deactivate your own admin membership.';
    end if;

    if v_target_role = 'club_admin'
       and v_admin_role <> 'club_admin' then
        raise exception 'Only a Club Admin can change another Club Admin account.';
    end if;

    update public.club_memberships as membership
    set
        status = v_new_status,
        joined_at = case
            when v_new_status = 'active'
                then coalesce(membership.joined_at, current_date)
            else membership.joined_at
        end,
        updated_at = now()
    where membership.id = p_membership_id
      and membership.club_id = p_club_id;

    return query
    select membership.id, membership.status
    from public.club_memberships as membership
    where membership.id = p_membership_id
      and membership.club_id = p_club_id;
end;
$$;

revoke all on function public.admin_set_member_status(uuid,uuid,text) from public, anon;
grant execute on function public.admin_set_member_status(uuid,uuid,text) to authenticated;

create or replace function public.admin_set_member_status(
    p_membership_id uuid,
    p_status text
)
returns table (
    membership_id uuid,
    membership_status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_club_id uuid;
begin
    select membership.club_id
    into v_club_id
    from public.club_memberships as membership
    where membership.id = p_membership_id;

    if v_club_id is null then
        raise exception 'Member not found.';
    end if;

    return query
    select *
    from public.admin_set_member_status(
        v_club_id,
        p_membership_id,
        p_status
    );
end;
$$;

revoke all on function public.admin_set_member_status(uuid,text) from public, anon;
grant execute on function public.admin_set_member_status(uuid,text) to authenticated;

-- ---------------------------------------------------------
-- MEMBER REMOVAL — DO NOT RETURN PLAYER LINK DATA TO CLUBHUB
-- ---------------------------------------------------------

create or replace function public.admin_remove_member(
    p_club_id uuid,
    p_membership_id uuid
)
returns table (
    removed_membership_id uuid,
    removed_profile_id uuid,
    removed_email text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor_role text;
    v_target_profile_id uuid;
    v_target_role text;
    v_target_email text;
    v_member_exists boolean;
    v_active_admin_count bigint;
begin
    if auth.uid() is null
       or p_club_id is null
       or not public.user_has_admin_access(p_club_id) then
        raise exception 'Club management access required.';
    end if;

    select membership.role
    into v_actor_role
    from public.club_memberships as membership
    where membership.profile_id = auth.uid()
      and membership.club_id = p_club_id
      and membership.status = 'active'
      and membership.role in ('manager','club_admin')
    limit 1;

    select
        true,
        membership.profile_id,
        membership.role,
        membership.club_email
    into
        v_member_exists,
        v_target_profile_id,
        v_target_role,
        v_target_email
    from public.club_memberships as membership
    where membership.id = p_membership_id
      and membership.club_id = p_club_id
    limit 1;

    if not coalesce(v_member_exists, false) then
        raise exception 'Club member not found.';
    end if;

    if v_target_profile_id = auth.uid() then
        raise exception 'You cannot remove your own club membership.';
    end if;

    if v_target_role = 'club_admin'
       and v_actor_role <> 'club_admin' then
        raise exception 'Only a Club Admin can remove another Club Admin.';
    end if;

    if v_target_role = 'club_admin' then
        select count(*)
        into v_active_admin_count
        from public.club_memberships as membership
        where membership.club_id = p_club_id
          and membership.status = 'active'
          and membership.role = 'club_admin';

        if v_active_admin_count <= 1 then
            raise exception 'The club must retain at least one active Club Admin.';
        end if;
    end if;

    delete from public.club_memberships as membership
    where membership.id = p_membership_id
      and membership.club_id = p_club_id;

    -- Keep the legacy return shape for the current frontend but deliberately
    -- never disclose the linked Paryx profile id.
    return query
    select
        p_membership_id,
        null::uuid,
        v_target_email;
end;
$$;

revoke all on function public.admin_remove_member(uuid,uuid) from public, anon;
grant execute on function public.admin_remove_member(uuid,uuid) to authenticated;

-- ---------------------------------------------------------
-- CLUB CREDIT SEARCH — MEMBERSHIP BASED, LINK-INVISIBLE
-- ---------------------------------------------------------

create or replace function public.club_credit_search_members(
    p_club_id uuid,
    p_search text
)
returns table (
    membership_id uuid,
    profile_id uuid,
    display_name text,
    email text,
    membership_number text,
    membership_type text,
    balance numeric,
    currency_code text,
    transaction_count bigint,
    last_activity_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_search text;
    v_currency text;
begin
    if auth.uid() is null
       or not public.user_can_view_club_credit(p_club_id) then
        raise exception 'Club Credit access required.';
    end if;

    v_search := nullif(lower(trim(coalesce(p_search, ''))), '');
    if v_search is null then
        return;
    end if;

    select coalesce(settings.currency_code, 'GBP')
    into v_currency
    from public.club_settings as settings
    where settings.club_id = p_club_id
    limit 1;

    v_currency := coalesce(v_currency, 'GBP');

    return query
    select
        membership.id,
        null::uuid,
        coalesce(
            nullif(trim(membership.club_display_name), ''),
            nullif(trim(concat_ws(' ', membership.club_first_name, membership.club_last_name)), ''),
            nullif(trim(membership.club_email), ''),
            'Member'
        )::text,
        membership.club_email,
        membership.membership_number,
        membership.membership_type,
        coalesce(account.balance, 0)::numeric,
        coalesce(account.currency_code, v_currency)::text,
        (
            select count(*)
            from public.club_member_account_transactions as transaction
            where transaction.membership_id = membership.id
              and transaction.club_id = p_club_id
        )::bigint,
        (
            select max(transaction.created_at)
            from public.club_member_account_transactions as transaction
            where transaction.membership_id = membership.id
              and transaction.club_id = p_club_id
        )
    from public.club_memberships as membership
    left join public.club_member_accounts as account
        on account.club_id = p_club_id
       and account.membership_id = membership.id
       and account.is_active
    where membership.club_id = p_club_id
      and membership.status = 'active'
      and coalesce(membership.membership_type, 'member') not in ('visitor','guest','staff')
      and (
          lower(coalesce(membership.club_display_name, '')) like '%' || v_search || '%'
          or lower(coalesce(membership.club_first_name, '')) like '%' || v_search || '%'
          or lower(coalesce(membership.club_last_name, '')) like '%' || v_search || '%'
          or lower(coalesce(membership.club_email, '')) like '%' || v_search || '%'
          or lower(coalesce(membership.membership_number, '')) like '%' || v_search || '%'
      )
    order by lower(coalesce(
        nullif(trim(membership.club_display_name), ''),
        membership.club_last_name,
        membership.club_email,
        ''
    ))
    limit 100;
end;
$$;

revoke all on function public.club_credit_search_members(uuid,text) from public, anon;
grant execute on function public.club_credit_search_members(uuid,text) to authenticated;

-- ---------------------------------------------------------
-- COMPETITION MEMBER SEARCH/ENTRY — SUPPORT UNCLAIMED MEMBERS
-- ---------------------------------------------------------

create or replace function public.competition_search_members(
    p_club_id uuid,
    p_search text
)
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
    if auth.uid() is null
       or not public.user_can_manage_competitions(p_club_id) then
        raise exception 'Competition management access required.';
    end if;

    v_search := nullif(lower(trim(coalesce(p_search, ''))), '');
    if v_search is null then
        return;
    end if;

    return query
    select
        membership.id,
        null::uuid,
        coalesce(
            nullif(trim(membership.club_display_name), ''),
            nullif(trim(concat_ws(' ', membership.club_first_name, membership.club_last_name)), ''),
            nullif(trim(membership.club_email), ''),
            'Member'
        )::text,
        membership.club_email,
        membership.membership_number,
        membership.membership_type
    from public.club_memberships as membership
    where membership.club_id = p_club_id
      and membership.status = 'active'
      and coalesce(membership.membership_type, 'member') not in ('visitor','guest','staff')
      and (
          lower(coalesce(membership.club_display_name, '')) like '%' || v_search || '%'
          or lower(coalesce(membership.club_first_name, '')) like '%' || v_search || '%'
          or lower(coalesce(membership.club_last_name, '')) like '%' || v_search || '%'
          or lower(coalesce(membership.club_email, '')) like '%' || v_search || '%'
          or lower(coalesce(membership.membership_number, '')) like '%' || v_search || '%'
      )
    order by lower(coalesce(
        nullif(trim(membership.club_display_name), ''),
        membership.club_last_name,
        membership.club_email,
        ''
    ))
    limit 100;
end;
$$;

revoke all on function public.competition_search_members(uuid,text) from public, anon;
grant execute on function public.competition_search_members(uuid,text) to authenticated;

create or replace function public.competition_add_member_entry(
    p_competition_id uuid,
    p_membership_id uuid
)
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
    select competition.club_id
    into v_club_id
    from public.club_competitions as competition
    where competition.id = p_competition_id
      and competition.results_confirmed_at is null;

    if v_club_id is null
       or auth.uid() is null
       or not public.user_can_manage_competitions(v_club_id) then
        raise exception 'Competition management access required.';
    end if;

    select
        coalesce(
            nullif(trim(membership.club_display_name), ''),
            nullif(trim(concat_ws(' ', membership.club_first_name, membership.club_last_name)), ''),
            nullif(trim(membership.club_email), ''),
            'Member'
        )::text,
        membership.club_email,
        membership.membership_number
    into
        v_name,
        v_email,
        v_membership_number
    from public.club_memberships as membership
    where membership.id = p_membership_id
      and membership.club_id = v_club_id
      and membership.status = 'active'
      and coalesce(membership.membership_type, 'member') not in ('visitor','guest','staff');

    if v_name is null then
        raise exception 'An active genuine club member is required.';
    end if;

    insert into public.club_competition_entries (
        competition_id,
        membership_id,
        entry_type,
        entrant_name,
        entrant_email,
        membership_number,
        created_by
    )
    values (
        p_competition_id,
        p_membership_id,
        'member',
        v_name,
        v_email,
        v_membership_number,
        auth.uid()
    )
    on conflict (competition_id, membership_id) where membership_id is not null
    do update set
        entrant_name = excluded.entrant_name,
        entrant_email = excluded.entrant_email,
        membership_number = excluded.membership_number,
        updated_at = now()
    returning id into v_entry_id;

    return v_entry_id;
end;
$$;

revoke all on function public.competition_add_member_entry(uuid,uuid) from public, anon;
grant execute on function public.competition_add_member_entry(uuid,uuid) to authenticated;

-- ---------------------------------------------------------
-- PLAYER CLAIM / LINK — PRIVATE, MEMBERSHIP NUMBER + EMAIL
-- ---------------------------------------------------------
-- Membership-number possession alone is deliberately insufficient. The email
-- held by the club must match the signed-in Paryx Player email.

create or replace function public.player_claim_club_membership(
    p_club_id uuid,
    p_membership_number text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid;
    v_user_email text;
    v_number text;
    v_match_count integer;
    v_membership_id uuid;
    v_membership_profile_id uuid;
    v_club_email text;
    v_membership_type text;
    v_membership_status text;
    v_club_name text;
    v_existing_link_profile_id uuid;
begin
    v_user_id := auth.uid();
    v_number := nullif(trim(coalesce(p_membership_number, '')), '');

    if v_user_id is null then
        raise exception 'Authentication required.';
    end if;

    if p_club_id is null or v_number is null then
        return jsonb_build_object(
            'status', 'not_found',
            'message', 'Membership could not be verified.'
        );
    end if;

    select lower(trim(auth_user.email::text))
    into v_user_email
    from auth.users as auth_user
    where auth_user.id = v_user_id;

    if v_user_email is null then
        return jsonb_build_object(
            'status', 'verification_required',
            'message', 'Your Paryx account email must be verified before linking a club membership.'
        );
    end if;

    select count(*)::integer
    into v_match_count
    from public.club_memberships as membership
    where membership.club_id = p_club_id
      and membership.status = 'active'
      and coalesce(membership.membership_type, 'member') not in ('visitor','guest','staff')
      and lower(trim(coalesce(membership.membership_number, ''))) = lower(v_number);

    if v_match_count = 0 then
        return jsonb_build_object(
            'status', 'not_found',
            'message', 'Membership could not be verified. Check your membership number or contact the club.'
        );
    end if;

    if v_match_count <> 1 then
        return jsonb_build_object(
            'status', 'verification_required',
            'message', 'This membership requires verification before it can be linked.'
        );
    end if;

    select
        membership.id,
        membership.profile_id,
        lower(trim(coalesce(membership.club_email, ''))),
        membership.membership_type,
        membership.status,
        club.name
    into
        v_membership_id,
        v_membership_profile_id,
        v_club_email,
        v_membership_type,
        v_membership_status,
        v_club_name
    from public.club_memberships as membership
    join public.clubs as club
        on club.id = membership.club_id
    where membership.club_id = p_club_id
      and membership.status = 'active'
      and coalesce(membership.membership_type, 'member') not in ('visitor','guest','staff')
      and lower(trim(coalesce(membership.membership_number, ''))) = lower(v_number)
    limit 1;

    select link.profile_id
    into v_existing_link_profile_id
    from public.club_membership_player_links as link
    where link.membership_id = v_membership_id;

    if v_existing_link_profile_id = v_user_id then
        return jsonb_build_object(
            'status', 'linked',
            'club_id', p_club_id,
            'club_name', v_club_name,
            'membership_id', v_membership_id,
            'membership_number', v_number,
            'membership_type', v_membership_type
        );
    end if;

    if v_existing_link_profile_id is not null
       and v_existing_link_profile_id <> v_user_id then
        return jsonb_build_object(
            'status', 'verification_required',
            'message', 'This membership requires verification before it can be linked.'
        );
    end if;

    if v_membership_profile_id is not null
       and v_membership_profile_id <> v_user_id then
        return jsonb_build_object(
            'status', 'verification_required',
            'message', 'This membership requires verification before it can be linked.'
        );
    end if;

    if v_club_email = '' or v_club_email <> v_user_email then
        return jsonb_build_object(
            'status', 'verification_required',
            'message', 'We found the membership, but the club-held email does not match your Paryx account. Ask the club to confirm or update the email on your membership and then try again.'
        );
    end if;

    if exists (
        select 1
        from public.club_membership_player_links as link
        where link.club_id = p_club_id
          and link.profile_id = v_user_id
          and link.membership_id <> v_membership_id
    ) then
        return jsonb_build_object(
            'status', 'verification_required',
            'message', 'Your Paryx account is already linked to another membership at this club.'
        );
    end if;

    insert into public.club_membership_player_links (
        membership_id,
        club_id,
        profile_id,
        link_method,
        linked_at,
        updated_at
    )
    values (
        v_membership_id,
        p_club_id,
        v_user_id,
        'membership_number_email',
        now(),
        now()
    )
    on conflict (membership_id)
    do update set
        profile_id = excluded.profile_id,
        link_method = excluded.link_method,
        updated_at = now();

    -- Temporary compatibility mirror for the existing Player/profile services.
    -- ClubHub never receives this value after this migration.
    update public.club_memberships as membership
    set
        profile_id = v_user_id,
        is_primary = case
            when exists (
                select 1
                from public.club_memberships as other_membership
                where other_membership.profile_id = v_user_id
                  and other_membership.is_primary = true
                  and other_membership.id <> v_membership_id
            ) then false
            else true
        end,
        updated_at = now()
    where membership.id = v_membership_id;

    return jsonb_build_object(
        'status', 'linked',
        'club_id', p_club_id,
        'club_name', v_club_name,
        'membership_id', v_membership_id,
        'membership_number', v_number,
        'membership_type', v_membership_type
    );
end;
$$;

revoke all on function public.player_claim_club_membership(uuid,text) from public, anon;
grant execute on function public.player_claim_club_membership(uuid,text) to authenticated;

commit;

notify pgrst, 'reload schema';
