-- PARYX PLATFORM
-- Migration 050: Single-course club mode + course setup refinement backend

begin;

alter table public.club_settings
    add column if not exists single_course_mode boolean not null default false;

create or replace function public.get_club_course_mode(p_club_id uuid)
returns table (
    single_course_mode boolean,
    default_course_id uuid,
    active_course_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null or p_club_id is null then
        raise exception 'Club access required.';
    end if;

    if not exists (
        select 1 from public.clubs c
        where c.id = p_club_id and c.is_active = true
    ) then
        raise exception 'Club not found.';
    end if;

    return query
    select
        coalesce(cs.single_course_mode, false),
        cs.default_course_id,
        count(c.id)::bigint
    from public.club_settings cs
    left join public.courses c
        on c.club_id = cs.club_id
       and c.is_active = true
    where cs.club_id = p_club_id
    group by cs.single_course_mode, cs.default_course_id;
end;
$$;

revoke all on function public.get_club_course_mode(uuid) from public, anon;
grant execute on function public.get_club_course_mode(uuid) to authenticated;

create or replace function public.admin_set_single_course_mode(
    p_club_id uuid,
    p_enabled boolean
)
returns table (
    single_course_mode boolean,
    default_course_id uuid,
    active_course_count bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_active_count bigint;
    v_only_course_id uuid;
begin
    if auth.uid() is null
       or p_club_id is null
       or not public.user_can_manage_club(p_club_id) then
        raise exception 'Club management access required.';
    end if;

    insert into public.club_settings (club_id)
    values (p_club_id)
    on conflict (club_id) do nothing;

    select count(*)
    into v_active_count
    from public.courses c
    where c.club_id = p_club_id
      and c.is_active = true;

    select c.id
    into v_only_course_id
    from public.courses c
    where c.club_id = p_club_id
      and c.is_active = true
    order by c.created_at, c.id
    limit 1;

    if coalesce(p_enabled, false) then
        if v_active_count <> 1 then
            raise exception 'Single-course mode requires exactly one active course. Deactivate extra courses or add the course first.';
        end if;

        update public.club_settings
        set single_course_mode = true,
            default_course_id = v_only_course_id,
            updated_at = now()
        where club_id = p_club_id;
    else
        update public.club_settings
        set single_course_mode = false,
            updated_at = now()
        where club_id = p_club_id;
    end if;

    return query
    select
        cs.single_course_mode,
        cs.default_course_id,
        v_active_count
    from public.club_settings cs
    where cs.club_id = p_club_id;
end;
$$;

revoke all on function public.admin_set_single_course_mode(uuid, boolean) from public, anon;
grant execute on function public.admin_set_single_course_mode(uuid, boolean) to authenticated;

create or replace function public.enforce_single_course_mode()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_single boolean;
    v_other_active bigint;
begin
    select coalesce(cs.single_course_mode, false)
    into v_single
    from public.club_settings cs
    where cs.club_id = new.club_id;

    if not coalesce(v_single, false) then
        return new;
    end if;

    if new.is_active = false then
        if tg_op = 'UPDATE' and old.is_active = true then
            raise exception 'Disable single-course mode before deactivating the club''s only active course.';
        end if;
        return new;
    end if;

    select count(*)
    into v_other_active
    from public.courses c
    where c.club_id = new.club_id
      and c.is_active = true
      and (tg_op = 'INSERT' or c.id <> new.id);

    if v_other_active > 0 then
        raise exception 'Single-course mode allows only one active course. Disable it before activating another course.';
    end if;

    return new;
end;
$$;

drop trigger if exists enforce_single_course_mode_trigger on public.courses;
create trigger enforce_single_course_mode_trigger
before insert or update of is_active, club_id
on public.courses
for each row
execute function public.enforce_single_course_mode();

commit;
notify pgrst, 'reload schema';
