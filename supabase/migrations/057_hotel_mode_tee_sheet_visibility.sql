-- Paryx Hotel Mode - Phase 2B: read-only ClubHub tee sheet allocation display.
-- Requires 055 and 056. Does NOT update bookings, settings, permissions or allocations.
-- Mode activation and staff permissions remain controlled in Paryx Console.
begin;

create or replace function public.staff_get_hotel_mode_tee_sheet(
    p_club_id uuid, p_course_id uuid, p_play_date date
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
    v_config public.hotel_mode_settings%rowtype;
    v_club_timezone text;
    v_today date;
    v_slots jsonb;
begin
    if auth.uid() is null
       or p_club_id is null or p_course_id is null or p_play_date is null
       or not public.user_can_operate_tee_sheet(p_club_id) then
        raise exception 'Tee sheet access required.';
    end if;

    select coalesce(nullif(trim(c.timezone), ''), 'Europe/London')
      into v_club_timezone
    from public.clubs c
    join public.courses cr on cr.club_id = c.id
    where c.id = p_club_id and cr.id = p_course_id
      and c.is_active and cr.is_active;
    if not found then
        raise exception 'The selected course is not available at this club.';
    end if;

    select * into v_config from public.hotel_mode_settings
    where club_id = p_club_id;

    if not found or not v_config.enabled then
        return jsonb_build_object('enabled', false, 'slots', '[]'::jsonb);
    end if;

    v_today := (now() at time zone v_club_timezone)::date;

    -- Allocation classes come from the exact same 056 function used in booking
    -- eligibility checks. This endpoint reports them; it does not override them.
    select coalesce(jsonb_agg(jsonb_build_object(
        'tee_time_id', t.id,
        'allocation', t.allocation,
        'released', case
            when t.allocation = 'hotel' then p_play_date - v_today <= v_config.hotel_release_days
            when t.allocation = 'member' then p_play_date - v_today <= v_config.member_release_days
            else true
        end,
        'release_on', case
            when t.allocation = 'hotel' then (p_play_date - v_config.hotel_release_days)::text
            when t.allocation = 'member' then (p_play_date - v_config.member_release_days)::text
            else null
        end
    ) order by t.start_time), '[]'::jsonb)
      into v_slots
    from (
        select tt.id, tt.start_time, public.hotel_mode_slot_class(tt.id) as allocation
        from public.tee_times tt
        where tt.course_id = p_course_id and tt.play_date = p_play_date
    ) t;

    return jsonb_build_object(
        'enabled', true,
        'hotel_allocation_percent', v_config.hotel_allocation_percent,
        'member_allocation_percent', v_config.member_allocation_percent,
        'hotel_release_days', v_config.hotel_release_days,
        'member_release_days', v_config.member_release_days,
        'can_manage_hotel', public.hotel_mode_staff_can(p_club_id, 'hotel'),
        'slots', v_slots
    );
end;
$$;

revoke all on function public.staff_get_hotel_mode_tee_sheet(uuid,uuid,date)
from public, anon;
grant execute on function public.staff_get_hotel_mode_tee_sheet(uuid,uuid,date)
to authenticated;

commit;
notify pgrst, 'reload schema';
