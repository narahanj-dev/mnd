# 회원가입 재신청 강조 공지 적용 안내

## 수정 내용
로그인 화면 공지사항 상단에 다음 문구를 빨간색 강조 상자로 추가했습니다.

> 중요: 업데이트로 인해 회원가입 승인을 받지 못한 사용자는 재가입해 주시기 바랍니다.

## 수정 파일
- `app/login/page.tsx`

## 적용 방법
1. 수정 압축파일을 해제합니다.
2. 압축을 푼 전체 파일을 기존 프로젝트 폴더에 덮어씁니다.
3. 기존 `.env.local` 파일은 그대로 유지합니다.
4. 아래 명령어로 확인 후 배포합니다.

```powershell
cd D:\leave-calendar
npm install
npm run build
git add .
git commit -m "회원가입 재신청 강조 공지 추가"
git push
```

이번 수정은 화면 문구 수정이므로 Supabase SQL 실행이 필요 없습니다.
