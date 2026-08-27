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
- explicit multi-club tenant switching and tenant-safe staff RPCs
- club configuration, branding, logo storage and per-club defaults
- neutral multi-club database baseline for future clean environments

The staff application deliberately excludes golfer scorecards, golfer home/profile pages, customer-specific course data, customer logos/domains, weather and prototype-only diagnostics.

