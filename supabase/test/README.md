# Paryx second-club validation

This temporary test proves that one staff account can belong to two clubs and
that Paryx switches tenant context without any source-code changes.

## Run

1. Open `supabase/test/002_create_second_club_test.sql`.
2. Replace BOTH occurrences of `YOUR_ADMIN_EMAIL` with the email address of the
   admin account you currently use to sign in to Paryx.
3. Run the SQL in the existing Paryx development Supabase project.
4. Sign out of Paryx and sign back in.
5. The Current club selector should now show your existing club plus
   `Paryx Test Golf Club`.
6. Select the test club and confirm Dashboard and Members switch to it.
7. Switch back and confirm your original club data returns.

## Expected isolation

While `Paryx Test Golf Club` is selected:

- Members must not show members from the original club.
- Dashboard counts should be zero/empty where no test data exists.
- Switching back should restore the original club's data.

If original-club data appears under the test club, stop there: that is a
tenant-scoping bug.

## Cleanup

After validation, run:
`supabase/test/002_remove_second_club_test.sql`

That removes only the temporary test club and its membership rows.
