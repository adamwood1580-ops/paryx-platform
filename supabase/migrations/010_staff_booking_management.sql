-- =========================================================
-- PARYX STAFF BOOKING MANAGEMENT
-- Run after 009_staff_tee_sheet_and_event_allocations.sql.
-- =========================================================

begin;

-- =========================================================
-- NAMED GUESTS
-- =========================================================

create table if not exists public.booking_guests (
    id uuid primary key default gen_random_uuid(),

    booking_id uuid not null
        references public.bookings(id)
        on delete cascade,

    guest_name text not null,
    position smallint not null,

    added_by_membership_id uuid
        references public.club_memberships(id)
        on delete set null,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint booking_guests_name_not_blank
        check (length(trim(guest_name)) > 0),

    constraint booking_guests_position_valid
        check (position between 1 and 8),

    constraint booking_guests_booking_position_unique
        unique (booking_id, position)
);

create index if not exists booking_guests_booking_id_idx
on public.booking_guests (booking_id);

alter table public.booking_guests
enable row level security;

drop trigger if exists set_booking_guests_updated_at
on public.booking_guests;

create trigger set_booking_guests_updated_at
before update on public.booking_guests
for each row
execute function public.set_updated_at();


-- =========================================================
-- STAFF BOOKING AUDIT
--
-- created_by_membership_id remains the accountable lead member
-- whenever a member is selected. This keeps the existing
-- member-facing lead/cancel rules intact.
-- =========================================================

alter table public.bookings
    add column if not exists staff_created_by_membership_id uuid
        references public.club_memberships(id)
        on delete set null;

create index if not exists bookings_staff_created_by_idx
on public.bookings (staff_created_by_membership_id)
where staff_created_by_membership_id is not null;


-- =========================================================
-- STAFF MEMBERSHIP RESOLUTION
-- =========================================================

create or replace function public.tee_sheet_operator_membership_id(
    p_club_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
    select cm.id
    from public.club_memberships as cm
    where cm.profile_id = auth.uid()
      and cm.club_id = p_club_id
      and cm.status = 'active'
      and cm.role in (
          'starter',
          'reception',
          'professional',
          'manager',
          'club_admin'
      )
    order by
        cm.is_primary desc,
        cm.created_at asc
    limit 1;
$$;

revoke all
on function public.tee_sheet_operator_membership_id(uuid)
from public, anon;

grant execute
on function public.tee_sheet_operator_membership_id(uuid)
to authenticated;


-- =========================================================
-- MEMBER SEARCH FOR STAFF BOOKINGS
-- =========================================================

create or replace function public.staff_search_booking_members(
    p_club_id uuid,
    p_search text default null,
    p_limit integer default 20
)
returns table (
    membership_id uuid,
    profile_id uuid,
    display_name text,
    email text,
    membership_number text,
    membership_type text,
    membership_role text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_search text :=
        nullif(lower(trim(coalesce(p_search, ''))), '');
    v_limit integer :=
        greatest(1, least(coalesce(p_limit, 20), 50));
begin
    if auth.uid() is null
       or p_club_id is null
       or not public.user_can_operate_tee_sheet(p_club_id) then
        raise exception
            'Tee sheet access required.';
    end if;

    return query
    select
        cm.id,
        cm.profile_id,
        coalesce(
            nullif(trim(p.display_name), ''),
            nullif(
                trim(
                    concat_ws(
                        ' ',
                        p.first_name,
                        p.last_name
                    )
                ),
                ''
            ),
            nullif(trim(au.email::text), ''),
            'Member'
        )::text,
        au.email::text,
        cm.membership_number,
        cm.membership_type,
        cm.role
    from public.club_memberships as cm
    join public.profiles as p
        on p.id = cm.profile_id
    left join auth.users as au
        on au.id = cm.profile_id
    where cm.club_id = p_club_id
      and cm.status = 'active'
      and (
          v_search is null
          or lower(
              coalesce(
                  p.display_name,
                  ''
              )
          ) like '%' || v_search || '%'
          or lower(
              coalesce(
                  p.first_name,
                  ''
              )
          ) like '%' || v_search || '%'
          or lower(
              coalesce(
                  p.last_name,
                  ''
              )
          ) like '%' || v_search || '%'
          or lower(
              coalesce(
                  au.email::text,
                  ''
              )
          ) like '%' || v_search || '%'
          or lower(
              coalesce(
                  cm.membership_number,
                  ''
              )
          ) like '%' || v_search || '%'
      )
    order by
        lower(
            coalesce(
                nullif(trim(p.display_name), ''),
                nullif(trim(p.last_name), ''),
                nullif(trim(p.first_name), ''),
                au.email::text,
                'member'
            )
        ),
        cm.id
    limit v_limit;
end;
$$;

revoke all
on function public.staff_search_booking_members(
    uuid,
    text,
    integer
)
from public, anon;

grant execute
on function public.staff_search_booking_members(
    uuid,
    text,
    integer
)
to authenticated;


-- =========================================================
-- STAFF BOOKING DETAIL
-- =========================================================

create or replace function public.staff_get_booking_detail(
    p_club_id uuid,
    p_booking_id uuid
)
returns table (
    booking_id uuid,
    tee_time_id uuid,
    course_id uuid,
    course_name text,
    play_date date,
    start_time time,
    max_players smallint,
    booking_type text,
    booking_status text,
    player_count smallint,
    lead_name text,
    contact_number text,
    notes text,
    members jsonb,
    guests jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null
       or p_club_id is null
       or p_booking_id is null
       or not public.user_can_operate_tee_sheet(
           p_club_id
       ) then
        raise exception
            'Tee sheet access required.';
    end if;

    return query
    select
        b.id,
        tt.id,
        c.id,
        c.name,
        tt.play_date,
        tt.start_time,
        tt.max_players,
        b.booking_type,
        b.booking_status,
        b.player_count,
        b.lead_name,
        b.contact_number,
        b.notes,
        coalesce(
            (
                select jsonb_agg(
                    jsonb_build_object(
                        'membership_id',
                        cm.id,
                        'profile_id',
                        cm.profile_id,
                        'display_name',
                        coalesce(
                            nullif(
                                trim(
                                    p.display_name
                                ),
                                ''
                            ),
                            nullif(
                                trim(
                                    concat_ws(
                                        ' ',
                                        p.first_name,
                                        p.last_name
                                    )
                                ),
                                ''
                            ),
                            nullif(
                                trim(
                                    au.email::text
                                ),
                                ''
                            ),
                            'Member'
                        ),
                        'email',
                        au.email,
                        'membership_number',
                        cm.membership_number,
                        'party_size',
                        bm.party_size,
                        'position',
                        bm.position,
                        'member_status',
                        bm.member_status
                    )
                    order by bm.position
                )
                from public.booking_members as bm
                join public.club_memberships as cm
                    on cm.id = bm.membership_id
                join public.profiles as p
                    on p.id = cm.profile_id
                left join auth.users as au
                    on au.id = cm.profile_id
                where bm.booking_id = b.id
                  and bm.member_status in (
                      'invited',
                      'confirmed',
                      'checked_in'
                  )
            ),
            '[]'::jsonb
        ),
        coalesce(
            (
                select jsonb_agg(
                    jsonb_build_object(
                        'guest_id',
                        bg.id,
                        'guest_name',
                        bg.guest_name,
                        'position',
                        bg.position
                    )
                    order by bg.position
                )
                from public.booking_guests as bg
                where bg.booking_id = b.id
            ),
            '[]'::jsonb
        )
    from public.bookings as b
    join public.tee_times as tt
        on tt.id = b.tee_time_id
    join public.courses as c
        on c.id = tt.course_id
    where b.id = p_booking_id
      and c.club_id = p_club_id;

    if not found then
        raise exception
            'The selected booking was not found.';
    end if;
end;
$$;

revoke all
on function public.staff_get_booking_detail(
    uuid,
    uuid
)
from public, anon;

grant execute
on function public.staff_get_booking_detail(
    uuid,
    uuid
)
to authenticated;


-- =========================================================
-- INTERNAL PLAYER REPLACEMENT
--
-- Existing member-created bookings may have party_size > 1.
-- Staff edits preserve that value unless the member is removed
-- and added again.
-- =========================================================

create or replace function public.staff_replace_booking_players(
    p_club_id uuid,
    p_booking_id uuid,
    p_member_ids uuid[],
    p_member_party_sizes smallint[],
    p_guest_names text[],
    p_added_by_membership_id uuid,
    p_max_players smallint
)
returns smallint
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_member_ids uuid[] :=
        coalesce(
            p_member_ids,
            array[]::uuid[]
        );

    v_member_party_sizes smallint[] :=
        coalesce(
            p_member_party_sizes,
            array[]::smallint[]
        );

    v_guest_names text[] :=
        coalesce(
            p_guest_names,
            array[]::text[]
        );

    v_total integer;
    v_position smallint := 1;
    v_guest_name text;
    v_index integer;
begin
    select coalesce(
        array_agg(
            trim(guest.name)
            order by guest.ordinality
        ),
        array[]::text[]
    )
    into v_guest_names
    from unnest(v_guest_names)
        with ordinality
        as guest(name, ordinality)
    where nullif(
        trim(guest.name),
        ''
    ) is not null;

    if cardinality(
        v_member_party_sizes
    ) = 0
       and cardinality(
           v_member_ids
       ) > 0 then

        v_member_party_sizes :=
            array_fill(
                1::smallint,
                array[
                    cardinality(
                        v_member_ids
                    )
                ]
            );
    end if;

    if cardinality(
        v_member_party_sizes
    ) <> cardinality(
        v_member_ids
    ) then
        raise exception
            'Member party-size data is inconsistent.';
    end if;

    if exists (
        select 1
        from unnest(
            v_member_party_sizes
        ) as party(size)
        where party.size < 1
           or party.size > 8
    ) then
        raise exception
            'Each member party must occupy between 1 and 8 places.';
    end if;

    if cardinality(
        v_member_ids
    ) <> (
        select count(
            distinct chosen.id
        )
        from unnest(
            v_member_ids
        ) as chosen(id)
    ) then
        raise exception
            'The same member cannot be added twice.';
    end if;

    if exists (
        select 1
        from unnest(
            v_member_ids
        ) as chosen(membership_id)
        left join public.club_memberships as cm
            on cm.id =
                chosen.membership_id
           and cm.club_id =
                p_club_id
           and cm.status =
                'active'
        where cm.id is null
    ) then
        raise exception
            'One or more selected members are not active at this club.';
    end if;

    select coalesce(
        sum(party.size),
        0
    )::integer
    into v_total
    from unnest(
        v_member_party_sizes
    ) as party(size);

    v_total :=
        v_total
        + cardinality(
            v_guest_names
        );

    if v_total < 1 then
        raise exception
            'Add at least one member or guest to the booking.';
    end if;

    if v_total > p_max_players then
        raise exception
            'This tee time allows a maximum of % players.',
            p_max_players;
    end if;

    delete from public.booking_members
    where booking_id =
        p_booking_id;

    delete from public.booking_guests
    where booking_id =
        p_booking_id;

    if cardinality(
        v_member_ids
    ) > 0 then
        for v_index in
            1..cardinality(
                v_member_ids
            )
        loop
            insert into public.booking_members (
                booking_id,
                membership_id,
                position,
                party_size,
                member_status,
                added_by_membership_id
            )
            values (
                p_booking_id,
                v_member_ids[
                    v_index
                ],
                v_position,
                v_member_party_sizes[
                    v_index
                ],
                'confirmed',
                p_added_by_membership_id
            );

            v_position :=
                v_position + 1;
        end loop;
    end if;

    foreach v_guest_name
        in array v_guest_names
    loop
        insert into public.booking_guests (
            booking_id,
            guest_name,
            position,
            added_by_membership_id
        )
        values (
            p_booking_id,
            trim(
                v_guest_name
            ),
            v_position,
            p_added_by_membership_id
        );

        v_position :=
            v_position + 1;
    end loop;

    return v_total::smallint;
end;
$$;

revoke all
on function public.staff_replace_booking_players(
    uuid,
    uuid,
    uuid[],
    smallint[],
    text[],
    uuid,
    smallint
)
from public, anon, authenticated;


-- =========================================================
-- CREATE STAFF BOOKING
-- =========================================================

create or replace function public.staff_create_booking(
    p_club_id uuid,
    p_tee_time_id uuid,
    p_member_ids uuid[]
        default array[]::uuid[],
    p_member_party_sizes smallint[]
        default array[]::smallint[],
    p_guest_names text[]
        default array[]::text[],
    p_booking_type text
        default 'joinable',
    p_lead_name text
        default null,
    p_contact_number text
        default null,
    p_notes text
        default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_operator_membership_id uuid;
    v_lead_membership_id uuid;
    v_tee_time public.tee_times%rowtype;
    v_booking_id uuid;
    v_player_count smallint;
begin
    if auth.uid() is null
       or p_club_id is null
       or p_tee_time_id is null
       or not public.user_can_operate_tee_sheet(
           p_club_id
       ) then
        raise exception
            'Tee sheet access required.';
    end if;

    if p_booking_type not in (
        'joinable',
        'private'
    ) then
        raise exception
            'Booking type must be joinable or private.';
    end if;

    v_operator_membership_id :=
        public.tee_sheet_operator_membership_id(
            p_club_id
        );

    if v_operator_membership_id is null then
        raise exception
            'Tee sheet access required.';
    end if;

    if cardinality(
        coalesce(
            p_member_ids,
            array[]::uuid[]
        )
    ) > 0 then

        select cm.id
        into v_lead_membership_id
        from public.club_memberships as cm
        where cm.id =
            p_member_ids[1]
          and cm.club_id =
            p_club_id
          and cm.status =
            'active';

        if v_lead_membership_id is null then
            raise exception
                'The lead member is not active at this club.';
        end if;
    else
        v_lead_membership_id :=
            v_operator_membership_id;
    end if;

    select tt.*
    into v_tee_time
    from public.tee_times as tt
    join public.courses as c
        on c.id = tt.course_id
    where tt.id =
        p_tee_time_id
      and c.club_id =
        p_club_id
    for update of tt;

    if not found then
        raise exception
            'The selected tee time was not found.';
    end if;

    if v_tee_time.operational_status <>
       'open' then
        raise exception
            'This tee time is not open for booking.';
    end if;

    if v_tee_time.play_date <
       current_date then
        raise exception
            'Past tee times cannot be booked.';
    end if;

    if exists (
        select 1
        from public.bookings as b
        where b.tee_time_id =
            v_tee_time.id
          and b.booking_status =
            'active'
    ) then
        raise exception
            'This tee time already has an active booking.';
    end if;

    insert into public.bookings (
        tee_time_id,
        created_by_membership_id,
        staff_created_by_membership_id,
        player_count,
        booking_type,
        booking_status,
        lead_name,
        contact_number,
        notes
    )
    values (
        v_tee_time.id,
        v_lead_membership_id,
        v_operator_membership_id,
        1,
        p_booking_type,
        'active',
        nullif(
            trim(
                p_lead_name
            ),
            ''
        ),
        nullif(
            trim(
                p_contact_number
            ),
            ''
        ),
        nullif(
            trim(
                p_notes
            ),
            ''
        )
    )
    returning id
    into v_booking_id;

    v_player_count :=
        public.staff_replace_booking_players(
            p_club_id,
            v_booking_id,
            p_member_ids,
            p_member_party_sizes,
            p_guest_names,
            v_operator_membership_id,
            v_tee_time.max_players
        );

    update public.bookings
    set player_count =
        v_player_count
    where id =
        v_booking_id;

    return v_booking_id;

exception
    when unique_violation then
        raise exception
            'This tee time was booked by another user moments ago.';
end;
$$;

revoke all
on function public.staff_create_booking(
    uuid,
    uuid,
    uuid[],
    smallint[],
    text[],
    text,
    text,
    text,
    text
)
from public, anon;

grant execute
on function public.staff_create_booking(
    uuid,
    uuid,
    uuid[],
    smallint[],
    text[],
    text,
    text,
    text,
    text
)
to authenticated;


-- =========================================================
-- UPDATE STAFF BOOKING
-- =========================================================

create or replace function public.staff_update_booking(
    p_club_id uuid,
    p_booking_id uuid,
    p_member_ids uuid[]
        default array[]::uuid[],
    p_member_party_sizes smallint[]
        default array[]::smallint[],
    p_guest_names text[]
        default array[]::text[],
    p_booking_type text
        default 'joinable',
    p_lead_name text
        default null,
    p_contact_number text
        default null,
    p_notes text
        default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_operator_membership_id uuid;
    v_new_lead_membership_id uuid;
    v_booking public.bookings%rowtype;
    v_tee_time public.tee_times%rowtype;
    v_player_count smallint;
begin
    if auth.uid() is null
       or p_club_id is null
       or p_booking_id is null
       or not public.user_can_operate_tee_sheet(
           p_club_id
       ) then
        raise exception
            'Tee sheet access required.';
    end if;

    if p_booking_type not in (
        'joinable',
        'private'
    ) then
        raise exception
            'Booking type must be joinable or private.';
    end if;

    v_operator_membership_id :=
        public.tee_sheet_operator_membership_id(
            p_club_id
        );

    select b.*
    into v_booking
    from public.bookings as b
    join public.tee_times as tt
        on tt.id =
            b.tee_time_id
    join public.courses as c
        on c.id =
            tt.course_id
    where b.id =
        p_booking_id
      and c.club_id =
        p_club_id
    for update of b;

    if not found then
        raise exception
            'The selected booking was not found.';
    end if;

    if v_booking.booking_status <>
       'active' then
        raise exception
            'Only active bookings can be edited.';
    end if;

    select *
    into v_tee_time
    from public.tee_times
    where id =
        v_booking.tee_time_id
    for update;

    v_player_count :=
        public.staff_replace_booking_players(
            p_club_id,
            v_booking.id,
            p_member_ids,
            p_member_party_sizes,
            p_guest_names,
            v_operator_membership_id,
            v_tee_time.max_players
        );

    if cardinality(
        coalesce(
            p_member_ids,
            array[]::uuid[]
        )
    ) > 0 then

        if v_booking.created_by_membership_id =
           any(
               p_member_ids
           ) then
            v_new_lead_membership_id :=
                v_booking.created_by_membership_id;
        else
            v_new_lead_membership_id :=
                p_member_ids[1];
        end if;
    else
        v_new_lead_membership_id :=
            v_operator_membership_id;
    end if;

    update public.bookings
    set
        created_by_membership_id =
            v_new_lead_membership_id,
        player_count =
            v_player_count,
        booking_type =
            p_booking_type,
        lead_name =
            nullif(
                trim(
                    p_lead_name
                ),
                ''
            ),
        contact_number =
            nullif(
                trim(
                    p_contact_number
                ),
                ''
            ),
        notes =
            nullif(
                trim(
                    p_notes
                ),
                ''
            )
    where id =
        v_booking.id;

    return true;
end;
$$;

revoke all
on function public.staff_update_booking(
    uuid,
    uuid,
    uuid[],
    smallint[],
    text[],
    text,
    text,
    text,
    text
)
from public, anon;

grant execute
on function public.staff_update_booking(
    uuid,
    uuid,
    uuid[],
    smallint[],
    text[],
    text,
    text,
    text,
    text
)
to authenticated;


-- =========================================================
-- MOVE BOOKING
-- =========================================================

create or replace function public.staff_move_booking(
    p_club_id uuid,
    p_booking_id uuid,
    p_new_tee_time_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_booking public.bookings%rowtype;
    v_new_tee_time public.tee_times%rowtype;
begin
    if auth.uid() is null
       or p_club_id is null
       or p_booking_id is null
       or p_new_tee_time_id is null
       or not public.user_can_operate_tee_sheet(
           p_club_id
       ) then
        raise exception
            'Tee sheet access required.';
    end if;

    select b.*
    into v_booking
    from public.bookings as b
    join public.tee_times as tt
        on tt.id =
            b.tee_time_id
    join public.courses as c
        on c.id =
            tt.course_id
    where b.id =
        p_booking_id
      and c.club_id =
        p_club_id
    for update of b;

    if not found then
        raise exception
            'The selected booking was not found.';
    end if;

    if v_booking.booking_status <>
       'active' then
        raise exception
            'Only active bookings can be moved.';
    end if;

    select tt.*
    into v_new_tee_time
    from public.tee_times as tt
    join public.courses as c
        on c.id =
            tt.course_id
    where tt.id =
        p_new_tee_time_id
      and c.club_id =
        p_club_id
    for update of tt;

    if not found then
        raise exception
            'The destination tee time was not found.';
    end if;

    if v_new_tee_time.operational_status <>
       'open' then
        raise exception
            'The destination tee time is not open.';
    end if;

    if v_new_tee_time.play_date <
       current_date then
        raise exception
            'A booking cannot be moved into the past.';
    end if;

    if v_booking.player_count >
       v_new_tee_time.max_players then
        raise exception
            'The destination tee time only allows % players.',
            v_new_tee_time.max_players;
    end if;

    if exists (
        select 1
        from public.bookings as b
        where b.tee_time_id =
            v_new_tee_time.id
          and b.booking_status =
            'active'
          and b.id <>
            v_booking.id
    ) then
        raise exception
            'The destination tee time already has an active booking.';
    end if;

    update public.bookings
    set tee_time_id =
        v_new_tee_time.id
    where id =
        v_booking.id;

    return true;

exception
    when unique_violation then
        raise exception
            'The destination tee time was booked by another user moments ago.';
end;
$$;

revoke all
on function public.staff_move_booking(
    uuid,
    uuid,
    uuid
)
from public, anon;

grant execute
on function public.staff_move_booking(
    uuid,
    uuid,
    uuid
)
to authenticated;


-- =========================================================
-- CANCEL BOOKING
-- =========================================================

create or replace function public.staff_cancel_booking(
    p_club_id uuid,
    p_booking_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_operator_membership_id uuid;
begin
    if auth.uid() is null
       or p_club_id is null
       or p_booking_id is null
       or not public.user_can_operate_tee_sheet(
           p_club_id
       ) then
        raise exception
            'Tee sheet access required.';
    end if;

    v_operator_membership_id :=
        public.tee_sheet_operator_membership_id(
            p_club_id
        );

    update public.bookings as b
    set
        booking_status =
            'cancelled',
        cancelled_at =
            now(),
        cancelled_by_membership_id =
            v_operator_membership_id
    from
        public.tee_times as tt,
        public.courses as c
    where b.id =
        p_booking_id
      and b.booking_status =
        'active'
      and tt.id =
        b.tee_time_id
      and c.id =
        tt.course_id
      and c.club_id =
        p_club_id;

    if not found then
        raise exception
            'The active booking was not found.';
    end if;

    update public.booking_members
    set
        member_status =
            'cancelled',
        checked_in_at =
            null
    where booking_id =
        p_booking_id
      and member_status <>
        'cancelled';

    return true;
end;
$$;

revoke all
on function public.staff_cancel_booking(
    uuid,
    uuid
)
from public, anon;

grant execute
on function public.staff_cancel_booking(
    uuid,
    uuid
)
to authenticated;


-- =========================================================
-- KEEP MEMBER JOINING COMPATIBLE WITH NAMED GUEST POSITIONS
-- =========================================================

create or replace function public.join_booking(
    p_booking_id uuid,
    p_player_count smallint
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid;
    v_membership_id uuid;
    v_booking public.bookings%rowtype;
    v_tee_time public.tee_times%rowtype;
    v_course public.courses%rowtype;
    v_next_position smallint;
begin
    v_user_id :=
        auth.uid();

    if v_user_id is null then
        raise exception
            'You must be signed in to join a booking.';
    end if;

    if p_booking_id is null then
        raise exception
            'A booking ID is required.';
    end if;

    if p_player_count is null
       or p_player_count < 1 then
        raise exception
            'At least one player must join.';
    end if;

    select *
    into v_booking
    from public.bookings
    where id =
        p_booking_id
    for update;

    if not found then
        raise exception
            'The selected booking was not found.';
    end if;

    if v_booking.booking_status <>
       'active' then
        raise exception
            'This booking is no longer active.';
    end if;

    if v_booking.booking_type <>
       'joinable' then
        raise exception
            'This booking is private and cannot be joined.';
    end if;

    select *
    into v_tee_time
    from public.tee_times
    where id =
        v_booking.tee_time_id;

    if not found then
        raise exception
            'The tee time linked to this booking was not found.';
    end if;

    select *
    into v_course
    from public.courses
    where id =
        v_tee_time.course_id;

    if not found then
        raise exception
            'The course linked to this booking was not found.';
    end if;

    select cm.id
    into v_membership_id
    from public.club_memberships as cm
    where cm.profile_id =
        v_user_id
      and cm.club_id =
        v_course.club_id
      and cm.status =
        'active'
    order by
        cm.is_primary desc,
        cm.created_at asc
    limit 1;

    if v_membership_id is null then
        raise exception
            'You do not have an active membership at this club.';
    end if;

    if v_tee_time.operational_status <>
       'open' then
        raise exception
            'This tee time is not open.';
    end if;

    if v_tee_time.play_date <
       current_date then
        raise exception
            'Past tee times cannot be joined.';
    end if;

    if (
        v_tee_time.play_date =
            current_date
        and v_tee_time.start_time <=
            localtime
    ) then
        raise exception
            'This tee time has already passed.';
    end if;

    if exists (
        select 1
        from public.booking_members as bm
        where bm.booking_id =
            v_booking.id
          and bm.membership_id =
            v_membership_id
          and bm.member_status in (
              'invited',
              'confirmed',
              'checked_in'
          )
    ) then
        raise exception
            'You are already part of this booking.';
    end if;

    if (
        v_booking.player_count
        + p_player_count
        > v_tee_time.max_players
    ) then
        raise exception
            'Only % places remain in this booking.',
            greatest(
                v_tee_time.max_players
                - v_booking.player_count,
                0
            );
    end if;

    select (
        greatest(
            coalesce(
                (
                    select max(
                        bm.position
                    )
                    from public.booking_members as bm
                    where bm.booking_id =
                        v_booking.id
                ),
                0
            ),
            coalesce(
                (
                    select max(
                        bg.position
                    )
                    from public.booking_guests as bg
                    where bg.booking_id =
                        v_booking.id
                ),
                0
            )
        ) + 1
    )::smallint
    into v_next_position;

    update public.bookings
    set
        player_count =
            player_count
            + p_player_count,
        updated_at =
            now()
    where id =
        v_booking.id;

    insert into public.booking_members (
        booking_id,
        membership_id,
        position,
        party_size,
        member_status,
        added_by_membership_id
    )
    values (
        v_booking.id,
        v_membership_id,
        v_next_position,
        p_player_count,
        'confirmed',
        v_membership_id
    );

    return v_booking.id;

exception
    when unique_violation then
        raise exception
            'You are already part of this booking.';
end;
$$;

revoke all
on function public.join_booking(
    uuid,
    smallint
)
from public, anon;

grant execute
on function public.join_booking(
    uuid,
    smallint
)
to authenticated;


-- =========================================================
-- TEE SHEET: INCLUDE NAMED GUESTS
-- =========================================================

create or replace function public.staff_get_tee_sheet(
    p_club_id uuid,
    p_course_id uuid,
    p_play_date date
)
returns table (
    tee_time_id uuid,
    start_time time,
    max_players smallint,
    operational_status text,
    tee_time_notes text,
    club_event_id uuid,
    event_title text,
    event_section text,
    event_type text,
    booking_id uuid,
    booking_type text,
    booking_status text,
    player_count smallint,
    lead_name text,
    booking_notes text,
    player_names text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null
       or p_club_id is null
       or p_course_id is null
       or p_play_date is null
       or not public.user_can_operate_tee_sheet(
           p_club_id
       ) then
        raise exception
            'Tee sheet access required.';
    end if;

    if not exists (
        select 1
        from public.courses as c
        where c.id =
            p_course_id
          and c.club_id =
            p_club_id
    ) then
        raise exception
            'The selected course is not available at this club.';
    end if;

    return query
    select
        tt.id,
        tt.start_time,
        tt.max_players,
        tt.operational_status,
        tt.notes,
        ce.id,
        ce.title,
        ce.section,
        ce.event_type,
        b.id,
        b.booking_type,
        b.booking_status,
        b.player_count,
        b.lead_name,
        b.notes,
        coalesce(
            (
                select array_agg(
                    players.name
                    order by players.position
                )
                from (
                    select
                        bm.position,
                        (
                            coalesce(
                                nullif(
                                    trim(
                                        p.display_name
                                    ),
                                    ''
                                ),
                                nullif(
                                    trim(
                                        concat_ws(
                                            ' ',
                                            p.first_name,
                                            p.last_name
                                        )
                                    ),
                                    ''
                                ),
                                'Member'
                            )
                        )::text as name
                    from public.booking_members as bm
                    join public.club_memberships as cm
                        on cm.id =
                            bm.membership_id
                    join public.profiles as p
                        on p.id =
                            cm.profile_id
                    where bm.booking_id =
                        b.id
                      and bm.member_status in (
                          'invited',
                          'confirmed',
                          'checked_in'
                      )

                    union all

                    select
                        bg.position,
                        (
                            bg.guest_name
                            || ' (Guest)'
                        )::text
                    from public.booking_guests as bg
                    where bg.booking_id =
                        b.id
                ) as players
            ),
            array[]::text[]
        )
    from public.tee_times as tt
    left join public.club_events as ce
        on ce.id =
            tt.club_event_id
    left join public.bookings as b
        on b.tee_time_id =
            tt.id
       and b.booking_status =
            'active'
    where tt.course_id =
        p_course_id
      and tt.play_date =
        p_play_date
    order by
        tt.start_time;
end;
$$;

revoke all
on function public.staff_get_tee_sheet(
    uuid,
    uuid,
    date
)
from public, anon;

grant execute
on function public.staff_get_tee_sheet(
    uuid,
    uuid,
    date
)
to authenticated;

commit;

notify pgrst, 'reload schema';
