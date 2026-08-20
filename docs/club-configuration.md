# Paryx v0.3 — Club Configuration & Branding

Paryx now treats club identity as tenant data rather than source-code content.

## New tenant configuration

Each club has one `club_settings` row and one `club_branding` row.

`club_settings` stores:

- short name
- website
- contact email
- phone
- address
- country
- currency
- default course

The existing `clubs` table remains the source of truth for:

- club name
- slug
- timezone
- active status

`club_branding` stores:

- logo storage path
- primary colour
- secondary colour
- accent colour

## Branding behaviour

The staff application loads `get_club_configuration(active_club_id)` as part of
`club-context.js`.

The selected club's colours are mapped onto Paryx CSS tokens at runtime. This
allows one deployed Paryx application to adopt each club's identity without
forking the codebase.

The Paryx master mark remains in the sidebar. A configured club logo appears in
the current-club area of the staff top bar.

## Logo storage

The migration creates the public `club-branding` Supabase Storage bucket.

Only authenticated `manager` and `club_admin` users of the owning club may
upload, replace or delete objects under that club's UUID folder.

The browser accepts PNG, JPG and WebP files up to 2 MB.

## Security

Reads require active membership of the selected club.

Configuration writes require the selected-club role to be `manager` or
`club_admin`. The RPC checks this server-side; hiding the Settings page in the
browser is not relied on for security.

## Acceptance test

1. Open Settings for Club A.
2. Change its short name and colours and optionally upload a logo.
3. Save.
4. Confirm the staff shell immediately reflects the new club identity.
5. Switch to Club B.
6. Confirm Club B retains its own independent branding/settings.
7. Switch back to Club A and confirm its configuration returns.

No HTML, CSS or JavaScript should need editing to configure either club.
