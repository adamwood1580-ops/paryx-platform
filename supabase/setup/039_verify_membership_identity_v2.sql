-- Read-only verification helpers for Migration 039.

-- 1. Find duplicate member numbers that should be cleaned before future unique enforcement.
select
    club_id,
    lower(trim(membership_number)) as normalised_membership_number,
    count(*) as rows
from public.club_memberships
where membership_number is not null
  and trim(membership_number) <> ''
group by club_id, lower(trim(membership_number))
having count(*) > 1
order by rows desc;

-- 2. Count active club members that have no legacy profile mirror.
select
    club_id,
    count(*) as unclaimed_active_members
from public.club_memberships
where status = 'active'
  and role = 'member'
  and profile_id is null
group by club_id
order by unclaimed_active_members desc;

-- 3. Private link count (Paryx/platform check only; do not expose in ClubHub UI).
select count(*) as private_membership_links
from public.club_membership_player_links;
