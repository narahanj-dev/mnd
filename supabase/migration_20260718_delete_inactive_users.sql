-- 기존 비활성 사용자 영구 삭제
-- 실행 결과: account_status = 'inactive'인 인증 계정, 프로필 및 관련 기록이 모두 삭제됩니다.
-- 주의: 삭제 후 복구할 수 없습니다.

alter table public.signup_requests
  add column if not exists approved_user_id uuid;

do $$
declare
  target_user record;
begin
  for target_user in
    select id, login_id
    from public.profiles
    where account_status = 'inactive'
  loop
    -- 다른 사용자 기록에서 처리자 또는 승인자로만 남아 있는 값은 NULL 처리합니다.
    update public.signup_requests
    set processed_by = null
    where processed_by = target_user.id;

    update public.calendar_events
    set approved_by = null
    where approved_by = target_user.id;

    update public.event_change_requests
    set processed_by = null
    where processed_by = target_user.id;

    -- 비활성 사용자가 등록한 일정과 직접 연결된 기록을 먼저 삭제합니다.
    delete from public.messages
    where related_event_id in (
      select id from public.calendar_events where user_id = target_user.id
    );

    delete from public.event_change_requests
    where event_id in (
      select id from public.calendar_events where user_id = target_user.id
    );

    -- 비활성 사용자가 보내거나 받은 기록 및 직접 생성한 요청을 삭제합니다.
    delete from public.messages
    where sender_id = target_user.id or recipient_id = target_user.id;

    delete from public.event_change_requests
    where requester_id = target_user.id;

    delete from public.calendar_events
    where user_id = target_user.id;

    delete from public.admin_settings
    where admin_user_id = target_user.id;

    delete from public.signup_requests
    where approved_user_id = target_user.id
       or (status = 'approved' and requested_login_id = target_user.login_id);

    -- 인증 사용자를 삭제하면 정상 프로필은 연쇄 삭제됩니다.
    delete from auth.users where id = target_user.id;

    -- 인증 계정 없이 프로필만 남아 있던 예외 데이터도 정리합니다.
    delete from public.profiles where id = target_user.id;
  end loop;
end
$$;
