# Supabase 마이그레이션 안내

기존 운영 DB에는 과거 마이그레이션을 다시 실행하지 말고 다음 통합 보안 마이그레이션만 추가 실행하세요.

```text
migration_20260719_full_server_security.sql
```

새 DB는 `schema.sql` 실행 후 통합 보안 마이그레이션을 실행합니다.

과거 `migration_20260718_signup_password_session_timeout.sql`은 이전 구조의 이력 파일이며 `requested_password` 컬럼을 생성합니다. 최종 통합 마이그레이션이 해당 컬럼을 제거하지만, 운영 DB에 과거 파일을 임의로 재실행하지 마세요.
