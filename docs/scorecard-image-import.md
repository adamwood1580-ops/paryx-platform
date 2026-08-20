# Scorecard Image Import

Paryx v0.4.1 introduces a review-first course onboarding workflow.

## Flow

Scorecard image
→ secure Supabase Edge Function
→ vision extraction
→ structured golf-course JSON
→ staff review
→ existing Paryx course RPCs
→ course / hole / tee records

## Why review is mandatory

Printed scorecards vary considerably between clubs. Common issues include:

- front/back nine layouts
- OUT / IN / TOTAL columns
- several tee rows
- separate men's and women's ratings
- abbreviated "SI" or "H'cap" labels
- old scorecards containing historic ratings
- shadows, folds and angled photographs

Paryx therefore never writes the image-analysis result straight to the database.

## Merge behaviour

- Recognised hole values replace the matching selected-course field.
- Null/unreadable extracted values preserve existing hole values.
- Tee names/colours are matched against existing tees before a new tee is made.
- Existing tee rating values are preserved when the scan does not provide a complete replacement.
- Existing yardage values are preserved for unreadable holes.
- Staff can untick an extracted tee before applying the import.

## Security

The image-analysis provider key exists only as a Supabase Edge Function secret.

The function verifies:
- a valid authenticated Paryx session
- manager / club_admin rights for the supplied club
- that the course belongs to that club

The browser never receives the provider API key.
