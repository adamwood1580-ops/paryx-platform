-- =========================================================
-- OPTIONAL TEST TEMPLATE — DO NOT RUN WITH PLACEHOLDERS
-- =========================================================
-- This is only for testing the API-ready imported-result UI before a real
-- ClubV1 API adapter exists. Use disposable/test competition data.
--
-- 1. Replace YOUR_CLUB_UUID and YOUR_COMPETITION_UUID.
-- 2. Replace the membership numbers/names with test members if you want
--    automatic matching to occur.
-- 3. Run in Supabase SQL Editor.
-- =========================================================

-- Enable the non-secret ClubV1 integration record for the test club.
insert into public.club_competition_result_integrations (
    club_id,
    provider,
    is_enabled,
    external_club_id
)
values (
    'YOUR_CLUB_UUID'::uuid,
    'clubv1',
    true,
    'TEST-CLUBV1-CLUB'
)
on conflict (club_id, provider)
do update set
    is_enabled = true,
    external_club_id = excluded.external_club_id,
    updated_at = now();

update public.club_competitions
set
    result_provider = 'clubv1',
    result_sync_status = 'awaiting_results',
    updated_at = now()
where id = 'YOUR_COMPETITION_UUID'::uuid;

-- Simulate the normalized payload a future ClubV1 Edge Function will send.
select public.competition_import_external_results(
    'YOUR_COMPETITION_UUID'::uuid,
    'clubv1',
    'TEST-COMP-001',
    'closed',
    jsonb_build_array(
        jsonb_build_object(
            'external_result_id', 'TEST-RESULT-1',
            'external_player_id', 'TEST-PLAYER-1',
            'membership_number', 'REPLACE_WITH_TEST_MEMBER_NUMBER_1',
            'player_name', 'Test Winner',
            'finishing_position', 1,
            'points', 41,
            'result_text', '41 pts'
        ),
        jsonb_build_object(
            'external_result_id', 'TEST-RESULT-2',
            'external_player_id', 'TEST-PLAYER-2',
            'membership_number', 'REPLACE_WITH_TEST_MEMBER_NUMBER_2',
            'player_name', 'Test Runner-up',
            'finishing_position', 2,
            'points', 39,
            'result_text', '39 pts'
        ),
        jsonb_build_object(
            'external_result_id', 'TEST-RESULT-3',
            'external_player_id', 'TEST-PLAYER-3',
            'player_name', 'Unmatched Test Player',
            'finishing_position', 3,
            'points', 37,
            'result_text', '37 pts'
        )
    ),
    jsonb_build_object('source', 'mock-clubv1-v0.22-test')
);
