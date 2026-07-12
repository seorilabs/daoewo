# Dependencies

## Package Manager

- pnpm: `11.3.0`
- Node in Seorilabs ARC: `24.16.0`
- Root engine: `>=24 <27`

## React Native

2026-07-12 실제 scaffold/lock 기준:

- `react-native`: `0.86.0`
- `react`: `19.2.3`
- `@react-native-community/cli`: `20.1.0` (RN 0.86 생성기 호환값)
- `typescript`: mobile/UI `5.8.x`, catalog/functions `5.9.x`
- Android: Temurin JDK `21`, Gradle `9.3.1`, API/target `36`, min API `24`
- iOS local verification: Xcode `26.6`, CocoaPods `1.16.2`, xcodeproj `1.27.0`, deployment target `15.1`

정책:

- `apps/mobile`은 Community CLI로 RN 0.86.0 native project를 생성했다.
- RN native dependency는 실제 target 생성 후 `apps/mobile/package.json`과 lockfile 기준으로 확정한다.
- Android Gradle은 repo의 `.java-version`대로 표준 JDK 21을 사용한다. GraalVM JDK 22는
  Android 36 `JdkImageTransform`의 `jlink` 단계에서 실패한 실제 이력이 있어 지원 조합으로
  사용하지 않는다.
- iOS Firebase pods는 static framework로 링크하고 Analytics의 IDFA variant를 제외한다.
- RN 0.86 + RNFirebase 25.1 static framework의 CocoaPods modulemap 충돌은 `Podfile`
  post-install에서 RNFB target에만 non-modular include를 허용하고 `RNFBApp.modulemap`의
  중복 wildcard submodule만 제거한다. `pod install` 2회와 simulator build로 멱등성을 검증한다.
- Firebase Apple SDK의 CocoaPods 배포는 2026년 10월 이후 새 버전이 중단될 예정이므로,
  기존 설치는 유지하되 SPM 전환을 dependency upgrade 일감으로 둔다.

구매/로그인 adapter lock 기준:

- `react-native-iap`: `15.4.0`
- `@react-native-google-signin/google-signin`: `16.1.2`
- `@invertase/react-native-apple-authentication`: `2.5.1`
- `@noble/hashes`: `2.2.0` (store account binding hash/UUID)

## AppsInToss

2026-07-12 npm/실제 scaffold 확인값:

- `@apps-in-toss/framework`: `2.10.5`
- `@granite-js/react-native`: `1.0.36`
- `@toss/tds-react-native`: `2.0.4`
- `react-native-safe-area-context`: `5.6.2` (Granite runtime과 정합)

정책:

- 신규 AppsInToss 비게임 app은 Granite RN + TDS React Native를 사용한다.
- `apps/ait` 생성 후 `granite.config.ts`와 AppsInToss console 값을 `docs/05-markets/apps-in-toss.md`에 반영한다.
- `.ait` artifact는 기본적으로 커밋하지 않는다.
- 공식 IAP 정기결제 지원 기준은 RN SDK `1.12.0+`, Toss App iOS `5.250.0`, Android
  `5.253.0`이다. 현재 Sandbox App은 구독 테스트를 지원하지 않는다.
- AppsInToss client IAP seam과 서버 partner provider는 별개다. 현재 Functions provider는
  공식 인증 계약·mTLS 인증서를 연결하기 전까지 unconfigured/fail-closed다.

## Firebase

2026-07-12 npm stable 확인값:

- `firebase`: `12.16.0`
- `firebase-admin`: `13.10.0`
- `firebase-functions`: `7.2.5`
- `@react-native-firebase/app`: `25.1.0`
- `@apple/app-store-server-library`: `3.1.0`
- `googleapis`: `173.0.0`

정책:

- `apps/mobile`은 native Firebase module을 우선 검토한다.
- `apps/ait`은 native Firebase module을 가정하지 않는다. AIT runtime 검증 전에는 server API 또는 constrained adapter로 둔다.
- Firebase가 필요 없는 local-only MVP에는 Firebase 코드를 미리 추가하지 않는다.
- Google Play provider는 Cloud Functions runtime service account의 ADC를 사용한다.
- Apple IAP private key와 root certificate set은 Secret Manager로만 주입하며 client나
  repo에 포함하지 않는다.

공식 서버 검증 문서:

- Google Play Developer API: https://developer.android.com/google/play/developer-api
- App Store Server API: https://developer.apple.com/documentation/appstoreserverapi/
- Apple receipt validation migration: https://developer.apple.com/documentation/storekit/validating-receipts-with-the-app-store
- AppsInToss IAP subscription: https://developers-apps-in-toss.toss.im/bedrock/reference/framework/%EC%9D%B8%EC%95%B1%20%EA%B2%B0%EC%A0%9C/subscription.html

## GitHub Actions

2026-07-12 GitHub Releases API 확인 기준:

- `actions/checkout@v7`
- `actions/setup-node@v6`
- `actions/setup-java@v5`
- `actions/upload-artifact@v7`

## Policy

- SDK 버전은 실제 프로젝트 생성 시 공식 문서와 repo-local lockfile로 확정한다.
- `@latest`나 branch ref보다 확인된 stable major tag를 선호한다.
- Actions minutes 보호를 위해 Dependabot version update는 현재 비활성이다. 보안 경보는 별도 운영한다.
