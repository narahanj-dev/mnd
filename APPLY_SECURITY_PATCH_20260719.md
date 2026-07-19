# 부대달력 보안 수정본 적용 순서

이 수정본은 공개 가입 잔여 코드 제거, 브라우저 Supabase 클라이언트 제거, 관리자 MFA 재인증, 데모 데이터 암호화·운영차단, 구형 Auth 이메일 제거, JSON 본문 크기 제한, React 패치 및 DB 평문 차단을 포함합니다.

## 1. 기존 파일 백업

현재 프로젝트 폴더를 별도 위치에 복사하고 Supabase DB 백업을 먼저 생성합니다.

## 2. 수정본 덮어쓰기

압축을 푼 뒤 기존 프로젝트 폴더에 전체 파일을 덮어씁니다. `.env.local` 파일은 수정본에 포함되어 있지 않으므로 기존 값을 유지합니다.

## 3. 패키지 재설치

PowerShell에서 프로젝트 폴더로 이동한 뒤 실행합니다.

```powershell
Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue
npm ci
```

React와 React DOM은 19.2.6으로 고정되어 있습니다.

## 4. 구형 Auth 이메일 전환

새 코드 배포 전에 반드시 실행합니다. 비밀번호나 사용자 데이터는 변경하지 않고 Supabase Auth 이메일만 해시 형식으로 전환합니다.

```powershell
npm run migrate-legacy-auth-emails
```

마지막에 `변경 n명, 기존 정상 n명`이 표시되는지 확인합니다.

## 5. 기존 평문 일정·쪽지 암호화

이미 실행한 적이 있더라도 재실행해도 암호문은 다시 암호화하지 않습니다.

```powershell
npm run migrate-content-encryption
```

## 6. Supabase 평문 저장 차단 SQL 실행

Supabase → SQL Editor → New query에서 다음 파일 전체를 붙여넣고 Run을 누릅니다.

```text
supabase/migration_20260719_encrypted_content_constraints.sql
```

이 SQL은 기존 평문이 남아 있으면 중단됩니다. 그 경우 5번 명령을 먼저 정상 완료해야 합니다.

## 7. 검사

```powershell
npm run security-check
```

환경변수가 없는 로컬 검사에서 빌드가 중단되면 최소한 다음 두 명령은 통과해야 합니다.

```powershell
npm run lint
node --test tests/security/*.test.mjs
```

## 8. GitHub 및 Vercel 배포

```powershell
git add .
git commit -m "Apply security hardening patch"
git push
```

Vercel 배포가 완료된 뒤 관리자 계정으로 로그인합니다. OTP가 아직 등록되지 않은 관리자는 현재 비밀번호를 한 번 더 입력한 뒤 QR 코드를 등록해야 합니다.

## 데모 데이터 명령

`npm run seed-demo`는 기본적으로 차단되어 있습니다. 실제 운영 프로젝트에서는 실행하지 마세요. 로컬 테스트 프로젝트에서만 다음 두 값을 설정해야 실행됩니다.

```env
ALLOW_DEMO_SEED=true
DEMO_SEED_ALLOWED_PROJECT_REF=Supabase프로젝트REF
```

운영환경에서는 `ALLOW_DEMO_SEED`를 설정하지 않거나 `false`로 유지합니다.
