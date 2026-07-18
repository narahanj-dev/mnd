-- scripts/migrate-sensitive-data.mjs가 정상 완료된 뒤 실행하세요.
do $$
begin
  if exists (select 1 from public.profiles where login_id_hash is null) then
    raise exception 'login_id_hash가 없는 프로필이 있습니다. 개인정보 마이그레이션 스크립트를 먼저 실행하세요.';
  end if;
  if exists (select 1 from public.profiles where login_id not like 'enc:v1:%' or display_name not like 'enc:v1:%') then
    raise exception '아직 평문 개인정보가 남아 있습니다. 개인정보 마이그레이션 스크립트를 다시 실행하세요.';
  end if;
  if exists (select 1 from public.signup_requests where requested_login_id_hash is null or birth_month_day is null) then
    raise exception '가입신청 암호화 데이터가 완성되지 않았습니다.';
  end if;
end $$;

alter table public.profiles alter column login_id_hash set not null;
alter table public.signup_requests alter column requested_login_id_hash set not null;
alter table public.signup_requests alter column birth_month_day set not null;
alter table public.profiles drop column if exists birth_date;
alter table public.signup_requests drop column if exists birth_date;

-- 기존 SQL 중 평문 아이디 비교를 전제로 한 인덱스/제약은 사용하지 않습니다.
