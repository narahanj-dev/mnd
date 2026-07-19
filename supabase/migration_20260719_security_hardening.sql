-- 부대달력 추가 보안 강화
-- migration_20260719_full_server_security.sql 실행 후 적용하세요.

begin;

-- 새 일정/변경 요청은 최대 366일까지만 허용합니다.
alter table public.calendar_events
  drop constraint if exists calendar_events_max_duration_check;
alter table public.calendar_events
  add constraint calendar_events_max_duration_check
  check (end_date <= start_date + 365) not valid;

alter table public.event_change_requests
  drop constraint if exists event_change_requests_max_duration_check;
alter table public.event_change_requests
  add constraint event_change_requests_max_duration_check
  check (
    request_type = 'delete'
    or proposed_end_date <= proposed_start_date + 365
  ) not valid;

-- 한 일정에 동시에 둘 이상의 대기 요청이 생기는 경쟁 조건을 DB에서 차단합니다.
create unique index if not exists event_change_requests_one_pending_per_event_idx
  on public.event_change_requests(event_id)
  where status = 'pending';

create or replace function public.decide_calendar_event_atomic(
  p_event_id uuid,
  p_actor_id uuid,
  p_decision text,
  p_rejection_reason text,
  p_message_title text,
  p_message_content text,
  p_message_type text,
  p_audit_action text,
  p_ip_hash text,
  p_user_agent text
)
returns table(processed boolean, target_user_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_row public.profiles%rowtype;
  target_row public.profiles%rowtype;
  event_row public.calendar_events%rowtype;
begin
  if p_decision not in ('approve', 'reject') then
    raise exception 'INVALID_DECISION' using errcode = '22023';
  end if;

  select * into actor_row
  from public.profiles
  where id = p_actor_id and account_status = 'active';
  if not found or actor_row.role not in ('admin', 'department_admin') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select * into event_row
  from public.calendar_events
  where id = p_event_id
  for update;
  if not found then
    return query select false, null::uuid;
    return;
  end if;

  select * into target_row
  from public.profiles
  where id = event_row.user_id;
  if not found then
    return query select false, null::uuid;
    return;
  end if;

  if actor_row.role = 'department_admin'
     and (actor_row.department <> target_row.department or target_row.role = 'admin') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if event_row.status <> 'pending' then
    return query select false, event_row.user_id;
    return;
  end if;

  update public.calendar_events
  set
    status = case when p_decision = 'approve' then 'approved'::public.event_status else 'rejected'::public.event_status end,
    rejection_reason = case when p_decision = 'approve' then null else p_rejection_reason end,
    approved_by = p_actor_id,
    approved_at = now(),
    updated_at = now()
  where id = p_event_id;

  insert into public.messages(
    sender_id, recipient_id, related_event_id, title, content, message_type
  ) values (
    p_actor_id, event_row.user_id, event_row.id,
    p_message_title, p_message_content, p_message_type
  );

  insert into public.security_audit_logs(
    actor_id, action, target_user_id, target_resource_id,
    success, ip_hash, user_agent, metadata
  ) values (
    p_actor_id, p_audit_action, event_row.user_id, p_event_id::text,
    true, p_ip_hash, left(p_user_agent, 500), '{}'::jsonb
  );

  return query select true, event_row.user_id;
end;
$$;

revoke all on function public.decide_calendar_event_atomic(
  uuid, uuid, text, text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.decide_calendar_event_atomic(
  uuid, uuid, text, text, text, text, text, text, text, text
) to service_role;

create or replace function public.decide_event_change_atomic(
  p_request_id uuid,
  p_actor_id uuid,
  p_decision text,
  p_rejection_reason text,
  p_event_type public.event_type,
  p_title text,
  p_start_date date,
  p_end_date date,
  p_all_day boolean,
  p_start_time time,
  p_end_time time,
  p_description text,
  p_public_note text,
  p_admin_note text,
  p_message_title text,
  p_message_content text,
  p_message_type text,
  p_audit_action text,
  p_ip_hash text,
  p_user_agent text
)
returns table(processed boolean, target_user_id uuid, event_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_row public.profiles%rowtype;
  target_row public.profiles%rowtype;
  request_row public.event_change_requests%rowtype;
  event_row public.calendar_events%rowtype;
begin
  if p_decision not in ('approve', 'reject') then
    raise exception 'INVALID_DECISION' using errcode = '22023';
  end if;

  select * into actor_row
  from public.profiles
  where id = p_actor_id and account_status = 'active';
  if not found or actor_row.role not in ('admin', 'department_admin') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select * into request_row
  from public.event_change_requests
  where id = p_request_id
  for update;
  if not found then
    return query select false, null::uuid, null::uuid;
    return;
  end if;

  select * into event_row
  from public.calendar_events
  where id = request_row.event_id
  for update;
  if not found then
    return query select false, null::uuid, request_row.event_id;
    return;
  end if;

  select * into target_row
  from public.profiles
  where id = event_row.user_id;
  if not found then
    return query select false, null::uuid, event_row.id;
    return;
  end if;

  if actor_row.role = 'department_admin'
     and (actor_row.department <> target_row.department or target_row.role = 'admin') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if request_row.status <> 'pending' then
    return query select false, event_row.user_id, event_row.id;
    return;
  end if;

  if p_decision = 'approve' then
    if event_row.status <> 'approved' then
      return query select false, event_row.user_id, event_row.id;
      return;
    end if;

    if request_row.request_type = 'delete' then
      update public.calendar_events
      set status = 'cancelled', updated_at = now()
      where id = event_row.id;
    else
      if p_event_type is null or p_title is null or p_start_date is null or p_end_date is null or p_all_day is null then
        raise exception 'MISSING_EVENT_UPDATE' using errcode = '22023';
      end if;
      update public.calendar_events
      set
        event_type = p_event_type,
        title = p_title,
        start_date = p_start_date,
        end_date = p_end_date,
        all_day = p_all_day,
        start_time = case when p_all_day then null else p_start_time end,
        end_time = case when p_all_day then null else p_end_time end,
        description = p_description,
        public_note = p_public_note,
        admin_note = p_admin_note,
        updated_at = now()
      where id = event_row.id;
    end if;
  end if;

  update public.event_change_requests
  set
    status = case when p_decision = 'approve' then 'approved'::public.request_status else 'rejected'::public.request_status end,
    rejection_reason = case when p_decision = 'approve' then null else p_rejection_reason end,
    processed_by = p_actor_id,
    processed_at = now()
  where id = request_row.id;

  insert into public.messages(
    sender_id, recipient_id, related_event_id, title, content, message_type
  ) values (
    p_actor_id, request_row.requester_id, event_row.id,
    p_message_title, p_message_content, p_message_type
  );

  insert into public.security_audit_logs(
    actor_id, action, target_user_id, target_resource_id,
    success, ip_hash, user_agent, metadata
  ) values (
    p_actor_id, p_audit_action, request_row.requester_id, request_row.id::text,
    true, p_ip_hash, left(p_user_agent, 500), jsonb_build_object('event_id', event_row.id)
  );

  return query select true, request_row.requester_id, event_row.id;
end;
$$;

revoke all on function public.decide_event_change_atomic(
  uuid, uuid, text, text, public.event_type, text, date, date, boolean, time, time,
  text, text, text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.decide_event_change_atomic(
  uuid, uuid, text, text, public.event_type, text, date, date, boolean, time, time,
  text, text, text, text, text, text, text, text, text
) to service_role;

-- 오래된 비보관 쪽지, rate-limit, 감사 로그를 한 번에 정리합니다.
create or replace function public.cleanup_security_records()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  message_count bigint;
  rate_limit_count bigint;
  audit_count bigint;
begin
  delete from public.messages
  where is_archived = false and created_at < now() - interval '15 days';
  get diagnostics message_count = row_count;

  delete from public.security_rate_limits
  where updated_at < now() - interval '2 days';
  get diagnostics rate_limit_count = row_count;

  delete from public.security_audit_logs
  where created_at < now() - interval '1 year';
  get diagnostics audit_count = row_count;

  return jsonb_build_object(
    'messages', message_count,
    'rate_limits', rate_limit_count,
    'audit_logs', audit_count
  );
end;
$$;

revoke all on function public.cleanup_security_records() from public, anon, authenticated;
grant execute on function public.cleanup_security_records() to service_role;

commit;
