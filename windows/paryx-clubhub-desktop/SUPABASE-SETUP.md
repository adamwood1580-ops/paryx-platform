# Supabase desktop redirect setup

Add these exact values under:

Authentication -> URL Configuration -> Redirect URLs

```text
paryx://auth/invite
paryx://auth/recovery
```

Then redeploy:

```text
supabase/functions/admin-invite-staff/index.ts
```

Why this is required:

- ClubHub staff invitations use `paryx://auth/invite`.
- ClubHub password resets use `paryx://auth/recovery`.
- The installed Windows app converts those deep links back into its bundled `set-password.html` page.
- The normal web URLs remain supported by the Edge Function during the pilot.

No database migration is required.
