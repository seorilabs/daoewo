# Clean Architecture Boundary

## Dependency Rule

```mermaid
flowchart TD
  Domain["Domain Entities / Value Objects"] --> UseCases["Use Cases"]
  UseCases --> Ports["Ports"]
  Ports --> MobileAdapters["apps/mobile adapters"]
  Ports --> AITAdapters["apps/ait adapters"]
  Ports --> FirebaseAdapters["Firebase/server adapters"]
  UseCases --> ProductUI["packages/product-ui"]
  MobileAdapters --> MobileUI["React Native UI / navigation"]
  AITAdapters --> AITUI["Granite RN / TDS UI"]
  FirebaseAdapters --> Functions["Functions: 권위 세션·진도"]
  Functions --> Firestore["Firestore: goal/progress/meta"]
  Functions --> Storage["Storage: versioned card chunks"]
```

의존성 방향은 바깥에서 안쪽으로만 향한다. `product-core`는 app target이나 SDK를 모른다.

## packages/product-core

허용:

- Domain entities
- Value objects
- Pure use cases
- Port interfaces
- Pure fixtures/fakes

금지:

- React Native, Expo, native module
- Firebase SDK, Admin SDK, service account
- AppsInToss, Granite, Toss SDK
- Google Play Billing, App Store StoreKit
- Ad SDK
- Network/client SDK 직접 호출

## apps/mobile

허용:

- Android/iOS native project
- React Native UI, navigation, lifecycle
- Native Firebase adapter
- Play Billing / StoreKit adapter
- Analytics, Crashlytics, FCM, App Check adapter
- Platform storage, permission, device API adapter

## apps/ait

허용:

- Granite React Native runtime
- TDS React Native UI
- AppsInToss `Storage` 등 runtime API adapter
- AIT-safe server API adapter

주의:

- normal RN native module이 Toss runtime에서 동작한다고 가정하지 않는다.
- Firebase native module, OAuth redirect, realtime listener, FCM, file upload는 device-level AppsInToss 검증 전까지 release-ready로 보지 않는다.

## Market / Backend

- Google Play: `play-store/`
- App Store: `app-store/`
- AppsInToss: `apps-in-toss/`, `apps/ait/`
- Firebase: `firebase/`

## 프리미엄 세션 흐름

```mermaid
sequenceDiagram
  participant App as Mobile/AIT
  participant Fn as Cloud Functions
  participant DB as Firestore
  participant CS as Cloud Storage chunks
  App->>Fn: deliverSession(goalId, deviceId) + Auth/AppCheck
  Fn->>DB: goal/progress/entitlement/quota read
  Fn->>Fn: product-core로 오늘+도래 cardIndex 계산
  Fn->>CS: 필요한 200장 청크만 fetch(cache miss)
  Fn->>DB: delivery log와 unique coverage 기록
  Fn-->>App: 현재 24시간 창만 반환
  App->>Fn: submitProgress(windowId, outcomes[])
  Fn->>Fn: product-core SRS 계산
  Fn->>DB: progress 압축문서 batch commit
```

클라이언트는 `deckContent`나 Pro Storage 객체를 직접 읽을 수 없다. 동일 core를 client에서는 UX/Free 오프라인 계산에, Functions에서는 권위 계산에 사용한다.
