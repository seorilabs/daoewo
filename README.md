# 다외워 · Daoewo

무엇이든 같은 루틴으로 외우는 스와이프 암기 앱이다. 목표일까지 오늘 분량을 자동 배분하고, 왼쪽은 `모르겠다`, 오른쪽은 `안다`로 분류한 뒤 오답을 간격 반복으로 다시 보여 준다. 운영자가 검수한 큐레이션 덱을 Free/Pro 카탈로그로 공급한다.

- Android/iOS: bare React Native
- AppsInToss: Granite React Native + TDS
- Backend: Firebase Auth, Firestore, Storage, Functions, Remote Config, Analytics, Crashlytics, FCM, App Check
- 공통 core: 플랫폼 SDK import가 없는 순수 TypeScript
- 수익화: 월 ₩4,900 / 연 ₩39,000 / 7일 체험

## 구조

```text
docs/                  # 기획, 의사결정, 작업, 마켓, 릴리스 원장
apps/mobile/           # Android/iOS React Native target
apps/ait/              # AppsInToss Granite React Native target
packages/product-core/ # platform 독립 도메인/유스케이스/포트
packages/product-ui/   # Android/iOS/AIT 공통 RN 제품 UI
functions/             # 서버 권위 세션/진도/요청/영수증 Functions
content-pipeline/      # 공급자 전용 덱 생성·검수·배포 파이프라인
firebase/              # Firebase rules/indexes/emulator config
play-store/            # Google Play registration/release metadata
app-store/             # App Store registration/release metadata
apps-in-toss/          # AppsInToss console/release metadata
scripts/               # local/CI quality gates
```

## 개발 명령

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm dev:mobile
pnpm dev:ait
pnpm check:mobile
pnpm check:ait
pnpm check:release       # 외부 콘솔/사람 QA blocker가 있으면 의도적으로 실패
```

플랫폼별 상세 실행 방법은 각 target README에 기록한다. Android/iOS와 미승인 콘텐츠
Debug Preview는 [`apps/mobile/README.md`](apps/mobile/README.md), AppsInToss는
[`apps/ait/README.md`](apps/ait/README.md)를 따른다. 콘텐츠 초안은 서버에 올리지 않고
다음 두 터미널로 로컬 앱에서 확인한다.

```bash
pnpm run dev:mobile:preview
pnpm run ios:mobile:preview      # 또는 android:mobile:preview
```

## 배포 게이트

기획 승인은 2026-07-12 완료됐다. 개발·에이전트 QA·release-candidate 준비는 진행할 수 있지만 Google Play/App Store/AppsInToss 제출과 프로덕션 공개는 별도 deployment approval 전까지 금지한다. 상세 원장은 `docs/`다.
