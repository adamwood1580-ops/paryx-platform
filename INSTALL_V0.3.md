# Install Paryx v0.3 — Club Configuration & Branding

## 1. Supabase first

Run:

`supabase/migrations/002_club_configuration_and_branding.sql`

in the existing Paryx development Supabase project.

Do not run the baseline SQL.

Expected result: `Success. No rows returned`.

The migration creates:

- `club_settings`
- `club_branding`
- default configuration rows for existing clubs
- automatic defaults for future clubs
- `get_club_configuration(p_club_id)`
- `get_club_courses_for_settings(p_club_id)`
- `admin_update_club_configuration(...)`
- `user_can_manage_club(p_club_id)`
- public `club-branding` Storage bucket
- tenant-scoped Storage upload/update/delete policies

## 2. Push the frontend patch

Copy the files in this package into the same paths in `paryx-platform`.

The protected loader is bumped to `loader=3` and app version is:

`0.3.0-club-configuration`

## 3. Test

1. Sign in as your existing club admin/manager.
2. Dashboard should still load.
3. Open `Settings` from the sidebar or Dashboard.
4. Save the club name/contact information without changing it first.
5. Change one branding colour and save.
6. Confirm the Paryx staff shell changes immediately.
7. Upload a test club logo (PNG/JPG/WebP, <= 2 MB).
8. Confirm it appears beside the Current club selector.
9. Switch club if your test account still has two tenant memberships and confirm settings stay isolated.

If Storage upload returns an RLS error, do not weaken the policy. Capture the
exact error so the tenant policy can be fixed safely.
