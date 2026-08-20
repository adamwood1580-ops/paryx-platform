# Paryx v0.2 — Multi-club tenant foundation

This milestone removes the prototype assumption that a staff account manages only one club.

## Behaviour

- A staff user can have active roles at multiple clubs.
- The top bar shows the explicit **Current club**.
- If more than one staff club is available, the selector becomes active.
- The selected club is saved per authenticated user in local storage.
- Changing clubs reloads the page so stale data from another tenant cannot remain on-screen.
- Dashboard, Members and CSV Import operate against the selected club ID.
- Database RPCs independently verify that the signed-in user has the required role at that exact club.

## Staff roles recognised by the tenant selector

- starter
- reception
- professional
- greenkeeper
- manager
- club_admin

The current Dashboard, Members and Import modules still require `manager` or `club_admin`. Later modules can grant narrower permissions to other staff roles.

## Important security rule

The browser-selected `club_id` is never trusted on its own. Every privileged RPC and the member-import Edge Function verifies the caller's active membership/role for that club server-side.
