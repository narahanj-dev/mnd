# 회원가입 승인 오류 최종 수정 적용법

이번 수정은 **Supabase SQL 실행과 소스 배포를 모두 해야 합니다.**

## 1. Supabase SQL 실행

Supabase 프로젝트에서 `SQL Editor` → `New query`로 이동한 뒤 아래 파일 내용을 전체 실행합니다.

```text
supabase/migration_20260718_disable_auth_profile_trigger.sql
```

이 SQL은 `auth.users`에 연결된 `on_auth_user_created` 트리거를 제거합니다. 기존 사용자와 가입신청 데이터는 삭제하지 않습니다.

## 2. 소스 덮어쓰기

압축파일의 전체 내용을 기존 프로젝트 폴더에 덮어씁니다.

```text
D:\leave-calendar
```

기존 `.env.local` 파일은 유지합니다.

## 3. 배포 전 확인

PowerShell에서 실행합니다.

```powershell
cd D:\leave-calendar
npm install
npm run build
git status
git add .
git commit -m "회원가입 승인 오류 최종 수정"
git push origin master
```

## 4. Vercel 배포 확인

Vercel의 `Deployments`에서 방금 올린 커밋이 `Ready`인지 확인합니다. 배포가 끝나면 사이트에서 `Ctrl + Shift + R`로 강력 새로고침합니다.

## 5. 승인 테스트

관리자 → 가입 신청 → 해당 부서 → 승인 순서로 진행합니다.

- 승인 성공 시 페이지 안에 `가입 승인이 완료되었습니다`가 표시됩니다.
- 실패 시 더 이상 `{}` 팝업이 뜨지 않고 실제 오류가 붉은 안내 상자에 표시됩니다.
- 과거 승인 실패 과정에서 Auth 계정만 남은 경우에도 동일 이메일 계정을 찾아 복구한 뒤 승인하도록 보완했습니다.

## 변경 파일

```text
app/api/admin/signup-requests/[id]/route.ts
components/admin/SignupRequestList.tsx
lib/utils.ts
supabase/schema.sql
supabase/migration_20260718_fix_signup_approval_trigger.sql
supabase/migration_20260718_disable_auth_profile_trigger.sql
```
