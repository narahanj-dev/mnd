# 회원가입 연락처·이메일 항목 제거 적용법

## 1. 소스파일 덮어쓰기
수정된 압축파일의 내용을 기존 프로젝트 폴더에 덮어씁니다.
`.env.local`과 `.git` 폴더는 유지하세요.

## 2. Supabase SQL 실행
Supabase 대시보드 → SQL Editor → New query에서 아래 파일 내용을 실행합니다.

`supabase/migration_20260718_remove_signup_contact.sql`

실행되는 SQL:

```sql
alter table public.signup_requests
  drop column if exists contact;
```

이 작업은 회원가입 신청 테이블의 연락처 열을 삭제하므로 기존에 작성된 휴대폰번호·실제 이메일 기록도 함께 영구 삭제됩니다.

## 3. 검사 및 배포

```powershell
cd D:\leave-calendar
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm install
npm run lint
npm run build
git add .
git commit -m "회원가입 연락처 이메일 수집 제거"
git push
```

참고: 군번 로그인에 사용되는 `군번@leave-calendar.local` 형식의 내부 가상 이메일은 실제 사용자가 작성한 이메일이 아니며 Supabase 인증에 필요하므로 유지됩니다.
