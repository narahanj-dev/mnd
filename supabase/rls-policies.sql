-- 최종 보안 정책: 브라우저의 업무 테이블 직접 접근을 모두 차단합니다.
-- 프로필, 일정, 쪽지, 가입신청, 관리자 기능은 Next.js 서버 API에서 권한검사 후 service_role로 처리합니다.

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
alter table public.security_audit_logs enable row level security;
alter table public.security_rate_limits enable row level security;


revoke all on public.profiles from anon, authenticated;
revoke all on public.signup_requests from anon, authenticated;
revoke all on public.calendar_events from anon, authenticated;
revoke all on public.event_change_requests from anon, authenticated;
revoke all on public.messages from anon, authenticated;
revoke all on public.admin_settings from anon, authenticated;
revoke all on public.password_history from anon, authenticated;
revoke all on public.security_audit_logs from anon, authenticated;
revoke all on public.security_rate_limits from anon, authenticated;
