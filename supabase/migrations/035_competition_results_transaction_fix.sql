-- =========================================================
-- PARYX MIGRATION 035
-- COMPETITION RESULTS TRANSACTION FIX
-- =========================================================
--
-- Fixes two Competition Management V1 workflow defects:
-- 1. Saving the competition header could reload the dialog before
--    unsaved entrant scores/results were persisted.
-- 2. Confirming results depended on separately saved entrant rows.
--
-- This adds one atomic RPC that saves the complete on-screen result set
-- (entrants + prizes) and can optionally confirm the competition.
-- Physical database column remains finishing_position; API payload keeps
-- the frontend-friendly JSON key "placing".
-- =========================================================

begin;

create or replace function public.competition_save_results_batch(
    p_competition_id uuid,
    p_entries jsonb,
    p_prizes jsonb,
    p_confirm boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_club_id uuid;
    v_entry jsonb;
    v_prize jsonb;
    v_entry_id uuid;
    v_status text;
    v_gross integer;
    v_nett integer;
    v_points integer;
    v_placing integer;
    v_result_text text;
    v_amount numeric(12,2);
    v_label text;
    v_currency text;
    v_total_entries integer;
    v_payload_entries integer;
    v_seen_places integer[] := '{}'::integer[];
    v_seen_prize_places integer[] := '{}'::integer[];
begin
    select competition.club_id
    into v_club_id
    from public.club_competitions as competition
    where competition.id = p_competition_id
      and competition.results_confirmed_at is null;

    if v_club_id is null
       or auth.uid() is null
       or not public.user_can_manage_competitions(v_club_id) then
        raise exception 'Competition management access required.';
    end if;

    if coalesce(p_confirm, false)
       and not public.user_can_confirm_competition_results(v_club_id) then
        raise exception 'Manager or Club Admin confirmation is required.';
    end if;

    if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
        raise exception 'Competition entries must be supplied as an array.';
    end if;

    if p_prizes is null or jsonb_typeof(p_prizes) <> 'array' then
        raise exception 'Prize structure must be supplied as an array.';
    end if;

    select count(*)::integer
    into v_total_entries
    from public.club_competition_entries as entry
    where entry.competition_id = p_competition_id;

    v_payload_entries := jsonb_array_length(p_entries);

    if v_payload_entries <> v_total_entries then
        raise exception 'The entrant list changed. Reload the competition and try again.';
    end if;

    if exists (
        select 1
        from (
            select nullif(trim(item.value ->> 'entry_id'), '') as entry_id,
                   count(*) as row_count
            from jsonb_array_elements(p_entries) as item(value)
            group by nullif(trim(item.value ->> 'entry_id'), '')
        ) as duplicate
        where duplicate.entry_id is null
           or duplicate.row_count > 1
    ) then
        raise exception 'The entrant result set contains an invalid or duplicate entrant.';
    end if;

    if exists (
        select 1
        from jsonb_array_elements(p_entries) as item(value)
        where not exists (
            select 1
            from public.club_competition_entries as entry
            where entry.id = (item.value ->> 'entry_id')::uuid
              and entry.competition_id = p_competition_id
        )
    ) then
        raise exception 'One or more entrants no longer belong to this competition.';
    end if;

    -- Validate every entrant before changing any stored result.
    for v_entry in
        select value from jsonb_array_elements(p_entries)
    loop
        v_entry_id := (v_entry ->> 'entry_id')::uuid;
        v_status := coalesce(nullif(trim(v_entry ->> 'entry_status'), ''), 'entered');
        v_gross := nullif(trim(coalesce(v_entry ->> 'gross_score', '')), '')::integer;
        v_nett := nullif(trim(coalesce(v_entry ->> 'nett_score', '')), '')::integer;
        v_points := nullif(trim(coalesce(v_entry ->> 'points', '')), '')::integer;
        v_placing := nullif(trim(coalesce(v_entry ->> 'placing', '')), '')::integer;
        v_result_text := nullif(trim(coalesce(v_entry ->> 'result_text', '')), '');

        if v_status not in ('entered','completed','no_return','disqualified','withdrawn') then
            raise exception 'Unsupported entry status.';
        end if;
        if v_gross is not null and v_gross < 0 then
            raise exception 'Gross score cannot be negative.';
        end if;
        if v_nett is not null and v_nett < 0 then
            raise exception 'Nett score cannot be negative.';
        end if;
        if v_points is not null and v_points < 0 then
            raise exception 'Points cannot be negative.';
        end if;
        if v_placing is not null and v_placing < 1 then
            raise exception 'Placing must be at least 1.';
        end if;
        if v_placing is not null and v_status in ('withdrawn','disqualified','no_return') then
            raise exception 'Withdrawn, disqualified or no-return entrants cannot hold a placing.';
        end if;
        if v_placing is not null and v_placing = any(v_seen_places) then
            raise exception 'Place % is assigned to more than one entrant.', v_placing;
        end if;
        if v_placing is not null then
            v_seen_places := array_append(v_seen_places, v_placing);
        end if;
    end loop;

    select coalesce(settings.currency_code, 'GBP')
    into v_currency
    from public.club_settings as settings
    where settings.club_id = v_club_id
    limit 1;

    v_currency := coalesce(v_currency, 'GBP');

    -- Validate prizes before changing stored rows.
    for v_prize in
        select value from jsonb_array_elements(p_prizes)
    loop
        v_placing := nullif(trim(coalesce(v_prize ->> 'placing', '')), '')::integer;
        v_amount := round(
            coalesce(
                nullif(trim(coalesce(v_prize ->> 'amount', '')), '')::numeric,
                0
            ),
            2
        );
        v_label := nullif(trim(coalesce(v_prize ->> 'label', '')), '');

        if v_placing is null or v_placing not between 1 and 20 then
            raise exception 'Prize placing must be between 1 and 20.';
        end if;
        if v_amount < 0 then
            raise exception 'Prize value cannot be negative.';
        end if;
        if v_placing = any(v_seen_prize_places) then
            raise exception 'Each prize place can only be used once.';
        end if;
        v_seen_prize_places := array_append(v_seen_prize_places, v_placing);
    end loop;

    -- Clear only stored finishing positions first so places can be swapped
    -- without transient uniqueness conflicts. Scores are never cleared here.
    update public.club_competition_entries
    set finishing_position = null,
        updated_at = now()
    where competition_id = p_competition_id;

    -- Persist the complete entrant result set currently shown in ClubHub.
    for v_entry in
        select value from jsonb_array_elements(p_entries)
    loop
        v_entry_id := (v_entry ->> 'entry_id')::uuid;
        v_status := coalesce(nullif(trim(v_entry ->> 'entry_status'), ''), 'entered');
        v_gross := nullif(trim(coalesce(v_entry ->> 'gross_score', '')), '')::integer;
        v_nett := nullif(trim(coalesce(v_entry ->> 'nett_score', '')), '')::integer;
        v_points := nullif(trim(coalesce(v_entry ->> 'points', '')), '')::integer;
        v_placing := nullif(trim(coalesce(v_entry ->> 'placing', '')), '')::integer;
        v_result_text := nullif(trim(coalesce(v_entry ->> 'result_text', '')), '');

        update public.club_competition_entries
        set entry_status = v_status,
            gross_score = v_gross,
            nett_score = v_nett,
            points = v_points,
            finishing_position = v_placing,
            result_text = v_result_text,
            updated_at = now()
        where id = v_entry_id
          and competition_id = p_competition_id;
    end loop;

    delete from public.club_competition_prizes
    where competition_id = p_competition_id;

    for v_prize in
        select value from jsonb_array_elements(p_prizes)
    loop
        v_placing := (v_prize ->> 'placing')::integer;
        v_amount := round(coalesce((v_prize ->> 'amount')::numeric, 0), 2);
        v_label := nullif(trim(coalesce(v_prize ->> 'label', '')), '');

        insert into public.club_competition_prizes (
            competition_id,
            finishing_position,
            label,
            amount,
            currency_code,
            created_by
        )
        values (
            p_competition_id,
            v_placing,
            v_label,
            v_amount,
            v_currency,
            auth.uid()
        );
    end loop;

    if coalesce(p_confirm, false) then
        if not exists (
            select 1
            from public.club_competition_entries as entry
            where entry.competition_id = p_competition_id
              and entry.entry_status = 'completed'
              and entry.finishing_position is not null
        ) then
            raise exception 'At least one completed entrant with a placing is required.';
        end if;

        if exists (
            select 1
            from public.club_competition_prizes as prize
            where prize.competition_id = p_competition_id
              and prize.amount > 0
              and not exists (
                  select 1
                  from public.club_competition_entries as entry
                  where entry.competition_id = p_competition_id
                    and entry.entry_status = 'completed'
                    and entry.finishing_position = prize.finishing_position
              )
        ) then
            raise exception 'Every positive-value prize place must have a matching completed entrant.';
        end if;

        update public.club_competitions
        set status = 'completed',
            results_confirmed_at = now(),
            results_confirmed_by = auth.uid(),
            updated_at = now()
        where id = p_competition_id;
    else
        update public.club_competitions
        set status = case
                when status in ('draft','open','closed') then 'results_pending'
                else status
            end,
            updated_at = now()
        where id = p_competition_id;
    end if;

    return true;
end;
$$;

revoke all
on function public.competition_save_results_batch(uuid,jsonb,jsonb,boolean)
from public, anon;

grant execute
on function public.competition_save_results_batch(uuid,jsonb,jsonb,boolean)
to authenticated;

commit;

notify pgrst, 'reload schema';
