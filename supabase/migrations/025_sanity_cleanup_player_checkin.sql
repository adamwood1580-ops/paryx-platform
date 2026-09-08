-- =========================================================
-- PARYX MIGRATION 025
-- SANITY CLEANUP: PLAYER CHECK-IN VISIBILITY
--
-- Adds a v2 read-only upcoming-bookings RPC so Player can display
-- ClubHub's booking-level check-in status without changing the
-- existing member_get_upcoming_bookings() contract.
--
-- Requires migration 018, which added bookings.staff_checked_in_at.
-- =========================================================

begin;

create or replace function public.member_get_upcoming_bookings_v2(
    p_limit integer default 20
)
returns table (
    booking_id uuid,
    club_name text,
    course_name text,
    play_date date,
    start_time time,
    player_count smallint,
    booking_type text,
    player_names text[],
    member_role text,
    checked_in_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null then
        raise exception
            'You must be signed in.';
    end if;

    return query
    select
        b.id,
        club.name,
        course.name,
        tt.play_date,
        tt.start_time,
        b.player_count,
        b.booking_type,

        coalesce(
            (
                select array_agg(
                    x.name
                    order by x.position
                )
                from (
                    select
                        bm.position,
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
                        )::text as name
                    from public.booking_members as bm
                    join public.club_memberships as cm2
                        on cm2.id =
                            bm.membership_id
                    join public.profiles as p
                        on p.id =
                            cm2.profile_id
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
                        'Guest'::text
                    from public.booking_guests as bg
                    where bg.booking_id =
                            b.id
                ) as x
            ),
            array[]::text[]
        ),

        case
            when exists (
                select 1
                from public.club_memberships as leadcm
                where leadcm.id =
                        b.created_by_membership_id
                  and leadcm.profile_id =
                        auth.uid()
            )
                then 'lead'
            else 'joined'
        end,

        b.staff_checked_in_at

    from public.bookings as b

    join public.tee_times as tt
        on tt.id =
            b.tee_time_id

    join public.courses as course
        on course.id =
            tt.course_id

    join public.clubs as club
        on club.id =
            course.club_id

    where b.booking_status =
            'active'

      and (
          tt.play_date >
              current_date
          or (
              tt.play_date =
                  current_date
              and tt.start_time >
                  localtime
          )
      )

      and (
          exists (
              select 1
              from public.club_memberships as leadcm
              where leadcm.id =
                      b.created_by_membership_id
                and leadcm.profile_id =
                      auth.uid()
          )
          or exists (
              select 1
              from public.booking_members as bm
              join public.club_memberships as cm
                  on cm.id =
                      bm.membership_id
              where bm.booking_id =
                      b.id
                and cm.profile_id =
                      auth.uid()
                and bm.member_status in (
                    'invited',
                    'confirmed',
                    'checked_in'
                )
          )
      )

    order by
        tt.play_date,
        tt.start_time

    limit greatest(
        1,
        least(
            coalesce(
                p_limit,
                20
            ),
            100
        )
    );
end;
$$;

revoke all
on function public.member_get_upcoming_bookings_v2(integer)
from public, anon;

grant execute
on function public.member_get_upcoming_bookings_v2(integer)
to authenticated;

commit;

notify pgrst, 'reload schema';
