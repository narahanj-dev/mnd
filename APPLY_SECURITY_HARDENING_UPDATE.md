# 서버 보안 강화 적용 방법

## 1. 적용 전 백업

- 현재 GitHub 소스와 Supabase DB를 먼저 백업합니다.
- Vercel 환경변수의 기존 `PII_ENCRYPTION_KEY`, `PII_HASH_KEY`는 절대 새 값으로 교체하지 않습니다. 기존 암호화 데이터가 복호화되지 않을 수 있습니다.

## 2. 소스 덮어쓰기

이 압축파일의 전체 내용을 기존 프로젝트에 덮어씁니다.

이번 버전에서는 브라우저용 Supabase 클라이언트를 제거했습니다. 기존 경로의 `lib/supabase/client.ts`가 남아 있다면 삭제하세요.

## 3. Supabase SQL 실행

Supabase 대시보드에서 다음 순서로 실행합니다.

1. **SQL Editor** 이동
2. **New query** 선택
3. `supabase/migration_20260719_security_hardening.sql` 전체 복사
4. **Run** 실행

이 SQL은 다음을 적용합니다.

- 일정 및 변경요청 최대 기간 366일 제한
- 한 일정에 대기 중 변경요청 1개만 허용
- 일정 승인·거절 트랜잭션 처리
- 일정 수정·삭제 승인·거절 트랜잭션 처리
- 쪽지·감사로그·속도제한 기록 정리 함수 추가

> `event_change_requests_one_pending_per_event_idx` 생성 오류가 발생하면 동일 일정에 대기 중 요청이 여러 건 존재하는 상태입니다. 중복 대기 요청을 먼저 승인·거절 처리한 뒤 SQL을 다시 실행하세요.

## 4. Vercel 환경변수 추가

Vercel 프로젝트의 **Settings → Environment Variables**에 다음 값을 추가합니다.

```env
APP_ORIGIN=https://실제-운영-도메인
TRUST_PROXY_HEADERS=false
```

예시:

```env
APP_ORIGIN=https://mnd-calendar.vercel.app
TRUST_PROXY_HEADERS=false
```

- `APP_ORIGIN` 끝에는 `/`를 붙이지 않습니다.
- Vercel에서 직접 운영하면 `TRUST_PROXY_HEADERS=false`를 유지합니다.
- 별도의 Nginx 등 자체 프록시를 운영하면서 전달 헤더를 신뢰하는 경우에만 `true`로 변경합니다.

다음 보안키는 모두 `npm run generate-security-keys`로 만든 32바이트 키를 사용해야 합니다.

```env
PII_ENCRYPTION_KEY=
PII_HASH_KEY=
PASSWORD_HISTORY_PEPPER=
SESSION_SIGNING_KEY=
RATE_LIMIT_PEPPER=
```

기존 운영 서버의 PII 관련 키는 변경하지 말고 형식만 확인합니다.

## 5. Supabase Auth 설정 확인

브라우저에서 직접 비밀번호를 변경하는 우회 경로를 줄이기 위해 이번 소스는 Supabase 인증 쿠키를 `HttpOnly`로 저장하고 MFA도 서버 API를 통해 처리합니다.

추가로 Supabase 대시보드의 Auth 설정에서 다음을 확인합니다.

- 공개 이메일 회원가입 비활성화
- 최소 비밀번호 길이 9자 이상
- 비밀번호 변경 시 재인증 요구 기능 사용
- 관리자 및 부서관리자 MFA 사용

## 6. 재배포

```powershell
git add .
git commit -m "서버 보안 강화 적용"
git push
```

Vercel 자동 배포가 끝난 뒤 기존 로그인 세션은 새 `HttpOnly` 쿠키 형식과 절대 세션 제한 때문에 다시 로그인해야 할 수 있습니다.

## 7. 적용 확인

다음 항목을 순서대로 테스트합니다.

1. 일반사용자 로그인 및 달력 조회
2. 일반사용자가 같은 부서의 승인대기·거절 일정을 볼 수 없는지 확인
3. 관리자 로그인 후 MFA 등록 및 6자리 코드 인증
4. MFA 전 관리자 API 접근이 차단되는지 확인
5. 일정 승인·거절
6. 일정 수정·삭제 요청 승인·거절
7. 관리자 임시비밀번호 발급
8. 300초 유휴 세션 만료
9. 장시간 로그인 후 8시간 절대 세션 만료

## 8. 선택사항: 보안 기록 정리 자동화

다음 함수를 하루 1회 Supabase Cron에서 실행하면 오래된 기록이 자동 정리됩니다.

```sql
select public.cleanup_security_records();
```

정리 기준:

- 보관하지 않은 쪽지: 15일
- 속도제한 기록: 2일
- 보안 감사로그: 1년
