# 로그인 화면 아이디 문구 변경 적용 안내

## 변경 내용

- 로그인 화면의 `군번` 표시를 `아이디`로 변경
- 관리자 설정 로그인 창의 `관리자 군번` 안내를 `관리자 아이디`로 변경
- 로그인 처리 방식과 데이터베이스 구조는 변경하지 않음

## 적용 방법

1. 압축파일의 전체 내용을 기존 프로젝트 폴더에 덮어씁니다.
2. 기존 `.env.local`과 `.git`은 유지합니다.
3. 아래 명령을 실행합니다.

```powershell
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm install
npm run lint
npm run build
```

4. 로컬 확인 후 GitHub에 푸시합니다.

```powershell
git add .
git commit -m "로그인 화면 군번 문구를 아이디로 변경"
git push
```

이번 수정은 Supabase SQL 실행이 필요 없습니다.
