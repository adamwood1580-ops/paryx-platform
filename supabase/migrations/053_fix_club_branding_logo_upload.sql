-- =========================================================
-- PARYX v0.30.5
-- Migration 053: Fix ClubHub club-logo uploads
--
-- The branding storage policies previously reused user_can_manage_club(),
-- whose permission target is inferred from request.path. That is appropriate
-- for ClubHub RPCs, but Storage requests use a different path and should not
-- depend on RPC route inference.
--
-- This migration gives the club-branding bucket an explicit, tenant-scoped
-- permission check tied to the Settings module. Greenkeeper, Manager and
-- Club Admin may manage branding only for an active club membership and only
-- when the Settings module is enabled for that club.
-- =========================================================

begin;

create or replace function public.user_can_manage_club_branding(
    p_club_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select
        auth.uid() is not null
        and p_club_id is not null
        and exists (
            select 1
            from public.club_memberships as membership
            join public.clubs as club
                on club.id = membership.club_id
               and club.is_active = true
            join public.club_modules as module
                on module.club_id = membership.club_id
               and module.module_key = 'settings'
               and module.is_enabled = true
            where membership.profile_id = auth.uid()
              and membership.club_id = p_club_id
              and membership.status = 'active'
              and membership.role = any(
                    array['greenkeeper','manager','club_admin']::text[]
              )
        );
$$;

revoke all
on function public.user_can_manage_club_branding(uuid)
from public, anon;

grant execute
on function public.user_can_manage_club_branding(uuid)
to authenticated;

-- Ensure the expected bucket configuration exists even on installations where
-- the original branding migration was only partially applied.
insert into storage.buckets (
    id,
    name,
    public,
    file_size_limit,
    allowed_mime_types
)
values (
    'club-branding',
    'club-branding',
    true,
    2097152,
    array[
        'image/png',
        'image/jpeg',
        'image/webp'
    ]
)
on conflict (id)
do update set
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Replace the old request-path-dependent policies with explicit branding
-- policies. The first folder in every object path must be the owning club UUID.
drop policy if exists
    "Paryx managers can upload club branding"
on storage.objects;

drop policy if exists
    "Paryx managers can update club branding"
on storage.objects;

drop policy if exists
    "Paryx managers can delete club branding"
on storage.objects;

drop policy if exists
    "Paryx settings staff can upload club branding"
on storage.objects;

drop policy if exists
    "Paryx settings staff can update club branding"
on storage.objects;

drop policy if exists
    "Paryx settings staff can delete club branding"
on storage.objects;

create policy
    "Paryx settings staff can upload club branding"
on storage.objects
for insert
to authenticated
with check (
    bucket_id = 'club-branding'
    and split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and public.user_can_manage_club_branding(
        split_part(name, '/', 1)::uuid
    )
);

create policy
    "Paryx settings staff can update club branding"
on storage.objects
for update
to authenticated
using (
    bucket_id = 'club-branding'
    and split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and public.user_can_manage_club_branding(
        split_part(name, '/', 1)::uuid
    )
)
with check (
    bucket_id = 'club-branding'
    and split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and public.user_can_manage_club_branding(
        split_part(name, '/', 1)::uuid
    )
);

create policy
    "Paryx settings staff can delete club branding"
on storage.objects
for delete
to authenticated
using (
    bucket_id = 'club-branding'
    and split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and public.user_can_manage_club_branding(
        split_part(name, '/', 1)::uuid
    )
);

commit;
