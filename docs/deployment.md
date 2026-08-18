# Deployment Notes

## GitHub

Upload the **contents** of this package to the root of the `paryx-platform` repository.

For GitHub Pages, publish from the repository root. The root `index.html` forwards users to the staff login page.

## Development Supabase

The current frontend configuration is retained so the existing working development data and RPCs remain usable.

After the new site is deployed, add its `apps/club/html/set-password.html` URL to Supabase Auth allowed redirect URLs.

The Edge Function must remain deployed with the exact name:

```text
admin-import-members
```

## Fresh Supabase environment later

`supabase/baseline/001_platform_baseline.sql` is a neutral reference baseline with customer-specific seeds removed. It is intended only for a fresh project.

Do not apply it to the current development project because those objects already exist.

## Next database work

The next active migration should introduce the proper multi-club tenant/configuration model rather than copying any customer-specific seed data.
