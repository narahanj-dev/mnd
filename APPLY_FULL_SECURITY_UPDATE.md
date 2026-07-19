# 부대달력 전체 보안강화 적용방법

## 중요

이 업데이트는 코드만 덮어쓰는 업데이트가 아닙니다. 보안용 테이블·함수·RLS 정책을 먼저 적용해야 합니다. SQL 적용과 코드 배포 사이에는 기존 사이트 일부 기능이 잠시 작동하지 않을 수 있으므로 사용이 적은 시간에 진행하세요.

기존 운영 환경의 다음 키는 절대 변경하지 마세요.

- `PII_ENCRYPTION_KEY`
- `PII_HASH_KEY`
- `PASSWORD_HISTORY_PEPPER`

키를 잃거나 교체하면 기존 암호화 데이터 또는 비밀번호 이력을 정상적으로 처리할 수 없습니다.

## 1. 백업

Supabase Dashboard에서 데이터베이스 백업 가능 여부를 확인하고, 최소한 다음 테이블을 CSV 또는 SQL로 별도 보관합니다.

- `profiles`
- `signup_requests`
- `calendar_events`
- `event_change_requests`
- `messages`
- `password_history`
- `admin_settings`

현재 GitHub 소스도 별도 브랜치나 압축파일로 보관합니다.

## 2. 새 환경변수 생성

로컬 프로젝트에서 실행합니다.

```bash
npm ci
npm run generate-security-keys
```

출력된 값 중 기존에 없던 다음 두 값을 별도로 보관합니다.

```env
SESSION_SIGNING_KEY=
RATE_LIMIT_PEPPER=
```

기존 운영 프로젝트의 PII 키와 비밀번호 이력 Pepper는 새 출력값으로 바꾸지 않습니다.

## 3. Vercel 환경변수 등록

Vercel 프로젝트의 **Settings → Environment Variables**에 다음 값을 등록합니다.

```env
SESSION_SIGNING_KEY=<새로 생성한 값>
RATE_LIMIT_PEPPER=<새로 생성한 값>
SIGNUP_INVITE_CODE=<관리자가 구두로 전달할 회원가입 코드>
REQUIRE_ADMIN_MFA=true
```

Production, Preview, Development에 필요한 범위를 선택합니다. 회원가입 코드는 `NEXT_PUBLIC_` 접두사를 붙이지 않습니다.

기존 환경변수도 그대로 유지합니다.

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
PII_ENCRYPTION_KEY=
PII_HASH_KEY=
PASSWORD_HISTORY_PEPPER=
```

## 4. Supabase 통합 보안 SQL 실행

Supabase Dashboard에서 **SQL Editor → New query**를 열고 다음 파일 전체를 붙여넣어 실행합니다.

```text
supabase/migration_20260719_full_server_security.sql
```

이 SQL은 다음 작업을 수행합니다.

- 세션 버전과 임시 비밀번호 만료 컬럼 추가
- 기존 `requested_password` 컬럼 제거
- 가입신청과 대기 Auth 계정 연결
- 요청 횟수 제한 테이블과 RPC 생성
- 보안 감사로그 테이블 생성
- 기존 RLS 정책 제거
- 브라우저의 업무 테이블 직접 접근 차단
- 보안 함수 실행권한 제한

오류가 발생하면 코드 배포를 먼저 진행하지 말고 오류 문구를 확인합니다.

## 5. 새 소스 배포

압축파일 내용을 기존 프로젝트 폴더에 덮어쓴 후 실행합니다.

```powershell
cd D:\leave-calendar
git add .
git commit -m "전체 서버 보안 강화"
git push origin master
```

현재 브랜치가 `main`이면 마지막 명령은 다음과 같습니다.

```powershell
git push origin main
```

Vercel 배포 상태가 `Ready`인지 확인합니다. 새 환경변수를 등록한 뒤에는 반드시 새 배포가 필요합니다.

## 6. 기존 민감 내용 암호화

배포에 사용한 것과 동일한 운영 환경변수를 로컬 `.env.local`에 설정한 뒤 실행합니다.

```bash
npm run migrate-content-encryption
```

다음 필드의 기존 평문 데이터가 AES-256-GCM 암호문으로 변환됩니다.

- 일정 설명·공개메모·관리자메모·거절사유
- 일정 수정·삭제 요청 사유와 제안 메모
- 쪽지 제목·내용
- 가입신청 사유·거절사유

스크립트는 이미 `enc:v1:` 형식으로 암호화된 값은 건너뛰므로 재실행해도 중복 암호화하지 않습니다.

## 7. 관리자 MFA 등록

관리자 또는 부서관리자가 로그인하면 `/mfa` 화면으로 이동합니다.

1. 인증 앱에서 QR코드 스캔
2. 인증 앱에 표시된 6자리 코드 입력
3. 인증 완료 후 달력으로 이동되는지 확인

관리자 계정 하나만 운영하지 말고 비상 접근이 가능한 별도 관리자 계정도 준비합니다. 인증 앱을 삭제하거나 기기를 분실하기 전에 복구 절차를 마련해야 합니다.

## 8. 기존 가입승인 대기자 처리

업데이트 전 만들어진 가입신청에는 `auth_user_id`가 없으므로 새 구조에서 승인할 수 없습니다.

- 기존 대기 신청은 거절 또는 삭제
- 해당 사용자에게 새 회원가입 코드 전달
- 사용자가 다시 가입신청

새 가입신청부터 비밀번호는 앱 DB에 저장되지 않고 Supabase Auth에만 전달됩니다.

## 9. 확인 항목

- 일반사용자가 다른 사용자의 사용자관리·내일정·사용현황을 볼 수 없는지
- 부서관리자가 다른 부서 자료를 볼 수 없는지
- 관리자가 MFA 없이 관리자 API를 사용할 수 없는지
- 회원가입 코드를 틀리면 신청이 접수되지 않는지
- 로그인 반복 실패 시 요청 제한이 작동하는지
- 5분 후 화면과 API 모두 다시 로그인을 요구하는지
- 비밀번호 초기화 시 매번 다른 임시 비밀번호가 생성되는지
- 임시 비밀번호가 30분 후 만료되는지
- 계정 생성·권한 변경·초기화·삭제 시 현재 비밀번호를 요구하는지
- Supabase Table Editor에서 민감 내용이 `enc:v1:`로 저장되는지
- `security_audit_logs`에 로그인과 관리자 작업이 기록되는지

## 10. 로컬 보안검사

```bash
npm run security-check
```

검사는 ESLint, 프로덕션 빌드, CSRF·RLS·세션·MFA·암호화 관련 소스 보안테스트를 실행합니다.
