-- 부대달력 최종 서버 보안 통합 마이그레이션
-- 기존 운영 DB와 새 DB 모두 이 파일 하나만 최종 적용합니다.

create extension if not exists pg_cron;

begin;

alter table public.profiles
  add column if not exists session_version integer not null default 1,
  add column if not exists temporary_password_expires_at timestamptz;

-- 공개 회원가입 기능을 완전히 종료하고 과거 신청 데이터도 삭제합니다.
drop table if exists public.signup_requests cascade;

-- AES-GCM 암호문은 원문보다 길기 때문에 평문 길이 제약은 앱 입력검증으로 대체합니다.
alter table public.calendar_events drop constraint if exists calendar_events_title_check;
alter table public.event_change_requests drop constraint if exists event_change_requests_reason_check;
alter table public.event_change_requests drop constraint if exists event_change_requests_proposed_title_check;

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

create table if not exists public.security_rate_limits (
  key_hash text primary key,
  window_started_at timestamptz not null,
  attempts integer not null check (attempts >= 0),
  updated_at timestamptz not null default now()
);

create or replace function public.consume_security_rate_limit(
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns table(allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.security_rate_limits%rowtype;
  now_value timestamptz := clock_timestamp();
  elapsed_seconds integer;
begin
  if p_limit < 1 or p_window_seconds < 1 or char_length(p_key_hash) < 32 then
    raise exception 'invalid rate limit arguments';
  end if;

  insert into public.security_rate_limits(key_hash, window_started_at, attempts, updated_at)
  values (p_key_hash, now_value, 1, now_value)
  on conflict (key_hash) do update
  set
    window_started_at = case
      when public.security_rate_limits.window_started_at + make_interval(secs => p_window_seconds) <= now_value
        then now_value
      else public.security_rate_limits.window_started_at
    end,
    attempts = case
      when public.security_rate_limits.window_started_at + make_interval(secs => p_window_seconds) <= now_value
        then 1
      else public.security_rate_limits.attempts + 1
    end,
    updated_at = now_value
  returning * into current_row;

  elapsed_seconds := greatest(0, floor(extract(epoch from (now_value - current_row.window_started_at)))::integer);
  allowed := current_row.attempts <= p_limit;
  retry_after_seconds := greatest(1, p_window_seconds - elapsed_seconds);
  return next;
end;
$$;

revoke all on table public.security_rate_limits from anon, authenticated;
revoke all on function public.consume_security_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_security_rate_limit(text, integer, integer) to service_role;

create table if not exists public.security_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  target_user_id uuid,
  target_resource_id text,
  success boolean not null,
  ip_hash text not null,
  user_agent text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists security_audit_logs_actor_created_idx
  on public.security_audit_logs(actor_id, created_at desc);
create index if not exists security_audit_logs_action_created_idx
  on public.security_audit_logs(action, created_at desc);

alter table public.security_audit_logs enable row level security;
revoke all on table public.security_audit_logs from anon, authenticated;

-- 브라우저는 업무 테이블을 직접 읽거나 쓰지 않으며 모든 처리는 Next.js 서버 API를 통과합니다.
do $$
declare policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'profiles','calendar_events','event_change_requests',
        'messages','admin_settings','password_history','security_audit_logs','security_rate_limits'
      )
  loop
    execute format('drop policy if exists %I on %I.%I', policy_row.policyname, policy_row.schemaname, policy_row.tablename);
  end loop;
end $$;

alter table public.profiles enable row level security;
alter table public.calendar_events enable row level security;
alter table public.event_change_requests enable row level security;
alter table public.messages enable row level security;
alter table public.admin_settings enable row level security;
alter table public.password_history enable row level security;
alter table public.security_rate_limits enable row level security;

revoke all on public.profiles from anon, authenticated;
revoke all on public.calendar_events from anon, authenticated;
revoke all on public.event_change_requests from anon, authenticated;
revoke all on public.messages from anon, authenticated;
revoke all on public.admin_settings from anon, authenticated;
revoke all on public.password_history from anon, authenticated;

-- 기존 SECURITY DEFINER/트리거 함수는 브라우저 역할에서 직접 호출할 수 없게 합니다.
do $$
begin
  if to_regprocedure('public.delete_expired_unarchived_messages()') is not null then
    execute 'revoke all on function public.delete_expired_unarchived_messages() from public, anon, authenticated';
    execute 'grant execute on function public.delete_expired_unarchived_messages() to service_role';
  end if;
  if to_regprocedure('public.handle_new_user()') is not null then
    execute 'revoke all on function public.handle_new_user() from public, anon, authenticated';
  end if;
  if to_regprocedure('public.set_updated_at()') is not null then
    execute 'revoke all on function public.set_updated_at() from public, anon, authenticated';
  end if;
end $$;

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

  if event_row.user_id = p_actor_id then
    raise exception 'SELF_APPROVAL_FORBIDDEN' using errcode = '42501';
  end if;

  select * into target_row
  from public.profiles
  where id = event_row.user_id;
  if not found then
    return query select false, null::uuid;
    return;
  end if;

  if actor_row.role = 'department_admin'
     and (actor_row.department <> target_row.department or target_row.role <> 'user') then
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

  if event_row.user_id = p_actor_id or request_row.requester_id = p_actor_id then
    raise exception 'SELF_APPROVAL_FORBIDDEN' using errcode = '42501';
  end if;

  select * into target_row
  from public.profiles
  where id = event_row.user_id;
  if not found then
    return query select false, null::uuid, event_row.id;
    return;
  end if;

  if actor_row.role = 'department_admin'
     and (actor_row.department <> target_row.department or target_row.role <> 'user') then
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

-- 오래된 비보관 쪽지, 속도제한, 감사로그를 한 번에 정리합니다.
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

-- 매일 03:17(UTC)에 보안 보존기간 정리를 자동 실행합니다.
do $$
declare
  existing_job bigint;
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    select jobid into existing_job from cron.job where jobname = 'leave_calendar_security_cleanup' limit 1;
    if existing_job is not null then
      perform cron.unschedule(existing_job);
    end if;
    perform cron.schedule(
      'leave_calendar_security_cleanup',
      '17 3 * * *',
      'select public.cleanup_security_records();'
    );
  end if;
end $$;
