-- 회원가입 연락처/이메일 수집 중단 및 기존 작성 기록 영구 삭제
-- Supabase SQL Editor에서 한 번 실행하세요.

alter table public.signup_requests
  drop column if exists contact;
