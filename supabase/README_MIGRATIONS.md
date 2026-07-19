# Supabase 최종 보안 마이그레이션 안내

## 기존 운영 DB

다음 순서를 지켜 적용합니다.

1. 필요한 경우 `migration_20260719_full_server_security.sql` 실행
2. 로컬 프로젝트에서 `npm run migrate-legacy-auth-emails` 실행
3. 로컬 프로젝트에서 `npm run migrate-content-encryption` 실행
4. `migration_20260719_encrypted_content_constraints.sql` 실행

마지막 SQL은 service role을 포함한 모든 연결에서 일정 제목·메모·변경 사유·쪽지의 평문 저장을 차단합니다. 기존 평문이 남아 있으면 오류로 중단되므로 반드시 암호화 스크립트를 먼저 실행합니다.

## 새 DB

1. `schema.sql` 실행
2. `migration_20260719_full_server_security.sql` 실행
3. 환경변수 설정
4. `npm run create-admin` 실행

새 `schema.sql`에는 암호문 형식 제약이 이미 포함되어 있습니다.

## 자동정리 Cron 확인

```sql
select jobid, jobname, schedule, command
from cron.job
where jobname = 'leave_calendar_security_cleanup';
```

과거 마이그레이션 파일은 이력 보관용이므로 운영 DB에 임의로 다시 실행하지 마세요.
