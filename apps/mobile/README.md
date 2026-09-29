# 다외워 모바일

Google Play와 App Store용 bare React Native 0.86 타깃이다. 공통 화면은
`@daoewo/product-ui`, 규칙은 `@daoewo/product-core`, 공개 카탈로그 메타는
`@daoewo/product-catalog`를 사용한다.

## Runtime 설정

`src/runtime-config.ts`가 공개 runtime 식별자의 원장이다.

- `firebaseEnabled`: Firebase 앱 등록·native config가 모두 준비된 뒤에만 `true`
- `googleWebClientId`: Google 로그인용 Web client ID
- `subscriptionProductIds.monthly` / `annual`: Play와 App Store에 실제 등록한 상품 ID
- `releaseMetadata`: FCM 설치 진단용 현재 앱 버전/build(권한·entitlement 권위 아님)
- `legalUrls.terms` / `privacy`: 결제 CTA에서 여는 공개 HTTPS 약관 URL

현재 위 값은 비어 있거나 비활성 상태다. `android/app/google-services.json`과
`ios/Daoewo/GoogleService-Info.plist`도 아직 없으므로 앱은 Free-only local runtime으로 시작하고,
로그인·동기화·구매·복원은 fail-closed 된다. 빈 상품 ID나 가격/체험 문자열을 UI에 대신
표시하지 않는다.

승인된 Free 본문·목표·진도는 계정별 로컬 key에 번들/캐시되어 네트워크 없이 학습할 수
있다. Firebase 익명 로그인을 새로 만들 수 없는 완전 오프라인 상태에서는 scoped local
guest를 사용하고, 이후 로그인 성공 시 해당 Free 상태를 UID key로 옮긴다. Firebase가
구성된 계정은 시작·로그인·학습 완료 때 본문 없는 Free snapshot을 서버와 pull/merge/push한다.
Free는 해시로 바인딩된 primary device 한 대, Pro는 여러 기기를 허용하며 Pro progress는
서버 권위 상태로 hydrate한다. 실패 시 로컬 기록을 보존하고 다음 동기화 기회에 재시도한다.
로그아웃 시 scoped local state를 지운다.

## 로컬 검증

저장소 루트에서 실행한다.

```bash
pnpm --filter @daoewo/mobile typecheck
pnpm --filter @daoewo/mobile test --runInBand
pnpm --filter @daoewo/mobile start
pnpm --filter @daoewo/mobile android
pnpm --filter @daoewo/mobile ios
```

### 미승인 콘텐츠 DEV Preview

`content-pipeline/.work/*.json` 중 실제 source로 생성되고 자동 QA를 통과했지만 아직 사람
승인 전인 레코드만 Debug 앱에서 확인할 수 있다. 생성물은
`apps/mobile/.work/content-preview.generated.json`에 만들어지며 gitignore 대상이다.

터미널 두 개에서 다음을 실행한다.

```bash
# 1. 검증·생성 후 Preview 전용 Metro(8082)
pnpm run dev:mobile:preview

# 2. Preview Metro를 명시적으로 사용하는 Debug target
pnpm run ios:mobile:preview
# 또는
pnpm run android:mobile:preview
```

연결한 iPhone을 지정하려면 두 번째 터미널에서 root shortcut 대신 다음 명령을 쓴다.

```bash
pnpm --filter @daoewo/mobile exec react-native run-ios \
  --device "<iPhone 이름>" --scheme Daoewo --mode Debug \
  --xcconfig Preview.xcconfig --port 8082 --no-packager
```

Preview는 `index.preview.js`와 `metro.preview.config.js`를 통해서만 진입한다. 상단에
`DEV · 미승인 콘텐츠`가 항상 표시되고 Analytics, cloud sync, purchase, share,
notification, deck request는 외부 전송 불가 상태다. production `index.js`와 기본 Metro는
Preview 코드나 `.work` artifact를 import하지 않는다. iOS의 `Preview.xcconfig`는 Debug Preview
빌드에서만 `index.preview.bundle`과 8082를 고정해, 다른 프로젝트의 8081 Metro에 연결되는 것을
막는다. 8082에 연결할 수 없으면 앱에 포함된 `preview.jsbundle`로 기동하므로 실기기에서도
콘텐츠를 확인할 수 있다. 이때 새 콘텐츠 반영에는 Preview 앱 재빌드가 필요하다. 일반 Debug와
Release 빌드에는 이 compile condition과 내장 Preview 번들이 없다.

iOS native dependency가 바뀌면 다음을 먼저 실행한다.

```bash
cd apps/mobile/ios
bundle exec pod install
```

`scripts/restore-mobile-firebase-config.mjs --ios --require`는 검증된 plist를 위 경로에
복원하고 Google 로그인용 reversed client URL scheme을 `Info.plist`에 주입한다. 설정이
없는 Debug simulator는 offline runtime으로 빌드되지만 Release는 native config 없이 실패한다.

## FCM / APNs 준비 상태

저장소에는 iOS Push Notifications·Background Modes, 환경별 `aps-environment`, Android
`POST_NOTIFICATIONS`·기본 알림 channel/icon/color가 설정되어 있다. FCM token과 iOS APNs
등록은 `firebase.json`에서 기본 비활성화하며, 사용자가 신규·요청 덱 알림을 켠 뒤에만 native 권한
요청과 계정별 설치 등록을 시작한다. 신규 덱도 서버가 현재 opt-in 계정의 설치 목록을
조회해 multicast한다. Android 13 권한은 app-local `NativeDaoewoNotifications.requestPermission()`
경계가 요청하고, iOS는 `UNUserNotificationCenter` 결과를 동일한 boolean 계약으로 반환한다.

다음 항목은 저장소 밖의 release blocker이며 완료 전 FCM 실전 준비로 보지 않는다.

- Apple Developer App ID의 Push Notifications 활성화
- APNs Auth Key(`.p8`)·Key ID·Team ID의 Firebase Console 등록. private key는 커밋하지 않는다.
- development/distribution provisioning profile에 올바른 APNs entitlement 포함
- Firebase iOS/Android app 등록과 검증된 `GoogleService-Info.plist` / `google-services.json`
- 서명된 실기기에서 권한 허용·token 등록·Firebase live send·background/quit 수신 확인

클라이언트는 raw FCM token을 등록 호출 중에만 전달하고 console/native log 또는 사용자에게
노출하지 않는다. 표시 payload는 고정된 제품 문구와 `kind=deck-ready` 또는
`kind=catalog-published`만 허용하며 UID,
request/deck ID, 학습 본문, 카드 앞·뒤 내용은 넣지 않는다. `RemoteMessage` 전체나 provider
원본 오류를 로그하지 않는다.

Android는 저장소의 `.java-version`에 맞춰 Temurin JDK 21을 사용한다. release 후보는
`apps/mobile/android/app/build/outputs/bundle/release/app-release.aab` 존재만으로 완료가
아니며, signing·Play App Signing·internal track QA가 별도 게이트다.

## 구독 권위

클라이언트는 스토어가 반환한 현지 가격·청구 주기·실제 체험 자격만 표시한다. 구매 시작 시
Firebase UID에 결정적으로 묶인 Play `obfuscatedExternalAccountId` 또는 Apple
`appAccountToken`을 전달하고, 권한은 Functions의 서버 영수증 검증 결과만 따른다.

출시 전에는 다음이 모두 필요하다.

- Play/App Store 월·연 상품 생성과 mobile/runtime/Functions allowlist 일치
- Google Play Developer API runtime service account 권한
- App Store App Apple ID, IAP issuer/key ID, Secret Manager private key·Apple root 인증서
- 구매·복원·환불·grace/billing retry sandbox 검증
- 서버가 Free를 반환한 비익명 계정은 앱 세션당 한 번 현재 스토어 구매를 재검증해 누락된
  갱신 이벤트를 복구한다. 이 경로의 sandbox 성공·실패 E2E는 별도 live gate다.
- 공개 이용약관·개인정보처리방침 URL

실제 blocker는 저장소 루트의 `pnpm run check:release`로 확인한다.

## 기기 설정·내보내기

일일 09시와 가장 빠른 복습 알림은 Android/iOS local scheduler가 처리하며 Functions scheduler를
사용하지 않는다. Android는 exact-alarm 특별 권한 없이 절전 친화적 alarm을 사용하므로 전달이
지연될 수 있다. TTS는 양 플랫폼 native speech engine을 사용하고 설정 OFF 시 실제 호출을 막는다.
음성 가이드는 React Native 접근성 announcement로 제공한다. 주간 기록 공유와 JSON 내보내기는
system share sheet를 열며 JSON에는 목표·압축 progress·세션 수치만 포함한다.

Remote Config는 카탈로그 cache TTL과 신규·요청 덱 push kill-switch 두 key만 허용한다. 템플릿 기본값과
mobile local defaults는 `pnpm run test:scripts`에서 일치 여부를 검증한다.

## 개인정보 disclosure 경계

앱이 Crashlytics에 직접 추가하는 non-fatal 진단은 고정 operation/surface/error code만 사용하지만,
native Crashlytics SDK의 crash stack·관련 app state·기기/OS 기본 수집은 별도다. Google federated
로그인은 이름·이메일·UID와 fraud prevention용 IP 기반 대략적 위치를 처리할 수 있고, FCM은
계정별 설치 등록과 메시지 전송을 위해 token·설치 ID·기기 model·language·timezone·OS·앱
version을 처리한다.
`PrivacyInfo.xcprivacy`, App Store config와 `docs/05-markets/privacy-data-inventory.md`를 이 실제
SDK 경계와 함께 갱신한다.
