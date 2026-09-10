-- =========================================================
-- PARYX MIGRATION 036
-- VERIFIED COMPETITION RESULTS + AUTOMATIC CLUB CREDIT
-- =========================================================
--
-- Paryx no longer duplicates the full competition score entry held in
-- ClubV1 / HowDidiDo. Club staff verify the final prize placings there,
-- then record only the club members receiving a result/prize in Paryx.
--
-- Saving stores the verified placings and proposed prize values.
-- Confirming atomically:
--   1. stores the current verified placings,
--   2. posts each positive prize as Club Credit,
--   3. links the credit transaction to the prize,
--   4. locks the competition as completed.
--
-- Prerequisites: Migration 030 (Member Club Credit) and Migration 034
-- (Competition Management) must already be installed. Migration 035 may
-- remain installed; the new frontend no longer uses its batch RPC.
-- =========================================================

begin;

alter table public.club_competition_prizes
    add column if not exists credit_transaction_id uuid
        references public.club_member_account_transactions(id)
        on delete set null;

create index if not exists club_competition_prizes_credit_transaction_idx
on public.club_competition_prizes (credit_transaction_id)
where credit_transaction_id is not null;

create or replace function public.competition_save_verified_awards(
    p_competition_id uuid,
    p_results jsonb,
    p_confirm boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_club_id uuid;
    v_competition_name text;
    v_club_event_id uuid;
    v_currency text;
    v_result jsonb;
    v_membership_id uuid;
    v_placing integer;
    v_amount numeric(12,2);
    v_label text;
    v_name text;
    v_email text;
    v_membership_number text;
    v_account_id uuid;
    v_account_currency text;
    v_balance_before numeric(12,2);
    v_balance_after numeric(12,2);
    v_transaction_id uuid;
    v_external_event_id text;
    v_seen_places integer[] := '{}'::integer[];
    v_seen_members uuid[] := '{}'::uuid[];
    v_result_count integer := 0;
    v_award_count integer := 0;
    v_total_credit numeric(12,2) := 0;
begin
    select
        competition.club_id,
        coalesce(event.title, competition.name),
        competition.club_event_id,
        coalesce(settings.currency_code, 'GBP')
    into
        v_club_id,
        v_competition_name,
        v_club_event_id,
        v_currency
    from public.club_competitions as competition
    left join public.club_events as event
        on event.id = competition.club_event_id
    left join public.club_settings as settings
        on settings.club_id = competition.club_id
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

    if p_results is null or jsonb_typeof(p_results) <> 'array' then
        raise exception 'Verified competition results must be supplied as an array.';
    end if;

    v_currency := coalesce(v_currency, 'GBP');
    v_result_count := jsonb_array_length(p_results);

    if coalesce(p_confirm, false) and v_result_count = 0 then
        raise exception 'Add at least one verified result before confirming the competition.';
    end if;

    -- Validate every row before changing any stored result data.
    for v_result in
        select value
        from jsonb_array_elements(p_results)
    loop
        v_membership_id :=
            nullif(trim(coalesce(v_result ->> 'membership_id', '')), '')::uuid;
        v_placing :=
            nullif(trim(coalesce(v_result ->> 'placing', '')), '')::integer;
        v_amount :=
            round(
                coalesce(
                    nullif(trim(coalesce(v_result ->> 'amount', '')), '')::numeric,
                    0
                ),
                2
            );
        v_label :=
            nullif(trim(coalesce(v_result ->> 'label', '')), '');

        if v_membership_id is null then
            raise exception 'Every verified result must be assigned to a club member.';
        end if;

        if v_placing is null or v_placing not between 1 and 20 then
            raise exception 'Result placing must be between 1 and 20.';
        end if;

        if v_amount < 0 then
            raise exception 'Competition credit cannot be negative.';
        end if;

        if v_placing = any(v_seen_places) then
            raise exception 'Place % is assigned more than once.', v_placing;
        end if;

        if v_membership_id = any(v_seen_members) then
            raise exception 'The same club member cannot be assigned to more than one place.';
        end if;

        if not exists (
            select 1
            from public.club_memberships as membership
            where membership.id = v_membership_id
              and membership.club_id = v_club_id
              and membership.status = 'active'
              and coalesce(membership.membership_type, 'member')
                    not in ('visitor', 'guest', 'staff')
        ) then
            raise exception 'Every verified result must use an active genuine club member.';
        end if;

        v_seen_places := array_append(v_seen_places, v_placing);
        v_seen_members := array_append(v_seen_members, v_membership_id);
        v_total_credit := v_total_credit + v_amount;
    end loop;

    if coalesce(p_confirm, false)
       and v_total_credit > 0
       and not public.user_can_manage_club_credit(v_club_id) then
        raise exception 'Member Club Credit must be enabled before competition prizes can be awarded.';
    end if;

    -- This Competition workflow now stores only the verified prize/result
    -- positions required by Paryx. ClubV1 / HowDidiDo remains the source of
    -- truth for the full field and scorecard.
    delete from public.club_competition_prizes
    where competition_id = p_competition_id;

    delete from public.club_competition_entries
    where competition_id = p_competition_id;

    for v_result in
        select value
        from jsonb_array_elements(p_results)
        order by (value ->> 'placing')::integer
    loop
        v_membership_id := (v_result ->> 'membership_id')::uuid;
        v_placing := (v_result ->> 'placing')::integer;
        v_amount := round(coalesce((v_result ->> 'amount')::numeric, 0), 2);
        v_label := nullif(trim(coalesce(v_result ->> 'label', '')), '');

        select
            coalesce(
                nullif(trim(profile.display_name), ''),
                nullif(trim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
                auth_user.email::text,
                'Member'
            )::text,
            auth_user.email::text,
            membership.membership_number
        into
            v_name,
            v_email,
            v_membership_number
        from public.club_memberships as membership
        join public.profiles as profile
            on profile.id = membership.profile_id
        join auth.users as auth_user
            on auth_user.id = membership.profile_id
        where membership.id = v_membership_id
          and membership.club_id = v_club_id
          and membership.status = 'active';

        insert into public.club_competition_entries (
            competition_id,
            membership_id,
            entry_type,
            entrant_name,
            entrant_email,
            membership_number,
            entry_status,
            finishing_position,
            created_by
        )
        values (
            p_competition_id,
            v_membership_id,
            'member',
            v_name,
            v_email,
            v_membership_number,
            'completed',
            v_placing,
            auth.uid()
        );

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
            coalesce(v_label, 'Place ' || v_placing::text),
            v_amount,
            v_currency,
            auth.uid()
        );
    end loop;

    if coalesce(p_confirm, false) then
        -- Award every positive prize as an append-only Club Credit ledger
        -- transaction. The external_event_id makes each competition/place
        -- award uniquely identifiable and prevents accidental duplication.
        for v_result in
            select value
            from jsonb_array_elements(p_results)
            where coalesce((value ->> 'amount')::numeric, 0) > 0
            order by (value ->> 'placing')::integer
        loop
            v_membership_id := (v_result ->> 'membership_id')::uuid;
            v_placing := (v_result ->> 'placing')::integer;
            v_amount := round((v_result ->> 'amount')::numeric, 2);
            v_external_event_id :=
                'competition:' || p_competition_id::text || ':place:' || v_placing::text;

            if exists (
                select 1
                from public.club_member_account_transactions as transaction
                where transaction.club_id = v_club_id
                  and transaction.external_event_id = v_external_event_id
            ) then
                raise exception 'Club Credit for place % has already been awarded.', v_placing;
            end if;

            insert into public.club_member_accounts (
                club_id,
                membership_id,
                balance,
                currency_code
            )
            values (
                v_club_id,
                v_membership_id,
                0,
                v_currency
            )
            on conflict (club_id, membership_id)
            do nothing;

            select
                account.id,
                account.balance,
                account.currency_code
            into
                v_account_id,
                v_balance_before,
                v_account_currency
            from public.club_member_accounts as account
            where account.club_id = v_club_id
              and account.membership_id = v_membership_id
              and account.is_active
            for update;

            if v_account_id is null then
                raise exception 'Member Club Credit account is unavailable for place %.', v_placing;
            end if;

            v_balance_after := v_balance_before + v_amount;

            update public.club_member_accounts
            set
                balance = v_balance_after,
                updated_at = now()
            where id = v_account_id;

            insert into public.club_member_account_transactions (
                club_id,
                account_id,
                membership_id,
                transaction_type,
                amount,
                balance_before,
                balance_after,
                currency_code,
                reference,
                description,
                club_event_id,
                source,
                external_event_id,
                created_by
            )
            values (
                v_club_id,
                v_account_id,
                v_membership_id,
                'competition_prize',
                v_amount,
                v_balance_before,
                v_balance_after,
                coalesce(v_account_currency, v_currency),
                v_competition_name,
                'Competition prize — place ' || v_placing::text,
                v_club_event_id,
                'competition',
                v_external_event_id,
                auth.uid()
            )
            returning id
            into v_transaction_id;

            update public.club_competition_prizes
            set
                credit_transaction_id = v_transaction_id,
                updated_at = now()
            where competition_id = p_competition_id
              and finishing_position = v_placing;

            v_award_count := v_award_count + 1;
        end loop;

        update public.club_competitions
        set
            status = 'completed',
            results_confirmed_at = now(),
            results_confirmed_by = auth.uid(),
            updated_at = now()
        where id = p_competition_id;
    else
        update public.club_competitions
        set
            status = case
                when v_result_count > 0
                     and status in ('draft', 'open', 'closed')
                    then 'results_pending'
                else status
            end,
            updated_at = now()
        where id = p_competition_id;
    end if;

    return jsonb_build_object(
        'saved_results', v_result_count,
        'awarded_transactions', v_award_count,
        'total_credit', v_total_credit,
        'currency_code', v_currency,
        'confirmed', coalesce(p_confirm, false)
    );
end;
$$;

revoke all
on function public.competition_save_verified_awards(uuid, jsonb, boolean)
from public, anon;

grant execute
on function public.competition_save_verified_awards(uuid, jsonb, boolean)
to authenticated;

-- Return the Club Credit transaction link with each prize so ClubHub can
-- show whether money has actually been posted.
create or replace function public.competition_get_detail(p_competition_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_club_id uuid;
    v_result jsonb;
begin
    select competition.club_id into v_club_id
    from public.club_competitions as competition
    where competition.id = p_competition_id;

    if v_club_id is null
       or auth.uid() is null
       or not public.user_can_view_competitions(v_club_id) then
        raise exception 'Competition access required.';
    end if;

    select jsonb_build_object(
        'competition', jsonb_build_object(
            'competition_id', competition.id,
            'club_id', competition.club_id,
            'club_event_id', competition.club_event_id,
            'name', coalesce(event.title, competition.name),
            'competition_date', coalesce(event.event_date, competition.competition_date),
            'competition_format', competition.competition_format,
            'section', coalesce(event.section, competition.section),
            'status', competition.status,
            'is_qualifier', coalesce(event.is_qualifier, competition.is_qualifier),
            'notes', competition.notes,
            'results_confirmed_at', competition.results_confirmed_at,
            'results_confirmed_by', competition.results_confirmed_by,
            'currency_code', coalesce(settings.currency_code, 'GBP')
        ),
        'entries', coalesce((
            select jsonb_agg(
                jsonb_build_object(
                    'entry_id', entry.id,
                    'membership_id', entry.membership_id,
                    'entry_type', entry.entry_type,
                    'entrant_name', entry.entrant_name,
                    'entrant_email', entry.entrant_email,
                    'membership_number', entry.membership_number,
                    'entry_status', entry.entry_status,
                    'gross_score', entry.gross_score,
                    'nett_score', entry.nett_score,
                    'points', entry.points,
                    'placing', entry.finishing_position,
                    'result_text', entry.result_text
                )
                order by entry.finishing_position nulls last,
                         lower(entry.entrant_name),
                         entry.created_at
            )
            from public.club_competition_entries as entry
            where entry.competition_id = competition.id
        ), '[]'::jsonb),
        'prizes', coalesce((
            select jsonb_agg(
                jsonb_build_object(
                    'prize_id', prize.id,
                    'placing', prize.finishing_position,
                    'label', prize.label,
                    'amount', prize.amount,
                    'currency_code', prize.currency_code,
                    'credit_transaction_id', prize.credit_transaction_id
                )
                order by prize.finishing_position
            )
            from public.club_competition_prizes as prize
            where prize.competition_id = competition.id
        ), '[]'::jsonb)
    ) into v_result
    from public.club_competitions as competition
    left join public.club_events as event
        on event.id = competition.club_event_id
    left join public.club_settings as settings
        on settings.club_id = competition.club_id
    where competition.id = p_competition_id;

    return v_result;
end;
$$;

revoke all on function public.competition_get_detail(uuid) from public, anon;
grant execute on function public.competition_get_detail(uuid) to authenticated;

-- Once credit has been posted, reopening the result without reversing the
-- ledger would create an accounting inconsistency. Zero-credit results can
-- still be reopened normally.
create or replace function public.competition_reopen_results(p_competition_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_club_id uuid;
begin
    select competition.club_id
    into v_club_id
    from public.club_competitions as competition
    where competition.id = p_competition_id;

    if v_club_id is null
       or auth.uid() is null
       or not public.user_can_confirm_competition_results(v_club_id) then
        raise exception 'Manager or Club Admin confirmation is required.';
    end if;

    if exists (
        select 1
        from public.club_competition_prizes as prize
        where prize.competition_id = p_competition_id
          and prize.credit_transaction_id is not null
    ) then
        raise exception 'Club Credit has already been awarded. Correct the balance through Club Credit rather than reopening this result.';
    end if;

    update public.club_competitions
    set
        status = 'results_pending',
        results_confirmed_at = null,
        results_confirmed_by = null,
        updated_at = now()
    where id = p_competition_id;

    return true;
end;
$$;

revoke all on function public.competition_reopen_results(uuid) from public, anon;
grant execute on function public.competition_reopen_results(uuid) to authenticated;

commit;

notify pgrst, 'reload schema';
