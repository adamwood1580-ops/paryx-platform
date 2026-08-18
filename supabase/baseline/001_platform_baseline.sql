-- PARYX PLATFORM BASELINE
-- Generated from the proven prototype schema with all customer-specific seed data removed.
-- Use only for a fresh Supabase project. Do not run this against the existing development database.


-- =========================================================
-- SOURCE: 001_create_clubs.sql
-- =========================================================
create table public.clubs (
    id uuid primary key default gen_random_uuid(),

    name text not null,
    slug text not null unique,

    timezone text not null default 'Europe/London',

    is_active boolean not null default true,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint clubs_name_not_blank
        check (length(trim(name)) > 0),

    constraint clubs_slug_format
        check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

alter table public.clubs enable row level security;


-- =========================================================
-- SOURCE: 003_create_courses.sql
-- =========================================================
create table public.courses (
    id uuid primary key default gen_random_uuid(),

    club_id uuid not null
        references public.clubs(id)
        on delete cascade,

    name text not null,
    holes smallint not null default 18,

    is_active boolean not null default true,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint courses_name_not_blank
        check (length(trim(name)) > 0),

    constraint courses_valid_hole_count
        check (holes in (9, 18)),

    constraint courses_unique_name_per_club
        unique (club_id, name)
);

create index courses_club_id_idx
    on public.courses(club_id);

alter table public.courses enable row level security;


-- =========================================================
-- SOURCE: 005_create_profiles.sql
-- =========================================================
begin;

create table public.profiles (
    id uuid primary key
        references auth.users(id)
        on delete cascade,

    first_name text,
    last_name text,
    display_name text,
    phone text,
    avatar_url text,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint profiles_first_name_not_blank
        check (
            first_name is null
            or length(trim(first_name)) > 0
        ),

    constraint profiles_last_name_not_blank
        check (
            last_name is null
            or length(trim(last_name)) > 0
        ),

    constraint profiles_display_name_not_blank
        check (
            display_name is null
            or length(trim(display_name)) > 0
        )
);

alter table public.profiles
enable row level security;

create policy "Users can read their own profile"
on public.profiles
for select
to authenticated
using (auth.uid() = id);

create policy "Users can update their own profile"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profiles (
        id,
        first_name,
        last_name,
        display_name
    )
    values (
        new.id,
        nullif(trim(new.raw_user_meta_data ->> 'first_name'), ''),
        nullif(trim(new.raw_user_meta_data ->> 'last_name'), ''),
        nullif(
            trim(
                coalesce(
                    new.raw_user_meta_data ->> 'display_name',
                    new.raw_user_meta_data ->> 'full_name'
                )
            ),
            ''
        )
    )
    on conflict (id) do nothing;

    return new;
end;
$$;

drop trigger if exists on_auth_user_created
on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();

insert into public.profiles (
    id,
    first_name,
    last_name,
    display_name
)
select
    users.id,
    nullif(trim(users.raw_user_meta_data ->> 'first_name'), ''),
    nullif(trim(users.raw_user_meta_data ->> 'last_name'), ''),
    nullif(
        trim(
            coalesce(
                users.raw_user_meta_data ->> 'display_name',
                users.raw_user_meta_data ->> 'full_name'
            )
        ),
        ''
    )
from auth.users as users
on conflict (id) do nothing;

commit;


-- =========================================================
-- SOURCE: 006_create_club_memberships.sql
-- =========================================================
begin;

create table public.club_memberships (
    id uuid primary key default gen_random_uuid(),

    profile_id uuid not null
        references public.profiles(id)
        on delete cascade,

    club_id uuid not null
        references public.clubs(id)
        on delete cascade,

    membership_number text,
    membership_type text not null default 'member',
    status text not null default 'active',
    role text not null default 'member',

    joined_at date,
    is_primary boolean not null default false,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint club_memberships_profile_club_unique
        unique (profile_id, club_id),

    constraint club_memberships_number_not_blank
        check (
            membership_number is null
            or length(trim(membership_number)) > 0
        ),

    constraint club_memberships_type_valid
        check (
            membership_type in (
                'member',
                'junior',
                'student',
                'social',
                'corporate',
                'visitor',
                'guest',
                'staff'
            )
        ),

    constraint club_memberships_status_valid
        check (
            status in (
                'invited',
                'pending',
                'active',
                'suspended',
                'expired',
                'cancelled'
            )
        ),

    constraint club_memberships_role_valid
        check (
            role in (
                'member',
                'starter',
                'reception',
                'professional',
                'greenkeeper',
                'manager',
                'club_admin'
            )
        )
);

create unique index club_memberships_one_primary_club
on public.club_memberships (profile_id)
where is_primary = true;

create index club_memberships_profile_id_idx
on public.club_memberships (profile_id);

create index club_memberships_club_id_idx
on public.club_memberships (club_id);

create index club_memberships_status_idx
on public.club_memberships (status);

alter table public.club_memberships
enable row level security;

create policy "Members can read their own club memberships"
on public.club_memberships
for select
to authenticated
using (auth.uid() = profile_id);

commit;


-- =========================================================
-- SOURCE: 007_create_player_handicaps.sql
-- =========================================================
begin;

create table public.player_handicaps (
    id uuid primary key default gen_random_uuid(),

    profile_id uuid not null
        references public.profiles(id)
        on delete cascade,

    governing_body text not null default 'england_golf',
    external_member_id text,

    handicap_index numeric(4,1),
    verification_status text not null default 'unverified',

    verified_at timestamptz,
    last_checked_at timestamptz,
    source_updated_at timestamptz,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint player_handicaps_one_per_profile
        unique (profile_id),

    constraint player_handicaps_external_id_unique
        unique (governing_body, external_member_id),

    constraint player_handicaps_governing_body_valid
        check (
            governing_body in (
                'england_golf',
                'wales_golf',
                'scottish_golf',
                'golf_ireland',
                'manual'
            )
        ),

    constraint player_handicaps_status_valid
        check (
            verification_status in (
                'unverified',
                'pending',
                'verified',
                'failed',
                'expired'
            )
        ),

    constraint player_handicaps_index_valid
        check (
            handicap_index is null
            or handicap_index between -10.0 and 54.0
        ),

    constraint player_handicaps_external_id_not_blank
        check (
            external_member_id is null
            or length(trim(external_member_id)) > 0
        ),

    constraint player_handicaps_verified_data_consistent
        check (
            verification_status <> 'verified'
            or (
                handicap_index is not null
                and external_member_id is not null
                and verified_at is not null
            )
        )
);

create index player_handicaps_profile_id_idx
on public.player_handicaps (profile_id);

create index player_handicaps_external_member_id_idx
on public.player_handicaps (
    governing_body,
    external_member_id
);

create index player_handicaps_verification_status_idx
on public.player_handicaps (verification_status);

alter table public.player_handicaps
enable row level security;

create policy "Players can read their own handicap"
on public.player_handicaps
for select
to authenticated
using (
    (select auth.uid()) = profile_id
);

commit;


-- =========================================================
-- SOURCE: 008_allow_authenticated_club_reads.sql
-- =========================================================
begin;

alter table public.clubs
enable row level security;

drop policy if exists
    "Authenticated users can read clubs"
on public.clubs;

create policy
    "Authenticated users can read clubs"
on public.clubs
for select
to authenticated
using (true);

commit;


-- =========================================================
-- SOURCE: 009_create_tees_and_ratings.sql
-- =========================================================
begin;

-- =========================================================
-- PHYSICAL TEE SETS
-- Examples: White, Yellow, Red
-- =========================================================

create table public.tees (
    id uuid primary key default gen_random_uuid(),

    course_id uuid not null
        references public.courses(id)
        on delete cascade,

    name text not null,
    colour text,

    display_order smallint not null default 0,
    total_yards integer,

    is_active boolean not null default true,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint tees_course_name_unique
        unique (course_id, name),

    constraint tees_name_not_blank
        check (length(trim(name)) > 0),

    constraint tees_colour_not_blank
        check (
            colour is null
            or length(trim(colour)) > 0
        ),

    constraint tees_display_order_valid
        check (display_order >= 0),

    constraint tees_total_yards_valid
        check (
            total_yards is null
            or total_yards between 500 and 10000
        )
);

create index tees_course_id_idx
on public.tees (course_id);

create index tees_active_idx
on public.tees (course_id, is_active);

alter table public.tees
enable row level security;

create policy "Authenticated users can read active tees"
on public.tees
for select
to authenticated
using (is_active = true);


-- =========================================================
-- WHS RATINGS
--
-- A physical tee can have separate men's and women's
-- Course Rating, Slope Rating and Par.
-- =========================================================

create table public.tee_ratings (
    id uuid primary key default gen_random_uuid(),

    tee_id uuid not null
        references public.tees(id)
        on delete cascade,

    rating_gender text not null,

    par smallint not null,
    course_rating numeric(4,1) not null,
    slope_rating smallint not null,

    effective_from date,
    effective_to date,

    is_active boolean not null default true,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint tee_ratings_gender_valid
        check (
            rating_gender in (
                'men',
                'women'
            )
        ),

    constraint tee_ratings_par_valid
        check (
            par between 27 and 90
        ),

    constraint tee_ratings_course_rating_valid
        check (
            course_rating between 20.0 and 100.0
        ),

    constraint tee_ratings_slope_valid
        check (
            slope_rating between 55 and 155
        ),

    constraint tee_ratings_dates_valid
        check (
            effective_to is null
            or effective_from is null
            or effective_to >= effective_from
        )
);

create index tee_ratings_tee_id_idx
on public.tee_ratings (tee_id);

create index tee_ratings_active_idx
on public.tee_ratings (
    tee_id,
    rating_gender,
    is_active
);

create unique index tee_ratings_one_current_rating
on public.tee_ratings (
    tee_id,
    rating_gender
)
where
    is_active = true
    and effective_to is null;

alter table public.tee_ratings
enable row level security;

create policy "Authenticated users can read active tee ratings"
on public.tee_ratings
for select
to authenticated
using (is_active = true);


-- =========================================================
-- AUTOMATIC UPDATED_AT TIMESTAMPS
-- =========================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists set_tees_updated_at
on public.tees;

create trigger set_tees_updated_at
before update on public.tees
for each row
execute function public.set_updated_at();

drop trigger if exists set_tee_ratings_updated_at
on public.tee_ratings;

create trigger set_tee_ratings_updated_at
before update on public.tee_ratings
for each row
execute function public.set_updated_at();

commit;


-- =========================================================
-- SOURCE: 011_create_booking_foundation.sql
-- =========================================================
begin;

-- =========================================================
-- SHARED UPDATED_AT FUNCTION
-- =========================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;


-- =========================================================
-- TEE TIMES
--
-- Club-controlled playable inventory for a course.
-- Occupancy is calculated from active booking members.
-- =========================================================

create table public.tee_times (
    id uuid primary key default gen_random_uuid(),

    course_id uuid not null
        references public.courses(id)
        on delete cascade,

    play_date date not null,
    start_time time without time zone not null,

    max_players smallint not null default 4,

    operational_status text not null default 'open',
    notes text,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint tee_times_course_date_time_unique
        unique (
            course_id,
            play_date,
            start_time
        ),

    constraint tee_times_max_players_valid
        check (
            max_players between 1 and 8
        ),

    constraint tee_times_status_valid
        check (
            operational_status in (
                'open',
                'blocked',
                'maintenance',
                'competition',
                'closed'
            )
        ),

    constraint tee_times_notes_not_blank
        check (
            notes is null
            or length(trim(notes)) > 0
        )
);

create index tee_times_course_date_idx
on public.tee_times (
    course_id,
    play_date,
    start_time
);

create index tee_times_status_idx
on public.tee_times (
    course_id,
    play_date,
    operational_status
);

create trigger set_tee_times_updated_at
before update on public.tee_times
for each row
execute function public.set_updated_at();


-- =========================================================
-- BOOKINGS
--
-- A booking reserves a tee time.
-- Only one active booking can exist for each tee time.
-- Cancelled bookings remain for history and auditing.
-- =========================================================

create table public.bookings (
    id uuid primary key default gen_random_uuid(),

    tee_time_id uuid not null
        references public.tee_times(id)
        on delete restrict,

    created_by_membership_id uuid not null
        references public.club_memberships(id)
        on delete restrict,

    booking_type text not null default 'joinable',
    booking_status text not null default 'active',

    lead_name text,
    contact_number text,
    notes text,

    cancelled_at timestamptz,
    cancelled_by_membership_id uuid
        references public.club_memberships(id)
        on delete set null,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint bookings_type_valid
        check (
            booking_type in (
                'joinable',
                'private'
            )
        ),

    constraint bookings_status_valid
        check (
            booking_status in (
                'active',
                'cancelled',
                'completed',
                'no_show'
            )
        ),

    constraint bookings_lead_name_not_blank
        check (
            lead_name is null
            or length(trim(lead_name)) > 0
        ),

    constraint bookings_contact_not_blank
        check (
            contact_number is null
            or length(trim(contact_number)) > 0
        ),

    constraint bookings_notes_not_blank
        check (
            notes is null
            or length(trim(notes)) > 0
        ),

    constraint bookings_cancellation_consistent
        check (
            (
                booking_status = 'cancelled'
                and cancelled_at is not null
            )
            or
            (
                booking_status <> 'cancelled'
                and cancelled_at is null
                and cancelled_by_membership_id is null
            )
        )
);

-- Allows historical cancelled bookings while ensuring only one
-- current active booking occupies a tee time.
create unique index bookings_one_active_per_tee_time
on public.bookings (tee_time_id)
where booking_status = 'active';

create index bookings_tee_time_id_idx
on public.bookings (tee_time_id);

create index bookings_creator_idx
on public.bookings (created_by_membership_id);

create index bookings_status_idx
on public.bookings (booking_status);

create trigger set_bookings_updated_at
before update on public.bookings
for each row
execute function public.set_updated_at();


-- =========================================================
-- BOOKING MEMBERS
--
-- Members occupy positions within a club-owned booking.
-- Visitor support can later use a separate booking_guests table.
-- =========================================================

create table public.booking_members (
    id uuid primary key default gen_random_uuid(),

    booking_id uuid not null
        references public.bookings(id)
        on delete cascade,

    membership_id uuid not null
        references public.club_memberships(id)
        on delete restrict,

    position smallint not null,

    member_status text not null default 'confirmed',

    added_by_membership_id uuid
        references public.club_memberships(id)
        on delete set null,

    checked_in_at timestamptz,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint booking_members_booking_membership_unique
        unique (
            booking_id,
            membership_id
        ),

    constraint booking_members_booking_position_unique
        unique (
            booking_id,
            position
        ),

    constraint booking_members_position_valid
        check (
            position between 1 and 8
        ),

    constraint booking_members_status_valid
        check (
            member_status in (
                'invited',
                'confirmed',
                'declined',
                'cancelled',
                'checked_in',
                'no_show'
            )
        ),

    constraint booking_members_check_in_consistent
        check (
            member_status <> 'checked_in'
            or checked_in_at is not null
        )
);

create index booking_members_booking_id_idx
on public.booking_members (booking_id);

create index booking_members_membership_id_idx
on public.booking_members (membership_id);

create index booking_members_active_idx
on public.booking_members (
    booking_id,
    member_status
);

create trigger set_booking_members_updated_at
before update on public.booking_members
for each row
execute function public.set_updated_at();


-- =========================================================
-- ROW LEVEL SECURITY
-- =========================================================

alter table public.tee_times
enable row level security;

alter table public.bookings
enable row level security;

alter table public.booking_members
enable row level security;


-- Members may read tee times belonging to clubs where they
-- currently hold an active membership.
create policy "Members can read their club tee times"
on public.tee_times
for select
to authenticated
using (
    exists (
        select 1
        from public.courses as c
        join public.club_memberships as cm
            on cm.club_id = c.club_id
        where c.id = tee_times.course_id
          and cm.profile_id = auth.uid()
          and cm.status = 'active'
    )
);


-- Members may read bookings belonging to their active clubs.
create policy "Members can read their club bookings"
on public.bookings
for select
to authenticated
using (
    exists (
        select 1
        from public.tee_times as tt
        join public.courses as c
            on c.id = tt.course_id
        join public.club_memberships as cm
            on cm.club_id = c.club_id
        where tt.id = bookings.tee_time_id
          and cm.profile_id = auth.uid()
          and cm.status = 'active'
    )
);


-- Members may read occupants of bookings at their active clubs.
create policy "Members can read their club booking members"
on public.booking_members
for select
to authenticated
using (
    exists (
        select 1
        from public.bookings as b
        join public.tee_times as tt
            on tt.id = b.tee_time_id
        join public.courses as c
            on c.id = tt.course_id
        join public.club_memberships as cm
            on cm.club_id = c.club_id
        where b.id = booking_members.booking_id
          and cm.profile_id = auth.uid()
          and cm.status = 'active'
    )
);


-- =========================================================
-- DATA API PRIVILEGES
--
-- Direct browser writes are intentionally disabled.
-- Controlled booking functions will be added next.
-- =========================================================

revoke all
on public.tee_times,
   public.bookings,
   public.booking_members
from anon;

revoke all
on public.tee_times,
   public.bookings,
   public.booking_members
from authenticated;

grant select
on public.tee_times,
   public.bookings,
   public.booking_members
to authenticated;

commit;


-- =========================================================
-- SOURCE: 012_create_booking_schedules.sql
-- =========================================================
begin;

-- =========================================================
-- BOOKING SCHEDULES
--
-- Defines when a course normally offers tee times.
-- Actual tee_times rows will be generated from these records.
-- =========================================================

create table public.booking_schedules (
    id uuid primary key default gen_random_uuid(),

    course_id uuid not null
        references public.courses(id)
        on delete cascade,

    name text not null,

    first_tee_time time without time zone not null,
    last_tee_time time without time zone not null,

    interval_minutes smallint not null,
    max_players smallint not null default 4,

    monday boolean not null default true,
    tuesday boolean not null default true,
    wednesday boolean not null default true,
    thursday boolean not null default true,
    friday boolean not null default true,
    saturday boolean not null default true,
    sunday boolean not null default true,

    effective_from date not null,
    effective_to date,

    is_active boolean not null default true,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint booking_schedules_name_not_blank
        check (length(trim(name)) > 0),

    constraint booking_schedules_times_valid
        check (last_tee_time >= first_tee_time),

    constraint booking_schedules_interval_valid
        check (interval_minutes between 1 and 60),

    constraint booking_schedules_max_players_valid
        check (max_players between 1 and 8),

    constraint booking_schedules_dates_valid
        check (
            effective_to is null
            or effective_to >= effective_from
        ),

    constraint booking_schedules_has_active_day
        check (
            monday
            or tuesday
            or wednesday
            or thursday
            or friday
            or saturday
            or sunday
        ),

    constraint booking_schedules_course_name_dates_unique
        unique (
            course_id,
            name,
            effective_from
        )
);

create index booking_schedules_course_id_idx
on public.booking_schedules (course_id);

create index booking_schedules_active_dates_idx
on public.booking_schedules (
    course_id,
    is_active,
    effective_from,
    effective_to
);

create trigger set_booking_schedules_updated_at
before update on public.booking_schedules
for each row
execute function public.set_updated_at();


-- =========================================================
-- ROW LEVEL SECURITY
--
-- Schedules are operational Paryx data.
-- Only authorised staff roles may read them in the browser.
-- Direct browser writes remain disabled for now.
-- =========================================================

alter table public.booking_schedules
enable row level security;

create policy "Club staff can read booking schedules"
on public.booking_schedules
for select
to authenticated
using (
    exists (
        select 1
        from public.courses as c
        join public.club_memberships as cm
            on cm.club_id = c.club_id
        where c.id = booking_schedules.course_id
          and cm.profile_id = auth.uid()
          and cm.status = 'active'
          and cm.role in (
              'starter',
              'reception',
              'professional',
              'manager',
              'club_admin'
          )
    )
);

revoke all
on public.booking_schedules
from anon;

revoke all
on public.booking_schedules
from authenticated;

grant select
on public.booking_schedules
to authenticated;

commit;


-- =========================================================
-- SOURCE: 013_create_tee_sheet_generator.sql
-- =========================================================
begin;

-- =========================================================
-- LINK GENERATED TEE TIMES TO THEIR SOURCE SCHEDULE
-- =========================================================

alter table public.tee_times
add column if not exists booking_schedule_id uuid
    references public.booking_schedules(id)
    on delete set null;

create index if not exists tee_times_booking_schedule_id_idx
on public.tee_times (booking_schedule_id);


-- =========================================================
-- GENERATE A SINGLE DAY'S TEE SHEET
--
-- Returns the number of new tee-time rows created.
-- Existing course/date/time rows are skipped safely.
-- =========================================================

create or replace function public.generate_tee_sheet(
    p_schedule_id uuid,
    p_play_date date
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_schedule public.booking_schedules%rowtype;
    v_day_enabled boolean;
    v_created_count integer := 0;
begin
    if p_schedule_id is null then
        raise exception
            'A booking schedule ID is required.';
    end if;

    if p_play_date is null then
        raise exception
            'A play date is required.';
    end if;

    select *
    into v_schedule
    from public.booking_schedules
    where id = p_schedule_id;

    if not found then
        raise exception
            'Booking schedule % was not found.',
            p_schedule_id;
    end if;

    -- When called by a signed-in browser user, verify that the
    -- user has an authorised Paryx role for this schedule.
    --
    -- auth.uid() is null in the Supabase SQL Editor, allowing
    -- administrators to test the function there.
    if auth.uid() is not null then
        if not exists (
            select 1
            from public.courses as c
            join public.club_memberships as cm
                on cm.club_id = c.club_id
            where c.id = v_schedule.course_id
              and cm.profile_id = auth.uid()
              and cm.status = 'active'
              and cm.role in (
                  'starter',
                  'reception',
                  'professional',
                  'manager',
                  'club_admin'
              )
        ) then
            raise exception
                'You are not authorised to generate this tee sheet.';
        end if;
    end if;

    if not v_schedule.is_active then
        raise exception
            'The selected booking schedule is inactive.';
    end if;

    if p_play_date < v_schedule.effective_from then
        raise exception
            'The selected date is before this schedule begins.';
    end if;

    if (
        v_schedule.effective_to is not null
        and p_play_date > v_schedule.effective_to
    ) then
        raise exception
            'The selected date is after this schedule ends.';
    end if;

    v_day_enabled :=
        case extract(isodow from p_play_date)::integer
            when 1 then v_schedule.monday
            when 2 then v_schedule.tuesday
            when 3 then v_schedule.wednesday
            when 4 then v_schedule.thursday
            when 5 then v_schedule.friday
            when 6 then v_schedule.saturday
            when 7 then v_schedule.sunday
            else false
        end;

    if not v_day_enabled then
        raise exception
            'The booking schedule is not enabled for this day of the week.';
    end if;

    insert into public.tee_times (
        course_id,
        booking_schedule_id,
        play_date,
        start_time,
        max_players,
        operational_status
    )
    select
        v_schedule.course_id,
        v_schedule.id,
        p_play_date,
        generated_time::time,
        v_schedule.max_players,
        'open'
    from generate_series(
        p_play_date + v_schedule.first_tee_time,
        p_play_date + v_schedule.last_tee_time,
        make_interval(
            mins => v_schedule.interval_minutes
        )
    ) as generated_time
    on conflict (
        course_id,
        play_date,
        start_time
    )
    do nothing;

    get diagnostics v_created_count = row_count;

    return v_created_count;
end;
$$;


-- =========================================================
-- FUNCTION PERMISSIONS
-- =========================================================

revoke all
on function public.generate_tee_sheet(uuid, date)
from public;

revoke all
on function public.generate_tee_sheet(uuid, date)
from anon;

grant execute
on function public.generate_tee_sheet(uuid, date)
to authenticated;

commit;


-- =========================================================
-- SOURCE: 015_allow_member_course_reads.sql
-- =========================================================
begin;

alter table public.courses
enable row level security;

drop policy if exists
    "Members can read their club courses"
on public.courses;

create policy
    "Members can read their club courses"
on public.courses
for select
to authenticated
using (
    is_active = true
    and exists (
        select 1
        from public.club_memberships as cm
        where cm.club_id = courses.club_id
          and cm.profile_id = auth.uid()
          and cm.status = 'active'
    )
);

grant select
on public.courses
to authenticated;

commit;


-- =========================================================
-- SOURCE: 016_create_rolling_tee_sheet_generation.sql
-- =========================================================
begin;

-- =========================================================
-- GENERATE A ROLLING WINDOW FOR ALL ACTIVE SCHEDULES
--
-- Default: today plus the following 59 days = 60 days total.
-- Existing tee times are skipped by generate_tee_sheet().
-- =========================================================

create or replace function public.generate_rolling_tee_sheets(
    p_start_date date default current_date,
    p_number_of_days integer default 60
)
returns table (
    schedules_processed integer,
    dates_checked integer,
    tee_times_created integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_schedule public.booking_schedules%rowtype;
    v_play_date date;
    v_created integer;
    v_schedules_processed integer := 0;
    v_dates_checked integer := 0;
    v_tee_times_created integer := 0;
begin
    if p_start_date is null then
        raise exception
            'A start date is required.';
    end if;

    if p_number_of_days is null
       or p_number_of_days < 1
       or p_number_of_days > 366 then
        raise exception
            'The number of days must be between 1 and 366.';
    end if;

    for v_schedule in
        select *
        from public.booking_schedules
        where is_active = true
          and effective_from <=
              p_start_date + (p_number_of_days - 1)
          and (
              effective_to is null
              or effective_to >= p_start_date
          )
    loop
        v_schedules_processed :=
            v_schedules_processed + 1;

        for v_play_date in
            select generate_series(
                p_start_date,
                p_start_date + (p_number_of_days - 1),
                interval '1 day'
            )::date
        loop
            -- Only attempt dates within the schedule period.
            if v_play_date < v_schedule.effective_from then
                continue;
            end if;

            if (
                v_schedule.effective_to is not null
                and v_play_date > v_schedule.effective_to
            ) then
                continue;
            end if;

            -- Skip disabled weekdays rather than raising an error.
            if not (
                case extract(isodow from v_play_date)::integer
                    when 1 then v_schedule.monday
                    when 2 then v_schedule.tuesday
                    when 3 then v_schedule.wednesday
                    when 4 then v_schedule.thursday
                    when 5 then v_schedule.friday
                    when 6 then v_schedule.saturday
                    when 7 then v_schedule.sunday
                    else false
                end
            ) then
                continue;
            end if;

            v_dates_checked :=
                v_dates_checked + 1;

            v_created :=
                public.generate_tee_sheet(
                    v_schedule.id,
                    v_play_date
                );

            v_tee_times_created :=
                v_tee_times_created + v_created;
        end loop;
    end loop;

    return query
    select
        v_schedules_processed,
        v_dates_checked,
        v_tee_times_created;
end;
$$;


-- =========================================================
-- FUNCTION PERMISSIONS
--
-- This is an operational/admin function. Ordinary members
-- should not invoke bulk tee-sheet generation directly.
-- =========================================================

revoke all
on function public.generate_rolling_tee_sheets(date, integer)
from public;

revoke all
on function public.generate_rolling_tee_sheets(date, integer)
from anon;

revoke all
on function public.generate_rolling_tee_sheets(date, integer)
from authenticated;

commit;


-- =========================================================
-- SOURCE: 017_create_booking_function.sql
-- =========================================================
begin;

-- =========================================================
-- CREATE A BOOKING
--
-- Creates one active booking and adds the signed-in member
-- as position 1.
--
-- Direct browser inserts remain disabled. The browser calls
-- this controlled function instead.
-- =========================================================

create or replace function public.create_booking(
    p_tee_time_id uuid,
    p_booking_type text default 'joinable',
    p_contact_number text default null,
    p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid;
    v_membership_id uuid;
    v_booking_id uuid;

    v_tee_time public.tee_times%rowtype;
    v_course public.courses%rowtype;
begin
    v_user_id := auth.uid();

    if v_user_id is null then
        raise exception
            'You must be signed in to create a booking.';
    end if;

    if p_tee_time_id is null then
        raise exception
            'A tee-time ID is required.';
    end if;

    if p_booking_type not in (
        'joinable',
        'private'
    ) then
        raise exception
            'Booking type must be joinable or private.';
    end if;

    /*
     * Lock the tee-time row so two users cannot reserve the
     * same empty tee time simultaneously.
     */
    select *
    into v_tee_time
    from public.tee_times
    where id = p_tee_time_id
    for update;

    if not found then
        raise exception
            'The selected tee time was not found.';
    end if;

    select *
    into v_course
    from public.courses
    where id = v_tee_time.course_id;

    if not found then
        raise exception
            'The course linked to this tee time was not found.';
    end if;

    /*
     * Resolve the signed-in user's active membership at the
     * club that owns the course.
     */
    select cm.id
    into v_membership_id
    from public.club_memberships as cm
    where cm.profile_id = v_user_id
      and cm.club_id = v_course.club_id
      and cm.status = 'active'
    order by
        cm.is_primary desc,
        cm.created_at asc
    limit 1;

    if v_membership_id is null then
        raise exception
            'You do not have an active membership at this club.';
    end if;

    if v_tee_time.operational_status <> 'open' then
        raise exception
            'This tee time is not open for booking.';
    end if;

    if v_tee_time.play_date < current_date then
        raise exception
            'Past tee times cannot be booked.';
    end if;

    if (
        v_tee_time.play_date = current_date
        and v_tee_time.start_time <= localtime
    ) then
        raise exception
            'This tee time has already passed.';
    end if;

    if exists (
        select 1
        from public.bookings as b
        where b.tee_time_id = v_tee_time.id
          and b.booking_status = 'active'
    ) then
        raise exception
            'This tee time already has an active booking.';
    end if;

    insert into public.bookings (
        tee_time_id,
        created_by_membership_id,
        booking_type,
        booking_status,
        contact_number,
        notes
    )
    values (
        v_tee_time.id,
        v_membership_id,
        p_booking_type,
        'active',
        nullif(trim(p_contact_number), ''),
        nullif(trim(p_notes), '')
    )
    returning id
    into v_booking_id;

    insert into public.booking_members (
        booking_id,
        membership_id,
        position,
        member_status,
        added_by_membership_id
    )
    values (
        v_booking_id,
        v_membership_id,
        1,
        'confirmed',
        v_membership_id
    );

    return v_booking_id;

exception
    when unique_violation then
        raise exception
            'This tee time was booked by another member moments ago.';
end;
$$;


-- =========================================================
-- FUNCTION PERMISSIONS
-- =========================================================

revoke all
on function public.create_booking(
    uuid,
    text,
    text,
    text
)
from public;

revoke all
on function public.create_booking(
    uuid,
    text,
    text,
    text
)
from anon;

grant execute
on function public.create_booking(
    uuid,
    text,
    text,
    text
)
to authenticated;

commit;


-- =========================================================
-- SOURCE: 018_add_booking_player_count.sql
-- =========================================================
begin;

-- =========================================================
-- BOOKING PLAYER COUNT
-- =========================================================

alter table public.bookings
add column if not exists player_count smallint;

update public.bookings as b
set player_count = greatest(
    (
        select count(*)::smallint
        from public.booking_members as bm
        where bm.booking_id = b.id
          and bm.member_status in (
              'invited',
              'confirmed',
              'checked_in'
          )
    ),
    1
)
where b.player_count is null;

alter table public.bookings
alter column player_count set default 1;

alter table public.bookings
alter column player_count set not null;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'bookings_player_count_valid'
          and conrelid = 'public.bookings'::regclass
    ) then
        alter table public.bookings
        add constraint bookings_player_count_valid
        check (
            player_count between 1 and 8
        );
    end if;
end;
$$;


-- =========================================================
-- REMOVE OLD RPC SIGNATURE
--
-- PostgreSQL cannot change default parameters in place.
-- =========================================================

drop function if exists public.create_booking(
    uuid,
    text,
    text,
    text
);


-- =========================================================
-- PRIMARY CREATE BOOKING FUNCTION
-- =========================================================

create or replace function public.create_booking(
    p_tee_time_id uuid,
    p_player_count smallint,
    p_booking_type text,
    p_contact_number text,
    p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid;
    v_membership_id uuid;
    v_booking_id uuid;

    v_tee_time public.tee_times%rowtype;
    v_course public.courses%rowtype;
begin
    v_user_id := auth.uid();

    if v_user_id is null then
        raise exception
            'You must be signed in to create a booking.';
    end if;

    if p_tee_time_id is null then
        raise exception
            'A tee-time ID is required.';
    end if;

    if p_player_count is null then
        raise exception
            'A player count is required.';
    end if;

    if p_player_count < 1 then
        raise exception
            'A booking must contain at least one player.';
    end if;

    if p_booking_type not in (
        'joinable',
        'private'
    ) then
        raise exception
            'Booking type must be joinable or private.';
    end if;

    select *
    into v_tee_time
    from public.tee_times
    where id = p_tee_time_id
    for update;

    if not found then
        raise exception
            'The selected tee time was not found.';
    end if;

    select *
    into v_course
    from public.courses
    where id = v_tee_time.course_id;

    if not found then
        raise exception
            'The course linked to this tee time was not found.';
    end if;

    select cm.id
    into v_membership_id
    from public.club_memberships as cm
    where cm.profile_id = v_user_id
      and cm.club_id = v_course.club_id
      and cm.status = 'active'
    order by
        cm.is_primary desc,
        cm.created_at asc
    limit 1;

    if v_membership_id is null then
        raise exception
            'You do not have an active membership at this club.';
    end if;

    if v_tee_time.operational_status <> 'open' then
        raise exception
            'This tee time is not open for booking.';
    end if;

    if p_player_count > v_tee_time.max_players then
        raise exception
            'This tee time allows a maximum of % players.',
            v_tee_time.max_players;
    end if;

    if v_tee_time.play_date < current_date then
        raise exception
            'Past tee times cannot be booked.';
    end if;

    if (
        v_tee_time.play_date = current_date
        and v_tee_time.start_time <= localtime
    ) then
        raise exception
            'This tee time has already passed.';
    end if;

    if exists (
        select 1
        from public.bookings as b
        where b.tee_time_id = v_tee_time.id
          and b.booking_status = 'active'
    ) then
        raise exception
            'This tee time already has an active booking.';
    end if;

    insert into public.bookings (
        tee_time_id,
        created_by_membership_id,
        player_count,
        booking_type,
        booking_status,
        contact_number,
        notes
    )
    values (
        v_tee_time.id,
        v_membership_id,
        p_player_count,
        p_booking_type,
        'active',
        nullif(trim(p_contact_number), ''),
        nullif(trim(p_notes), '')
    )
    returning id
    into v_booking_id;

    insert into public.booking_members (
        booking_id,
        membership_id,
        position,
        member_status,
        added_by_membership_id
    )
    values (
        v_booking_id,
        v_membership_id,
        1,
        'confirmed',
        v_membership_id
    );

    return v_booking_id;

exception
    when unique_violation then
        raise exception
            'This tee time was booked by another member moments ago.';
end;
$$;


-- =========================================================
-- TEMPORARY FOUR-ARGUMENT COMPATIBILITY WRAPPER
-- =========================================================

create function public.create_booking(
    p_tee_time_id uuid,
    p_booking_type text,
    p_contact_number text,
    p_notes text
)
returns uuid
language sql
security definer
set search_path = public
as $$
    select public.create_booking(
        p_tee_time_id,
        1::smallint,
        p_booking_type,
        p_contact_number,
        p_notes
    );
$$;


-- =========================================================
-- FUNCTION PERMISSIONS
-- =========================================================

revoke all
on function public.create_booking(
    uuid,
    smallint,
    text,
    text,
    text
)
from public, anon;

grant execute
on function public.create_booking(
    uuid,
    smallint,
    text,
    text,
    text
)
to authenticated;

revoke all
on function public.create_booking(
    uuid,
    text,
    text,
    text
)
from public, anon;

grant execute
on function public.create_booking(
    uuid,
    text,
    text,
    text
)
to authenticated;

commit;


-- =========================================================
-- SOURCE: 019_create_join_booking_function.sql
-- =========================================================
begin;

-- =========================================================
-- JOIN AN EXISTING BOOKING
--
-- Adds the authenticated member to a joinable booking and
-- increases the booking's occupied player_count.
-- =========================================================

create or replace function public.join_booking(
    p_booking_id uuid,
    p_player_count smallint default 1
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
    v_user_id := auth.uid();

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

    /*
     * Lock the booking so simultaneous join requests cannot
     * exceed the tee-time capacity.
     */
    select *
    into v_booking
    from public.bookings
    where id = p_booking_id
    for update;

    if not found then
        raise exception
            'The selected booking was not found.';
    end if;

    if v_booking.booking_status <> 'active' then
        raise exception
            'This booking is no longer active.';
    end if;

    if v_booking.booking_type <> 'joinable' then
        raise exception
            'This booking is private and cannot be joined.';
    end if;

    select *
    into v_tee_time
    from public.tee_times
    where id = v_booking.tee_time_id;

    if not found then
        raise exception
            'The tee time linked to this booking was not found.';
    end if;

    select *
    into v_course
    from public.courses
    where id = v_tee_time.course_id;

    if not found then
        raise exception
            'The course linked to this booking was not found.';
    end if;

    select cm.id
    into v_membership_id
    from public.club_memberships as cm
    where cm.profile_id = v_user_id
      and cm.club_id = v_course.club_id
      and cm.status = 'active'
    order by
        cm.is_primary desc,
        cm.created_at asc
    limit 1;

    if v_membership_id is null then
        raise exception
            'You do not have an active membership at this club.';
    end if;

    if v_tee_time.operational_status <> 'open' then
        raise exception
            'This tee time is not open.';
    end if;

    if v_tee_time.play_date < current_date then
        raise exception
            'Past tee times cannot be joined.';
    end if;

    if (
        v_tee_time.play_date = current_date
        and v_tee_time.start_time <= localtime
    ) then
        raise exception
            'This tee time has already passed.';
    end if;

    if exists (
        select 1
        from public.booking_members as bm
        where bm.booking_id = v_booking.id
          and bm.membership_id = v_membership_id
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
        v_booking.player_count + p_player_count
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

    select
        coalesce(max(bm.position), 0) + 1
    into v_next_position
    from public.booking_members as bm
    where bm.booking_id = v_booking.id;

    update public.bookings
    set
        player_count =
            player_count + p_player_count,
        updated_at = now()
    where id = v_booking.id;

    /*
     * One identifiable booking_member represents the joining
     * member and their party. player_count stores all places.
     */
    insert into public.booking_members (
        booking_id,
        membership_id,
        position,
        member_status,
        added_by_membership_id
    )
    values (
        v_booking.id,
        v_membership_id,
        v_next_position,
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


-- =========================================================
-- FUNCTION PERMISSIONS
-- =========================================================

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

commit;


-- =========================================================
-- SOURCE: 020_repair_join_booking_rpc.sql
-- =========================================================
begin;

-- =========================================================
-- JOIN AN EXISTING BOOKING
--
-- Adds the authenticated member and their party to a
-- joinable booking without exceeding the tee-time capacity.
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
    v_user_id := auth.uid();

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

    /*
     * Lock the booking so simultaneous joins cannot exceed
     * the available capacity.
     */
    select *
    into v_booking
    from public.bookings
    where id = p_booking_id
    for update;

    if not found then
        raise exception
            'The selected booking was not found.';
    end if;

    if v_booking.booking_status <> 'active' then
        raise exception
            'This booking is no longer active.';
    end if;

    if v_booking.booking_type <> 'joinable' then
        raise exception
            'This booking is private and cannot be joined.';
    end if;

    select *
    into v_tee_time
    from public.tee_times
    where id = v_booking.tee_time_id;

    if not found then
        raise exception
            'The tee time linked to this booking was not found.';
    end if;

    select *
    into v_course
    from public.courses
    where id = v_tee_time.course_id;

    if not found then
        raise exception
            'The course linked to this booking was not found.';
    end if;

    select cm.id
    into v_membership_id
    from public.club_memberships as cm
    where cm.profile_id = v_user_id
      and cm.club_id = v_course.club_id
      and cm.status = 'active'
    order by
        cm.is_primary desc,
        cm.created_at asc
    limit 1;

    if v_membership_id is null then
        raise exception
            'You do not have an active membership at this club.';
    end if;

    if v_tee_time.operational_status <> 'open' then
        raise exception
            'This tee time is not open.';
    end if;

    if v_tee_time.play_date < current_date then
        raise exception
            'Past tee times cannot be joined.';
    end if;

    if (
        v_tee_time.play_date = current_date
        and v_tee_time.start_time <= localtime
    ) then
        raise exception
            'This tee time has already passed.';
    end if;

    if exists (
        select 1
        from public.booking_members as bm
        where bm.booking_id = v_booking.id
          and bm.membership_id = v_membership_id
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
        v_booking.player_count + p_player_count
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

    select
        coalesce(max(bm.position), 0) + 1
    into v_next_position
    from public.booking_members as bm
    where bm.booking_id = v_booking.id;

    update public.bookings
    set
        player_count =
            player_count + p_player_count,
        updated_at = now()
    where id = v_booking.id;

    /*
     * One identified member represents the joining party.
     * player_count stores the total places they occupy.
     */
    insert into public.booking_members (
        booking_id,
        membership_id,
        position,
        member_status,
        added_by_membership_id
    )
    values (
        v_booking.id,
        v_membership_id,
        v_next_position,
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

commit;

-- Force Supabase Data API/PostgREST to discover the RPC.
notify pgrst, 'reload schema';


-- =========================================================
-- SOURCE: 021_add_booking_member_party_size.sql
-- =========================================================
begin;

-- =========================================================
-- PARTY SIZE PER IDENTIFIED BOOKING MEMBER
--
-- Each booking_members row represents an accountable member
-- and the number of tee-time places occupied by their party.
-- =========================================================

alter table public.booking_members
add column if not exists party_size smallint;

alter table public.booking_members
alter column party_size set default 1;

-- Existing joining members are conservatively treated as
-- one-player parties. The lead member receives the remaining
-- booking occupancy.
update public.booking_members
set party_size = 1
where party_size is null;

with active_member_counts as (
    select
        bm.booking_id,
        count(*) filter (
            where bm.member_status in (
                'invited',
                'confirmed',
                'checked_in'
            )
        ) as active_member_rows
    from public.booking_members as bm
    group by bm.booking_id
),
lead_party_sizes as (
    select
        b.id as booking_id,
        greatest(
            b.player_count
            - greatest(amc.active_member_rows - 1, 0),
            1
        )::smallint as lead_party_size
    from public.bookings as b
    join active_member_counts as amc
        on amc.booking_id = b.id
)
update public.booking_members as bm
set party_size = lps.lead_party_size
from lead_party_sizes as lps
where bm.booking_id = lps.booking_id
  and bm.position = 1
  and bm.member_status in (
      'invited',
      'confirmed',
      'checked_in'
  );

alter table public.booking_members
alter column party_size set not null;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname =
            'booking_members_party_size_valid'
          and conrelid =
            'public.booking_members'::regclass
    ) then
        alter table public.booking_members
        add constraint booking_members_party_size_valid
        check (party_size between 1 and 8);
    end if;
end;
$$;


-- =========================================================
-- REPLACE CREATE BOOKING RPC
-- =========================================================

drop function if exists public.create_booking(
    uuid,
    smallint,
    text,
    text,
    text
);

create function public.create_booking(
    p_tee_time_id uuid,
    p_player_count smallint,
    p_booking_type text,
    p_contact_number text,
    p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid;
    v_membership_id uuid;
    v_booking_id uuid;

    v_tee_time public.tee_times%rowtype;
    v_course public.courses%rowtype;
begin
    v_user_id := auth.uid();

    if v_user_id is null then
        raise exception
            'You must be signed in to create a booking.';
    end if;

    if p_tee_time_id is null then
        raise exception
            'A tee-time ID is required.';
    end if;

    if p_player_count is null
       or p_player_count < 1 then
        raise exception
            'A booking must contain at least one player.';
    end if;

    if p_booking_type not in (
        'joinable',
        'private'
    ) then
        raise exception
            'Booking type must be joinable or private.';
    end if;

    select *
    into v_tee_time
    from public.tee_times
    where id = p_tee_time_id
    for update;

    if not found then
        raise exception
            'The selected tee time was not found.';
    end if;

    select *
    into v_course
    from public.courses
    where id = v_tee_time.course_id;

    if not found then
        raise exception
            'The course linked to this tee time was not found.';
    end if;

    select cm.id
    into v_membership_id
    from public.club_memberships as cm
    where cm.profile_id = v_user_id
      and cm.club_id = v_course.club_id
      and cm.status = 'active'
    order by
        cm.is_primary desc,
        cm.created_at asc
    limit 1;

    if v_membership_id is null then
        raise exception
            'You do not have an active membership at this club.';
    end if;

    if v_tee_time.operational_status <> 'open' then
        raise exception
            'This tee time is not open for booking.';
    end if;

    if p_player_count > v_tee_time.max_players then
        raise exception
            'This tee time allows a maximum of % players.',
            v_tee_time.max_players;
    end if;

    if v_tee_time.play_date < current_date then
        raise exception
            'Past tee times cannot be booked.';
    end if;

    if (
        v_tee_time.play_date = current_date
        and v_tee_time.start_time <= localtime
    ) then
        raise exception
            'This tee time has already passed.';
    end if;

    if exists (
        select 1
        from public.bookings as b
        where b.tee_time_id = v_tee_time.id
          and b.booking_status = 'active'
    ) then
        raise exception
            'This tee time already has an active booking.';
    end if;

    insert into public.bookings (
        tee_time_id,
        created_by_membership_id,
        player_count,
        booking_type,
        booking_status,
        contact_number,
        notes
    )
    values (
        v_tee_time.id,
        v_membership_id,
        p_player_count,
        p_booking_type,
        'active',
        nullif(trim(p_contact_number), ''),
        nullif(trim(p_notes), '')
    )
    returning id
    into v_booking_id;

    insert into public.booking_members (
        booking_id,
        membership_id,
        position,
        party_size,
        member_status,
        added_by_membership_id
    )
    values (
        v_booking_id,
        v_membership_id,
        1,
        p_player_count,
        'confirmed',
        v_membership_id
    );

    return v_booking_id;

exception
    when unique_violation then
        raise exception
            'This tee time was booked by another member moments ago.';
end;
$$;


-- Keep the existing four-argument compatibility wrapper.
drop function if exists public.create_booking(
    uuid,
    text,
    text,
    text
);

create function public.create_booking(
    p_tee_time_id uuid,
    p_booking_type text,
    p_contact_number text,
    p_notes text
)
returns uuid
language sql
security definer
set search_path = public
as $$
    select public.create_booking(
        p_tee_time_id,
        1::smallint,
        p_booking_type,
        p_contact_number,
        p_notes
    );
$$;


-- =========================================================
-- REPLACE JOIN BOOKING RPC
-- =========================================================

drop function if exists public.join_booking(
    uuid,
    smallint
);

create function public.join_booking(
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
    v_user_id := auth.uid();

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
    where id = p_booking_id
    for update;

    if not found then
        raise exception
            'The selected booking was not found.';
    end if;

    if v_booking.booking_status <> 'active' then
        raise exception
            'This booking is no longer active.';
    end if;

    if v_booking.booking_type <> 'joinable' then
        raise exception
            'This booking is private and cannot be joined.';
    end if;

    select *
    into v_tee_time
    from public.tee_times
    where id = v_booking.tee_time_id;

    if not found then
        raise exception
            'The tee time linked to this booking was not found.';
    end if;

    select *
    into v_course
    from public.courses
    where id = v_tee_time.course_id;

    if not found then
        raise exception
            'The course linked to this booking was not found.';
    end if;

    select cm.id
    into v_membership_id
    from public.club_memberships as cm
    where cm.profile_id = v_user_id
      and cm.club_id = v_course.club_id
      and cm.status = 'active'
    order by
        cm.is_primary desc,
        cm.created_at asc
    limit 1;

    if v_membership_id is null then
        raise exception
            'You do not have an active membership at this club.';
    end if;

    if v_tee_time.operational_status <> 'open' then
        raise exception
            'This tee time is not open.';
    end if;

    if v_tee_time.play_date < current_date then
        raise exception
            'Past tee times cannot be joined.';
    end if;

    if (
        v_tee_time.play_date = current_date
        and v_tee_time.start_time <= localtime
    ) then
        raise exception
            'This tee time has already passed.';
    end if;

    if exists (
        select 1
        from public.booking_members as bm
        where bm.booking_id = v_booking.id
          and bm.membership_id = v_membership_id
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
        v_booking.player_count + p_player_count
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

    select
        coalesce(max(bm.position), 0) + 1
    into v_next_position
    from public.booking_members as bm
    where bm.booking_id = v_booking.id;

    update public.bookings
    set
        player_count =
            player_count + p_player_count,
        updated_at = now()
    where id = v_booking.id;

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


-- =========================================================
-- PERMISSIONS
-- =========================================================

revoke all
on function public.create_booking(
    uuid,
    smallint,
    text,
    text,
    text
)
from public, anon;

grant execute
on function public.create_booking(
    uuid,
    smallint,
    text,
    text,
    text
)
to authenticated;

revoke all
on function public.create_booking(
    uuid,
    text,
    text,
    text
)
from public, anon;

grant execute
on function public.create_booking(
    uuid,
    text,
    text,
    text
)
to authenticated;

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

commit;

notify pgrst, 'reload schema';


-- =========================================================
-- SOURCE: 022_create_leave_and_cancel_booking_functions.sql
-- =========================================================
begin;

-- =========================================================
-- LEAVE BOOKING
--
-- Allows a non-lead member to remove themselves and their
-- party from an active booking.
-- =========================================================

create or replace function public.leave_booking(
    p_booking_id uuid
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

    v_booking_member_id uuid;
    v_party_size smallint;
begin
    v_user_id := auth.uid();

    if v_user_id is null then
        raise exception
            'You must be signed in to leave a booking.';
    end if;

    if p_booking_id is null then
        raise exception
            'A booking ID is required.';
    end if;

    /*
     * Lock the booking while occupancy is changed.
     */
    select *
    into v_booking
    from public.bookings
    where id = p_booking_id
    for update;

    if not found then
        raise exception
            'The selected booking was not found.';
    end if;

    if v_booking.booking_status <> 'active' then
        raise exception
            'This booking is no longer active.';
    end if;

    select *
    into v_tee_time
    from public.tee_times
    where id = v_booking.tee_time_id;

    if not found then
        raise exception
            'The tee time linked to this booking was not found.';
    end if;

    select *
    into v_course
    from public.courses
    where id = v_tee_time.course_id;

    if not found then
        raise exception
            'The course linked to this booking was not found.';
    end if;

    select cm.id
    into v_membership_id
    from public.club_memberships as cm
    where cm.profile_id = v_user_id
      and cm.club_id = v_course.club_id
      and cm.status = 'active'
    order by
        cm.is_primary desc,
        cm.created_at asc
    limit 1;

    if v_membership_id is null then
        raise exception
            'You do not have an active membership at this club.';
    end if;

    /*
     * The lead booker must cancel the whole booking rather
     * than using Leave.
     */
    if v_booking.created_by_membership_id = v_membership_id then
        raise exception
            'The lead booker must cancel the booking instead.';
    end if;

    if v_tee_time.play_date < current_date then
        raise exception
            'Past bookings cannot be changed.';
    end if;

    if (
        v_tee_time.play_date = current_date
        and v_tee_time.start_time <= localtime
    ) then
        raise exception
            'This tee time has already passed.';
    end if;

    /*
     * Lock and retrieve the member's active party record.
     */
    select
        bm.id,
        bm.party_size
    into
        v_booking_member_id,
        v_party_size
    from public.booking_members as bm
    where bm.booking_id = v_booking.id
      and bm.membership_id = v_membership_id
      and bm.member_status in (
          'invited',
          'confirmed',
          'checked_in'
      )
    for update;

    if v_booking_member_id is null then
        raise exception
            'You are not part of this booking.';
    end if;

    delete from public.booking_members
    where id = v_booking_member_id;

    update public.bookings
    set
        player_count = greatest(
            player_count - v_party_size,
            1
        ),
        updated_at = now()
    where id = v_booking.id;

    return v_booking.id;
end;
$$;


-- =========================================================
-- CANCEL BOOKING
--
-- Allows only the accountable lead booker to cancel the
-- entire booking. The tee time then becomes available again.
-- =========================================================

create or replace function public.cancel_booking(
    p_booking_id uuid
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

    v_cancelled_booking_id uuid;
begin
    v_user_id := auth.uid();

    if v_user_id is null then
        raise exception
            'You must be signed in to cancel a booking.';
    end if;

    if p_booking_id is null then
        raise exception
            'A booking ID is required.';
    end if;

    /*
     * Lock the booking so it cannot be joined while being
     * cancelled.
     */
    select *
    into v_booking
    from public.bookings
    where id = p_booking_id
    for update;

    if not found then
        raise exception
            'The selected booking was not found.';
    end if;

    if v_booking.booking_status <> 'active' then
        raise exception
            'This booking is no longer active.';
    end if;

    select *
    into v_tee_time
    from public.tee_times
    where id = v_booking.tee_time_id;

    if not found then
        raise exception
            'The tee time linked to this booking was not found.';
    end if;

    select *
    into v_course
    from public.courses
    where id = v_tee_time.course_id;

    if not found then
        raise exception
            'The course linked to this booking was not found.';
    end if;

    select cm.id
    into v_membership_id
    from public.club_memberships as cm
    where cm.profile_id = v_user_id
      and cm.club_id = v_course.club_id
      and cm.status = 'active'
    order by
        cm.is_primary desc,
        cm.created_at asc
    limit 1;

    if v_membership_id is null then
        raise exception
            'You do not have an active membership at this club.';
    end if;

    if v_booking.created_by_membership_id <> v_membership_id then
        raise exception
            'Only the lead booker can cancel this booking.';
    end if;

    if v_tee_time.play_date < current_date then
        raise exception
            'Past bookings cannot be cancelled.';
    end if;

    if (
        v_tee_time.play_date = current_date
        and v_tee_time.start_time <= localtime
    ) then
        raise exception
            'This tee time has already passed.';
    end if;

    v_cancelled_booking_id := v_booking.id;

    /*
     * Remove identifiable members first, then the booking.
     * With no active booking attached, the existing tee-time
     * service will immediately show the slot as available.
     */
    delete from public.booking_members
    where booking_id = v_booking.id;

    delete from public.bookings
    where id = v_booking.id;

    return v_cancelled_booking_id;
end;
$$;


-- =========================================================
-- PERMISSIONS
-- =========================================================

revoke all
on function public.leave_booking(uuid)
from public, anon;

grant execute
on function public.leave_booking(uuid)
to authenticated;

revoke all
on function public.cancel_booking(uuid)
from public, anon;

grant execute
on function public.cancel_booking(uuid)
to authenticated;

commit;

notify pgrst, 'reload schema';


-- =========================================================
-- SOURCE: 023_create_club_events.sql
-- =========================================================
begin;

-- =========================================================
-- CLUB EVENTS
--
-- migration chain and is safe to run against the existing table.
-- It does not insert or duplicate fixture records.
-- =========================================================

create table if not exists public.club_events (
    id uuid primary key default gen_random_uuid(),

    club_id uuid not null
        references public.clubs(id)
        on delete cascade,

    event_date date not null,
    display_order smallint not null default 1,

    start_time time,
    end_time time,
    time_text text,

    title text not null,

    section text not null
        check (
            section in (
                'club',
                'mens',
                'seniors',
                'ladies'
            )
        ),

    event_type text not null default 'other'
        check (
            event_type in (
                'competition',
                'roll_up',
                'fixture',
                'social',
                'course_event',
                'other'
            )
        ),

    location_type text
        check (
            location_type is null
            or location_type in (
                'home',
                'away'
            )
        ),

    venue text,
    notes text,

    is_qualifier boolean not null default false,
    course_closed boolean not null default false,

    status text not null default 'scheduled'
        check (
            status in (
                'scheduled',
                'cancelled',
                'postponed',
                'completed'
            )
        ),

    is_published boolean not null default true,

    source_key text not null,
    source_text text,
    source_page smallint,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint club_events_source_key_unique
        unique (club_id, source_key)
);

create index if not exists
    club_events_club_date_idx
on public.club_events (
    club_id,
    event_date
);

create index if not exists
    club_events_club_section_date_idx
on public.club_events (
    club_id,
    section,
    event_date
);

create index if not exists
    club_events_published_date_idx
on public.club_events (
    is_published,
    event_date
);

create or replace function
    public.set_club_events_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists
    set_club_events_updated_at
on public.club_events;

create trigger set_club_events_updated_at
before update on public.club_events
for each row
execute function public.set_club_events_updated_at();

alter table public.club_events
    enable row level security;

grant select
on table public.club_events
to authenticated;

grant all
on table public.club_events
to service_role;

revoke insert, update, delete
on table public.club_events
from authenticated;

drop policy if exists
    "Authenticated users can read published club events"
on public.club_events;

create policy
    "Authenticated users can read published club events"
on public.club_events
for select
to authenticated
using (
    is_published = true
);

commit;


-- =========================================================
-- SOURCE: 024_create_admin_foundation.sql
-- =========================================================
begin;

-- =========================================================
-- ADMIN ACCESS HELPER
--
-- Admin is intentionally limited to management roles at this
-- stage. Other operational staff roles can receive narrower
-- tools later without granting full club administration access.
-- =========================================================

create or replace function public.user_has_admin_access(
    p_club_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.club_memberships as cm
        where cm.profile_id = auth.uid()
          and cm.club_id = p_club_id
          and cm.status = 'active'
          and cm.role in (
              'manager',
              'club_admin'
          )
    );
$$;

revoke all
on function public.user_has_admin_access(uuid)
from public, anon;

grant execute
on function public.user_has_admin_access(uuid)
to authenticated;


-- =========================================================
-- ADMIN DASHBOARD
--
-- Security-definer RPC keeps member-wide data out of normal
-- browser SELECT policies. The function first proves that the
-- signed-in user is an active manager/club_admin at the club,
-- then returns only aggregate dashboard information.
-- =========================================================

create or replace function public.get_admin_dashboard()
returns table (
    club_id uuid,
    club_name text,
    club_timezone text,
    membership_id uuid,
    admin_role text,
    club_today date,
    active_members bigint,
    pending_invites bigint,
    today_bookings bigint,
    upcoming_events bigint,
    next_event_title text,
    next_event_date date,
    next_event_time text
)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid;
    v_club_id uuid;
    v_club_name text;
    v_club_timezone text;
    v_membership_id uuid;
    v_admin_role text;
    v_today date;

    v_active_members bigint;
    v_pending_invites bigint;
    v_today_bookings bigint;
    v_upcoming_events bigint;

    v_next_event_title text;
    v_next_event_date date;
    v_next_event_time text;
begin
    v_user_id := auth.uid();

    if v_user_id is null then
        raise exception
            'Admin access required.';
    end if;

    select
        cm.club_id,
        c.name,
        c.timezone,
        cm.id,
        cm.role
    into
        v_club_id,
        v_club_name,
        v_club_timezone,
        v_membership_id,
        v_admin_role
    from public.club_memberships as cm
    join public.clubs as c
        on c.id = cm.club_id
    where cm.profile_id = v_user_id
      and cm.status = 'active'
      and cm.role in (
          'manager',
          'club_admin'
      )
      and c.is_active = true
    order by
        cm.is_primary desc,
        cm.created_at asc
    limit 1;

    if v_membership_id is null then
        raise exception
            'Admin access required.';
    end if;

    v_today := (
        now() at time zone
        coalesce(
            nullif(v_club_timezone, ''),
            'Europe/London'
        )
    )::date;

    select count(*)
    into v_active_members
    from public.club_memberships as cm
    where cm.club_id = v_club_id
      and cm.status = 'active';

    select count(*)
    into v_pending_invites
    from public.club_memberships as cm
    where cm.club_id = v_club_id
      and cm.status in (
          'invited',
          'pending'
      );

    select count(*)
    into v_today_bookings
    from public.bookings as b
    join public.tee_times as tt
        on tt.id = b.tee_time_id
    join public.courses as c
        on c.id = tt.course_id
    where c.club_id = v_club_id
      and tt.play_date = v_today
      and b.booking_status = 'active';

    select count(*)
    into v_upcoming_events
    from public.club_events as ce
    where ce.club_id = v_club_id
      and ce.is_published = true
      and ce.status <> 'cancelled'
      and ce.event_date between
          v_today
          and (v_today + 30);

    select
        ce.title,
        ce.event_date,
        coalesce(
            nullif(trim(ce.time_text), ''),
            case
                when ce.start_time is not null
                    then to_char(
                        ce.start_time,
                        'HH24:MI'
                    )
                else null
            end
        )
    into
        v_next_event_title,
        v_next_event_date,
        v_next_event_time
    from public.club_events as ce
    where ce.club_id = v_club_id
      and ce.is_published = true
      and ce.status <> 'cancelled'
      and ce.event_date >= v_today
    order by
        ce.event_date asc,
        ce.start_time asc nulls last,
        ce.display_order asc
    limit 1;

    return query
    select
        v_club_id,
        v_club_name,
        v_club_timezone,
        v_membership_id,
        v_admin_role,
        v_today,
        v_active_members,
        v_pending_invites,
        v_today_bookings,
        v_upcoming_events,
        v_next_event_title,
        v_next_event_date,
        v_next_event_time;
end;
$$;

revoke all
on function public.get_admin_dashboard()
from public, anon;

grant execute
on function public.get_admin_dashboard()
to authenticated;

commit;

notify pgrst, 'reload schema';


-- =========================================================
-- SOURCE: 025_create_admin_member_management.sql
-- =========================================================
begin;

-- =========================================================
-- PARYX ADMIN: MEMBER DIRECTORY + CSV IMPORT AUDIT
-- =========================================================

create table if not exists public.member_import_batches (
    id uuid primary key default gen_random_uuid(),

    club_id uuid not null
        references public.clubs(id)
        on delete cascade,

    created_by uuid
        references public.profiles(id)
        on delete set null,

    source_filename text,
    total_rows integer not null default 0,
    imported_count integer not null default 0,
    existing_count integer not null default 0,
    failed_count integer not null default 0,

    status text not null default 'processing',

    created_at timestamptz not null default now(),
    completed_at timestamptz,

    constraint member_import_batches_status_valid
        check (
            status in (
                'processing',
                'completed',
                'partial',
                'failed'
            )
        ),

    constraint member_import_batches_counts_valid
        check (
            total_rows >= 0
            and imported_count >= 0
            and existing_count >= 0
            and failed_count >= 0
        )
);

create index if not exists member_import_batches_club_created_idx
on public.member_import_batches (
    club_id,
    created_at desc
);

alter table public.member_import_batches
enable row level security;

drop policy if exists "Club admins can read member import batches"
on public.member_import_batches;

create policy "Club admins can read member import batches"
on public.member_import_batches
for select
to authenticated
using (
    public.user_has_admin_access(club_id)
);


create table if not exists public.member_import_rows (
    id uuid primary key default gen_random_uuid(),

    batch_id uuid not null
        references public.member_import_batches(id)
        on delete cascade,

    row_number integer not null,
    email text not null,
    first_name text,
    last_name text,
    membership_number text,
    membership_type text,
    handicap_index numeric(4,1),

    result_status text not null,
    result_message text,

    profile_id uuid
        references public.profiles(id)
        on delete set null,

    membership_id uuid
        references public.club_memberships(id)
        on delete set null,

    created_at timestamptz not null default now(),

    constraint member_import_rows_result_valid
        check (
            result_status in (
                'imported',
                'existing',
                'failed'
            )
        ),

    constraint member_import_rows_row_number_valid
        check (row_number > 0)
);

create unique index if not exists member_import_rows_batch_row_unique
on public.member_import_rows (
    batch_id,
    row_number
);

create index if not exists member_import_rows_batch_idx
on public.member_import_rows (batch_id);

alter table public.member_import_rows
enable row level security;

drop policy if exists "Club admins can read member import rows"
on public.member_import_rows;

create policy "Club admins can read member import rows"
on public.member_import_rows
for select
to authenticated
using (
    exists (
        select 1
        from public.member_import_batches as mib
        where mib.id = member_import_rows.batch_id
          and public.user_has_admin_access(mib.club_id)
    )
);


-- =========================================================
-- MEMBER DIRECTORY RPC
--
-- Email lives in auth.users, so the browser cannot query it
-- directly. This security-definer RPC verifies club admin access
-- first and returns only members belonging to that admin's club.
-- =========================================================

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
security definer
set search_path = ''
as $$
declare
    v_user_id uuid;
    v_club_id uuid;
    v_limit integer;
    v_offset integer;
    v_search text;
    v_status text;
begin
    v_user_id := auth.uid();

    if v_user_id is null then
        raise exception 'Admin access required.';
    end if;

    select cm.club_id
    into v_club_id
    from public.club_memberships as cm
    where cm.profile_id = v_user_id
      and cm.status = 'active'
      and cm.role in ('manager', 'club_admin')
    order by cm.is_primary desc, cm.created_at asc
    limit 1;

    if v_club_id is null then
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
            cm.id as membership_id,
            cm.profile_id,
            au.email::text as email,
            p.first_name,
            p.last_name,
            p.display_name,
            cm.membership_number,
            cm.membership_type,
            cm.status as membership_status,
            cm.role as membership_role,
            cm.joined_at,
            cm.is_primary,
            ph.handicap_index,
            ph.verification_status as handicap_status,
            cm.created_at as member_created_at
        from public.club_memberships as cm
        join public.profiles as p
            on p.id = cm.profile_id
        join auth.users as au
            on au.id = cm.profile_id
        left join public.player_handicaps as ph
            on ph.profile_id = cm.profile_id
        where cm.club_id = v_club_id
          and (
              v_status is null
              or cm.status = v_status
          )
          and (
              v_search is null
              or lower(coalesce(au.email, '')) like '%' || v_search || '%'
              or lower(coalesce(p.first_name, '')) like '%' || v_search || '%'
              or lower(coalesce(p.last_name, '')) like '%' || v_search || '%'
              or lower(coalesce(p.display_name, '')) like '%' || v_search || '%'
              or lower(coalesce(cm.membership_number, '')) like '%' || v_search || '%'
          )
    ),
    counted as (
        select count(*)::bigint as total_count
        from filtered
    )
    select
        f.membership_id,
        f.profile_id,
        f.email,
        f.first_name,
        f.last_name,
        f.display_name,
        f.membership_number,
        f.membership_type,
        f.membership_status,
        f.membership_role,
        f.joined_at,
        f.is_primary,
        f.handicap_index,
        f.handicap_status,
        f.member_created_at,
        c.total_count
    from filtered as f
    cross join counted as c
    order by
        lower(
            coalesce(
                nullif(trim(f.display_name), ''),
                nullif(trim(f.last_name), ''),
                nullif(trim(f.first_name), ''),
                f.email
            )
        ),
        lower(f.email)
    limit v_limit
    offset v_offset;
end;
$$;

revoke all
on function public.get_admin_members(text, text, integer, integer)
from public, anon;

grant execute
on function public.get_admin_members(text, text, integer, integer)
to authenticated;


-- =========================================================
-- MEMBER STATUS UPDATE
-- =========================================================

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
    v_user_id uuid;
    v_admin_role text;
    v_target_club_id uuid;
    v_target_profile_id uuid;
    v_target_role text;
    v_new_status text;
begin
    v_user_id := auth.uid();
    v_new_status := lower(trim(coalesce(p_status, '')));

    if v_user_id is null then
        raise exception 'Admin access required.';
    end if;

    if v_new_status not in (
        'invited',
        'pending',
        'active',
        'suspended',
        'expired',
        'cancelled'
    ) then
        raise exception 'Invalid membership status.';
    end if;

    select
        cm.club_id,
        cm.profile_id,
        cm.role
    into
        v_target_club_id,
        v_target_profile_id,
        v_target_role
    from public.club_memberships as cm
    where cm.id = p_membership_id;

    if v_target_club_id is null then
        raise exception 'Member not found.';
    end if;

    select cm.role
    into v_admin_role
    from public.club_memberships as cm
    where cm.profile_id = v_user_id
      and cm.club_id = v_target_club_id
      and cm.status = 'active'
      and cm.role in ('manager', 'club_admin')
    limit 1;

    if v_admin_role is null then
        raise exception 'Admin access required.';
    end if;

    if v_target_profile_id = v_user_id
       and v_new_status <> 'active' then
        raise exception 'You cannot deactivate your own admin membership.';
    end if;

    if v_target_role = 'club_admin'
       and v_admin_role <> 'club_admin' then
        raise exception 'Only a Club Admin can change another Club Admin account.';
    end if;

    update public.club_memberships as cm
    set
        status = v_new_status,
        joined_at = case
            when v_new_status = 'active'
                then coalesce(cm.joined_at, current_date)
            else cm.joined_at
        end,
        updated_at = now()
    where cm.id = p_membership_id;

    return query
    select
        cm.id,
        cm.status
    from public.club_memberships as cm
    where cm.id = p_membership_id;
end;
$$;

revoke all
on function public.admin_set_member_status(uuid, text)
from public, anon;

grant execute
on function public.admin_set_member_status(uuid, text)
to authenticated;


-- =========================================================
-- FIRST LOGIN ACTIVATION
--
-- CSV-invited members are stored as invited until they actually
-- authenticate. The profile service calls this RPC immediately
-- after authentication so the membership becomes active before
-- the rest of the application reads it.
-- =========================================================

create or replace function public.activate_my_invited_memberships()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid;
    v_updated integer := 0;
begin
    v_user_id := auth.uid();

    if v_user_id is null then
        return 0;
    end if;

    update public.club_memberships as cm
    set
        status = 'active',
        joined_at = coalesce(cm.joined_at, current_date),
        updated_at = now()
    where cm.profile_id = v_user_id
      and cm.status in ('invited', 'pending');

    get diagnostics v_updated = row_count;

    if not exists (
        select 1
        from public.club_memberships as cm
        where cm.profile_id = v_user_id
          and cm.is_primary = true
    ) then
        update public.club_memberships as cm
        set
            is_primary = true,
            updated_at = now()
        where cm.id = (
            select candidate.id
            from public.club_memberships as candidate
            where candidate.profile_id = v_user_id
              and candidate.status = 'active'
            order by candidate.created_at asc
            limit 1
        );
    end if;

    return v_updated;
end;
$$;

revoke all
on function public.activate_my_invited_memberships()
from public, anon;

grant execute
on function public.activate_my_invited_memberships()
to authenticated;

commit;

notify pgrst, 'reload schema';
