-- =========================================================
-- PARYX MIGRATION 030
-- MEMBER CLUB CREDIT V1
--
-- Club-specific member balances.
--
-- This is NOT a global Paryx wallet.
-- Balances cannot fall below zero.
-- Transactions are append-only.
-- =========================================================

begin;

create table if not exists public.club_member_accounts (
    id uuid primary key default gen_random_uuid(),

    club_id uuid not null
        references public.clubs(id)
        on delete cascade,

    membership_id uuid not null
        references public.club_memberships(id)
        on delete restrict,

    balance numeric(12,2) not null default 0,
    currency_code text not null default 'GBP',
    is_active boolean not null default true,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    unique (club_id, membership_id),

    constraint club_member_accounts_balance_nonnegative
        check (balance >= 0),

    constraint club_member_accounts_currency_format
        check (currency_code ~ '^[A-Z]{3}$')
);

create index if not exists
club_member_accounts_club_balance_idx
on public.club_member_accounts (
    club_id,
    balance desc
);

alter table public.club_member_accounts
enable row level security;

create table if not exists public.club_member_account_transactions (
    id uuid primary key default gen_random_uuid(),

    club_id uuid not null
        references public.clubs(id)
        on delete cascade,

    account_id uuid not null
        references public.club_member_accounts(id)
        on delete restrict,

    membership_id uuid not null
        references public.club_memberships(id)
        on delete restrict,

    transaction_type text not null,

    amount numeric(12,2) not null,
    balance_before numeric(12,2) not null,
    balance_after numeric(12,2) not null,

    currency_code text not null default 'GBP',

    reference text,
    description text,

    club_event_id uuid
        references public.club_events(id)
        on delete set null,

    source text not null default 'manual',
    external_event_id text,

    created_by uuid
        references public.profiles(id)
        on delete set null,

    created_at timestamptz not null default now(),

    constraint club_member_credit_transaction_type_valid
        check (
            transaction_type in (
                'competition_prize',
                'manual_credit',
                'manual_debit',
                'epos_purchase',
                'refund',
                'adjustment'
            )
        ),

    constraint club_member_credit_amount_nonzero
        check (amount <> 0),

    constraint club_member_credit_balances_nonnegative
        check (
            balance_before >= 0
            and balance_after >= 0
        ),

    constraint club_member_credit_currency_format
        check (currency_code ~ '^[A-Z]{3}$'),

    constraint club_member_credit_source_valid
        check (
            source in (
                'manual',
                'competition',
                'epos',
                'system'
            )
        )
);

create index if not exists
club_member_credit_transactions_account_created_idx
on public.club_member_account_transactions (
    account_id,
    created_at desc
);

create index if not exists
club_member_credit_transactions_club_created_idx
on public.club_member_account_transactions (
    club_id,
    created_at desc
);

create unique index if not exists
club_member_credit_external_event_unique
on public.club_member_account_transactions (
    club_id,
    external_event_id
)
where external_event_id is not null;

alter table public.club_member_account_transactions
enable row level security;

-- =========================================================
-- ACCESS
-- =========================================================

create or replace function public.user_can_view_club_credit(
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
            where membership.profile_id = auth.uid()
              and membership.club_id = p_club_id
              and membership.status = 'active'
              and membership.role in (
                    'reception',
                    'professional',
                    'manager',
                    'club_admin'
              )
        );
$$;

revoke all
on function public.user_can_view_club_credit(uuid)
from public, anon;

grant execute
on function public.user_can_view_club_credit(uuid)
to authenticated;

create or replace function public.user_can_manage_club_credit(
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
            where membership.profile_id = auth.uid()
              and membership.club_id = p_club_id
              and membership.status = 'active'
              and membership.role in (
                    'professional',
                    'manager',
                    'club_admin'
              )
        );
$$;

revoke all
on function public.user_can_manage_club_credit(uuid)
from public, anon;

grant execute
on function public.user_can_manage_club_credit(uuid)
to authenticated;

-- =========================================================
-- SUMMARY
-- =========================================================

create or replace function public.club_credit_get_summary(
    p_club_id uuid
)
returns table (
    members_with_credit bigint,
    total_balance numeric,
    month_credits numeric,
    month_debits numeric,
    currency_code text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_currency text;
    v_month_start timestamptz;
begin
    if auth.uid() is null
       or not public.user_can_view_club_credit(p_club_id) then
        raise exception 'Club Credit access required.';
    end if;

    select coalesce(settings.currency_code, 'GBP')
    into v_currency
    from public.club_settings as settings
    where settings.club_id = p_club_id
    limit 1;

    v_currency := coalesce(v_currency, 'GBP');
    v_month_start := date_trunc('month', now());

    return query
    select
        (
            select count(*)
            from public.club_member_accounts as account
            where account.club_id = p_club_id
              and account.is_active
              and account.balance > 0
        )::bigint,

        coalesce(
            (
                select sum(account.balance)
                from public.club_member_accounts as account
                where account.club_id = p_club_id
                  and account.is_active
            ),
            0
        )::numeric,

        coalesce(
            (
                select sum(transaction.amount)
                from public.club_member_account_transactions as transaction
                where transaction.club_id = p_club_id
                  and transaction.created_at >= v_month_start
                  and transaction.amount > 0
            ),
            0
        )::numeric,

        abs(
            coalesce(
                (
                    select sum(transaction.amount)
                    from public.club_member_account_transactions as transaction
                    where transaction.club_id = p_club_id
                      and transaction.created_at >= v_month_start
                      and transaction.amount < 0
                ),
                0
            )
        )::numeric,

        v_currency;
end;
$$;

revoke all
on function public.club_credit_get_summary(uuid)
from public, anon;

grant execute
on function public.club_credit_get_summary(uuid)
to authenticated;

-- =========================================================
-- SEARCH
-- =========================================================

create or replace function public.club_credit_search_members(
    p_club_id uuid,
    p_search text
)
returns table (
    membership_id uuid,
    profile_id uuid,
    display_name text,
    email text,
    membership_number text,
    membership_type text,
    balance numeric,
    currency_code text,
    transaction_count bigint,
    last_activity_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_search text;
    v_currency text;
begin
    if auth.uid() is null
       or not public.user_can_view_club_credit(p_club_id) then
        raise exception 'Club Credit access required.';
    end if;

    v_search :=
        nullif(
            lower(trim(coalesce(p_search, ''))),
            ''
        );

    if v_search is null then
        return;
    end if;

    select coalesce(settings.currency_code, 'GBP')
    into v_currency
    from public.club_settings as settings
    where settings.club_id = p_club_id
    limit 1;

    v_currency := coalesce(v_currency, 'GBP');

    return query
    select
        membership.id,
        membership.profile_id,
        coalesce(
            nullif(trim(profile.display_name), ''),
            nullif(
                trim(
                    concat_ws(
                        ' ',
                        profile.first_name,
                        profile.last_name
                    )
                ),
                ''
            ),
            profile.email,
            'Member'
        )::text,
        profile.email,
        membership.membership_number,
        membership.membership_type,
        coalesce(account.balance, 0)::numeric,
        coalesce(account.currency_code, v_currency)::text,
        (
            select count(*)
            from public.club_member_account_transactions as transaction
            where transaction.membership_id = membership.id
              and transaction.club_id = p_club_id
        )::bigint,
        (
            select max(transaction.created_at)
            from public.club_member_account_transactions as transaction
            where transaction.membership_id = membership.id
              and transaction.club_id = p_club_id
        )

    from public.club_memberships as membership

    join public.profiles as profile
        on profile.id = membership.profile_id

    left join public.club_member_accounts as account
        on account.club_id = p_club_id
       and account.membership_id = membership.id
       and account.is_active

    where membership.club_id = p_club_id
      and membership.status = 'active'
      and coalesce(
            membership.membership_type,
            'member'
          ) not in (
            'visitor',
            'guest',
            'staff'
          )
      and (
          lower(coalesce(profile.display_name, '')) like '%' || v_search || '%'
          or lower(coalesce(profile.first_name, '')) like '%' || v_search || '%'
          or lower(coalesce(profile.last_name, '')) like '%' || v_search || '%'
          or lower(coalesce(profile.email, '')) like '%' || v_search || '%'
          or lower(coalesce(membership.membership_number, '')) like '%' || v_search || '%'
      )

    order by
        lower(
            coalesce(
                profile.display_name,
                profile.last_name,
                profile.email,
                ''
            )
        )

    limit 100;
end;
$$;

revoke all
on function public.club_credit_search_members(uuid, text)
from public, anon;

grant execute
on function public.club_credit_search_members(uuid, text)
to authenticated;

-- =========================================================
-- STAFF HISTORY
-- =========================================================

create or replace function public.club_credit_get_transactions(
    p_club_id uuid,
    p_membership_id uuid,
    p_limit integer default 100
)
returns table (
    transaction_id uuid,
    transaction_type text,
    amount numeric,
    balance_before numeric,
    balance_after numeric,
    currency_code text,
    reference text,
    description text,
    club_event_id uuid,
    source text,
    created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null
       or not public.user_can_view_club_credit(p_club_id) then
        raise exception 'Club Credit access required.';
    end if;

    if not exists (
        select 1
        from public.club_memberships as membership
        where membership.id = p_membership_id
          and membership.club_id = p_club_id
    ) then
        raise exception 'Member account not found for selected club.';
    end if;

    return query
    select
        transaction.id,
        transaction.transaction_type,
        transaction.amount,
        transaction.balance_before,
        transaction.balance_after,
        transaction.currency_code,
        transaction.reference,
        transaction.description,
        transaction.club_event_id,
        transaction.source,
        transaction.created_at

    from public.club_member_account_transactions as transaction

    where transaction.club_id = p_club_id
      and transaction.membership_id = p_membership_id

    order by transaction.created_at desc

    limit greatest(
        1,
        least(coalesce(p_limit, 100), 500)
    );
end;
$$;

revoke all
on function public.club_credit_get_transactions(
    uuid,
    uuid,
    integer
)
from public, anon;

grant execute
on function public.club_credit_get_transactions(
    uuid,
    uuid,
    integer
)
to authenticated;

-- =========================================================
-- POST STAFF TRANSACTION
-- =========================================================

create or replace function public.club_credit_post_transaction(
    p_club_id uuid,
    p_membership_id uuid,
    p_transaction_type text,
    p_amount numeric,
    p_reference text default null,
    p_description text default null,
    p_direction text default null
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
    v_type text;
    v_direction text;
    v_amount numeric(12,2);
    v_balance_before numeric(12,2);
    v_balance_after numeric(12,2);
    v_currency text;
    v_account_id uuid;
    v_transaction_id uuid;
    v_source text;
begin
    if auth.uid() is null
       or not public.user_can_manage_club_credit(p_club_id) then
        raise exception 'Club Credit management access required.';
    end if;

    if not exists (
        select 1
        from public.club_memberships as membership
        where membership.id = p_membership_id
          and membership.club_id = p_club_id
          and membership.status = 'active'
          and coalesce(
                membership.membership_type,
                'member'
              ) not in (
                'visitor',
                'guest',
                'staff'
              )
    ) then
        raise exception 'An active genuine club membership is required.';
    end if;

    if p_amount is null or p_amount <= 0 then
        raise exception 'Amount must be greater than zero.';
    end if;

    v_type :=
        lower(trim(coalesce(p_transaction_type, '')));

    if v_type not in (
        'competition_prize',
        'manual_credit',
        'manual_debit',
        'refund',
        'adjustment'
    ) then
        raise exception 'Unsupported manual Club Credit transaction.';
    end if;

    v_direction :=
        lower(trim(coalesce(p_direction, '')));

    v_amount :=
        round(abs(p_amount)::numeric, 2);

    if v_type = 'manual_debit' then
        v_amount := -v_amount;
    elsif v_type = 'adjustment' then
        if v_direction = 'debit' then
            v_amount := -v_amount;
        elsif v_direction = 'credit' then
            v_amount := v_amount;
        else
            raise exception 'Adjustment direction must be credit or debit.';
        end if;
    end if;

    v_source :=
        case
            when v_type = 'competition_prize'
                then 'competition'
            else 'manual'
        end;

    select coalesce(settings.currency_code, 'GBP')
    into v_currency
    from public.club_settings as settings
    where settings.club_id = p_club_id
    limit 1;

    v_currency := coalesce(v_currency, 'GBP');

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
    on conflict (club_id, membership_id)
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
    where account.club_id = p_club_id
      and account.membership_id = p_membership_id
      and account.is_active
    for update;

    if v_account_id is null then
        raise exception 'Member Club Credit account is unavailable.';
    end if;

    v_balance_after :=
        v_balance_before + v_amount;

    if v_balance_after < 0 then
        raise exception
            'This debit exceeds the member''s available Club Credit.';
    end if;

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
        source,
        created_by
    )
    values (
        p_club_id,
        v_account_id,
        p_membership_id,
        v_type,
        v_amount,
        v_balance_before,
        v_balance_after,
        v_currency,
        nullif(trim(coalesce(p_reference, '')), ''),
        nullif(trim(coalesce(p_description, '')), ''),
        v_source,
        auth.uid()
    )
    returning id
    into v_transaction_id;

    return query
    select
        v_transaction_id,
        v_amount,
        v_balance_before,
        v_balance_after,
        v_currency;
end;
$$;

revoke all
on function public.club_credit_post_transaction(
    uuid,
    uuid,
    text,
    numeric,
    text,
    text,
    text
)
from public, anon;

grant execute
on function public.club_credit_post_transaction(
    uuid,
    uuid,
    text,
    numeric,
    text,
    text,
    text
)
to authenticated;

-- =========================================================
-- PLAYER BALANCES
-- =========================================================

create or replace function public.member_get_club_credit_accounts()
returns table (
    club_id uuid,
    club_name text,
    membership_id uuid,
    balance numeric,
    currency_code text,
    transaction_count bigint,
    last_activity_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null then
        raise exception 'Authentication required.';
    end if;

    return query
    select
        club.id,
        club.name,
        membership.id,
        coalesce(account.balance, 0)::numeric,
        coalesce(
            account.currency_code,
            settings.currency_code,
            'GBP'
        )::text,
        (
            select count(*)
            from public.club_member_account_transactions as transaction
            where transaction.club_id = club.id
              and transaction.membership_id = membership.id
        )::bigint,
        (
            select max(transaction.created_at)
            from public.club_member_account_transactions as transaction
            where transaction.club_id = club.id
              and transaction.membership_id = membership.id
        )

    from public.club_memberships as membership

    join public.clubs as club
        on club.id = membership.club_id

    left join public.club_settings as settings
        on settings.club_id = club.id

    left join public.club_member_accounts as account
        on account.club_id = club.id
       and account.membership_id = membership.id
       and account.is_active

    where membership.profile_id = auth.uid()
      and membership.status = 'active'
      and coalesce(
            membership.membership_type,
            'member'
          ) not in (
            'visitor',
            'guest',
            'staff'
          )
      and public.club_module_enabled(
            club.id,
            'member_credit'
          )

    order by lower(club.name);
end;
$$;

revoke all
on function public.member_get_club_credit_accounts()
from public, anon;

grant execute
on function public.member_get_club_credit_accounts()
to authenticated;

create or replace function public.member_get_club_credit_transactions(
    p_club_id uuid,
    p_limit integer default 50
)
returns table (
    transaction_id uuid,
    transaction_type text,
    amount numeric,
    balance_after numeric,
    currency_code text,
    reference text,
    description text,
    created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_membership_id uuid;
begin
    if auth.uid() is null then
        raise exception 'Authentication required.';
    end if;

    if not public.club_module_enabled(
        p_club_id,
        'member_credit'
    ) then
        raise exception
            'Club Credit is not enabled for this club.';
    end if;

    select membership.id
    into v_membership_id
    from public.club_memberships as membership
    where membership.profile_id = auth.uid()
      and membership.club_id = p_club_id
      and membership.status = 'active'
      and coalesce(
            membership.membership_type,
            'member'
          ) not in (
            'visitor',
            'guest',
            'staff'
          )
    limit 1;

    if v_membership_id is null then
        raise exception 'Active club membership required.';
    end if;

    return query
    select
        transaction.id,
        transaction.transaction_type,
        transaction.amount,
        transaction.balance_after,
        transaction.currency_code,
        transaction.reference,
        transaction.description,
        transaction.created_at

    from public.club_member_account_transactions as transaction

    where transaction.club_id = p_club_id
      and transaction.membership_id = v_membership_id

    order by transaction.created_at desc

    limit greatest(
        1,
        least(coalesce(p_limit, 50), 200)
    );
end;
$$;

revoke all
on function public.member_get_club_credit_transactions(
    uuid,
    integer
)
from public, anon;

grant execute
on function public.member_get_club_credit_transactions(
    uuid,
    integer
)
to authenticated;

commit;

notify pgrst, 'reload schema';
