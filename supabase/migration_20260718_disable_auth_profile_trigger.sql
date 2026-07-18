-- 회원가입 승인 안정화
-- 앱의 승인 API가 Auth 사용자 생성 직후 profiles 행을 직접 생성하므로,
-- auth.users INSERT 트리거가 중간에 실패해 전체 계정 생성을 막지 않도록 비활성화합니다.

begin;

drop trigger if exists on_auth_user_created on auth.users;

comment on function public.handle_new_user() is
  '현재 앱에서는 회원가입 승인 API가 profiles 행을 직접 생성합니다. auth.users 자동 트리거는 사용하지 않습니다.';

commit;
