# Supabase 최종 보안 마이그레이션 안내

기존 운영 DB와 새 DB 모두 최종적으로 아래 파일 **하나만** 실행합니다.

```text
migration_20260719_full_server_security.sql
```

이 통합 파일에는 다음 내용이 모두 포함되어 있습니다.

- 서버 전용 업무 테이블 권한과 RLS 차단
- 속도제한 및 감사로그 테이블
- 일정 승인·변경 승인 원자 처리
- 관리자 자기 승인 차단
- 부서관리자의 일반사용자 전용 관리 제한
- 일정 제목 암호화를 위한 길이 제약 정리
- 종료된 가입신청 테이블 및 과거 신청 데이터 삭제
- 미보관 쪽지·속도제한·감사로그 일일 자동정리 Cron

새 DB는 먼저 `schema.sql`을 실행한 뒤 위 통합 마이그레이션을 실행합니다.
과거 마이그레이션 파일은 이력 보관용이므로 운영 DB에 다시 실행하지 마세요.

적용 후 Cron 등록 확인:

```sql
select jobid, jobname, schedule, command
from cron.job
where jobname = 'leave_calendar_security_cleanup';
```
