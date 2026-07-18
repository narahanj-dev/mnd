# 기존 군번 가입자 공지사항 추가 적용 방법

## 변경 내용
로그인 화면 공지사항에 다음 문구를 추가했습니다.

> 기존 군번 가입자는 아이디에 본인 이름을 영어 자판으로 입력하고 초기 비밀번호를 사용해 로그인해 주세요.

## 수정 파일
- `app/login/page.tsx`

## 적용 순서
1. 기존 프로젝트의 `.env.local` 파일을 별도로 보관합니다.
2. 수정 압축파일을 풀고 기존 프로젝트 폴더에 전체 덮어씁니다.
3. `.env.local`은 기존 파일을 그대로 유지합니다.
4. PowerShell에서 다음 명령어를 실행합니다.

```powershell
cd D:\leave-calendar
npm install
npm run build
git add .
git commit -m "기존 군번 가입자 로그인 공지 추가"
git push origin master
```

## Supabase
이번 수정은 화면 공지 문구만 변경하므로 Supabase SQL 실행이 필요 없습니다.
