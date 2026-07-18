-- 회원가입 시 신청자가 비밀번호를 설정할 수 있도록 하는 DB 변경
-- 비밀번호는 앱 서버에서 AES-256-GCM으로 암호화된 뒤 이 컬럼에 임시 저장됩니다.
-- 승인 또는 거절 시 가입신청 행이 삭제되므로 함께 삭제됩니다.

alter table public.signup_requests
  add column if not exists requested_password text;

comment on column public.signup_requests.requested_password is
  '회원가입 승인 전까지만 보관되는 AES-256-GCM 암호문. 승인/거절 시 가입신청 행과 함께 삭제';
