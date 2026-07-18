# 로그인 화면 공지사항 추가 적용 안내

## 반영 내용

첫 로그인 화면에 다음 공지사항을 추가했습니다.

- 회원가입 시 아이디에 군번 사용 금지
- 기존 가입자는 본인 이름을 영문 자판(영타)으로 입력해 로그인한 뒤 사용자 관리에서 아이디 변경 가능

## 적용 방법

1. 수정 압축파일의 내용을 기존 프로젝트 폴더에 덮어씁니다.
2. 기존 `.env.local`과 `.git`은 유지합니다.
3. 다음 명령을 실행합니다.

```powershell
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm install
npm run lint
npm run build
```

4. 이상이 없으면 GitHub에 푸시하여 재배포합니다.

## Supabase

이번 수정은 화면 공지사항만 추가하므로 Supabase SQL 실행은 필요하지 않습니다.
