-- PARYX PLATFORM
-- Migration 006: Courses, tees and hole data
--
-- Builds the club-managed course-data foundation used later by Tee Sheet,
-- Competitions and Paryx Member scoring.
--
-- Existing tables reused:
--   public.courses
--   public.tees
--   public.tee_ratings
--
-- New tables:
--   public.course_holes
--   public.tee_hole_distances
--
-- All admin writes go through selected-club SECURITY DEFINER RPCs.

begin;

-- =========================================================
-- COURSE HOLES
-- One row per physical hole. Men's and women's par / stroke
-- index are stored at course level. Physical tee distances are
-- stored separately because they vary by tee set.
-- =========================================================

create table if not exists public.course_holes (
    course_id uuid not null
        references public.courses(id)
        on delete cascade,

    hole_number smallint not null,
    hole_name text,

    men_par smallint,
    men_stroke_index smallint,

    women_par smallint,
    women_stroke_index smallint,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    primary key (course_id, hole_number),

    constraint course_holes_number_valid
        check (hole_number between 1 and 18),

    constraint course_holes_name_not_blank
        check (
            hole_name is null
            or length(trim(hole_name)) > 0
        ),

    constraint course_holes_men_par_valid
        check (
            men_par is null
            or men_par between 2 and 7
        ),

    constraint course_holes_women_par_valid
        check (
            women_par is null
            or women_par between 2 and 7
        ),

    constraint course_holes_men_si_valid
        check (
            men_stroke_index is null
            or men_stroke_index between 1 and 18
        ),

    constraint course_holes_women_si_valid
        check (
            women_stroke_index is null
            or women_stroke_index between 1 and 18
        )
);

create unique index if not exists course_holes_men_si_unique
on public.course_holes (
    course_id,
    men_stroke_index
)
where men_stroke_index is not null;

create unique index if not exists course_holes_women_si_unique
on public.course_holes (
    course_id,
    women_stroke_index
)
where women_stroke_index is not null;

create index if not exists course_holes_course_id_idx
on public.course_holes(course_id);

alter table public.course_holes
    enable row level security;


-- =========================================================
-- TEE-BY-HOLE DISTANCES
-- =========================================================

create table if not exists public.tee_hole_distances (
    tee_id uuid not null
        references public.tees(id)
        on delete cascade,

    hole_number smallint not null,
    yards smallint not null,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    primary key (tee_id, hole_number),

    constraint tee_hole_distances_number_valid
        check (hole_number between 1 and 18),

    constraint tee_hole_distances_yards_valid
        check (yards between 20 and 900)
);

create index if not exists tee_hole_distances_tee_id_idx
on public.tee_hole_distances(tee_id);

alter table public.tee_hole_distances
    enable row level security;


-- =========================================================
-- UPDATED_AT TRIGGERS
-- =========================================================

drop trigger if exists set_course_holes_updated_at
on public.course_holes;

create trigger set_course_holes_updated_at
before update on public.course_holes
for each row
execute function public.set_updated_at();


drop trigger if exists set_tee_hole_distances_updated_at
on public.tee_hole_distances;

create trigger set_tee_hole_distances_updated_at
before update on public.tee_hole_distances
for each row
execute function public.set_updated_at();


-- =========================================================
-- TENANT-SCOPED READ POLICIES
-- =========================================================

-- Replace the older global active-tee reads with membership-scoped reads.
drop policy if exists
    "Authenticated users can read active tees"
on public.tees;

drop policy if exists
    "Members can read their club tees"
on public.tees;

create policy
    "Members can read their club tees"
on public.tees
for select
to authenticated
using (
    is_active = true
    and exists (
        select 1
        from public.courses as c
        join public.club_memberships as cm
            on cm.club_id = c.club_id
        where c.id = tees.course_id
          and c.is_active = true
          and cm.profile_id = auth.uid()
          and cm.status = 'active'
    )
);


drop policy if exists
    "Authenticated users can read active tee ratings"
on public.tee_ratings;

drop policy if exists
    "Members can read their club tee ratings"
on public.tee_ratings;

create policy
    "Members can read their club tee ratings"
on public.tee_ratings
for select
to authenticated
using (
    is_active = true
    and exists (
        select 1
        from public.tees as t
        join public.courses as c
            on c.id = t.course_id
        join public.club_memberships as cm
            on cm.club_id = c.club_id
        where t.id = tee_ratings.tee_id
          and t.is_active = true
          and c.is_active = true
          and cm.profile_id = auth.uid()
          and cm.status = 'active'
    )
);


drop policy if exists
    "Members can read their club course holes"
on public.course_holes;

create policy
    "Members can read their club course holes"
on public.course_holes
for select
to authenticated
using (
    exists (
        select 1
        from public.courses as c
        join public.club_memberships as cm
            on cm.club_id = c.club_id
        where c.id = course_holes.course_id
          and c.is_active = true
          and cm.profile_id = auth.uid()
          and cm.status = 'active'
    )
);


drop policy if exists
    "Members can read their club tee distances"
on public.tee_hole_distances;

create policy
    "Members can read their club tee distances"
on public.tee_hole_distances
for select
to authenticated
using (
    exists (
        select 1
        from public.tees as t
        join public.courses as c
            on c.id = t.course_id
        join public.club_memberships as cm
            on cm.club_id = c.club_id
        where t.id = tee_hole_distances.tee_id
          and t.is_active = true
          and c.is_active = true
          and cm.profile_id = auth.uid()
          and cm.status = 'active'
    )
);


grant select
on public.course_holes, public.tee_hole_distances
to authenticated;


-- =========================================================
-- ADMIN COURSE DIRECTORY
-- =========================================================

create or replace function public.admin_get_courses(
    p_club_id uuid
)
returns table (
    course_id uuid,
    course_name text,
    holes smallint,
    is_active boolean,
    is_default boolean,
    tee_count bigint,
    total_yards integer,
    updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null
       or p_club_id is null
       or not public.user_can_manage_club(p_club_id) then
        raise exception
            'Club management access required.';
    end if;

    return query
    select
        c.id,
        c.name,
        c.holes,
        c.is_active,
        (cs.default_course_id = c.id),
        (
            select count(*)
            from public.tees as t
            where t.course_id = c.id
              and t.is_active = true
        )::bigint,
        (
            select max(t.total_yards)
            from public.tees as t
            where t.course_id = c.id
              and t.is_active = true
        ),
        c.updated_at
    from public.courses as c
    left join public.club_settings as cs
        on cs.club_id = c.club_id
    where c.club_id = p_club_id
    order by
        c.is_active desc,
        (cs.default_course_id = c.id) desc,
        lower(c.name),
        c.created_at;
end;
$$;

revoke all
on function public.admin_get_courses(uuid)
from public, anon;

grant execute
on function public.admin_get_courses(uuid)
to authenticated;


-- =========================================================
-- ADMIN COURSE CONFIGURATION
-- Returns one JSON object to keep the browser contract stable
-- while course/tee data becomes richer over time.
-- =========================================================

create or replace function public.admin_get_course_configuration(
    p_club_id uuid,
    p_course_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_result jsonb;
begin
    if auth.uid() is null
       or p_club_id is null
       or not public.user_can_manage_club(p_club_id) then
        raise exception
            'Club management access required.';
    end if;

    if not exists (
        select 1
        from public.courses as c
        where c.id = p_course_id
          and c.club_id = p_club_id
    ) then
        raise exception
            'Course not found for the selected club.';
    end if;

    select
        jsonb_build_object(
            'course',
                jsonb_build_object(
                    'id', c.id,
                    'name', c.name,
                    'holes', c.holes,
                    'is_active', c.is_active,
                    'is_default', (cs.default_course_id = c.id),
                    'updated_at', c.updated_at
                ),

            'holes',
                coalesce(
                    (
                        select jsonb_agg(
                            jsonb_build_object(
                                'hole_number', gs.hole_number,
                                'hole_name', ch.hole_name,
                                'men_par', ch.men_par,
                                'men_stroke_index', ch.men_stroke_index,
                                'women_par', ch.women_par,
                                'women_stroke_index', ch.women_stroke_index
                            )
                            order by gs.hole_number
                        )
                        from generate_series(
                            1,
                            c.holes::integer
                        ) as gs(hole_number)
                        left join public.course_holes as ch
                            on ch.course_id = c.id
                           and ch.hole_number = gs.hole_number
                    ),
                    '[]'::jsonb
                ),

            'tees',
                coalesce(
                    (
                        select jsonb_agg(
                            jsonb_build_object(
                                'id', t.id,
                                'name', t.name,
                                'colour', t.colour,
                                'display_order', t.display_order,
                                'total_yards', t.total_yards,
                                'is_active', t.is_active,
                                'ratings', jsonb_build_object(
                                    'men',
                                        (
                                            select jsonb_build_object(
                                                'id', tr.id,
                                                'par', tr.par,
                                                'course_rating', tr.course_rating,
                                                'slope_rating', tr.slope_rating,
                                                'effective_from', tr.effective_from,
                                                'effective_to', tr.effective_to
                                            )
                                            from public.tee_ratings as tr
                                            where tr.tee_id = t.id
                                              and tr.rating_gender = 'men'
                                              and tr.is_active = true
                                            order by
                                                (tr.effective_to is null) desc,
                                                tr.effective_from desc nulls last,
                                                tr.created_at desc
                                            limit 1
                                        ),
                                    'women',
                                        (
                                            select jsonb_build_object(
                                                'id', tr.id,
                                                'par', tr.par,
                                                'course_rating', tr.course_rating,
                                                'slope_rating', tr.slope_rating,
                                                'effective_from', tr.effective_from,
                                                'effective_to', tr.effective_to
                                            )
                                            from public.tee_ratings as tr
                                            where tr.tee_id = t.id
                                              and tr.rating_gender = 'women'
                                              and tr.is_active = true
                                            order by
                                                (tr.effective_to is null) desc,
                                                tr.effective_from desc nulls last,
                                                tr.created_at desc
                                            limit 1
                                        )
                                ),
                                'distances',
                                    coalesce(
                                        (
                                            select jsonb_agg(
                                                jsonb_build_object(
                                                    'hole_number', dgs.hole_number,
                                                    'yards', thd.yards
                                                )
                                                order by dgs.hole_number
                                            )
                                            from generate_series(
                                                1,
                                                c.holes::integer
                                            ) as dgs(hole_number)
                                            left join public.tee_hole_distances as thd
                                                on thd.tee_id = t.id
                                               and thd.hole_number = dgs.hole_number
                                        ),
                                        '[]'::jsonb
                                    )
                            )
                            order by
                                t.display_order,
                                lower(t.name),
                                t.created_at
                        )
                        from public.tees as t
                        where t.course_id = c.id
                    ),
                    '[]'::jsonb
                )
        )
    into v_result
    from public.courses as c
    left join public.club_settings as cs
        on cs.club_id = c.club_id
    where c.id = p_course_id
      and c.club_id = p_club_id
    limit 1;

    return v_result;
end;
$$;

revoke all
on function public.admin_get_course_configuration(uuid, uuid)
from public, anon;

grant execute
on function public.admin_get_course_configuration(uuid, uuid)
to authenticated;


-- =========================================================
-- CREATE / UPDATE COURSE
-- =========================================================

create or replace function public.admin_save_course(
    p_club_id uuid,
    p_course_id uuid,
    p_name text,
    p_holes smallint,
    p_is_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_course_id uuid;
    v_name text;
    v_holes smallint;
begin
    if auth.uid() is null
       or p_club_id is null
       or not public.user_can_manage_club(p_club_id) then
        raise exception
            'Club management access required.';
    end if;

    v_name := nullif(trim(p_name), '');
    v_holes := p_holes;

    if v_name is null then
        raise exception
            'Course name is required.';
    end if;

    if v_holes not in (9, 18) then
        raise exception
            'Course must contain 9 or 18 holes.';
    end if;

    if p_course_id is null then
        insert into public.courses (
            club_id,
            name,
            holes,
            is_active
        )
        values (
            p_club_id,
            v_name,
            v_holes,
            coalesce(p_is_active, true)
        )
        returning id into v_course_id;
    else
        if not exists (
            select 1
            from public.courses as c
            where c.id = p_course_id
              and c.club_id = p_club_id
        ) then
            raise exception
                'Course not found for the selected club.';
        end if;

        if coalesce(p_is_active, false) = false
           and exists (
                select 1
                from public.club_settings as cs
                where cs.club_id = p_club_id
                  and cs.default_course_id = p_course_id
           ) then
            raise exception
                'Choose another default course in Settings before deactivating this course.';
        end if;

        update public.courses as c
        set
            name = v_name,
            holes = v_holes,
            is_active = coalesce(p_is_active, false),
            updated_at = now()
        where c.id = p_course_id
          and c.club_id = p_club_id;

        v_course_id := p_course_id;
    end if;

    -- Keep the physical hole rows aligned with the configured hole count.
    insert into public.course_holes (
        course_id,
        hole_number
    )
    select
        v_course_id,
        gs.hole_number::smallint
    from generate_series(
        1,
        v_holes::integer
    ) as gs(hole_number)
    on conflict on constraint course_holes_pkey
    do nothing;

    -- If an 18-hole course becomes 9-hole, remove out-of-range distances first.
    delete from public.tee_hole_distances as thd
    using public.tees as t
    where t.id = thd.tee_id
      and t.course_id = v_course_id
      and thd.hole_number > v_holes;

    delete from public.course_holes as ch
    where ch.course_id = v_course_id
      and ch.hole_number > v_holes;

    -- A tee total is only trusted when every configured hole has a distance.
    update public.tees as t
    set
        total_yards = case
            when (
                select count(*)
                from public.tee_hole_distances as thd
                where thd.tee_id = t.id
            ) = v_holes
            then (
                select sum(thd.yards)::integer
                from public.tee_hole_distances as thd
                where thd.tee_id = t.id
            )
            else null
        end,
        updated_at = now()
    where t.course_id = v_course_id;

    return v_course_id;
end;
$$;

revoke all
on function public.admin_save_course(uuid, uuid, text, smallint, boolean)
from public, anon;

grant execute
on function public.admin_save_course(uuid, uuid, text, smallint, boolean)
to authenticated;


-- =========================================================
-- SAVE HOLE PAR / STROKE INDEX
-- Payload must contain one entry for every configured hole.
-- =========================================================

create or replace function public.admin_save_course_holes(
    p_club_id uuid,
    p_course_id uuid,
    p_holes jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_course_holes smallint;
    v_item jsonb;
    v_number smallint;
    v_men_par smallint;
    v_men_si smallint;
    v_women_par smallint;
    v_women_si smallint;
    v_payload_count integer;
    v_distinct_count integer;
begin
    if auth.uid() is null
       or p_club_id is null
       or not public.user_can_manage_club(p_club_id) then
        raise exception
            'Club management access required.';
    end if;

    select c.holes
    into v_course_holes
    from public.courses as c
    where c.id = p_course_id
      and c.club_id = p_club_id
    limit 1;

    if v_course_holes is null then
        raise exception
            'Course not found for the selected club.';
    end if;

    if p_holes is null
       or jsonb_typeof(p_holes) <> 'array' then
        raise exception
            'Hole data must be supplied as an array.';
    end if;

    select
        count(*),
        count(distinct nullif(item->>'hole_number', '')::integer)
    into
        v_payload_count,
        v_distinct_count
    from jsonb_array_elements(p_holes) as payload(item);

    if v_payload_count <> v_course_holes
       or v_distinct_count <> v_course_holes then
        raise exception
            'Hole data must contain each configured hole exactly once.';
    end if;

    if exists (
        select 1
        from jsonb_array_elements(p_holes) as payload(item)
        where nullif(item->>'hole_number', '')::integer
              not between 1 and v_course_holes
    ) then
        raise exception
            'Hole number is outside the configured course range.';
    end if;

    if exists (
        select 1
        from jsonb_array_elements(p_holes) as payload(item)
        where nullif(item->>'men_stroke_index', '') is not null
        group by nullif(item->>'men_stroke_index', '')::integer
        having count(*) > 1
    ) then
        raise exception
            'Men stroke indexes must be unique.';
    end if;

    if exists (
        select 1
        from jsonb_array_elements(p_holes) as payload(item)
        where nullif(item->>'women_stroke_index', '') is not null
        group by nullif(item->>'women_stroke_index', '')::integer
        having count(*) > 1
    ) then
        raise exception
            'Women stroke indexes must be unique.';
    end if;

    -- Clear SIs first so a valid swap such as 1 <-> 2 does not collide
    -- with the unique indexes halfway through the transaction.
    update public.course_holes as ch
    set
        men_stroke_index = null,
        women_stroke_index = null,
        updated_at = now()
    where ch.course_id = p_course_id;

    for v_item in
        select item
        from jsonb_array_elements(p_holes) as payload(item)
    loop
        v_number :=
            nullif(v_item->>'hole_number', '')::smallint;

        v_men_par :=
            nullif(v_item->>'men_par', '')::smallint;

        v_men_si :=
            nullif(v_item->>'men_stroke_index', '')::smallint;

        v_women_par :=
            nullif(v_item->>'women_par', '')::smallint;

        v_women_si :=
            nullif(v_item->>'women_stroke_index', '')::smallint;

        if v_men_par is not null
           and v_men_par not between 2 and 7 then
            raise exception
                'Men par must be between 2 and 7.';
        end if;

        if v_women_par is not null
           and v_women_par not between 2 and 7 then
            raise exception
                'Women par must be between 2 and 7.';
        end if;

        if v_men_si is not null
           and v_men_si not between 1 and v_course_holes then
            raise exception
                'Men stroke index must be between 1 and %.',
                v_course_holes;
        end if;

        if v_women_si is not null
           and v_women_si not between 1 and v_course_holes then
            raise exception
                'Women stroke index must be between 1 and %.',
                v_course_holes;
        end if;

        insert into public.course_holes (
            course_id,
            hole_number,
            hole_name,
            men_par,
            men_stroke_index,
            women_par,
            women_stroke_index,
            updated_at
        )
        values (
            p_course_id,
            v_number,
            nullif(trim(v_item->>'hole_name'), ''),
            v_men_par,
            v_men_si,
            v_women_par,
            v_women_si,
            now()
        )
        on conflict on constraint course_holes_pkey
        do update set
            hole_name = excluded.hole_name,
            men_par = excluded.men_par,
            men_stroke_index = excluded.men_stroke_index,
            women_par = excluded.women_par,
            women_stroke_index = excluded.women_stroke_index,
            updated_at = now();
    end loop;
end;
$$;

revoke all
on function public.admin_save_course_holes(uuid, uuid, jsonb)
from public, anon;

grant execute
on function public.admin_save_course_holes(uuid, uuid, jsonb)
to authenticated;


-- =========================================================
-- CREATE / UPDATE PHYSICAL TEE + CURRENT WHS RATINGS
-- A rating is optional. If one field for a gender is supplied,
-- all three fields (Par / Course Rating / Slope) are required.
-- =========================================================

create or replace function public.admin_save_tee(
    p_club_id uuid,
    p_course_id uuid,
    p_tee_id uuid,
    p_name text,
    p_colour text,
    p_display_order smallint,
    p_is_active boolean,
    p_men_par smallint,
    p_men_course_rating numeric,
    p_men_slope smallint,
    p_women_par smallint,
    p_women_course_rating numeric,
    p_women_slope smallint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_tee_id uuid;
    v_name text;
    v_rating_id uuid;
begin
    if auth.uid() is null
       or p_club_id is null
       or not public.user_can_manage_club(p_club_id) then
        raise exception
            'Club management access required.';
    end if;

    if not exists (
        select 1
        from public.courses as c
        where c.id = p_course_id
          and c.club_id = p_club_id
    ) then
        raise exception
            'Course not found for the selected club.';
    end if;

    v_name := nullif(trim(p_name), '');

    if v_name is null then
        raise exception
            'Tee name is required.';
    end if;

    if coalesce(p_display_order, 0) < 0 then
        raise exception
            'Display order cannot be negative.';
    end if;

    if (
        p_men_par is not null
        or p_men_course_rating is not null
        or p_men_slope is not null
    ) and (
        p_men_par is null
        or p_men_course_rating is null
        or p_men_slope is null
    ) then
        raise exception
            'Men rating requires Par, Course Rating and Slope.';
    end if;

    if (
        p_women_par is not null
        or p_women_course_rating is not null
        or p_women_slope is not null
    ) and (
        p_women_par is null
        or p_women_course_rating is null
        or p_women_slope is null
    ) then
        raise exception
            'Women rating requires Par, Course Rating and Slope.';
    end if;

    if p_tee_id is null then
        insert into public.tees (
            course_id,
            name,
            colour,
            display_order,
            is_active
        )
        values (
            p_course_id,
            v_name,
            nullif(trim(p_colour), ''),
            coalesce(p_display_order, 0),
            coalesce(p_is_active, true)
        )
        returning id into v_tee_id;
    else
        if not exists (
            select 1
            from public.tees as t
            where t.id = p_tee_id
              and t.course_id = p_course_id
        ) then
            raise exception
                'Tee not found for the selected course.';
        end if;

        update public.tees as t
        set
            name = v_name,
            colour = nullif(trim(p_colour), ''),
            display_order = coalesce(p_display_order, 0),
            is_active = coalesce(p_is_active, false),
            updated_at = now()
        where t.id = p_tee_id
          and t.course_id = p_course_id;

        v_tee_id := p_tee_id;
    end if;

    -- MEN CURRENT RATING
    if p_men_par is null
       and p_men_course_rating is null
       and p_men_slope is null then
        update public.tee_ratings as tr
        set
            is_active = false,
            effective_to = coalesce(tr.effective_to, current_date),
            updated_at = now()
        where tr.tee_id = v_tee_id
          and tr.rating_gender = 'men'
          and tr.is_active = true;
    else
        select tr.id
        into v_rating_id
        from public.tee_ratings as tr
        where tr.tee_id = v_tee_id
          and tr.rating_gender = 'men'
          and tr.is_active = true
          and tr.effective_to is null
        order by tr.created_at desc
        limit 1;

        if v_rating_id is null then
            insert into public.tee_ratings (
                tee_id,
                rating_gender,
                par,
                course_rating,
                slope_rating,
                effective_from,
                effective_to,
                is_active
            )
            values (
                v_tee_id,
                'men',
                p_men_par,
                p_men_course_rating,
                p_men_slope,
                current_date,
                null,
                true
            );
        else
            update public.tee_ratings as tr
            set
                par = p_men_par,
                course_rating = p_men_course_rating,
                slope_rating = p_men_slope,
                is_active = true,
                effective_to = null,
                updated_at = now()
            where tr.id = v_rating_id;
        end if;
    end if;

    v_rating_id := null;

    -- WOMEN CURRENT RATING
    if p_women_par is null
       and p_women_course_rating is null
       and p_women_slope is null then
        update public.tee_ratings as tr
        set
            is_active = false,
            effective_to = coalesce(tr.effective_to, current_date),
            updated_at = now()
        where tr.tee_id = v_tee_id
          and tr.rating_gender = 'women'
          and tr.is_active = true;
    else
        select tr.id
        into v_rating_id
        from public.tee_ratings as tr
        where tr.tee_id = v_tee_id
          and tr.rating_gender = 'women'
          and tr.is_active = true
          and tr.effective_to is null
        order by tr.created_at desc
        limit 1;

        if v_rating_id is null then
            insert into public.tee_ratings (
                tee_id,
                rating_gender,
                par,
                course_rating,
                slope_rating,
                effective_from,
                effective_to,
                is_active
            )
            values (
                v_tee_id,
                'women',
                p_women_par,
                p_women_course_rating,
                p_women_slope,
                current_date,
                null,
                true
            );
        else
            update public.tee_ratings as tr
            set
                par = p_women_par,
                course_rating = p_women_course_rating,
                slope_rating = p_women_slope,
                is_active = true,
                effective_to = null,
                updated_at = now()
            where tr.id = v_rating_id;
        end if;
    end if;

    return v_tee_id;
end;
$$;

revoke all
on function public.admin_save_tee(
    uuid,
    uuid,
    uuid,
    text,
    text,
    smallint,
    boolean,
    smallint,
    numeric,
    smallint,
    smallint,
    numeric,
    smallint
)
from public, anon;

grant execute
on function public.admin_save_tee(
    uuid,
    uuid,
    uuid,
    text,
    text,
    smallint,
    boolean,
    smallint,
    numeric,
    smallint,
    smallint,
    numeric,
    smallint
)
to authenticated;


-- =========================================================
-- SAVE TEE YARDAGES
-- Payload contains every hole. Blank yards are allowed and
-- simply mean that tee distance is not configured yet.
-- =========================================================

create or replace function public.admin_save_tee_distances(
    p_club_id uuid,
    p_course_id uuid,
    p_tee_id uuid,
    p_distances jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_course_holes smallint;
    v_payload_count integer;
    v_distinct_count integer;
    v_item jsonb;
    v_number smallint;
    v_yards smallint;
    v_saved_count integer;
    v_total_yards integer;
begin
    if auth.uid() is null
       or p_club_id is null
       or not public.user_can_manage_club(p_club_id) then
        raise exception
            'Club management access required.';
    end if;

    select c.holes
    into v_course_holes
    from public.courses as c
    join public.tees as t
        on t.course_id = c.id
    where c.id = p_course_id
      and c.club_id = p_club_id
      and t.id = p_tee_id
    limit 1;

    if v_course_holes is null then
        raise exception
            'Tee not found for the selected course.';
    end if;

    if p_distances is null
       or jsonb_typeof(p_distances) <> 'array' then
        raise exception
            'Tee distances must be supplied as an array.';
    end if;

    select
        count(*),
        count(distinct nullif(item->>'hole_number', '')::integer)
    into
        v_payload_count,
        v_distinct_count
    from jsonb_array_elements(p_distances) as payload(item);

    if v_payload_count <> v_course_holes
       or v_distinct_count <> v_course_holes then
        raise exception
            'Tee distances must contain each configured hole exactly once.';
    end if;

    if exists (
        select 1
        from jsonb_array_elements(p_distances) as payload(item)
        where nullif(item->>'hole_number', '')::integer
              not between 1 and v_course_holes
    ) then
        raise exception
            'Distance hole number is outside the configured course range.';
    end if;

    delete from public.tee_hole_distances as thd
    where thd.tee_id = p_tee_id;

    for v_item in
        select item
        from jsonb_array_elements(p_distances) as payload(item)
    loop
        v_number :=
            nullif(v_item->>'hole_number', '')::smallint;

        v_yards :=
            nullif(v_item->>'yards', '')::smallint;

        if v_yards is not null then
            if v_yards not between 20 and 900 then
                raise exception
                    'Hole yardage must be between 20 and 900 yards.';
            end if;

            insert into public.tee_hole_distances (
                tee_id,
                hole_number,
                yards,
                updated_at
            )
            values (
                p_tee_id,
                v_number,
                v_yards,
                now()
            );
        end if;
    end loop;

    select
        count(*),
        sum(thd.yards)::integer
    into
        v_saved_count,
        v_total_yards
    from public.tee_hole_distances as thd
    where thd.tee_id = p_tee_id;

    if v_saved_count <> v_course_holes then
        v_total_yards := null;
    end if;

    update public.tees as t
    set
        total_yards = v_total_yards,
        updated_at = now()
    where t.id = p_tee_id;

    return v_total_yards;
end;
$$;

revoke all
on function public.admin_save_tee_distances(uuid, uuid, uuid, jsonb)
from public, anon;

grant execute
on function public.admin_save_tee_distances(uuid, uuid, uuid, jsonb)
to authenticated;

commit;
