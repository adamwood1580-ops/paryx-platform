# Active Paryx migrations

These migrations are for the **existing Paryx development Supabase project**.

Run them in order:

1. `001_multi_club_tenant_foundation.sql`
2. `002_club_configuration_and_branding.sql`

The separate baseline file under `../baseline/` is for a future clean production
environment only. Do **not** run the baseline against the current development
database.
