# Mobile Target

Google Play와 App Store를 위한 bare React Native target 자리다.

## 선택한 방향

- React Native Community CLI 기반 native project
- Android와 iOS를 `apps/mobile` 하나의 target에서 관리
- native Firebase, Play Billing, StoreKit, Crashlytics, FCM, App Check 등은 adapter로 격리
- product logic은 `packages/product-core`에서 import

## 초기화

```bash
pnpm run bootstrap:mobile -- <AppName>
```

초기화 후 확인할 것:

- `apps/mobile/android/`
- `apps/mobile/ios/`
- `apps/mobile/package.json`
- Metro workspace 설정
- `@react-native/gradle-plugin`, `@react-native/codegen`, Hermes path
- Android package name과 iOS bundle ID
- iOS `LaunchScreen.storyboard`에서 `Powered by React Native`, `Welcome to React Native`, 기술 target name 제거
- Android launch theme/splash를 제품 로고/앱 첫 화면 배경과 맞춤
- 초기 RN 렌더가 늦어 네이티브 런치 화면 뒤에 빈 화면이 보이면 `react-native-bootsplash` 또는 동등한 native hold mechanism 적용

## Release

- Android release build는 RPI ARC runner로 보내지 않는다.
- App Store build는 macOS/Xcode runner에서만 수행한다.
- signing 정보는 `AGENTS.local.md`, CI secret, store docs에 분리해서 관리한다.
- cold start에서 제품 브랜딩 스플래시만 노출되는지 iOS/Android 실기기 또는 simulator/emulator로 확인한다.
