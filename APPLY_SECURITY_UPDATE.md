# 개인정보 암호화·이름 마스킹·비밀번호 보안 업데이트 적용방법

## 반영 내용

1. DB에 저장되는 아이디, 이름, 생일 월/일을 AES-256-GCM으로 암호화합니다.
2. 로그인 아이디 검색과 중복 확인은 원문 대신 비밀키 기반 HMAC 해시로 처리합니다.
3. Supabase Auth의 내부 이메일도 아이디 원문이 아닌 HMAC 값으로 변경합니다.
4. Auth 사용자 메타데이터에 남아 있던 아이디, 이름, 부서, 생년월일을 제거합니다.
5. 회원가입은 출생연도를 받지 않고 생일의 월/일만 받습니다.
6. 달력에 표시되는 이름만 아래 방식으로 마스킹합니다.
   - 2글자: `홍길` → `홍*`
   - 3글자: `홍길동` → `홍*동`
   - 4글자 이상: `남궁민수` → `남궁**`
7. 비밀번호는 9자 이상이며 영문 대문자·영문 소문자·숫자·특수문자 중 3종류 이상을 포함해야 합니다.
8. 연속 숫자, 전화번호형 숫자열, `love`, `happy`, `password`, `qwerty`, `asdf`, 아이디·이름이 포함된 비밀번호를 거절합니다.
9. 마지막 비밀번호 변경 후 6개월이 지나면 강제로 변경 화면이 표시됩니다.
10. 최근 비밀번호 5개를 재사용할 수 없으므로 두 비밀번호를 교대로 사용하는 것도 차단됩니다.
11. 관리자 비밀번호 초기화는 더 이상 `12345`가 아니라 무작위 강력 임시 비밀번호를 발급합니다.

---

## 중요 주의사항

- 작업 전에 Supabase 데이터베이스 백업을 권장합니다.
- `PII_ENCRYPTION_KEY`를 분실하면 암호화된 이름·아이디·생일을 복호화할 수 없습니다.
- 세 개의 보안키는 로컬 `.env.local`과 Vercel 환경변수에 동일한 값으로 등록해야 합니다.
- 보안키를 임의로 변경하면 기존 암호문을 읽을 수 없습니다. 운영 중 키 변경은 별도의 재암호화 작업이 필요합니다.
- `SUPABASE_SERVICE_ROLE_KEY`와 세 개의 보안키는 GitHub에 올리거나 브라우저 코드에 넣지 마세요.

---

## 1단계: 수정 파일 덮어쓰기

수정된 압축파일의 전체 내용을 현재 프로젝트 폴더에 덮어씁니다.

PowerShell에서 프로젝트 폴더로 이동합니다.

```powershell
cd D:\leave-calendar
npm install
```

---

## 2단계: 암호화 키 생성

```powershell
npm run generate-security-keys
```

화면에 다음 세 줄이 출력됩니다.

```text
PII_ENCRYPTION_KEY=...
PII_HASH_KEY=...
PASSWORD_HISTORY_PEPPER=...
```

기존 `.env.local`에 세 값을 추가합니다.

```env
PII_ENCRYPTION_KEY=출력된_첫번째_값
PII_HASH_KEY=출력된_두번째_값
PASSWORD_HISTORY_PEPPER=출력된_세번째_값
```

Vercel을 사용한다면 Vercel 프로젝트의 **Settings → Environment Variables**에도 동일한 세 값을 추가합니다. Production, Preview, Development 환경에 모두 적용하는 것을 권장합니다.

---

## 3단계: Supabase 준비 SQL 실행

Supabase에서 **SQL Editor → New query**를 누른 뒤 아래 파일 전체 내용을 붙여넣고 실행합니다.

```text
supabase/migration_20260718_pii_encryption_password_policy.sql
```

이 SQL은 암호화 검색용 해시 컬럼, 월/일 생일 컬럼, 비밀번호 변경일, 비밀번호 이력 테이블을 추가합니다. 이 단계에서는 기존 평문 데이터가 아직 남아 있습니다.

---

## 4단계: 수정 소스 배포

Git을 사용하는 경우 예시는 다음과 같습니다.

```powershell
git add .
git commit -m "개인정보 암호화와 비밀번호 보안정책 적용"
git push
```

Vercel 배포가 완료된 것을 확인합니다. 새 로그인 코드는 데이터 전환 기간 동안 기존 로그인 방식도 임시로 지원하므로 다음 단계까지 진행할 수 있습니다.

---

## 5단계: 기존 개인정보 암호화

로컬 프로젝트의 `.env.local`에 아래 여섯 값이 모두 있어야 합니다.

```env
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
PII_ENCRYPTION_KEY=...
PII_HASH_KEY=...
PASSWORD_HISTORY_PEPPER=...
```

다음 명령을 한 번 실행합니다.

```powershell
npm run migrate-sensitive-data
```

이 작업은 다음을 수행합니다.

- 기존 프로필의 아이디·이름·생일을 암호화
- 기존 가입신청의 이름·아이디·생일·신청사유를 암호화
- 관리자 표시 이름을 암호화
- Auth 내부 이메일을 아이디 원문이 아닌 HMAC 값으로 변경
- Auth 메타데이터의 개인정보를 제거
- 기존 사용자의 비밀번호 변경일을 초기화하고 다음 로그인 때 비밀번호 변경을 요구

마지막에 아래 문구가 나오면 정상입니다.

```text
개인정보 암호화 마이그레이션이 완료되었습니다. 이제 finalize SQL을 실행하세요.
```

---

## 6단계: 출생연도 컬럼 삭제 및 최종화

Supabase SQL Editor에서 아래 파일 전체를 실행합니다.

```text
supabase/migration_20260718_pii_encryption_finalize.sql
```

이 SQL은 암호화가 완료됐는지 검사한 뒤 기존 `birth_date` 컬럼을 삭제합니다. 따라서 출생연도는 DB에서 완전히 제거됩니다.

오류가 나오면 최종화 SQL을 반복 실행하지 말고 먼저 `npm run migrate-sensitive-data`의 오류 내용을 확인하세요.

---

## 7단계: 확인

```powershell
npm run lint
npm run build
```

다음 항목을 직접 테스트합니다.

1. 기존 계정으로 로그인되는지 확인
2. 첫 로그인 시 비밀번호 변경창이 강제로 뜨는지 확인
3. 9자 미만 또는 `12345678`, `qwerty`, `love` 등이 포함된 비밀번호가 거절되는지 확인
4. 방금 사용한 비밀번호로 다시 변경할 수 없는지 확인
5. 회원가입 화면에 출생연도 입력란이 없고 월/일만 있는지 확인
6. 달력에서 `홍길동`이 `홍*동`, `홍길`이 `홍*`, `남궁민수`가 `남궁**`로 보이는지 확인
7. 사용자관리·사용현황·내 일정에서는 권한에 따라 정상 이름과 아이디가 보이는지 확인
8. 관리자 비밀번호 초기화 시 무작위 임시 비밀번호가 화면에 한 번 표시되는지 확인

---

## 새 Supabase 프로젝트인 경우

기존 마이그레이션 대신 아래 순서로 실행합니다.

1. `supabase/schema.sql`
2. `supabase/rls-policies.sql`
3. 로컬과 Vercel에 세 보안키 등록
4. 보안정책을 충족하는 초기 관리자 환경변수 입력
5. `npm run create-admin`

초기 관리자 비밀번호도 최소 9자 및 3종류 조합 규칙을 충족해야 합니다.
