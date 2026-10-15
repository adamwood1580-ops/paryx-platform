# Paryx 0.31.0 — barcode stock and Windows desktop patch

Apply this changed-files ZIP over `paryx-platform-main(5).zip`, copying its contents into the repository root (where `apps` and `supabase` are located) and replacing the matching files. It is not a full repository. Keep your current repository backup.

This adds USB/keyboard barcode lookup, camera scanning, barcode entry in the product editor, duplicate feedback, and the Windows desktop wrapper. It incorporates the previously supplied 0.30.9 desktop authentication changes because those files were absent from this repository ZIP.

No SQL migration is needed: the existing stock schema already has the barcode field and a unique per-club barcode index. Deploy the changed web files through your normal process to use scanning on the website. Redeploy `supabase/functions/admin-invite-staff/index.ts` and add the desktop redirect URLs as explained in `windows/paryx-clubhub-desktop/SUPABASE-SETUP.md` for desktop invitation and recovery links.

The desktop EXE is provided separately. Build instructions, usage and pilot checks are in `windows/paryx-clubhub-desktop/README.md`. No production website or Supabase changes have been deployed by this patch preparation.

Barcode records are ready for a future EPOS provider connection. Automated sale/refund synchronisation requires that provider adapter; this release does not create one.
