-- Stage 4B: ClubHub manages Hotel Mode policy and role permissions.
-- Console can enable/disable only. Requires migrations 055-059.
-- This migration preserves all existing policy values and allocation rows.
begin;

-- Console reads the state of its toggle alone.
create or replace function public.platform_hotel_mode_get(p_club_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_enabled boolean;
begin
 if auth.uid() is null or not public.is_platform_user(array['platform_owner','platform_admin','platform_support'])
 then raise exception 'Paryx Console access required.'; end if;
 select enabled into v_enabled from public.hotel_mode_settings where club_id=p_club_id;
 if not found then raise exception 'Hotel Mode settings not found.'; end if;
 return jsonb_build_object('config',jsonb_build_object('enabled',v_enabled));
end; $$;
revoke all on function public.platform_hotel_mode_get(uuid) from public,anon;
grant execute on function public.platform_hotel_mode_get(uuid) to authenticated;

-- The existing Console wrapper still uses this signature. Reject older Console
-- clients passing policy or permissions, rather than silently overwriting ClubHub.
create or replace function public.platform_hotel_mode_save(p_club_id uuid,p_config jsonb,p_permissions jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_before boolean;v_after boolean;v_actor text;
begin
 if auth.uid() is null or p_club_id is null
    or not public.is_platform_user(array['platform_owner','platform_admin'])
 then raise exception 'Paryx Console Admin/Owner required.'; end if;
 if p_config is null or jsonb_typeof(p_config)<>'object'
    or not (p_config ? 'enabled') or jsonb_typeof(p_config->'enabled')<>'boolean'
    or (p_config - 'enabled')<>'{}'::jsonb
    or p_permissions is null or p_permissions<>'{}'::jsonb
 then raise exception 'Console may only enable or disable Hotel Mode. Use ClubHub Settings for allocations and permissions.'; end if;
 v_after=(p_config->>'enabled')::boolean;
 select enabled into v_before from public.hotel_mode_settings where club_id=p_club_id for update;
 if not found then raise exception 'Hotel Mode settings not found.'; end if;
 update public.hotel_mode_settings set enabled=v_after,updated_at=now() where club_id=p_club_id;
 select role into v_actor from public.platform_users where user_id=auth.uid() and is_active limit 1;
 if v_before is distinct from v_after then
   insert into public.platform_audit_log(actor_user_id,actor_role,action,club_id,details)
   values(auth.uid(),v_actor,'hotel_mode_activation_changed',p_club_id,
   jsonb_build_object('previous',v_before,'enabled',v_after));
 end if;
 return true;
end; $$;
revoke all on function public.platform_hotel_mode_save(uuid,jsonb,jsonb) from public,anon;
grant execute on function public.platform_hotel_mode_save(uuid,jsonb,jsonb) to authenticated;

-- Note: platform_update_club_configuration_hotel() from 055 delegates to
-- platform_hotel_mode_save() above and is therefore also toggle-only.

create or replace function public.club_hotel_mode_get(p_club_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_config jsonb;v_rules jsonb;v_courses jsonb;v_perms jsonb;
begin
 if auth.uid() is null or p_club_id is null or not public.user_can_manage_club(p_club_id)
 then raise exception 'Club Manager/Admin access required.'; end if;
 select jsonb_build_object(
  'enabled',s.enabled,'allocation_mode',s.allocation_mode,
  'hotel_booking_days',s.hotel_booking_days,'society_booking_days',s.society_booking_days,
  'member_booking_days',s.member_booking_days,'visitor_booking_days',s.visitor_booking_days,
  'hotel_allocation_percent',s.hotel_allocation_percent,'member_allocation_percent',s.member_allocation_percent,
  'hotel_release_days',s.hotel_release_days,'member_release_days',s.member_release_days
 ) into v_config from public.hotel_mode_settings s where s.club_id=p_club_id;
 if not found then raise exception 'Hotel Mode settings not found.'; end if;
 select coalesce(jsonb_agg(jsonb_build_object(
   'course_id',r.course_id,'weekday',r.weekday,'specific_date',r.specific_date,
   'start_time',to_char(r.start_time,'HH24:MI'),'end_time',to_char(r.end_time,'HH24:MI'),
   'allocation',r.allocation
 ) order by r.specific_date nulls last,r.weekday nulls last,r.start_time),'[]'::jsonb)
 into v_rules from public.hotel_mode_time_allocations r where r.club_id=p_club_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name)
   order by c.name),'[]'::jsonb) into v_courses
 from public.courses c where c.club_id=p_club_id and c.is_active;
 select coalesce(jsonb_object_agg(r.staff_role,jsonb_build_object(
   'can_manage_hotel',r.can_manage_hotel,'can_manage_societies',r.can_manage_societies,
   'can_override',r.can_override
 )),'{}'::jsonb) into v_perms from public.hotel_mode_role_permissions r where r.club_id=p_club_id;
 return jsonb_build_object('config',v_config||jsonb_build_object('allocation_rules',v_rules),
   'courses',v_courses,'permissions',v_perms);
end; $$;
revoke all on function public.club_hotel_mode_get(uuid) from public,anon;
grant execute on function public.club_hotel_mode_get(uuid) to authenticated;

-- Booking policy can be changed by club managers and admins. No 'enabled' field
-- is accepted, and the owning club is inferred from the authenticated membership.
create or replace function public.club_hotel_mode_save_policy(p_club_id uuid,p_config jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_allowed text[]:=array[
  'allocation_mode','allocation_rules','hotel_booking_days','society_booking_days',
  'member_booking_days','visitor_booking_days','hotel_allocation_percent',
  'member_allocation_percent','hotel_release_days','member_release_days'
];v_prev jsonb;v_rule jsonb;v_actor text;
begin
 if auth.uid() is null or p_club_id is null or not public.user_can_manage_club(p_club_id)
 then raise exception 'Club Manager/Admin access required.'; end if;
 if p_config is null or jsonb_typeof(p_config)<>'object'
    or not (p_config ?& v_allowed)
    or exists(select 1 from jsonb_object_keys(p_config) as k(key) where k.key <> all(v_allowed))
 then raise exception 'Complete booking policy required; activation can only change in Console.'; end if;
 if (p_config->>'allocation_mode') not in ('percentage','time_bands')
 then raise exception 'Invalid allocation mode.'; end if;
 if jsonb_typeof(p_config->'allocation_rules')<>'array'
 then raise exception 'Allocation rules must be an array.'; end if;
 if jsonb_array_length(p_config->'allocation_rules')>200
 then raise exception 'Maximum 200 allocation rules.'; end if;
 perform 1 from public.hotel_mode_settings where club_id=p_club_id and enabled for update;
 if not found then raise exception 'Hotel Mode must first be enabled in Console.'; end if;
 select public.club_hotel_mode_get(p_club_id)->'config' into v_prev;
 update public.hotel_mode_settings set
  allocation_mode=p_config->>'allocation_mode',
  hotel_booking_days=(p_config->>'hotel_booking_days')::integer,
  society_booking_days=(p_config->>'society_booking_days')::integer,
  member_booking_days=(p_config->>'member_booking_days')::integer,
  visitor_booking_days=(p_config->>'visitor_booking_days')::integer,
  hotel_allocation_percent=(p_config->>'hotel_allocation_percent')::integer,
  member_allocation_percent=(p_config->>'member_allocation_percent')::integer,
  hotel_release_days=(p_config->>'hotel_release_days')::integer,
  member_release_days=(p_config->>'member_release_days')::integer,
  updated_at=now()
 where club_id=p_club_id;
 -- Preserve the saved timetable in percentage mode. Updates are atomic; the
 -- Stage 4 overlap trigger validates each inserted rule against its peers.
 delete from public.hotel_mode_time_allocations where club_id=p_club_id;
 for v_rule in select value from jsonb_array_elements(p_config->'allocation_rules') loop
  if jsonb_typeof(v_rule)<>'object'
     or not (v_rule ?& array['start_time','end_time','allocation'])
     or v_rule->>'allocation' not in ('hotel','member','general')
  then raise exception 'Invalid time allocation.'; end if;
  insert into public.hotel_mode_time_allocations(
    club_id,course_id,weekday,specific_date,start_time,end_time,allocation
  ) values(p_club_id,nullif(v_rule->>'course_id','')::uuid,
    (v_rule->>'weekday')::integer,nullif(v_rule->>'specific_date','')::date,
    (v_rule->>'start_time')::time,(v_rule->>'end_time')::time,v_rule->>'allocation');
 end loop;
 select cm.role into v_actor from public.club_memberships cm
 where cm.profile_id=auth.uid() and cm.club_id=p_club_id and cm.status='active'
 and cm.role in ('manager','club_admin')
 order by (cm.role='club_admin') desc limit 1;
 insert into public.platform_audit_log(actor_user_id,actor_role,action,club_id,details)
 values(auth.uid(),v_actor,'hotel_mode_policy_updated',p_club_id,
   jsonb_build_object('previous',v_prev,'new',public.club_hotel_mode_get(p_club_id)->'config'));
 return true;
end; $$;
revoke all on function public.club_hotel_mode_save_policy(uuid,jsonb) from public,anon;
grant execute on function public.club_hotel_mode_save_policy(uuid,jsonb) to authenticated;

-- Staff role permissions are a club-admin-only operation, separate from policy.
create or replace function public.club_hotel_mode_save_permissions(p_club_id uuid,p_permissions jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_role text;v_access jsonb;v_old jsonb;v_h boolean;v_s boolean;v_o boolean;
begin
 if auth.uid() is null or p_club_id is null or not exists (
  select 1 from public.club_memberships cm
  join public.clubs c on c.id=cm.club_id and c.is_active
  join public.hotel_mode_settings hs on hs.club_id=c.id and hs.enabled
  where cm.club_id=p_club_id and cm.profile_id=auth.uid()
    and cm.status='active' and cm.role='club_admin'
 ) then raise exception 'Club Admin and enabled Hotel Mode required.'; end if;
 if p_permissions is null or jsonb_typeof(p_permissions)<>'object'
  or (select count(*) from jsonb_object_keys(p_permissions))<>6
 then raise exception 'All six staff role settings are required.'; end if;
 perform 1 from public.hotel_mode_settings where club_id=p_club_id and enabled for update;
 if not found then raise exception 'Hotel Mode was disabled while saving.'; end if;
 select coalesce(jsonb_object_agg(r.staff_role,jsonb_build_object(
   'can_manage_hotel',r.can_manage_hotel,'can_manage_societies',r.can_manage_societies,
   'can_override',r.can_override
 )),'{}'::jsonb) into v_old
 from public.hotel_mode_role_permissions r where r.club_id=p_club_id;
 foreach v_role in array array['starter','reception','professional','greenkeeper','manager','club_admin'] loop
  v_access=p_permissions->v_role;
  if v_access is null or jsonb_typeof(v_access)<>'object'
    or not (v_access ?& array['can_manage_hotel','can_manage_societies','can_override'])
    or (select count(*) from jsonb_object_keys(v_access))<>3
    or jsonb_typeof(v_access->'can_manage_hotel')<>'boolean'
    or jsonb_typeof(v_access->'can_manage_societies')<>'boolean'
    or jsonb_typeof(v_access->'can_override')<>'boolean'
  then raise exception 'Incomplete permissions for %.',v_role; end if;
  v_h=(v_access->>'can_manage_hotel')::boolean;
  v_s=(v_access->>'can_manage_societies')::boolean;
  v_o=(v_access->>'can_override')::boolean;
  if v_o and not (v_h or v_s) then
   raise exception 'Override requires Hotel or Society access for %.',v_role;
  end if;
  insert into public.hotel_mode_role_permissions(
   club_id,staff_role,can_manage_hotel,can_manage_societies,can_override,updated_at
  ) values(p_club_id,v_role,v_h,v_s,v_o,now())
  on conflict(club_id,staff_role) do update set
   can_manage_hotel=excluded.can_manage_hotel,
   can_manage_societies=excluded.can_manage_societies,
   can_override=excluded.can_override,updated_at=now();
 end loop;
 insert into public.platform_audit_log(actor_user_id,actor_role,action,club_id,details)
 values(auth.uid(),'club_admin','hotel_mode_permissions_updated',p_club_id,
  jsonb_build_object('previous',v_old,'new',p_permissions));
 return true;
end; $$;
revoke all on function public.club_hotel_mode_save_permissions(uuid,jsonb) from public,anon;
grant execute on function public.club_hotel_mode_save_permissions(uuid,jsonb) to authenticated;
commit;
