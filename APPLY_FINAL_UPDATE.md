# 최종 추가 수정 적용 안내

1. 기존 프로젝트 전체를 백업합니다.
2. 이 압축파일을 풉니다.
3. 압축 안의 `app`, `components`, `lib` 등 모든 파일을 기존 프로젝트 최상위 폴더에 덮어씁니다.
4. 기존 프로젝트의 `.env.local`과 `.git`은 삭제하지 않습니다.
5. 프로젝트 폴더에서 아래 명령을 실행합니다.

```powershell
npm install
npm run lint
npm run build
npm run dev
```

6. 기능 확인 후 GitHub에 반영합니다.

```powershell
git add .
git commit -m "부서별 가입신청 사용자관리 달력 통계 적용"
git push origin HEAD
```

이번 수정은 Supabase SQL을 추가로 실행할 필요가 없습니다.
