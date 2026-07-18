# 회원가입 승인 `{}` 오류 수정 적용법

## 원인
개인정보 암호화 최종화 SQL에서 `profiles.login_id_hash`가 필수값으로 변경되었지만,
기존 신규 사용자 생성 트리거가 해당 값을 `NULL`로 저장해 Auth 사용자 생성이 실패할 수 있었습니다.
브라우저에서는 오류 객체가 제대로 표시되지 않아 `{}`만 나타났습니다.

## 1. Supabase SQL 실행
Supabase → SQL Editor → New query에서 다음 파일 내용을 전체 실행합니다.

`supabase/migration_20260718_fix_signup_approval_trigger.sql`

성공 메시지가 나오면 완료입니다. 기존 사용자 데이터는 변경하거나 삭제하지 않습니다.

## 2. 소스 덮어쓰기
수정 압축파일의 전체 내용을 기존 프로젝트에 덮어씁니다.
기존 `.env.local`은 유지합니다.

## 3. 빌드 및 배포
```powershell
cd D:\leave-calendar
npm install
npm run build
git add .
git commit -m "회원가입 승인 오류 수정"
git push
```

## 4. 확인
가입 신청 화면에서 승인 버튼을 다시 누릅니다.
정상 처리되면 신청 항목이 목록에서 사라지고 사용자가 로그인할 수 있습니다.
실패하더라도 더 이상 `{}`가 아니라 실제 원인이 한국어 오류 메시지로 표시됩니다.

## 참고
승인 시 `PASSWORD_HISTORY_PEPPER 환경변수가 설정되지 않았습니다.`가 표시되면
Vercel 프로젝트의 Environment Variables에 해당 값을 추가한 뒤 재배포해야 합니다.
