# 달력 날짜 정렬 및 표시항목 우선순위 적용 방법

## 반영 내용

- 달력 날짜 숫자를 각 날짜 칸의 왼쪽 맨 위에 고정했습니다.
- 일정 건수는 날짜 숫자 바로 아래에서 시작하도록 정렬했습니다.
- 표시 항목과 날짜별 일정 건수를 다음 순서로 고정했습니다.
  1. 휴가
  2. 외박
  3. 주말외출
  4. 평일외출
  5. 기념일

## 수정 파일

- `components/calendar/CalendarBoard.tsx`

## 적용 방법

1. 현재 운영 중인 프로젝트를 백업합니다.
2. 수정 압축파일을 풉니다.
3. 압축을 푼 파일을 기존 프로젝트 폴더에 덮어씁니다.
4. 기존 `.env.local` 파일은 그대로 유지합니다.
5. 이번 수정은 Supabase SQL 실행이 필요 없습니다.

```powershell
cd D:\leave-calendar
npm install
npm run build
npm run dev
```

브라우저에서 `http://localhost:3000/calendar`에 접속해 날짜와 표시 순서를 확인합니다.

## GitHub 반영

```powershell
cd D:\leave-calendar
git add .
git commit -m "달력 날짜 정렬 및 일정 우선순위 적용"
git push
```
