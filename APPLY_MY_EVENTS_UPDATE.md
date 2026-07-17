# 내 일정 부서·월별 조회 수정

## 적용 내용
- 관리자: 5개 부서 항목 표시
- 부서관리자: 본인 부서 항목만 표시
- 부서 선택 후 사용자 이름/아이디 검색
- 사용자 선택 시 `/my-events/[id]` 새 페이지로 이동
- 상세 페이지 진입 시 연도/월 선택창 표시
- 휴가, 외박, 외출, 평일외출 항목별 ON/OFF 필터
- 기존 승인/거절, 관리자 수정/삭제, 일반사용자 수정/삭제 요청 기능 유지
- 서버에서 관리자/부서관리자/일반사용자 조회 권한 제한

## 수정·추가 파일
- app/(protected)/my-events/page.tsx
- app/(protected)/my-events/[id]/page.tsx
- app/api/my-events/users/route.ts
- app/api/my-events/[id]/route.ts
- components/calendar/MyEventsList.tsx
- components/calendar/MyEventsDetail.tsx

## 데이터베이스
추가 SQL 실행은 필요하지 않습니다.
