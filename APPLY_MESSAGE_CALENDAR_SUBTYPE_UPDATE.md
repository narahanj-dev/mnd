# 쪽지·달력·세부종류 업데이트 적용 방법

## 1. Supabase SQL 실행

Supabase 프로젝트에서 **SQL Editor → New query**를 연 뒤 아래 파일 전체 내용을 붙여넣고 **Run**을 누릅니다.

- `supabase/migration_20260718_message_retention_event_subtypes.sql`

이 SQL은 다음을 처리합니다.

- 기존 `leave` 일정 제목을 모두 `연가`로 변경
- 기존 `overnight` 일정 제목을 모두 `정기외박`으로 변경
- 15일이 지난 미보관 쪽지를 삭제하는 함수 생성
- 매일 자동 정리하는 Supabase `pg_cron` 작업 등록
- SQL 실행 시점에 이미 만료된 미보관 쪽지 즉시 삭제

> `pg_cron` 확장 생성 권한 오류가 발생하면 Supabase Dashboard의 **Database → Extensions**에서 `pg_cron`을 먼저 활성화한 뒤 SQL을 다시 실행하세요. 앱의 쪽지함 API에도 접속 시 자동 정리 기능이 들어 있어 이중으로 동작합니다.

## 2. 소스 덮어쓰기

수정된 프로젝트 파일을 기존 프로젝트에 덮어씁니다. 특히 아래 파일들이 변경되었습니다.

- `lib/constants.ts`
- `components/calendar/CalendarBoard.tsx`
- `components/calendar/EventFormModal.tsx`
- `components/calendar/EventEditModal.tsx`
- `components/calendar/MyEventsDetail.tsx`
- `components/admin/ApprovalList.tsx`
- `components/usage/UsageDetail.tsx`
- `components/usage/UsageUserList.tsx`
- `components/messages/MessageList.tsx`
- `app/api/events/route.ts`
- `app/api/events/[id]/route.ts`
- `app/api/admin/approvals/[id]/route.ts`
- `app/api/admin/event-change-requests/[id]/route.ts`
- `app/api/messages/route.ts`
- `app/login/page.tsx`
- `app/layout.tsx`
- `supabase/schema.sql`

## 3. 로컬 확인

```powershell
npm install
npm run build
```

## 4. GitHub/Vercel 반영

```powershell
git add .
git commit -m "쪽지 보관기간 및 달력 세부종류 적용"
git push
```

Vercel과 GitHub가 연결되어 있으면 push 후 자동 배포됩니다.

## 5. 확인 항목

- 달력 날짜 칸에 이름·제목 없이 `휴가 2건`, `외박 1건`처럼 표시되는지
- 날짜를 클릭하면 상세 목록에서는 신청자와 `휴가(연가)` 같은 종류가 보이는지
- 일정 추가/수정에서 휴가는 `연가/포상/위로/청원`을 선택할 수 있는지
- 외박은 `정기외박/포상외박`을 선택할 수 있는지
- 기존 휴가·외박 일정이 각각 `휴가(연가)`, `외박(정기외박)`으로 표시되는지
- 15일이 지난 쪽지는 보관하지 않은 경우 삭제되고, 보관함 쪽지는 유지되는지
