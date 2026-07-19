-- 부대달력 서버 보안 강화 통합 마이그레이션
-- 기존 보안/기능 마이그레이션을 모두 적용한 뒤 실행하세요.

begin;

alter table public.profiles
  add column if not exists session_version integer not null default 1,
  add column if not exists temporary_password_expires_at timestamptz;

alter table public.signup_requests
  add column if not exists auth_user_id uuid references public.profiles(id) on delete cascade;

create unique index if not exists signup_requests_auth_user_unique_idx
  on public.signup_requests(auth_user_id)
  where auth_user_id is not null;

-- 새 가입 흐름은 비밀번호를 Supabase Auth에만 전달하며 앱 DB에는 저장하지 않습니다.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'signup_requests' and column_name = 'requested_password'
  ) then
    alter table public.signup_requests alter column requested_password drop not null;
    alter table public.signup_requests drop column requested_password;
  end if;
end $$;

-- AES-GCM 암호문은 원문보다 길기 때문에 평문 길이 제약은 앱 입력검증으로 대체합니다.
alter table public.event_change_requests drop constraint if exists event_change_requests_reason_check;
alter table public.event_change_requests drop constraint if exists event_change_requests_proposed_title_check;

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

-- 기존 직접 Data API 정책을 모두 제거합니다. 브라우저는 업무 테이블을 직접 읽거나 쓰지 않으며,
-- 모든 업무 데이터 조회·변경은 권한검사를 수행하는 Next.js 서버 API를 통과합니다.
do $$
declare policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'profiles','signup_requests','calendar_events','event_change_requests',
        'messages','admin_settings','password_history','security_audit_logs','security_rate_limits'
      )
  loop
    execute format('drop policy if exists %I on %I.%I', policy_row.policyname, policy_row.schemaname, policy_row.tablename);
  end loop;
end $$;

alter table public.profiles enable row level security;
alter table public.signup_requests enable row level security;
alter table public.calendar_events enable row level security;
alter table public.event_change_requests enable row level security;
alter table public.messages enable row level security;
alter table public.admin_settings enable row level security;
alter table public.password_history enable row level security;
alter table public.security_rate_limits enable row level security;


revoke all on public.profiles from anon, authenticated;
revoke all on public.signup_requests from anon, authenticated;
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

-- 오래된 rate-limit 행 정리. service_role 또는 DB 스케줄러에서 호출합니다.
create or replace function public.cleanup_security_rate_limits()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare removed bigint;
begin
  delete from public.security_rate_limits where updated_at < now() - interval '2 days';
  get diagnostics removed = row_count;
  return removed;
end;
$$;
revoke all on function public.cleanup_security_rate_limits() from public, anon, authenticated;
grant execute on function public.cleanup_security_rate_limits() to service_role;

commit;
