-- =========================================================
-- PARYX v0.26.0 — READ-ONLY MEMBERSHIP CLAIM READINESS CHECK
-- =========================================================
-- Run after Migration 043 if you want to review data quality before Player
-- testing. This script does not modify any data.

-- 1. Duplicate active membership numbers within the same club.
select
    club.name as club_name,
    lower(trim(membership.membership_number)) as normalised_membership_number,
    count(*) as duplicate_count
from public.club_memberships as membership
join public.clubs as club on club.id = membership.club_id
where membership.status = 'active'
  and coalesce(membership.membership_type, 'member') not in ('visitor','guest','staff')
  and nullif(trim(membership.membership_number), '') is not null
group by club.name, membership.club_id, lower(trim(membership.membership_number))
having count(*) > 1
order by club.name, normalised_membership_number;

-- 2. Active genuine memberships that cannot auto-link because member number or
-- club-held email is missing.
select
    club.name as club_name,
    membership.id as membership_id,
    membership.membership_number,
    membership.club_display_name,
    membership.club_email,
    case
        when nullif(trim(membership.membership_number), '') is null then 'missing_membership_number'
        when nullif(trim(membership.club_email), '') is null then 'missing_club_email'
        else 'ready'
    end as claim_readiness
from public.club_memberships as membership
join public.clubs as club on club.id = membership.club_id
where membership.status = 'active'
  and coalesce(membership.membership_type, 'member') not in ('visitor','guest','staff')
  and (
      nullif(trim(membership.membership_number), '') is null
      or nullif(trim(membership.club_email), '') is null
  )
order by club.name, membership.club_display_name nulls last, membership.membership_number;

-- 3. Private linked membership count. This is a Paryx/platform diagnostic only;
-- it must never be exposed in ClubHub UI/RPCs.
select count(*) as private_player_membership_links
from public.club_membership_player_links;
