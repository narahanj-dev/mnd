# 부대달력

Next.js 16과 Supabase를 사용하는 부서 공동 휴가·외박·외출·기념일 관리 웹 애플리케이션입니다.

## 적용된 보안 기능

- 공개 회원가입 기능을 차단하고 관리자만 사용자 관리에서 신규 계정 생성
- 관리자 생성 계정은 초기 비밀번호 변경을 강제하고 24시간 안에 최초 로그인
- 아이디·이름·생일 월/일 및 일정 제목·메모·요청 사유·쪽지 내용 AES-256-GCM 암호화
- 아이디 검색·중복확인 및 접속 식별자에 HMAC 기반 블라인드 인덱스 사용
- 고정 임시 비밀번호 제거, 계정별 무작위 임시 비밀번호와 30분 만료 적용
- 최근 비밀번호 5개 재사용 금지와 6개월 변경주기
- 서명된 HttpOnly 쿠키를 이용한 서버 강제 5분 유휴 세션
- 로그인·관리자 작업·중요 재인증 요청 횟수 제한
- 관리자와 부서관리자 TOTP MFA(`aal2`) 강제 및 최초 등록 시 현재 비밀번호 재확인
- 계정 생성·권한 변경·초기화·삭제 시 현재 비밀번호 재확인
- 모든 상태 변경 API의 동일 출처 검사(CSRF 방어)와 JSON 형식·16KB 본문 제한
- CSP nonce, HSTS, 클릭재킹·MIME 스니핑 방지 등 보안 헤더
- 브라우저의 업무 테이블 직접 접근 차단과 서버 API 권한검사
- 부서관리자는 자기 부서의 일반사용자만 관리하며 관리자·부서관리자 지정은 최고관리자만 가능
- 관리자·부서관리자 본인의 일정 및 변경 요청 직접 승인 차단
- 관리자 전용 필드를 일반사용자 응답에서 제거
- 로그인·승인·권한변경·초기화·삭제 등 보안 감사로그
- 내부 DB·Auth 오류를 사용자 응답에 직접 노출하지 않음
- 소스 기반 자동 보안검사 포함

## 설치 및 검사

```bash
npm ci
npm run lint
npm run build
node --test tests/security/*.test.mjs
```

한 번에 검사하려면 다음을 실행합니다.

```bash
npm run security-check
```

## 기존 운영 프로젝트 적용

반드시 [`APPLY_SECURITY_PATCH_20260719.md`](./APPLY_SECURITY_PATCH_20260719.md)의 순서대로 적용하세요. 특히 구형 Auth 이메일 전환과 평문 저장 차단 SQL을 새 코드 배포 전에 완료해야 합니다.

핵심 SQL:

```text
supabase/migration_20260719_full_server_security.sql
```

구형 Auth 이메일 전환 및 기존 평문 일정 메모·사유·쪽지 암호화:

```bash
npm run migrate-legacy-auth-emails
npm run migrate-content-encryption
```

암호화 완료 후 Supabase SQL Editor에서 다음 파일을 실행합니다.

```text
supabase/migration_20260719_encrypted_content_constraints.sql
```

## 새 Supabase 프로젝트

1. `supabase/schema.sql` 실행
2. `supabase/migration_20260719_full_server_security.sql` 실행
3. `supabase/migration_20260719_encrypted_content_constraints.sql` 실행
4. `.env.local.example`을 참고해 환경변수 설정
5. `npm run create-admin` 실행
6. 애플리케이션 배포
7. 최초 관리자 로그인 후 현재 비밀번호 재확인 및 TOTP MFA 등록

`supabase/rls-policies.sql`은 최종 정책만 따로 재적용해야 할 때 사용하는 파일입니다. 통합 보안 마이그레이션을 실행했다면 동일 정책이 이미 포함됩니다.

## 필수 환경변수

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
PII_ENCRYPTION_KEY=
PII_HASH_KEY=
PASSWORD_HISTORY_PEPPER=
SESSION_SIGNING_KEY=
RATE_LIMIT_PEPPER=
REQUIRE_ADMIN_MFA=true
```

새 키 생성:

```bash
npm run generate-security-keys
```

기존 운영 DB가 있다면 `PII_ENCRYPTION_KEY`, `PII_HASH_KEY`, `PASSWORD_HISTORY_PEPPER`를 새로 만들거나 교체하지 마세요. 기존 암호화 데이터와 비밀번호 이력을 사용할 수 없게 됩니다. `SUPABASE_SERVICE_ROLE_KEY`와 모든 비밀키는 GitHub에 올리지 말고 Vercel 환경변수와 별도 비밀 저장소에만 보관하세요.
