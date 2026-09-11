-- =========================================================
-- PARYX MIGRATION 042
-- CLUB MEMBER HARD DELETE
-- =========================================================
--
-- Purpose
-- - Suspension already provides a reversible way to stop club access.
-- - "Remove from club" therefore means permanently delete the club-owned
--   membership record.
-- - Historical operational/financial rows may remain, but are detached from
--   the deleted membership so the member no longer exists in the directory.
-- - A non-zero Club Credit balance must be settled before removal.
-- =========================================================

begin;

-- ---------------------------------------------------------
-- HISTORICAL BOOKING REFERENCES
-- ---------------------------------------------------------
-- A deleted member must not prevent old bookings from being retained.

alter table public.bookings
    alter column created_by_membership_id drop not null;

alter table public.bookings
    drop constraint if exists bookings_created_by_membership_id_fkey;

alter table public.bookings
    add constraint bookings_created_by_membership_id_fkey
    foreign key (created_by_membership_id)
    references public.club_memberships(id)
    on delete set null;

alter table public.booking_members
    alter column membership_id drop not null;

alter table public.booking_members
    drop constraint if exists booking_members_membership_id_fkey;

alter table public.booking_members
    add constraint booking_members_membership_id_fkey
    foreign key (membership_id)
    references public.club_memberships(id)
    on delete set null;

-- ---------------------------------------------------------
-- CLUB CREDIT HISTORY
-- ---------------------------------------------------------
-- Keep the accounting trail, but allow the membership itself to be removed.
-- Active balances are explicitly blocked by admin_remove_member below.

alter table public.club_member_accounts
    alter column membership_id drop not null;

alter table public.club_member_accounts
    drop constraint if exists club_member_accounts_membership_id_fkey;

alter table public.club_member_accounts
    add constraint club_member_accounts_membership_id_fkey
    foreign key (membership_id)
    references public.club_memberships(id)
    on delete set null;

alter table public.club_member_account_transactions
    alter column membership_id drop not null;

alter table public.club_member_account_transactions
    drop constraint if exists club_member_account_transactions_membership_id_fkey;

alter table public.club_member_account_transactions
    add constraint club_member_account_transactions_membership_id_fkey
    foreign key (membership_id)
    references public.club_memberships(id)
    on delete set null;

-- ---------------------------------------------------------
-- REMOVE MEMBER FROM CLUB = HARD DELETE
-- ---------------------------------------------------------
-- Existing two-argument callers are preserved. The function cleans up future
-- operational commitments, detaches historical references and then physically
-- deletes club_memberships.

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
    v_actor_membership_id uuid;
    v_actor_role text;
    v_target_profile_id uuid;
    v_target_role text;
    v_target_email text;
    v_target_name text;
    v_member_exists boolean;
    v_active_admin_count bigint;
    v_credit_balance numeric(12,2) := 0;
    v_today date;
begin
    if auth.uid() is null
       or p_club_id is null
       or not public.user_has_admin_access(p_club_id) then
        raise exception 'Club management access required.';
    end if;

    select
        membership.id,
        membership.role
    into
        v_actor_membership_id,
        v_actor_role
    from public.club_memberships as membership
    where membership.profile_id = auth.uid()
      and membership.club_id = p_club_id
      and membership.status = 'active'
      and membership.role in ('manager','club_admin')
    limit 1;

    if v_actor_membership_id is null then
        raise exception 'Club management access required.';
    end if;

    select
        true,
        membership.profile_id,
        membership.role,
        membership.club_email,
        coalesce(
            nullif(trim(membership.club_display_name), ''),
            nullif(trim(concat_ws(' ', membership.club_first_name, membership.club_last_name)), ''),
            'Member'
        )
    into
        v_member_exists,
        v_target_profile_id,
        v_target_role,
        v_target_email,
        v_target_name
    from public.club_memberships as membership
    where membership.id = p_membership_id
      and membership.club_id = p_club_id
    limit 1;

    if not coalesce(v_member_exists, false) then
        raise exception 'Club member not found.';
    end if;

    if v_target_profile_id is not null
       and v_target_profile_id = auth.uid() then
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

    select coalesce(max(account.balance), 0)
    into v_credit_balance
    from public.club_member_accounts as account
    where account.club_id = p_club_id
      and account.membership_id = p_membership_id
      and account.is_active = true;

    if coalesce(v_credit_balance, 0) <> 0 then
        raise exception
            'Settle this member''s Club Credit balance to £0.00 before removing them from the club.';
    end if;

    select (
        now() at time zone coalesce(nullif(club.timezone, ''), 'Europe/London')
    )::date
    into v_today
    from public.clubs as club
    where club.id = p_club_id;

    v_today := coalesce(v_today, current_date);

    -- Cancel future active bookings led by this member. Historical bookings are
    -- retained and will be detached automatically by the FK change above.
    update public.bookings as booking
    set
        booking_status = 'cancelled',
        cancelled_at = now(),
        cancelled_by_membership_id = v_actor_membership_id,
        updated_at = now()
    from public.tee_times as tee_time
    join public.courses as course
      on course.id = tee_time.course_id
    where booking.tee_time_id = tee_time.id
      and course.club_id = p_club_id
      and booking.created_by_membership_id = p_membership_id
      and booking.booking_status = 'active'
      and tee_time.play_date >= v_today;

    -- Remove the departing member from future active bookings led by somebody
    -- else and repair the occupied-player count.
    with removed as (
        delete from public.booking_members as booking_member
        using public.bookings as booking,
              public.tee_times as tee_time,
              public.courses as course
        where booking_member.booking_id = booking.id
          and booking.tee_time_id = tee_time.id
          and tee_time.course_id = course.id
          and course.club_id = p_club_id
          and booking_member.membership_id = p_membership_id
          and booking.created_by_membership_id is distinct from p_membership_id
          and booking.booking_status = 'active'
          and tee_time.play_date >= v_today
        returning booking_member.booking_id, booking_member.party_size
    ), totals as (
        select
            removed.booking_id,
            sum(coalesce(removed.party_size, 1))::integer as removed_places
        from removed
        group by removed.booking_id
    )
    update public.bookings as booking
    set
        player_count = greatest(
            1,
            booking.player_count - totals.removed_places
        )::smallint,
        updated_at = now()
    from totals
    where booking.id = totals.booking_id;

    -- Future/unconfirmed competition entries should not leave a ghost entrant.
    -- Completed historical competition rows remain, but their membership FK is
    -- nulled automatically when the membership is deleted.
    delete from public.club_competition_entries as entry
    using public.club_competitions as competition
    where entry.competition_id = competition.id
      and entry.membership_id = p_membership_id
      and competition.club_id = p_club_id
      and competition.results_confirmed_at is null
      and competition.competition_date >= v_today;

    -- Close a zero-balance account before its membership reference is detached.
    update public.club_member_accounts as account
    set
        is_active = false,
        updated_at = now()
    where account.club_id = p_club_id
      and account.membership_id = p_membership_id;

    -- Record the destructive club-side action without storing the member's
    -- email/name in the audit payload.
    insert into public.platform_audit_log (
        actor_user_id,
        actor_role,
        action,
        club_id,
        target_user_id,
        details
    )
    values (
        auth.uid(),
        v_actor_role,
        'club_member_deleted',
        p_club_id,
        v_target_profile_id,
        jsonb_build_object(
            'membership_id', p_membership_id::text,
            'had_player_link', v_target_profile_id is not null,
            'deleted_at', now()
        )
    );

    -- Private Paryx links and external player mappings cascade from the
    -- membership row. Other historical references use SET NULL.
    delete from public.club_memberships as membership
    where membership.id = p_membership_id
      and membership.club_id = p_club_id;

    if not found then
        raise exception 'Club member could not be deleted.';
    end if;

    -- Keep the legacy return contract. Never expose a Paryx profile id to
    -- ClubHub, even if one existed before deletion.
    return query
    select
        p_membership_id,
        null::uuid,
        v_target_email;
end;
$$;

revoke all on function public.admin_remove_member(uuid,uuid)
from public, anon;

grant execute on function public.admin_remove_member(uuid,uuid)
to authenticated;

commit;

notify pgrst, 'reload schema';
