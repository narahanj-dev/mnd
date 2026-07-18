# 부서 공동 연차달력

Next.js와 Supabase 기반의 부서 공동 연차·외박·외출 일정 관리 웹 애플리케이션입니다.

## 주요 보안 기능

- 아이디, 이름, 생일 월/일을 AES-256-GCM 암호문으로 DB에 저장
- 로그인·중복검색은 비밀키 기반 HMAC 해시 사용
- Supabase Auth 내부 이메일에 아이디 원문을 사용하지 않음
- 회원가입 승인 전 비밀번호는 AES-256-GCM 암호문으로 임시 보관하고, 승인 후 Supabase Auth의 단방향 해시로 저장
- 최근 비밀번호 5개 재사용 금지 및 6개월 변경주기 강제
- 회원가입 시 출생연도 미수집, 월/일만 암호화 저장
- 달력 이름 마스킹 적용
- 관리자·부서관리자·일반사용자 권한 분리
- 로그인 후 300초 카운트다운 및 만료 시 자동 로그아웃

## 설치

```bash
npm install
npm run generate-security-keys
npm run lint
npm run build
npm run dev
```

환경변수 예시는 `.env.local.example`을 참고하세요.

## 새 Supabase 프로젝트

SQL Editor에서 다음 순서로 실행합니다.

1. `supabase/schema.sql`
2. `supabase/rls-policies.sql`

그 뒤 보안정책을 충족하는 초기 관리자 정보를 `.env.local`에 입력하고 실행합니다.

```bash
npm run create-admin
```

## 기존 Supabase 프로젝트 업데이트

개인정보 암호화 상세 순서는 `APPLY_SECURITY_UPDATE.md`를 따르세요.
회원가입 비밀번호와 자동 로그아웃 추가 적용은 `APPLY_SIGNUP_PASSWORD_TIMER_UPDATE.md`를 따르세요.

1. `supabase/migration_20260718_pii_encryption_password_policy.sql`
2. 수정 코드 배포
3. `npm run migrate-sensitive-data`
4. `supabase/migration_20260718_pii_encryption_finalize.sql`

## 필수 환경변수

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
PII_ENCRYPTION_KEY=
PII_HASH_KEY=
PASSWORD_HISTORY_PEPPER=
```

`PII_ENCRYPTION_KEY`를 잃어버리면 기존 암호화 데이터를 복호화할 수 없습니다. 운영 키는 GitHub에 올리지 말고 안전한 비밀 저장소에 별도로 백업하세요.
