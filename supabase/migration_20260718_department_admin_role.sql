-- 기존 Supabase 프로젝트에 부서관리자 권한을 추가합니다.
-- 배포 전에 Supabase SQL Editor에서 한 번 실행하세요.

alter type public.user_role
add value if not exists 'department_admin' after 'user';
