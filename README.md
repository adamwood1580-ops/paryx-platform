https://adamwood1580-ops.github.io/paryx-platform/

# Paryx Platform

**Paryx** is a golf club management platform. This repository contains the clean platform foundation for the **club/staff workspace**. The golfer-facing experience will be developed separately as **Paryx Member**, while sharing platform services and the same tenant-aware data model.

> **Paryx — The platform behind your club.**

## Current working foundation

- Paryx authentication and protected-session bootstrap
- staff dashboard
- member directory
- CSV member importer
- secure Supabase Edge Function for account invitations/imports
- reusable Paryx design tokens and interface components
- neutral multi-club database baseline for future clean environments

The staff application deliberately excludes golfer scorecards, golfer home/profile pages, customer-specific course data, customer logos/domains, weather and prototype-only diagnostics.

## Repository structure

```text
apps/
  club/                    Paryx Club staff application
  member/                  Reserved for future Paryx Member application
shared/                    Reserved for shared platform services/modules
supabase/
  baseline/                Neutral baseline for a future clean environment
  functions/               Supabase Edge Functions
  migrations/              New multi-club migrations from this point onward
templates/                  Import templates
docs/                       Architecture, deployment, roadmap and brand guidance
```

## Product rule

**Paryx** is the software brand. A golf club is a tenant/customer. No source file in the staff application should contain a particular customer's name, logo, course data, coordinates or operating rules. Those values must come from tenant configuration/data.

## Development backend

The current `apps/club/js/core/config.js` points to the existing development Supabase project using a publishable client key only. Never place a Supabase secret/service-role key in browser code or commit one to Git.

See `INSTALL_FIRST.md` and `docs/deployment.md` for deployment notes.
