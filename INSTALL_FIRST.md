# Paryx Platform — Install First

# First Upload / Deployment

1. Extract this ZIP and upload **all files and folders at the ZIP root** into the new GitHub repository.
2. Commit to `main`.
3. Enable GitHub Pages from the repository root (or use your normal static deployment method).
4. The root `index.html` opens `apps/club/html/login.html`.
5. In Supabase Auth URL Configuration, add the new deployed password-setup URL to the allowed redirect URLs, for example:

   `https://YOUR-GITHUB-USER.github.io/YOUR-REPO/apps/club/html/set-password.html`

6. Keep the deployed Edge Function name exactly `admin-import-members`.
7. Do **not** run `supabase/baseline/001_platform_baseline.sql` against the existing development database. It is only for a future clean Supabase environment.
8. Sign in with the existing `club_admin` / `manager` test account and verify Dashboard → Members → Import members.

The staff application intentionally contains no customer-specific branding, course data, scorecards, weather or member-home code.
