# Paryx Platform Architecture

## Product split

```text
                         Paryx Platform
                               |
                 +-------------+-------------+
                 |                           |
          Paryx Club                  Paryx Member
          staff software                golfer experience
                 |                           |
                 +-------------+-------------+
                               |
                        shared services
                               |
                    PostgreSQL / Supabase
```

The staff and member applications have different user experiences but share identity, clubs, courses, memberships, bookings and competitions.

## Current deployment model

- Static HTML/CSS/JavaScript frontend during development
- Supabase managed PostgreSQL/Auth/Edge Functions
- GitHub repository and static hosting
- Future staff desktop packaging can wrap the same frontend without changing the platform model

## Long-term backend rule

UI code should increasingly call Paryx service modules rather than querying database tables directly. This keeps open the option to move from Supabase-hosted APIs to a Paryx API or self-hosted PostgreSQL later without rewriting every screen.

## Tenant rule

Every customer is a tenant. Customer-specific identity and behaviour must be data, not source code.
