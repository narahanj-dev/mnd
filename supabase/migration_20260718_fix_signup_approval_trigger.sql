-- 기존 회원가입 승인 트리거 수정 파일의 최종 대체본입니다.
-- 승인 API가 profiles 행을 직접 생성하므로 Auth 트리거를 제거합니다.

begin;

drop trigger if exists on_auth_user_created on auth.users;

comment on function public.handle_new_user() is
  '현재 앱에서는 회원가입 승인 API가 profiles 행을 직접 생성합니다. auth.users 자동 트리거는 사용하지 않습니다.';

commit;
