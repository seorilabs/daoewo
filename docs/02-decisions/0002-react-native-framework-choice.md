# ADR 0002: React Native Framework Choice

## Status

Accepted

## Context

Seorilabs 비게임 앱은 Google Play, App Store, AppsInToss를 모두 고려한다. Google Play와 App Store는 native Firebase, Crashlytics, FCM, App Check, Play Billing, StoreKit, signing, Gradle/Xcode release build 제어가 필요할 수 있다. AppsInToss는 Granite React Native와 TDS React Native가 review 승인에 맞는 기본 경로다.

React Native 공식 문서는 새 앱 경험에는 Framework 사용을 권장하고, framework 제약이 맞지 않으면 Community CLI 기반 앱을 만들 수 있다고 안내한다.

## Decision

- `apps/mobile`: Community CLI 기반 bare React Native target.
- `apps/ait`: AppsInToss Granite React Native target.
- `packages/product-core`: 두 target이 공유하는 platform 독립 제품 로직.
- Expo managed app은 기본값으로 채택하지 않는다.

## Consequences

- native SDK와 release build 제어를 app target에서 직접 관리할 수 있다.
- AppsInToss runtime API와 TDS 의존성은 `apps/ait`에만 둔다.
- UI를 완전히 공유하려면 RN component layer를 별도 package로 승격할 수 있지만, 초기 템플릿의 공유 단위는 product core로 제한한다.
