-- =========================================================
-- PARYX MIGRATION 033
-- MEMBER CLUB CREDIT V1.2 — SPEND CREDIT
--
-- Adds an explicit operational spend flow.
--
-- Reception, Professional, Manager and Club Admin may spend a
-- member's existing Club Credit.
--
-- Only Professional, Manager and Club Admin retain the ability
-- to grant prizes/credits/refunds/adjustments.
--
-- Existing manual_debit ledger rows remain valid. A spend is recorded
-- as transaction_type = 'manual_debit' with a negative amount.
-- =========================================================

begin;

create or replace function public.user_can_spend_club_credit(
    p_club_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select
        public.club_module_enabled(
            p_club_id,
            'member_credit'
        )
        and exists (
            select 1
            from public.club_memberships as membership
            where membership.profile_id =
                    auth.uid()
              and membership.club_id =
                    p_club_id
              and membership.status =
                    'active'
              and membership.role in (
                    'reception',
                    'professional',
                    'manager',
                    'club_admin'
              )
        );
$$;

revoke all
on function public.user_can_spend_club_credit(uuid)
from public, anon;

grant execute
on function public.user_can_spend_club_credit(uuid)
to authenticated;

create or replace function public.club_credit_spend(
    p_club_id uuid,
    p_membership_id uuid,
    p_amount numeric,
    p_reference text default null,
    p_description text default null
)
returns table (
    transaction_id uuid,
    amount numeric,
    balance_before numeric,
    balance_after numeric,
    currency_code text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_amount numeric(12,2);
    v_balance_before numeric(12,2);
    v_balance_after numeric(12,2);
    v_currency text;
    v_account_id uuid;
    v_transaction_id uuid;
begin
    if auth.uid() is null
       or not public.user_can_spend_club_credit(
            p_club_id
       ) then
        raise exception
            'Club Credit spend access required.';
    end if;

    if not exists (
        select 1
        from public.club_memberships as membership
        where membership.id =
                p_membership_id
          and membership.club_id =
                p_club_id
          and membership.status =
                'active'
          and coalesce(
                membership.membership_type,
                'member'
              ) not in (
                'visitor',
                'guest',
                'staff'
              )
    ) then
        raise exception
            'An active genuine club membership is required.';
    end if;

    if p_amount is null
       or p_amount <= 0 then
        raise exception
            'Spend amount must be greater than zero.';
    end if;

    v_amount :=
        round(
            abs(
                p_amount
            )::numeric,
            2
        );

    if v_amount <= 0 then
        raise exception
            'Spend amount must be at least 0.01.';
    end if;

    select coalesce(
        settings.currency_code,
        'GBP'
    )
    into v_currency
    from public.club_settings as settings
    where settings.club_id =
            p_club_id
    limit 1;

    v_currency :=
        coalesce(
            v_currency,
            'GBP'
        );

    -- Create a zero-balance account only if one does not already exist.
    -- This keeps account creation deterministic without granting funds.
    insert into public.club_member_accounts (
        club_id,
        membership_id,
        balance,
        currency_code
    )
    values (
        p_club_id,
        p_membership_id,
        0,
        v_currency
    )
    on conflict (
        club_id,
        membership_id
    )
    do nothing;

    select
        account.id,
        account.balance,
        account.currency_code
    into
        v_account_id,
        v_balance_before,
        v_currency
    from public.club_member_accounts as account
    where account.club_id =
            p_club_id
      and account.membership_id =
            p_membership_id
      and account.is_active
    for update;

    if v_account_id is null then
        raise exception
            'Member Club Credit account is unavailable.';
    end if;

    if v_amount >
       v_balance_before then
        raise exception
            'This spend exceeds the member''s available Club Credit. Available balance: % %.',
            v_currency,
            to_char(
                v_balance_before,
                'FM9999999990.00'
            );
    end if;

    v_balance_after :=
        v_balance_before -
        v_amount;

    update public.club_member_accounts
    set
        balance =
            v_balance_after,

        updated_at =
            now()

    where id =
            v_account_id;

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
        source,
        created_by
    )
    values (
        p_club_id,
        v_account_id,
        p_membership_id,
        'manual_debit',
        -v_amount,
        v_balance_before,
        v_balance_after,
        v_currency,
        nullif(
            trim(
                coalesce(
                    p_reference,
                    ''
                )
            ),
            ''
        ),
        nullif(
            trim(
                coalesce(
                    p_description,
                    ''
                )
            ),
            ''
        ),
        'manual',
        auth.uid()
    )
    returning id
    into v_transaction_id;

    return query
    select
        v_transaction_id,
        -v_amount,
        v_balance_before,
        v_balance_after,
        v_currency;
end;
$$;

revoke all
on function public.club_credit_spend(
    uuid,
    uuid,
    numeric,
    text,
    text
)
from public, anon;

grant execute
on function public.club_credit_spend(
    uuid,
    uuid,
    numeric,
    text,
    text
)
to authenticated;

commit;

notify pgrst, 'reload schema';
