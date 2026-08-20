# Paryx v0.4 — Courses & Tee Data

The Courses module is the shared course-data foundation for future Tee Sheet,
Competitions and Paryx Member scoring.

## Data model

```text
Club
└── Courses
    └── Course
        ├── 9 / 18 holes
        ├── Course holes
        │   ├── Men's par
        │   ├── Men's stroke index
        │   ├── Women's par
        │   └── Women's stroke index
        └── Physical tees
            ├── Name / colour
            ├── Men's WHS rating
            │   ├── Par
            │   ├── Course Rating
            │   └── Slope Rating
            ├── Women's WHS rating
            └── Yardage for every hole
```

Existing Paryx tables `courses`, `tees` and `tee_ratings` remain authoritative.
The migration adds `course_holes` and `tee_hole_distances` rather than placing
club-specific course data in source code.

## Tenant security

All staff writes go through selected-club RPCs that call
`user_can_manage_club(p_club_id)`.

The migration also replaces the older global active-tee read policies with
membership-scoped RLS policies, so tee and rating rows are only readable by an
active member of the owning club.

## Course management

Managers and Club Admins can:

- create 9-hole or 18-hole courses
- edit course name and active state
- enter men's and women's par / stroke index
- create physical tee sets
- set current WHS ratings independently for men and women
- enter hole-by-hole yardages
- archive courses/tees by marking them inactive

A course currently selected as the club default cannot be deactivated until a
new default is chosen in Settings.

## Why par/SI and yardage are separated

Par and stroke index are scorecard attributes for a course/gender. Yardage is
a physical tee attribute. Keeping those concepts separate prevents duplicated
scorecard data while still allowing White, Yellow, Red or other tees to have
independent distances and WHS ratings.
