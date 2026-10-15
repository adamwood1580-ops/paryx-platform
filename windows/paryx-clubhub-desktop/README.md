# Paryx ClubHub Desktop 0.31.0

This packages ClubHub in a Windows x64 EXE. ClubHub pages and its Supabase browser SDK are bundled locally, so the club computer no longer needs GitHub Pages to load ClubHub. Internet access to Supabase is still required for authentication and data. The Player app and public booking widget remain web applications.

## Run the portable EXE

Place `Paryx-ClubHub-Portable-0.31.0-x64.exe` in a permanent folder on the Windows computer, then double-click it. It extracts its bundled runtime before opening ClubHub. Keep the file in that location for invitation/password-reset links. The portable build registers `paryx://` against the original EXE path when launched. This build is unsigned and requires a Windows pilot test before wider distribution.

## Build an installer on Windows

Install Node.js LTS. Extract the changed-files patch over the supplied repository, preserving its folder structure. Double-click `Build-Windows.cmd` in this folder. It runs `npm ci` and `npm run dist:win` and opens `dist` on success.

The installer is `dist/Paryx-ClubHub-Setup-0.31.0-x64.exe`. It adds shortcuts and registers the authentication protocol. To build another portable EXE, run `npm run dist:portable`. To launch during development, run `npm run start`.

For signed distribution, configure the signing certificate and change the `win.signAndEditExecutable` setting as appropriate. The current package produces unsigned pilot builds.

## Supabase setup

See `SUPABASE-SETUP.md`: add the exact redirect URLs `paryx://auth/invite` and `paryx://auth/recovery`, retain the existing web URLs, and redeploy the supplied `admin-invite-staff` function. Normal sign-in uses the existing backend configuration. No SQL migration is needed.

## Barcode scanning

In Stock Inventory, select the Scan barcode field and use a USB/Bluetooth scanner in keyboard mode configured to append Enter. Alternatively select Use camera. Camera access is limited to the Stock page in the desktop client and requires permission. On the web, camera scanning requires HTTPS. Camera decoding is bundled with the patch and supports common EAN, UPC and Code 128 barcodes through ZXing.

A barcode lookup opens the exact product belonging to the current club, including inactive and out-of-stock records. An unknown barcode offers Create this product to staff who can manage stock. Its barcode and initial SKU are filled automatically; enter the name, prices and other details once. In the product editor, scan into Barcode or select Camera. Scanning never saves a product or changes stock by itself. Save product and Save movement remain explicit actions. Reception can look up records but cannot create or edit them.

## EPOS next step

The existing EPOS foundation already maps provider products to Paryx stock and applies sales/refunds to stock movements. This patch records barcodes against those same products. It does not connect a particular till provider or add a checkout screen. A provider adapter must map the till item to the Paryx product and send completed sales/refunds. Stock should reduce once per completed sale, rather than merely when a barcode is scanned.

## Windows pilot checks

1. Open the EXE, sign in, close it and reopen; verify session/theme behaviour.
2. Verify the existing ClubHub pages and role restrictions, including Greenkeeper access.
3. Scan a known barcode by USB and camera; check the name, leading zeros and stock balance.
4. Scan an unknown barcode, create the record, save it and scan it again.
5. Receive/remove stock through Adjust stock; verify quantity and audit history.
6. Try an existing barcode/SKU on a second product; verify the duplicate error.
7. Verify Reception can look up stock but cannot change it.
8. Cancel the camera and navigate away; verify the camera stops. Test permission denial.
9. After Supabase setup, test a new staff invitation and a password reset from the EXE.
10. Sign out and confirm the app returns to login.

Automated logic checks passed; physical scanner/camera, live backend and Windows runtime testing must be completed on the club PC.
