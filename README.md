# Seorilabs Starter Template App

Seorilabs 비게임 앱을 Google Play, Apple App Store, AppsInToss까지 확장하기 위한 React Native 멀티마켓 템플릿이다.

제품별 값을 임의로 채우지 않는다. 새 프로젝트를 만들면 `docs/01-planning/`, `docs/05-markets/`, `AGENTS.local.md`에서 `확정 필요` 항목을 먼저 정리한다.

## Stack Decision

- Google Play / App Store: Community CLI 기반 bare React Native target인 `apps/mobile`.
- AppsInToss: Granite React Native target인 `apps/ait`.
- Backend 기본값: Firebase. 단, 로컬 전용 MVP면 Firebase 코드를 미리 붙이지 않는다.
- 공통 제품 로직: `packages/product-core`에서 platform SDK import 없이 관리한다.
- 네이티브 런치/스플래시는 release asset이다. React Native 템플릿 화면을 숨기지 말고 제품 브랜딩 화면으로 교체한다.

React Native 공식 문서는 새 앱 경험에는 Framework 사용을 권장하지만, 이 템플릿은 native Firebase, Play Billing, StoreKit, Crashlytics, App Check, FCM, signing, App Store/Xcode build 제어가 필요한 Seorilabs 멀티마켓 운영을 기본 전제로 한다. 그래서 `apps/mobile`은 bare RN을 선택하고, AppsInToss는 Granite RN으로 분리한다.

## 구조

```text
docs/                  # 기획, 의사결정, 작업, 마켓, 릴리스 원장
apps/mobile/           # Android/iOS React Native target
apps/ait/              # AppsInToss Granite React Native target
packages/product-core/ # platform 독립 도메인/유스케이스/포트
firebase/              # Firebase rules/indexes/functions 자리
play-store/            # Google Play registration/release metadata
app-store/             # App Store registration/release metadata
apps-in-toss/          # AppsInToss console/release metadata
scripts/               # local/CI quality gates
```

## 기본 명령

```bash
pnpm run test:core
pnpm run check:architecture
pnpm run check:docs
pnpm run check:release
pnpm run bootstrap:mobile -- <AppName>
pnpm run bootstrap:ait -- <app-name>
```

`check:release`는 템플릿 placeholder가 남아 있으면 실패한다. 릴리스 직전 blocker inventory 용도다.
