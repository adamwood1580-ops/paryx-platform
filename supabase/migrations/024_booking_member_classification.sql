-- =========================================================
-- PARYX MIGRATION 024
-- BOOKING MEMBER / VISITOR CLASSIFICATION
--
-- Fixes sanity-check Issue 6.
--
-- A Player visitor booking is represented in booking_members using
-- that player's club_memberships row. Visitor relationships are
-- intentionally active so the player can book, but they are NOT a
-- genuine club membership.
--
-- staff_get_booking_detail() previously returned the membership
-- number but not membership_type/status. The ClubHub browser then
-- assumed every booking_members row was a "Club member".
--
-- This migration makes the relationship explicit.
-- =========================================================

begin;

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
                            'Paryx player'
                        ),

                        'email',
                        au.email,

                        'membership_number',
                        cm.membership_number,

                        'membership_type',
                        cm.membership_type,

                        'membership_status',
                        cm.status,

                        'is_active_member',
                        (
                            cm.status = 'active'
                            and coalesce(
                                cm.membership_type,
                                'member'
                            ) not in (
                                'visitor',
                                'guest',
                                'staff'
                            )
                        ),

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
                    on cm.id =
                        bm.membership_id
                join public.profiles as p
                    on p.id =
                        cm.profile_id
                left join auth.users as au
                    on au.id =
                        cm.profile_id
                where bm.booking_id =
                        b.id
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
                from public.booking_guests
                    as bg
                where bg.booking_id =
                        b.id
            ),
            '[]'::jsonb
        )

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
            p_club_id;

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

commit;

notify pgrst, 'reload schema';
