-- MEMBER CLUB CREDIT V1 — READ-ONLY VERIFICATION

select
    club.name,
    module.module_key,
    module.is_enabled
from public.clubs as club
join public.club_modules as module
    on module.club_id = club.id
where module.module_key = 'member_credit'
order by lower(club.name);

select
    club.name,
    count(account.id) as account_count,
    coalesce(sum(account.balance), 0) as total_credit
from public.clubs as club
left join public.club_member_accounts as account
    on account.club_id = club.id
   and account.is_active
group by club.id, club.name
order by lower(club.name);

select
    club.name,
    transaction.transaction_type,
    count(*) as transaction_count,
    coalesce(sum(transaction.amount), 0) as net_amount
from public.club_member_account_transactions as transaction
join public.clubs as club
    on club.id = transaction.club_id
group by
    club.id,
    club.name,
    transaction.transaction_type
order by
    lower(club.name),
    transaction.transaction_type;
