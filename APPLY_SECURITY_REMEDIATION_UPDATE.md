# 최종 서버 보안 보완 적용법

이 파일은 기존 보안 적용 문서를 대체하는 최종 안내입니다. 과거 보안 SQL을 다시 실행하지 말고 아래 통합 SQL 하나만 사용하세요.

## 1. 적용 전 백업

Supabase Dashboard에서 데이터베이스 백업 상태를 확인하고 현재 소스도 별도 복사합니다.
이번 SQL은 종료된 `signup_requests` 테이블과 과거 가입신청 기록을 영구 삭제합니다.

## 2. 수정 소스 반영

기존 프로젝트 폴더에 이 압축파일의 내용을 덮어쓴 뒤 실행합니다.

```powershell
npm ci
npm run lint
npm run build
node --test tests/security/*.test.mjs
npm audit --omit=dev
```

정상 기준:

- 린트 오류 없음
- 프로덕션 빌드 성공
- 보안 테스트 13개 통과
- npm audit 취약점 0건

## 3. Supabase 최종 통합 SQL 실행

Supabase → SQL Editor → New query에서 아래 파일 전체 내용을 붙여넣고 실행합니다.

```text
supabase/migration_20260719_full_server_security.sql
```

이 SQL 한 파일에 다음 작업이 모두 포함됩니다.

- 브라우저의 업무 테이블 직접 접근 차단
- 속도제한·감사로그 테이블과 함수
- 일정 승인·변경 승인 트랜잭션
- 관리자 자기 승인 차단
- 부서관리자의 일반사용자 전용 관리 제한
- 가입신청 테이블 및 과거 신청 기록 삭제
- 일정 제목 암호화용 DB 제약 정리
- 보안 기록 자동정리 Cron 등록

성공 후 Cron 확인:

```sql
select jobid, jobname, schedule, command
from cron.job
where jobname = 'leave_calendar_security_cleanup';
```

`leave_calendar_security_cleanup` 한 건이 나오면 정상입니다.

## 4. 기존 일정 제목과 내용 암호화

프로젝트의 `.env.local`에 운영 Supabase 주소·Service Role 키·기존 암호화 키가 들어 있는 상태에서 실행합니다.

```powershell
npm run migrate-content-encryption
```

이 작업은 기존 평문 데이터를 다음 범위까지 AES-256-GCM으로 변환합니다.

- 일정 제목·설명·공개메모·관리자메모·거절사유
- 일정 변경 요청 제목·사유·메모·거절사유
- 쪽지 제목·내용

기존 `PII_ENCRYPTION_KEY`는 절대 변경하지 마세요.

## 5. Vercel 배포

```powershell
git add .
git commit -m "서버 보안 최종 보완"
git push
```

Vercel 환경변수에서 다음 값이 유지되는지 확인합니다.

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY
PII_ENCRYPTION_KEY
PII_HASH_KEY
PASSWORD_HISTORY_PEPPER
SESSION_SIGNING_KEY
RATE_LIMIT_PEPPER
REQUIRE_ADMIN_MFA=true
APP_ORIGIN=https://실제서비스주소
```

## 6. 최종 동작 확인

1. 최고관리자 로그인 및 MFA 인증
2. 일반사용자 계정 생성·수정·비밀번호 초기화·삭제
3. 부서관리자 화면에는 같은 부서 일반사용자만 표시되는지 확인
4. 부서관리자가 다른 부서관리자의 권한·비밀번호·계정을 관리할 수 없는지 확인
5. 관리자 또는 부서관리자가 본인 일정 승인 시 차단되는지 확인
6. 다른 관리자가 해당 일정을 정상 승인할 수 있는지 확인
7. 달력·내 일정·사용현황에서 암호화된 제목이 정상 한글로 표시되는지 확인
8. `/signup-request` 및 `/api/signup-request` 경로가 존재하지 않는지 확인

## 중요

- `supabase/migration_20260719_security_hardening.sql`은 통합되어 삭제되었습니다.
- 과거 가입신청 관련 소스와 API도 완전히 삭제되었습니다.
- 로그인 실패 제한은 계정별 10분 6회, 확인 가능한 공인 IP별 10분 100회입니다.
- IP를 확인할 수 없는 환경에서는 전체 사용자가 `unknown` 하나로 묶이지 않습니다.
