-- 개인정보 암호화 저장 및 비밀번호 보안정책 준비 마이그레이션
-- 이 SQL 실행 후 scripts/migrate-sensitive-data.mjs를 실행하세요.

create extension if not exists pgcrypto;

-- 기존 평문 아이디 컬럼에는 AES-GCM 암호문이 저장되므로 평문 전용 제약을 제거합니다.
alter table public.profiles drop constraint if exists profiles_login_id_check;
alter table public.profiles drop constraint if exists profiles_login_id_key;
alter table public.profiles drop constraint if exists profiles_display_name_check;

alter table public.profiles
  add column if not exists login_id_hash text,
  add column if not exists birth_month_day text,
  add column if not exists password_changed_at timestamptz;

create unique index if not exists profiles_login_id_hash_unique_idx
  on public.profiles(login_id_hash)
  where login_id_hash is not null;

alter table public.signup_requests
  alter column birth_date drop not null;

alter table public.signup_requests
  add column if not exists requested_login_id_hash text,
  add column if not exists birth_month_day text;

create index if not exists signup_requests_login_id_hash_idx
  on public.signup_requests(requested_login_id_hash);

create table if not exists public.password_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  password_fingerprint text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists password_history_user_fingerprint_idx
  on public.password_history(user_id, password_fingerprint);
create index if not exists password_history_user_created_idx
  on public.password_history(user_id, created_at desc);

alter table public.password_history enable row level security;
revoke all on public.password_history from anon, authenticated;

-- Auth 메타데이터에 개인정보를 복사하지 않고, 앱 서버가 암호화 프로필을 upsert하도록 변경합니다.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (
    id, login_id, login_id_hash, display_name, department, role,
    account_status, must_change_password, birth_month_day, password_changed_at
  ) values (
    new.id,
    'pending:' || new.id::text,
    encode(digest(new.id::text, 'sha256'), 'hex'),
    'pending',
    '미지정',
    coalesce((new.raw_app_meta_data->>'role')::public.user_role, 'user'),
    'active',
    true,
    null,
    null
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- 앱 전환 중에는 과거 birth_date 컬럼을 유지합니다.
-- migrate-sensitive-data 실행 후 아래 최종화 SQL을 실행하면 연도 데이터 컬럼이 제거됩니다.
